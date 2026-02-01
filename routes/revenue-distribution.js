import express from 'express';
import admin from 'firebase-admin';
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import secondarySaleVerificationService from '../services/secondarySaleVerification.js';
import NFTVerificationService from '../services/nftVerification.js';

const router = express.Router();

// Configuration
const CONFIG = {
  // Legacy single amount (kept for backward compatibility)
  ALLOCATION_AMOUNT_USD: parseFloat(process.env.REVENUE_DISTRIBUTION_AMOUNT_USD || '5.00'),
  
  // Multi-token distribution pool (weight-based)
  POOL_SOL: 0.16,
  POOL_EMPIRE: 22500,
  POOL_MKIN: 100000,
  
  // Token mint addresses
  EMPIRE_MINT: 'EmpirdtfUMfBQXEjnNmTngeimjfizfuSBD3TN9zqzydj',
  MKIN_MINT: 'MKiNfTBT83DH1GK4azYyypSvQVPhN3E3tGYiHcR2BPR',
  
  MIN_NFTS: parseInt(process.env.REVENUE_DISTRIBUTION_MIN_NFTS || '1'),
  CLAIM_FEE_USD: parseFloat(process.env.REVENUE_DISTRIBUTION_CLAIM_FEE_USD || '0.10'),
  EXPIRY_DAYS: parseInt(process.env.REVENUE_DISTRIBUTION_EXPIRY_DAYS || '30'),
  TOKEN_ACCOUNT_RENT: 0.00203928, // Rent-exempt minimum for token accounts
  SECRET_TOKEN: process.env.REVENUE_DISTRIBUTION_SECRET_TOKEN || 'your-secret-token',
  USER_REWARDS_COLLECTION: 'userRewards',
  ALLOCATIONS_COLLECTION: 'revenueDistributionAllocations',
  CLAIMS_COLLECTION: 'revenueDistributionClaims',
};

// Active contract addresses for NFT verification
const ACTIVE_CONTRACTS = [
  '89KnhXiCHb2eGP2jRGzEQX3B8NTyqHEVmu55syDWSnL8', // therealmkin
  'eTQujiFKVvLJXdkAobg9JqULNdDrCt5t4WtDochmVSZ',  // realmkin_helius
  'EzjhzaTBqXohJTsaMKFSX6fgXcDJyXAV85NK7RK79u3Z',  // realmkin_mass_mint
].map(addr => addr.toLowerCase());

/**
 * Helper: Get Solana connection
 */
function getConnection() {
  const { Connection } = require('@solana/web3.js');
  return new Connection(
    process.env.HELIUS_MAINNET_RPC_URL || process.env.SOLANA_RPC_URL,
    'confirmed'
  );
}

/**
 * Helper: Generate distribution ID for current month
 */
function getCurrentDistributionId() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `revenue_dist_${year}_${month}`;
}

/**
 * Helper: Verify secret token
 */
function verifySecretToken(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
  
  if (!token || token !== CONFIG.SECRET_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing secret token'
    });
  }
  
  next();
}

/**
 * Helper: Verify Firebase authentication
 */
async function verifyFirebaseAuth(req, res, next) {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: No authentication token provided'
      });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error('Auth verification error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid authentication token'
    });
  }
}

/**
 * Helper: Calculate SOL amount from USD
 */
async function getUsdInSol(usdAmount) {
  try {
    const { getFeeInSol } = await import('../utils/solPrice.js');
    return await getFeeInSol(usdAmount);
  } catch (error) {
    console.error('Error calculating USD to SOL:', error.message);
    throw error;
  }
}

/**
 * Helper: Verify SOL transfer on-chain
 */
async function verifySolTransfer(signature, minAmountSol, maxAmountSol) {
  try {
    const connection = getConnection();
    const stakingAddr = process.env.STAKING_WALLET_ADDRESS;
    
    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return false;
    }

    const instructions = tx.transaction.message.instructions;
    
    for (const ix of instructions) {
      if (ix.program === 'system' && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        const solAmount = info.lamports / 1e9;
        
        if (info.destination === stakingAddr && 
            solAmount >= minAmountSol && 
            solAmount <= maxAmountSol) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('Error verifying SOL transfer:', error.message);
    return false;
  }
}

/**
 * Helper: Send SOL from treasury to user
 */
async function sendSolFromTreasury(userWallet, amountSol) {
  try {
    const connection = getConnection();
    const stakingKey = process.env.STAKING_PRIVATE_KEY;
    
    if (!stakingKey) {
      throw new Error('STAKING_PRIVATE_KEY not configured');
    }

    const vaultKeypair = Keypair.fromSecretKey(bs58.decode(stakingKey));
    const userPubkey = new PublicKey(userWallet);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: vaultKeypair.publicKey,
        toPubkey: userPubkey,
        lamports: Math.floor(amountSol * 1e9),
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = vaultKeypair.publicKey;

    transaction.sign(vaultKeypair);
    const signature = await connection.sendRawTransaction(
      transaction.serialize()
    );
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`✅ Sent ${amountSol} SOL to ${userWallet}, signature: ${signature}`);
    return signature;
  } catch (error) {
    console.error('Failed to send SOL from treasury:', error);
    throw new Error(`SOL transfer failed: ${error.message}`);
  }
}

// ============================================================================
// ADMIN ENDPOINTS (Require Secret Token)
// ============================================================================

/**
 * POST /api/revenue-distribution/allocate
 * Run monthly allocation process
 * Marks eligible users who can claim $5
 * 
 * Query params:
 * - dryRun=true: Test run without writing to database
 */
router.post('/allocate', verifySecretToken, async (req, res) => {
  const isDryRun = req.query.dryRun === 'true';
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 REVENUE DISTRIBUTION ALLOCATION STARTED`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Dry Run: ${isDryRun}`);
  console.log(`Min NFTs: ${CONFIG.MIN_NFTS}`);
  console.log(`Allocation Amount: $${CONFIG.ALLOCATION_AMOUNT_USD} USD`);
  
  try {
    const db = admin.firestore();
    const distributionId = getCurrentDistributionId();
    
    // Step 1: Check if already allocated for this month
    if (!isDryRun) {
      const existingAllocations = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
        .where('distributionId', '==', distributionId)
        .limit(1)
        .get();
      
      if (!existingAllocations.empty) {
        console.warn(`⚠️ Allocation already exists for ${distributionId}`);
        return res.status(400).json({
          success: false,
          error: `Allocation already executed for ${distributionId}`,
          distributionId
        });
      }
    }
    
    // Step 2: Load all users with wallets
    console.log(`\n📖 Step 1: Loading users with wallets...`);
    const usersSnapshot = await db.collection(CONFIG.USER_REWARDS_COLLECTION)
      .where('walletAddress', '!=', null)
      .get();
    
    const allUsers = [];
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.walletAddress?.trim()) {
        allUsers.push({
          userId: doc.id,
          walletAddress: data.walletAddress,
          totalRealmkin: data.totalRealmkin || 0,
        });
      }
    });
    
    console.log(`✅ Loaded ${allUsers.length} users with wallets`);
    
    // Step 3: Filter by NFT count (fast, no API calls)
    console.log(`\n🔍 Step 2: Filtering by NFT count (>= ${CONFIG.MIN_NFTS})...`);
    const nftEligible = allUsers.filter(u => u.totalRealmkin >= CONFIG.MIN_NFTS);
    console.log(`✅ ${nftEligible.length} users have ${CONFIG.MIN_NFTS}+ NFTs`);
    
    // Step 4: Verify secondary sales (RATE LIMITED - this is slow)
    console.log(`\n⏳ Step 3: Verifying secondary market purchases (RATE LIMITED)...`);
    console.log(`This may take 10-15 minutes for ${nftEligible.length} users...`);
    
    const wallets = nftEligible.map(u => u.walletAddress);
    const secondarySaleResults = await secondarySaleVerificationService.batchVerifyUsers(
      wallets,
      (progress) => {
        // Progress callback
        const percent = ((progress.processed / progress.total) * 100).toFixed(1);
        console.log(`   Progress: ${percent}% (${progress.processed}/${progress.total})`);
      }
    );
    
    // Map results back to users
    const secondarySaleMap = new Map(
      secondarySaleResults.map(r => [r.wallet, r.hasSecondarySale])
    );
    
    const eligible = nftEligible.filter(u => secondarySaleMap.get(u.walletAddress) === true);
    
    console.log(`\n✅ ${eligible.length} users have secondary market purchases`);
    
    // Step 4: Calculate weight-based shares
    console.log(`\n📊 Step 4: Calculating weight-based distribution...`);
    const totalNFTs = eligible.reduce((sum, user) => sum + user.totalRealmkin, 0);
    console.log(`   Total NFTs across all eligible users: ${totalNFTs}`);
    console.log(`   Pool: ${CONFIG.POOL_SOL} SOL, ${CONFIG.POOL_EMPIRE} EMPIRE, ${CONFIG.POOL_MKIN} MKIN`);
    
    // Calculate each user's share
    const allocations = eligible.map(user => {
      const weight = user.totalRealmkin / totalNFTs;
      return {
        ...user,
        weight: weight,
        amountSol: CONFIG.POOL_SOL * weight,
        amountEmpire: CONFIG.POOL_EMPIRE * weight,
        amountMkin: CONFIG.POOL_MKIN * weight,
      };
    });
    
    // Log distribution summary
    console.log(`\n📋 Distribution Summary:`);
    console.log(`   Users: ${allocations.length}`);
    console.log(`   Total SOL to distribute: ${CONFIG.POOL_SOL}`);
    console.log(`   Total EMPIRE to distribute: ${CONFIG.POOL_EMPIRE}`);
    console.log(`   Total MKIN to distribute: ${CONFIG.POOL_MKIN}`);
    console.log(`\n   Top 5 allocations:`);
    allocations.slice(0, 5).forEach((u, i) => {
      console.log(`   ${i+1}. ${u.userId} - ${u.totalRealmkin} NFTs (${(u.weight*100).toFixed(2)}%) = ${u.amountSol.toFixed(6)} SOL + ${u.amountEmpire.toFixed(2)} EMPIRE + ${u.amountMkin.toFixed(2)} MKIN`);
    });
    
    // Step 5: Store allocations in Firestore
    if (!isDryRun && allocations.length > 0) {
      console.log(`\n💾 Step 5: Storing ${allocations.length} allocations in Firestore...`);
      
      const now = admin.firestore.Timestamp.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + (CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      );
      
      // Batch write allocations (500 per batch - Firestore limit)
      const batchSize = 500;
      for (let i = 0; i < allocations.length; i += batchSize) {
        const batch = db.batch();
        const chunk = allocations.slice(i, i + batchSize);
        
        chunk.forEach(user => {
          const docId = `${user.userId}_${distributionId}`;
          const docRef = db.collection(CONFIG.ALLOCATIONS_COLLECTION).doc(docId);
          
          batch.set(docRef, {
            distributionId,
            userId: user.userId,
            walletAddress: user.walletAddress,
            nftCount: user.totalRealmkin,
            weight: user.weight,
            amountSol: user.amountSol,
            amountEmpire: user.amountEmpire,
            amountMkin: user.amountMkin,
            hasSecondarySale: true,
            // Legacy field for backward compatibility
            allocatedAmountUsd: CONFIG.ALLOCATION_AMOUNT_USD,
            eligibleAt: now,
            expiresAt: expiresAt,
            status: 'pending',
            secondarySaleCheckedAt: now,
          });
        });
        
        await batch.commit();
        console.log(`   Wrote batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(eligible.length / batchSize)}`);
      }
      
      console.log(`✅ Stored ${eligible.length} allocations`);
    }
    
    // Calculate stats
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const stats = {
      distributionId,
      totalUsers: allUsers.length,
      nftEligible: nftEligible.length,
      eligible: eligible.length,
      allocatedAmountUsd: CONFIG.ALLOCATION_AMOUNT_USD,
      totalAllocatedUsd: eligible.length * CONFIG.ALLOCATION_AMOUNT_USD,
      minNfts: CONFIG.MIN_NFTS,
      expiryDays: CONFIG.EXPIRY_DAYS,
      durationSeconds: parseFloat(duration),
      timestamp: new Date().toISOString(),
    };
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ ALLOCATION COMPLETED`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Distribution ID: ${distributionId}`);
    console.log(`Total Users: ${stats.totalUsers}`);
    console.log(`NFT Eligible: ${stats.nftEligible}`);
    console.log(`Final Eligible: ${stats.eligible}`);
    console.log(`Total Allocated: $${stats.totalAllocatedUsd} USD`);
    console.log(`Duration: ${duration}s`);
    console.log(`Dry Run: ${isDryRun}`);
    console.log(`${'='.repeat(80)}\n`);
    
    res.json({
      success: true,
      stats,
      dryRun: isDryRun,
    });
    
  } catch (error) {
    console.error('❌ Allocation error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/revenue-distribution/allocation-status/:distributionId
 * Get allocation status and stats for a specific distribution
 */
router.get('/allocation-status/:distributionId', verifySecretToken, async (req, res) => {
  try {
    const db = admin.firestore();
    const { distributionId } = req.params;
    
    const allocationsSnapshot = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .where('distributionId', '==', distributionId)
      .get();
    
    let pending = 0;
    let claimed = 0;
    let expired = 0;
    const now = Date.now();
    
    allocationsSnapshot.forEach(doc => {
      const data = doc.data();
      const status = data.status;
      const expiresAt = data.expiresAt?.toMillis();
      
      if (status === 'claimed') {
        claimed++;
      } else if (expiresAt && now > expiresAt) {
        expired++;
      } else {
        pending++;
      }
    });
    
    const total = allocationsSnapshot.size;
    const totalAllocatedUsd = total * CONFIG.ALLOCATION_AMOUNT_USD;
    const claimedUsd = claimed * CONFIG.ALLOCATION_AMOUNT_USD;
    const unclaimedUsd = (pending + expired) * CONFIG.ALLOCATION_AMOUNT_USD;
    
    res.json({
      success: true,
      distributionId,
      stats: {
        total,
        pending,
        claimed,
        expired,
        totalAllocatedUsd,
        claimedUsd,
        unclaimedUsd,
      },
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Error getting allocation status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/revenue-distribution/cache-stats
 * Get secondary sale cache statistics
 */
router.get('/cache-stats', verifySecretToken, async (req, res) => {
  try {
    const stats = await secondarySaleVerificationService.getCacheStats();
    
    res.json({
      success: true,
      cacheStats: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/revenue-distribution/clear-cache
 * Clear secondary sale verification cache
 */
router.delete('/clear-cache', verifySecretToken, async (req, res) => {
  try {
    console.log('🗑️  Clearing secondary sale cache...');
    
    const db = admin.firestore();
    const CACHE_COLLECTION = 'secondarySaleCache';
    
    const snapshot = await db.collection(CACHE_COLLECTION).get();
    
    if (snapshot.empty) {
      return res.json({
        success: true,
        message: 'Cache is already empty',
        deletedCount: 0,
      });
    }
    
    console.log(`   Found ${snapshot.size} cached entries, deleting...`);
    
    // Delete in batches of 500
    const batchSize = 500;
    let deletedCount = 0;
    
    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      const chunk = snapshot.docs.slice(i, i + batchSize);
      
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      deletedCount += chunk.length;
      console.log(`   Deleted ${deletedCount} / ${snapshot.size} entries...`);
    }
    
    console.log(`✅ Cache cleared: ${deletedCount} documents deleted`);
    
    res.json({
      success: true,
      message: 'Cache cleared successfully',
      deletedCount,
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================================
// USER ENDPOINTS (Require Firebase Authentication)
// ============================================================================

/**
 * GET /api/revenue-distribution/check-eligibility
 * Check if authenticated user is eligible to claim
 */
router.get('/check-eligibility', verifyFirebaseAuth, async (req, res) => {
  try {
    const db = admin.firestore();
    const userId = req.userId;
    const distributionId = getCurrentDistributionId();
    
    // Check if user has an allocation for current month
    const docId = `${userId}_${distributionId}`;
    const allocationDoc = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .get();
    
    if (!allocationDoc.exists) {
      return res.json({
        success: true,
        eligible: false,
        reason: 'No allocation found for current month',
        distributionId,
      });
    }
    
    const allocation = allocationDoc.data();
    
    // Check if expired
    const now = Date.now();
    const expiresAt = allocation.expiresAt?.toMillis();
    if (expiresAt && now > expiresAt) {
      return res.json({
        success: true,
        eligible: false,
        reason: 'Allocation expired',
        distributionId,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }
    
    // Check if already claimed
    if (allocation.status === 'claimed') {
      return res.json({
        success: true,
        eligible: false,
        reason: 'Already claimed',
        distributionId,
        claimedAt: allocation.claimedAt?.toDate().toISOString(),
      });
    }
    
    // User is eligible!
    res.json({
      success: true,
      eligible: true,
      distributionId,
      amountUsd: allocation.allocatedAmountUsd,
      claimFeeUsd: CONFIG.CLAIM_FEE_USD,
      expiresAt: new Date(expiresAt).toISOString(),
      nftCount: allocation.nftCount,
    });
    
  } catch (error) {
    console.error('Error checking eligibility:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/revenue-distribution/claim
 * User claims their allocation
 * 
 * Body: { feeSignature: string, distributionId: string }
 */
router.post('/claim', verifyFirebaseAuth, async (req, res) => {
  const operationId = `REVENUE_CLAIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const logPrefix = `[${operationId}]`;
  
  try {
    const db = admin.firestore();
    const userId = req.userId;
    const { feeSignature, distributionId } = req.body;
    
    if (!feeSignature || !distributionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: feeSignature and distributionId',
      });
    }
    
    console.log(`${logPrefix} 🚀 Revenue claim started`);
    console.log(`${logPrefix} User: ${userId}`);
    console.log(`${logPrefix} Distribution: ${distributionId}`);
    console.log(`${logPrefix} Fee TX: ${feeSignature}`);
    
    // Step 1: Check allocation exists and is claimable
    const docId = `${userId}_${distributionId}`;
    const allocationDoc = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .get();
    
    if (!allocationDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'No allocation found for this distribution',
      });
    }
    
    const allocation = allocationDoc.data();
    
    // Check if expired
    const now = Date.now();
    const expiresAt = allocation.expiresAt?.toMillis();
    if (expiresAt && now > expiresAt) {
      return res.status(400).json({
        success: false,
        error: 'Allocation has expired',
      });
    }
    
    // Check if already claimed
    if (allocation.status === 'claimed') {
      return res.status(400).json({
        success: false,
        error: 'Already claimed for this distribution',
      });
    }
    
    // Step 2: Check for duplicate claim transaction
    const existingClaim = await db.collection(CONFIG.CLAIMS_COLLECTION)
      .where('feeTx', '==', feeSignature)
      .limit(1)
      .get();
    
    if (!existingClaim.empty) {
      return res.status(400).json({
        success: false,
        error: 'This transaction has already been processed',
      });
    }
    
    // Step 3: Check and create token accounts if needed
    console.log(`${logPrefix} 🔍 Checking token accounts...`);
    const connection = getConnection();
    const userPubkey = new PublicKey(allocation.walletAddress);
    
    // Load gatekeeper keypair (byte array format)
    const gatekeeperKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.GATEKEEPER_KEYPAIR))
    );
    const gatekeeperPubkey = gatekeeperKeypair.publicKey;
    
    const empireMint = new PublicKey(CONFIG.EMPIRE_MINT);
    const mkinMint = new PublicKey(CONFIG.MKIN_MINT);
    
    const userEmpireAta = await getAssociatedTokenAddress(empireMint, userPubkey);
    const userMkinAta = await getAssociatedTokenAddress(mkinMint, userPubkey);
    
    const [empireAccount, mkinAccount] = await Promise.all([
      connection.getAccountInfo(userEmpireAta),
      connection.getAccountInfo(userMkinAta),
    ]);
    
    const needsEmpireAccount = !empireAccount;
    const needsMkinAccount = !mkinAccount;
    const accountsToCreate = (needsEmpireAccount ? 1 : 0) + (needsMkinAccount ? 1 : 0);
    
    console.log(`${logPrefix} Token accounts status:`);
    console.log(`   EMPIRE: ${needsEmpireAccount ? '❌ Missing' : '✅ Exists'}`);
    console.log(`   MKIN: ${needsMkinAccount ? '❌ Missing' : '✅ Exists'}`);
    
    // Step 4: Calculate total expected fee (base + account creation)
    const { solAmount: baseFeeAmount, usdAmount: baseFeeUsd, solPrice } = await getUsdInSol(CONFIG.CLAIM_FEE_USD);
    const accountCreationFeeUsd = accountsToCreate * CONFIG.TOKEN_ACCOUNT_RENT * solPrice;
    const totalExpectedFeeUsd = CONFIG.CLAIM_FEE_USD + accountCreationFeeUsd;
    const { solAmount: totalExpectedFeeSol } = await getUsdInSol(totalExpectedFeeUsd);
    
    console.log(`${logPrefix} 💵 Fee breakdown:`);
    console.log(`   Base fee: ${baseFeeAmount.toFixed(6)} SOL ($${CONFIG.CLAIM_FEE_USD})`);
    console.log(`   Account creation: ${(accountsToCreate * CONFIG.TOKEN_ACCOUNT_RENT).toFixed(6)} SOL ($${accountCreationFeeUsd.toFixed(4)}) for ${accountsToCreate} accounts`);
    console.log(`   Total expected: ${totalExpectedFeeSol.toFixed(6)} SOL ($${totalExpectedFeeUsd.toFixed(4)})`);
    
    // Step 5: Verify fee payment (with tolerance for price fluctuation)
    console.log(`${logPrefix} 🔍 Verifying fee payment...`);
    const tolerance = 0.20; // 20% tolerance for price fluctuation
    const minFee = totalExpectedFeeSol * (1 - tolerance);
    const maxFee = totalExpectedFeeSol * (1 + tolerance);
    
    const isValidFee = await verifySolTransfer(feeSignature, minFee, maxFee);
    
    if (!isValidFee) {
      console.error(`${logPrefix} ❌ Fee verification failed`);
      console.error(`${logPrefix}   Expected: ${totalExpectedFeeSol.toFixed(6)} SOL (min: ${minFee.toFixed(6)}, max: ${maxFee.toFixed(6)})`);
      return res.status(400).json({
        success: false,
        error: 'Invalid fee payment',
      });
    }
    
    console.log(`${logPrefix} ✅ Fee verified: ${totalExpectedFeeSol.toFixed(6)} SOL`);
    
    // Step 4: Get payout amounts (multi-token)
    const payoutSol = allocation.amountSol || 0;
    const payoutEmpire = allocation.amountEmpire || 0;
    const payoutMkin = allocation.amountMkin || 0;
    
    console.log(`${logPrefix} 💰 Payout:`);
    console.log(`   ${payoutSol.toFixed(6)} SOL`);
    console.log(`   ${payoutEmpire.toFixed(2)} EMPIRE`);
    console.log(`   ${payoutMkin.toFixed(2)} MKIN`);
    console.log(`   Weight: ${(allocation.weight * 100).toFixed(2)}% (${allocation.nftCount} NFTs)`);
    
    // Step 5: Check gatekeeper balance (SOL only - assuming tokens are pre-funded)
    const gatekeeperBalance = await connection.getBalance(gatekeeperPubkey);
    const gatekeeperBalanceSol = gatekeeperBalance / 1e9;
    
    const requiredSol = payoutSol + 0.005; // payout + gas buffer (multi-instruction tx)
    if (gatekeeperBalanceSol < requiredSol) {
      console.error(`${logPrefix} ❌ Insufficient gatekeeper SOL balance`);
      return res.status(503).json({
        success: false,
        error: 'Service temporarily unavailable. Please try again later.',
      });
    }
    
    // Step 6: Build multi-token transfer transaction
    console.log(`${logPrefix} 💸 Building multi-token transfer transaction...`);
    
    const transaction = new Transaction();
    const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
    
    // Create token accounts if needed (FIRST)
    const accountsCreated = [];
    if (needsEmpireAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          gatekeeperPubkey, // payer
          userEmpireAta,  // ata
          userPubkey,     // owner
          empireMint      // mint
        )
      );
      accountsCreated.push('EMPIRE');
      console.log(`${logPrefix}   ✓ Added EMPIRE token account creation`);
    }
    
    if (needsMkinAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          gatekeeperPubkey,
          userMkinAta,
          userPubkey,
          mkinMint
        )
      );
      accountsCreated.push('MKIN');
      console.log(`${logPrefix}   ✓ Added MKIN token account creation`);
    }
    
    // Add SOL transfer
    if (payoutSol > 0) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: gatekeeperPubkey,
          toPubkey: userPubkey,
          lamports: Math.round(payoutSol * 1e9),
        })
      );
      console.log(`${logPrefix}   ✓ Added SOL transfer: ${payoutSol.toFixed(6)}`);
    }
    
    // Add EMPIRE token transfer
    if (payoutEmpire > 0) {
      const gatekeeperEmpireAta = await getAssociatedTokenAddress(empireMint, gatekeeperPubkey);
      
      transaction.add(
        createTransferInstruction(
          gatekeeperEmpireAta,
          userEmpireAta,
          gatekeeperPubkey,
          Math.round(payoutEmpire * 1e9) // EMPIRE has 9 decimals
        )
      );
      console.log(`${logPrefix}   ✓ Added EMPIRE transfer: ${payoutEmpire.toFixed(2)}`);
    }
    
    // Add MKIN token transfer
    if (payoutMkin > 0) {
      const gatekeeperMkinAta = await getAssociatedTokenAddress(mkinMint, gatekeeperPubkey);
      
      transaction.add(
        createTransferInstruction(
          gatekeeperMkinAta,
          userMkinAta,
          gatekeeperPubkey,
          Math.round(payoutMkin * 1e9) // MKIN has 9 decimals
        )
      );
      console.log(`${logPrefix}   ✓ Added MKIN transfer: ${payoutMkin.toFixed(2)}`);
    }
    
    // Send transaction
    console.log(`${logPrefix} 📡 Sending multi-token transaction...`);
    let payoutSignature;
    try {
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = gatekeeperPubkey;
      
      // Sign and send
      transaction.sign(gatekeeperKeypair);
      payoutSignature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      
      // Wait for confirmation
      await connection.confirmTransaction(payoutSignature, 'confirmed');
      console.log(`${logPrefix} ✅ Payout successful: ${payoutSignature}`);
    } catch (payoutError) {
      console.error(`${logPrefix} ❌ Payout failed:`, payoutError);
      
      // Log failed payout for manual recovery
      await db.collection('failed_payouts').add({
        userId,
        type: 'REVENUE_DISTRIBUTION',
        distributionId,
        amountSol: payoutSol,
        amountEmpire: payoutEmpire,
        amountMkin: payoutMkin,
        amountUsd: allocation.allocatedAmountUsd, // legacy
        walletAddress: allocation.walletAddress,
        feeTx: feeSignature,
        feeAmountSol: totalExpectedFeeSol,
        error: payoutError.message,
        timestamp: admin.firestore.Timestamp.now(),
        status: 'PENDING_RECOVERY',
      });
      
      return res.status(500).json({
        success: false,
        error: 'Payout failed. Your claim has been logged for manual processing. Please contact support.',
      });
    }
    
    // Step 7: Update allocation and create claim record
    const claimTimestamp = admin.firestore.Timestamp.now();
    
    await db.runTransaction(async (transaction) => {
      // Update allocation status
      transaction.update(allocationDoc.ref, {
        status: 'claimed',
        claimedAt: claimTimestamp,
      });
      
      // Create claim record
      const claimRef = db.collection(CONFIG.CLAIMS_COLLECTION).doc();
      transaction.set(claimRef, {
        distributionId,
        userId,
        walletAddress: allocation.walletAddress,
        amountSol: payoutSol,
        amountEmpire: payoutEmpire,
        amountMkin: payoutMkin,
        nftCount: allocation.nftCount,
        weight: allocation.weight,
        // Legacy fields for backward compatibility
        amountUsd: allocation.allocatedAmountUsd,
        feeTx: feeSignature,
        feeAmountSol: totalExpectedFeeSol,
        feeAmountUsd: totalExpectedFeeUsd,
        baseFeeUsd: CONFIG.CLAIM_FEE_USD,
        accountCreationFeeUsd,
        accountsCreated,
        payoutTx: payoutSignature,
        claimedAt: claimTimestamp,
        status: 'completed',
      });
    });
    
    console.log(`${logPrefix} ✅ Claim completed successfully`);
    
    res.json({
      success: true,
      amountSol: payoutSol,
      amountEmpire: payoutEmpire,
      amountMkin: payoutMkin,
      amountUsd: allocation.allocatedAmountUsd,
      accountsCreated,
      payoutSignature,
      feeSignature,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error(`${logPrefix} ❌ Claim error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/revenue-distribution/history
 * Get authenticated user's claim history
 */
router.get('/history', verifyFirebaseAuth, async (req, res) => {
  try {
    const db = admin.firestore();
    const userId = req.userId;
    
    const claimsSnapshot = await db.collection(CONFIG.CLAIMS_COLLECTION)
      .where('userId', '==', userId)
      .orderBy('claimedAt', 'desc')
      .get();
    
    const claims = [];
    claimsSnapshot.forEach(doc => {
      const data = doc.data();
      claims.push({
        distributionId: data.distributionId,
        amountSol: data.amountSol,
        amountEmpire: data.amountEmpire,
        amountMkin: data.amountMkin,
        nftCount: data.nftCount,
        weight: data.weight,
        amountUsd: data.amountUsd, // legacy
        payoutTx: data.payoutTx,
        claimedAt: data.claimedAt?.toDate().toISOString(),
        status: data.status,
      });
    });
    
    res.json({
      success: true,
      claims,
      total: claims.length,
    });
    
  } catch (error) {
    console.error('Error getting claim history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
