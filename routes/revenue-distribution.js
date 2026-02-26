import express from "express";
import admin from "firebase-admin";
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import secondarySaleVerificationService from "../services/secondarySaleVerification.js";
import NFTVerificationService from "../services/nftVerification.js";
import { distributeFees } from "../utils/feeDistribution.js";
import {
  REWARD_TIERS,
  calculateHolderShare,
  calculateTier3Rewards,
  calculateRankBasedRewards,
  mergeUserAllocations,
  getSolPrice,
} from "../utils/rewardTierCalculator.js";
import {
  getCurrentDistributionId,
  getDistributionMonthName,
} from "../utils/distributionScheduler.js";

const router = express.Router();

// Configuration
const CONFIG = {
  // Legacy single amount (kept for backward compatibility)
  ALLOCATION_AMOUNT_USD: parseFloat(
    process.env.REVENUE_DISTRIBUTION_AMOUNT_USD || "5.00",
  ),

  // Multi-token distribution pool (weight-based) - LEGACY
  POOL_SOL: 0.16,
  POOL_EMPIRE: 22500,
  POOL_MKIN: 100000,

  // NEW: Multi-tier reward structure (February 2026+)
  REWARD_TIERS: {
    HOLDER_SHARE: {
      enabled: true,
      minNfts: 1,
      royaltyPercentage: 0.35, // 35% of royalty pool
    },
    TIER_3: {
      enabled: true,
      minNfts: 12,
      poolSol: 1.5,
    },
    TIER_2: {
      enabled: true,
      maxRank: 5,
      poolSol: 1.5,
      poolMkin: 300000,
    },
    TIER_1: {
      enabled: true,
      maxRank: 3,
      poolSol: 1.5,
      poolEmpire: 450000,
      poolMkin: 300000,
    },
  },

  // Total royalty pool for the month (set via environment or admin)
  TOTAL_ROYALTY_POOL_USD: parseFloat(
    process.env.REVENUE_DISTRIBUTION_ROYALTY_POOL_USD || "1000",
  ),

  // Token mint addresses
  EMPIRE_MINT: "EmpirdtfUMfBQXEjnNmTngeimjfizfuSBD3TN9zqzydj",
  MKIN_MINT:
    process.env.MKIN_TOKEN_MINT ||
    "BKDGf6DnDHK87GsZpdWXyBqiNdcNb6KnoFcYbWPUhJLA",

  MIN_NFTS: parseInt(process.env.REVENUE_DISTRIBUTION_MIN_NFTS || "1"),
  CLAIM_FEE_USD: Math.max(
    parseFloat(
      process.env.REVENUE_DISTRIBUTION_CLAIM_FEE_USD || "1.00", // $0.10 base + $0.90 site fee
    ),
    1.0,
  ), // Enforce minimum $1.00 claim fee even if env is outdated
  TOKEN_ACCOUNT_CREATION_FEE_USD: 1.0, // $1.00 per token account creation
  EXPIRY_DAYS: parseInt(process.env.REVENUE_DISTRIBUTION_EXPIRY_DAYS || "30"),
  SECRET_TOKEN:
    process.env.REVENUE_DISTRIBUTION_SECRET_TOKEN || "your-secret-token",
  USER_REWARDS_COLLECTION: "userRewards",
  ALLOCATIONS_COLLECTION: "revenueDistributionAllocations",
  CLAIMS_COLLECTION: "revenueDistributionClaims",
  
  // Distribution schedule: 'last' = last day of month, or number 1-31
  DISTRIBUTION_DAY: process.env.REVENUE_DISTRIBUTION_DAY || "last",
};

// Active contract addresses for NFT verification
const ACTIVE_CONTRACTS = [
  "89KnhXiCHb2eGP2jRGzEQX3B8NTyqHEVmu55syDWSnL8", // therealmkin
  "eTQujiFKVvLJXdkAobg9JqULNdDrCt5t4WtDochmVSZ", // realmkin_helius
  "EzjhzaTBqXohJTsaMKFSX6fgXcDJyXAV85NK7RK79u3Z", // realmkin_mass_mint
].map((addr) => addr.toLowerCase());

/**
 * Helper: Get Solana connection
 */
function getConnection() {
  return new Connection(
    process.env.HELIUS_MAINNET_RPC_URL || process.env.SOLANA_RPC_URL,
    "confirmed",
  );
}

/**
 * Helper: Verify secret token
 */
function verifySecretToken(req, res, next) {
  const token =
    req.headers["authorization"]?.replace("Bearer ", "") || req.query.token;

  if (!token || token !== CONFIG.SECRET_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Invalid or missing secret token",
    });
  }

  next();
}

/**
 * Helper: Verify Firebase authentication
 */
async function verifyFirebaseAuth(req, res, next) {
  try {
    const token = req.headers["authorization"]?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: No authentication token provided",
      });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);
    req.userId = decodedToken.uid;
    next();
  } catch (error) {
    console.error("Auth verification error:", error.message);
    return res.status(401).json({
      success: false,
      error: "Unauthorized: Invalid authentication token",
    });
  }
}

/**
 * Helper: Calculate SOL amount from USD
 */
async function getUsdInSol(usdAmount) {
  try {
    const { getFeeInSol } = await import("../utils/solPrice.js");
    return await getFeeInSol(usdAmount);
  } catch (error) {
    console.error("Error calculating USD to SOL:", error.message);
    throw error;
  }
}

/**
 * Helper: Verify SOL transfer on-chain
 */
async function verifySolTransfer(signature, minAmountSol, maxAmountSol) {
  try {
    const connection = getConnection();

    // Get gatekeeper address from keypair
    const gatekeeperKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.GATEKEEPER_KEYPAIR)),
    );
    const gatekeeperAddr = gatekeeperKeypair.publicKey.toBase58();

    const tx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return false;
    }

    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      if (ix.program === "system" && ix.parsed?.type === "transfer") {
        const info = ix.parsed.info;
        const solAmount = info.lamports / 1e9;

        if (
          info.destination === gatekeeperAddr &&
          solAmount >= minAmountSol &&
          solAmount <= maxAmountSol
        ) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error("Error verifying SOL transfer:", error.message);
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
      throw new Error("STAKING_PRIVATE_KEY not configured");
    }

    const vaultKeypair = Keypair.fromSecretKey(bs58.decode(stakingKey));
    const userPubkey = new PublicKey(userWallet);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: vaultKeypair.publicKey,
        toPubkey: userPubkey,
        lamports: Math.floor(amountSol * 1e9),
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = vaultKeypair.publicKey;

    transaction.sign(vaultKeypair);
    const signature = await connection.sendRawTransaction(
      transaction.serialize(),
    );
    await connection.confirmTransaction(signature, "confirmed");

    console.log(
      `✅ Sent ${amountSol} SOL to ${userWallet}, signature: ${signature}`,
    );
    return signature;
  } catch (error) {
    console.error("Failed to send SOL from treasury:", error);
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
router.post("/allocate", verifySecretToken, async (req, res) => {
  const isDryRun = req.query.dryRun === "true";
  const startTime = Date.now();

  console.log(`\n${"=".repeat(80)}`);
  console.log(`🚀 REVENUE DISTRIBUTION ALLOCATION STARTED`);
  console.log(`${"=".repeat(80)}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Dry Run: ${isDryRun}`);
  console.log(`Min NFTs: ${CONFIG.MIN_NFTS}`);
  console.log(`Allocation Amount: $${CONFIG.ALLOCATION_AMOUNT_USD} USD`);

  try {
    const db = admin.firestore();
    const distributionId = getCurrentDistributionId();

    // Step 1: Check if already allocated for this month
    if (!isDryRun) {
      const existingAllocations = await db
        .collection(CONFIG.ALLOCATIONS_COLLECTION)
        .where("distributionId", "==", distributionId)
        .limit(1)
        .get();

      if (!existingAllocations.empty) {
        console.warn(`⚠️ Allocation already exists for ${distributionId}`);
        return res.status(400).json({
          success: false,
          error: `Allocation already executed for ${distributionId}`,
          distributionId,
        });
      }
    }

    // Step 2: Load all users with wallets (using pagination)
    console.log(`\n📖 Step 1: Loading users with wallets (paginated)...`);
    const allUsers = [];
    let lastDoc = null;
    let pageNum = 1;
    const pageSize = 100;

    while (true) {
      let query = db
        .collection(CONFIG.USER_REWARDS_COLLECTION)
        .where("walletAddress", "!=", null)
        .orderBy("walletAddress")
        .limit(pageSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        break;
      }

      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.walletAddress?.trim()) {
          allUsers.push({
            userId: doc.id,
            walletAddress: data.walletAddress,
            totalRealmkin: data.totalRealmkin || 0,
          });
        }
      });

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      console.log(
        `   📄 Page ${pageNum}: Fetched ${snapshot.docs.length} users (total: ${allUsers.length})`,
      );
      pageNum++;

      if (snapshot.docs.length < pageSize) {
        break;
      }
    }

    console.log(
      `✅ Loaded ${allUsers.length} users with wallets (fetched via pagination)`,
    );

    // Step 3: Filter by NFT count (fast, no API calls)
    console.log(
      `\n🔍 Step 2: Filtering by NFT count (>= ${CONFIG.MIN_NFTS})...`,
    );
    const nftEligible = allUsers.filter(
      (u) => u.totalRealmkin >= CONFIG.MIN_NFTS,
    );
    console.log(`✅ ${nftEligible.length} users have ${CONFIG.MIN_NFTS}+ NFTs`);

    // Step 4: Verify secondary sales (RATE LIMITED - this is slow)
    // TEMPORARILY DISABLED FOR TESTING - Remove comments to re-enable
    /*
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
    */

    // TEMPORARY: Skip secondary market check for testing
    console.log(
      `\n⚠️ Step 3: Secondary market verification DISABLED (testing mode)`,
    );
    const eligible = nftEligible;
    console.log(
      `✅ ${eligible.length} users eligible (secondary market check bypassed)`,
    );

    // Step 4: Calculate MULTI-TIER rewards (February 2026+)
    console.log(`\n📊 Step 4: Calculating multi-tier rewards...`);
    
    // Fetch secondary market leaderboard for Tier calculations
    let secondaryMarketLeaderboard = [];
    try {
      const leaderboardModule = await import('./leaderboard.js');
      // Get top 50 for tier calculations
      secondaryMarketLeaderboard = await leaderboardModule.getSecondaryMarketLeaderboardData(50);
      console.log(`   📊 Fetched ${secondaryMarketLeaderboard.length} entries from secondary market leaderboard`);
    } catch (error) {
      console.warn(`   ⚠️ Could not fetch secondary market leaderboard: ${error.message}`);
    }

    // Create map of wallet -> purchase count for Tier 3
    const secondaryPurchaseMap = new Map(
      secondaryMarketLeaderboard.map(e => [e.walletAddress, e.nftCount || e.purchaseCount || 0])
    );

    // Calculate each tier
    const allTierAllocations = [];

    // Holder Share: 35% royalty to all NFT holders (1+ NFTs)
    const holderSharePool = CONFIG.TOTAL_ROYALTY_POOL_USD * CONFIG.REWARD_TIERS.HOLDER_SHARE.royaltyPercentage;
    const holders = eligible.filter(u => u.totalRealmkin >= CONFIG.REWARD_TIERS.HOLDER_SHARE.minNfts);
    const holderAllocations = calculateHolderShare(holders, holderSharePool);
    allTierAllocations.push(...holderAllocations);
    console.log(`   🏰 Holder Share: ${holderAllocations.length} users, ${holderSharePool} USD pool`);

    // Tier 3: Special Perks (12+ NFTs)
    const tier3Eligible = eligible.filter(u => u.totalRealmkin >= CONFIG.REWARD_TIERS.TIER_3.minNfts);
    const tier3Allocations = calculateTier3Rewards(tier3Eligible, secondaryPurchaseMap);
    allTierAllocations.push(...tier3Allocations);
    console.log(`   🔱 Tier 3 (Special Perks): ${tier3Allocations.length} users, ${CONFIG.REWARD_TIERS.TIER_3.poolSol} SOL pool`);

    // Tier 2: Top 5
    const tier2Allocations = calculateRankBasedRewards(secondaryMarketLeaderboard, 'TIER_2');
    allTierAllocations.push(...tier2Allocations);
    console.log(`   ⚔️  Tier 2 (Top 5): ${tier2Allocations.length} users`);

    // Tier 1: Top 3
    const tier1Allocations = calculateRankBasedRewards(secondaryMarketLeaderboard, 'TIER_1');
    allTierAllocations.push(...tier1Allocations);
    console.log(`   👑 Tier 1 (Top 3): ${tier1Allocations.length} users`);

    // Merge allocations per user (users can be in multiple tiers)
    const mergedAllocations = mergeUserAllocations(allTierAllocations);
    console.log(`\n   📋 Merged ${allTierAllocations.length} tier allocations → ${mergedAllocations.length} unique users`);

    // Log top allocations
    const topAllocations = mergedAllocations
      .sort((a, b) => b.amountSol - a.amountSol)
      .slice(0, 5);
    console.log(`\n   Top 5 total allocations:`);
    topAllocations.forEach((u, i) => {
      console.log(
        `   ${i + 1}. ${u.userId} - Tiers: ${u.tiers.join(', ')} → ${u.amountSol.toFixed(6)} SOL + ${u.amountMkin.toLocaleString()} MKIN + ${u.amountEmpire.toLocaleString()} EMPIRE`,
      );
    });

    const allocations = mergedAllocations;

    // Step 5: Store allocations in Firestore
    if (!isDryRun && allocations.length > 0) {
      console.log(
        `\n💾 Step 5: Storing ${allocations.length} allocations in Firestore...`,
      );

      const now = admin.firestore.Timestamp.now();
      const expiresAt = admin.firestore.Timestamp.fromMillis(
        Date.now() + CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      );

      // Batch write allocations (500 per batch - Firestore limit)
      const batchSize = 500;
      for (let i = 0; i < allocations.length; i += batchSize) {
        const batch = db.batch();
        const chunk = allocations.slice(i, i + batchSize);

        chunk.forEach((user) => {
          const docId = `${user.userId}_${distributionId}`;
          const docRef = db
            .collection(CONFIG.ALLOCATIONS_COLLECTION)
            .doc(docId);

          batch.set(docRef, {
            distributionId,
            userId: user.userId,
            walletAddress: user.walletAddress,
            nftCount: user.nftCount || user.totalRealmkin || 0,
            weight: user.totalWeight || user.weight || 0,
            amountSol: user.amountSol,
            amountEmpire: user.amountEmpire,
            amountMkin: user.amountMkin,
            // NEW: Tier breakdown (February 2026+)
            tiers: user.tiers || ['HOLDER_SHARE'],
            holderShareSol: user.holderShare?.amountSol || 0,
            holderShareEmpire: user.holderShare?.amountEmpire || 0,
            holderShareMkin: user.holderShare?.amountMkin || 0,
            tier3Sol: user.tier3?.amountSol || 0,
            tier3Empire: user.tier3?.amountEmpire || 0,
            tier3Mkin: user.tier3?.amountMkin || 0,
            tier2Sol: user.tier2?.amountSol || 0,
            tier2Empire: user.tier2?.amountEmpire || 0,
            tier2Mkin: user.tier2?.amountMkin || 0,
            tier1Sol: user.tier1?.amountSol || 0,
            tier1Empire: user.tier1?.amountEmpire || 0,
            tier1Mkin: user.tier1?.amountMkin || 0,
            // Legacy fields for backward compatibility
            hasSecondarySale: false, // TEMPORARY: Set to false during testing (was true)
            allocatedAmountUsd: CONFIG.ALLOCATION_AMOUNT_USD,
            eligibleAt: now,
            expiresAt: expiresAt,
            status: "pending",
            secondarySaleCheckedAt: now,
          });
        });

        await batch.commit();
        console.log(
          `   Wrote batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(eligible.length / batchSize)}`,
        );
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

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ ALLOCATION COMPLETED`);
    console.log(`${"=".repeat(80)}`);
    console.log(`Distribution ID: ${distributionId}`);
    console.log(`Total Users: ${stats.totalUsers}`);
    console.log(`NFT Eligible: ${stats.nftEligible}`);
    console.log(`Final Eligible: ${stats.eligible}`);
    console.log(`Total Allocated: $${stats.totalAllocatedUsd} USD`);
    console.log(`Duration: ${duration}s`);
    console.log(`Dry Run: ${isDryRun}`);
    console.log(`${"=".repeat(80)}\n`);

    res.json({
      success: true,
      stats,
      dryRun: isDryRun,
    });
  } catch (error) {
    console.error("❌ Allocation error:", error);
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
router.get(
  "/allocation-status/:distributionId",
  verifySecretToken,
  async (req, res) => {
    try {
      const db = admin.firestore();
      const { distributionId } = req.params;

      const allocationsSnapshot = await db
        .collection(CONFIG.ALLOCATIONS_COLLECTION)
        .where("distributionId", "==", distributionId)
        .get();

      let pending = 0;
      let claimed = 0;
      let expired = 0;
      const now = Date.now();

      allocationsSnapshot.forEach((doc) => {
        const data = doc.data();
        const status = data.status;
        const expiresAt = data.expiresAt?.toMillis();

        if (status === "claimed") {
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
      console.error("Error getting allocation status:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
);

/**
 * GET /api/revenue-distribution/cache-stats
 * Get secondary sale cache statistics
 */
router.get("/cache-stats", verifySecretToken, async (req, res) => {
  try {
    const stats = await secondarySaleVerificationService.getCacheStats();

    res.json({
      success: true,
      cacheStats: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error getting cache stats:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/revenue-distribution/clear-allocations
 * Clear allocation records for a specific distribution to allow re-running
 */
router.delete("/clear-allocations", verifySecretToken, async (req, res) => {
  try {
    const { distributionId } = req.body;

    if (!distributionId) {
      return res.status(400).json({
        success: false,
        error: "distributionId is required",
      });
    }

    console.log(`🗑️  Clearing allocations for ${distributionId}...`);

    const db = admin.firestore();

    // Delete from revenueDistributionAllocations
    const allocationsSnapshot = await db
      .collection("revenueDistributionAllocations")
      .where("distributionId", "==", distributionId)
      .get();

    if (allocationsSnapshot.empty) {
      return res.json({
        success: true,
        message: "No allocations found for this distribution",
        distributionId,
        deletedCount: 0,
      });
    }

    console.log(
      `   Found ${allocationsSnapshot.size} allocation records to delete`,
    );

    // Delete in batches
    const batchSize = 500;
    let deletedCount = 0;

    for (let i = 0; i < allocationsSnapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      const chunk = allocationsSnapshot.docs.slice(i, i + batchSize);

      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      deletedCount += chunk.length;
      console.log(
        `   Deleted ${deletedCount} / ${allocationsSnapshot.size}...`,
      );
    }

    console.log(
      `✅ Cleared ${deletedCount} allocation records for ${distributionId}`,
    );

    res.json({
      success: true,
      message: "Allocations cleared successfully",
      distributionId,
      deletedCount,
    });
  } catch (error) {
    console.error("Error clearing allocations:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/revenue-distribution/refresh-secondary-market
 * Manually refresh secondary sale cache using Magic Eden holder_stats API
 * Single API call gets ALL holders - much faster than per-wallet checks
 * Available to all authenticated users for refreshing leaderboard
 */
router.post("/refresh-secondary-market", async (req, res) => {
  try {
    const requestId = Date.now();
    console.log(`\n${"=".repeat(80)}`);
    console.log(
      `🔄 [REFRESH-${requestId}] Secondary Market Cache Refresh Started (Using holder_stats API)`,
    );
    console.log(`${"=".repeat(80)}`);

    const db = admin.firestore();
    const collectionSymbol = req.body.collectionSymbol || "the_realmkin";

    // Step 0: Get last fetch metadata for incremental updates
    console.log(
      `📊 [REFRESH-${requestId}] Step 0: Checking last fetch metadata...`,
    );
    const metadataRef = db.collection("secondarySaleCache").doc("_metadata");
    const metadataDoc = await metadataRef.get();

    let lastFetchBlockTime = null;
    let isFirstFetch = false;

    if (metadataDoc.exists) {
      const metadata = metadataDoc.data();
      lastFetchBlockTime = metadata.lastBlockTime || null;
      const lastFetchDate = metadata.lastFetchedAt?.toDate();

      console.log(`   ✅ Found previous fetch metadata:`);
      console.log(
        `      Last block time: ${lastFetchBlockTime ? new Date(lastFetchBlockTime * 1000).toISOString() : "N/A"}`,
      );
      console.log(
        `      Last fetched at: ${lastFetchDate ? lastFetchDate.toISOString() : "N/A"}`,
      );
      console.log(`      Mode: INCREMENTAL (fetch only new activities)`);
    } else {
      isFirstFetch = true;
      console.log(`   🌟 First fetch detected - will fetch ALL-TIME history`);
      console.log(`      Mode: ALL-TIME (complete collection history)`);
    }

    // Get registered users for fallback
    const userRewardsSnapshot = await db
      .collection("userRewards")
      .where("walletAddress", "!=", null)
      .get();

    const walletsToRefresh = [];
    userRewardsSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.walletAddress) {
        walletsToRefresh.push({ userId: doc.id, wallet: data.walletAddress });
      }
    });

    console.log(`   Found ${walletsToRefresh.length} registered wallets`);

    // Step 1: Fetch secondary market activities from Magic Eden
    console.log(
      `📊 [REFRESH-${requestId}] Step 1: Fetching buyNow activities from Magic Eden...`,
    );
    console.log(`   Collection: ${collectionSymbol}`);
    console.log(
      `   Strategy: ${isFirstFetch ? "ALL-TIME fetch" : "INCREMENTAL fetch (new activities only)"}`,
    );

    let buyTransactions = [];
    let usedCollectionApi = false;
    let mostRecentBlockTime = lastFetchBlockTime;

    try {
      // Try collection-wide activities API
      console.log(`   🔄 Fetching activities...`);
      buyTransactions =
        await secondarySaleVerificationService.getCollectionActivities(
          collectionSymbol,
          {
            limit: 500,
            sinceBlockTime: lastFetchBlockTime, // null for first fetch (all-time), timestamp for incremental
          },
        );
      usedCollectionApi = true;

      // Track the most recent blockTime for next incremental fetch
      if (buyTransactions.length > 0) {
        mostRecentBlockTime = Math.max(
          ...buyTransactions.map((tx) => tx.blockTime),
        );
        console.log(
          `   📌 Most recent transaction: ${new Date(mostRecentBlockTime * 1000).toISOString()}`,
        );
      }

      console.log(
        `   ✅ Collection API successful: ${buyTransactions.length} buyNow transactions found`,
      );
    } catch (collectionError) {
      console.warn(`   ⚠️ Collection API failed: ${collectionError.message}`);
      console.log(`   🔄 Falling back to per-wallet verification...`);

      // Fallback: Check registered users individually
      const verificationResults =
        await secondarySaleVerificationService.batchVerifyUsers(
          walletsToRefresh.map((u) => u.wallet),
        );

      // Per-wallet API already updates cache, so we just use those results
      buyTransactions = verificationResults
        .filter((r) => r.hasSecondarySale)
        .map((r) => ({ buyer: r.wallet }));

      console.log(
        `   ✅ Per-wallet verification complete: ${buyTransactions.length} wallets with purchases`,
      );
    }

    // Step 2: Aggregate buyers and their purchase counts
    console.log(`📊 [REFRESH-${requestId}] Step 2: Aggregating buyer data...`);

    const buyerMap = new Map();

    if (usedCollectionApi) {
      // Count purchases per buyer from transactions
      for (const tx of buyTransactions) {
        const buyer = tx.buyer;
        if (!buyerMap.has(buyer)) {
          buyerMap.set(buyer, {
            count: 0,
            lastPurchase: tx.blockTime || Date.now(),
          });
        }
        const data = buyerMap.get(buyer);
        data.count++;
        // Track most recent purchase
        if (tx.blockTime && tx.blockTime > data.lastPurchase) {
          data.lastPurchase = tx.blockTime;
        }
      }
    } else {
      // Use cached data from per-wallet verification
      for (const wallet of walletsToRefresh) {
        const cached = await secondarySaleVerificationService.getCachedResult(
          wallet.wallet,
        );
        if (cached && cached.hasSecondarySale) {
          buyerMap.set(wallet.wallet, {
            count: cached.salesCount || 0,
            lastPurchase: cached.lastCheckedAt?.toMillis() || Date.now(),
          });
        }
      }
    }

    console.log(`   ✅ Found ${buyerMap.size} unique buyers`);

    // Step 3: Update cache with buyer data
    console.log(
      `📊 [REFRESH-${requestId}] Step 3: Updating cache with buyer data...`,
    );

    let updatedCount = 0;
    const BATCH_SIZE = 500;
    const buyerEntries = Array.from(buyerMap.entries());

    for (let i = 0; i < buyerEntries.length; i += BATCH_SIZE) {
      const batchBuyers = buyerEntries.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const [walletAddress, data] of batchBuyers) {
        const cacheRef = db.collection("secondarySaleCache").doc(walletAddress);
        // Determine if we should increment or set
        let salesCountValue = data.count;
        if (usedCollectionApi && !isFirstFetch) {
          salesCountValue = admin.firestore.FieldValue.increment(data.count);
        }

        batch.set(
          cacheRef,
          {
            walletAddress,
            salesCount: salesCountValue,
            lastCheckedAt: admin.firestore.Timestamp.now(),
            hasSecondarySale: true, // If in buyerMap, it has sales
            lastPurchaseTime: admin.firestore.Timestamp.fromMillis(
              data.lastPurchase,
            ),
          },
          { merge: true },
        );
        updatedCount++;
      }

      await batch.commit();
      console.log(
        `   Batch ${Math.floor(i / BATCH_SIZE) + 1}: Updated ${batchBuyers.length} records`,
      );
    }

    console.log(`   ✅ Total updated: ${updatedCount} buyer records`);

    // Step 4: Update metadata for next incremental fetch
    console.log(`📊 [REFRESH-${requestId}] Step 4: Updating fetch metadata...`);
    await metadataRef.set(
      {
        lastBlockTime: mostRecentBlockTime,
        lastFetchedAt: admin.firestore.Timestamp.now(),
        totalBuyers: buyerMap.size,
        totalTransactions: buyTransactions.length,
        collectionSymbol,
        fetchMode: isFirstFetch ? "all-time" : "incremental",
      },
      { merge: true },
    );
    console.log(`   ✅ Metadata updated for next incremental fetch`);

    // Step 5: Invalidate leaderboard cache to force fresh data
    console.log(
      `📊 [REFRESH-${requestId}] Step 5: Invalidating leaderboard cache...`,
    );
    try {
      // Import leaderboard cache invalidation
      const leaderboardModule = await import("./leaderboard.js");
      if (leaderboardModule.invalidateSecondaryMarketCache) {
        leaderboardModule.invalidateSecondaryMarketCache();
        console.log(`   ✅ Leaderboard cache invalidated`);
      }
    } catch (err) {
      console.warn(
        `   ⚠️ Could not invalidate leaderboard cache:`,
        err.message,
      );
    }

    // Step 6: Get cache stats
    const cacheStats = await secondarySaleVerificationService.getCacheStats();
    const withSalesCount = Array.from(buyerMap.values()).filter(
      (d) => d.count > 0,
    ).length;

    console.log(`${"=".repeat(80)}`);
    console.log(
      `✅ [REFRESH-${requestId}] Secondary Market Cache Refresh Complete`,
    );
    console.log(
      `   Mode: ${isFirstFetch ? "ALL-TIME (first fetch)" : "INCREMENTAL (new data only)"}`,
    );
    console.log(`   Total buyers: ${buyerMap.size}`);
    console.log(`   With purchases: ${withSalesCount}`);
    console.log(`   Total transactions: ${buyTransactions.length}`);
    console.log(`   Cache entries updated: ${updatedCount}`);
    console.log(
      `   API calls: ${usedCollectionApi ? "Dynamic (paginated)" : Math.ceil(walletsToRefresh.length / 10)}`,
    );
    console.log(
      `   Method: ${usedCollectionApi ? "collection_activities" : "per_wallet_activities"}`,
    );
    console.log(
      `   Most recent activity: ${mostRecentBlockTime ? new Date(mostRecentBlockTime * 1000).toISOString() : "N/A"}`,
    );
    console.log(`   Cache stats:`, cacheStats);
    console.log(`${"=".repeat(80)}\n`);

    res.json({
      success: true,
      message: `Secondary market cache refreshed successfully - ${isFirstFetch ? "ALL-TIME history fetched" : "Incremental update completed"}`,
      stats: {
        mode: isFirstFetch ? "all-time" : "incremental",
        totalBuyers: buyerMap.size,
        withPurchases: withSalesCount,
        totalTransactions: buyTransactions.length,
        cacheUpdated: updatedCount,
        method: usedCollectionApi
          ? "collection_activities"
          : "per_wallet_activities",
        fallbackUsed: !usedCollectionApi,
        mostRecentActivity: mostRecentBlockTime
          ? new Date(mostRecentBlockTime * 1000).toISOString()
          : null,
        cacheStats,
      },
    });
  } catch (error) {
    console.error("Error refreshing secondary market cache:", error);
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
router.delete("/clear-cache", verifySecretToken, async (req, res) => {
  try {
    console.log("🗑️  Clearing secondary sale cache...");

    const db = admin.firestore();
    const CACHE_COLLECTION = "secondarySaleCache";

    const snapshot = await db.collection(CACHE_COLLECTION).get();

    if (snapshot.empty) {
      return res.json({
        success: true,
        message: "Cache is already empty",
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

      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      deletedCount += chunk.length;
      console.log(`   Deleted ${deletedCount} / ${snapshot.size} entries...`);
    }

    console.log(`✅ Cache cleared: ${deletedCount} documents deleted`);

    res.json({
      success: true,
      message: "Cache cleared successfully",
      deletedCount,
    });
  } catch (error) {
    console.error("Error clearing cache:", error);
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
router.get("/check-eligibility", verifyFirebaseAuth, async (req, res) => {
  try {
    const db = admin.firestore();
    const userId = req.userId;
    const distributionId = getCurrentDistributionId();

    // Check if user has an allocation for current month
    const docId = `${userId}_${distributionId}`;
    const allocationDoc = await db
      .collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .get();

    if (!allocationDoc.exists) {
      return res.json({
        success: true,
        eligible: false,
        reason: "No allocation found for current month",
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
        reason: "Allocation expired",
        distributionId,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    }

    // Check if already claimed
    if (allocation.status === "claimed") {
      return res.json({
        success: true,
        eligible: false,
        reason: "Already claimed",
        distributionId,
        claimedAt: allocation.claimedAt?.toDate().toISOString(),
      });
    }

    // User is eligible!
    res.json({
      success: true,
      eligible: true,
      distributionId,
      amountSol: allocation.amountSol || 0,
      amountEmpire: allocation.amountEmpire || 0,
      amountMkin: allocation.amountMkin || 0,
      weight: allocation.weight || 0,
      amountUsd: allocation.allocatedAmountUsd,
      claimFeeUsd: CONFIG.CLAIM_FEE_USD,
      expiresAt: new Date(expiresAt).toISOString(),
      nftCount: allocation.nftCount,
      // NEW: Tier breakdown (February 2026+)
      userTiers: allocation.tiers || ['HOLDER_SHARE'],
      tierBreakdown: {
        holderShare: {
          sol: allocation.holderShareSol || 0,
          empire: allocation.holderShareEmpire || 0,
          mkin: allocation.holderShareMkin || 0,
        },
        tier3: {
          sol: allocation.tier3Sol || 0,
          empire: allocation.tier3Empire || 0,
          mkin: allocation.tier3Mkin || 0,
        },
        tier2: {
          sol: allocation.tier2Sol || 0,
          empire: allocation.tier2Empire || 0,
          mkin: allocation.tier2Mkin || 0,
        },
        tier1: {
          sol: allocation.tier1Sol || 0,
          empire: allocation.tier1Empire || 0,
          mkin: allocation.tier1Mkin || 0,
        },
      },
      // Distribution month name for display
      distributionMonth: getDistributionMonthName(distributionId),
    });
  } catch (error) {
    console.error("Error checking eligibility:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/revenue-distribution/calculate-fee
 * Calculate the exact fee needed for claiming (for frontend verification)
 */
router.get("/calculate-fee", verifyFirebaseAuth, async (req, res) => {
  try {
    const db = admin.firestore();
    const userId = req.userId;

    // Get user's wallet address
    const userDoc = await db
      .collection(CONFIG.USER_REWARDS_COLLECTION)
      .doc(userId)
      .get();

    if (!userDoc.exists || !userDoc.data().walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address not found",
      });
    }

    const walletAddress = userDoc.data().walletAddress;

    // Check token accounts
    const connection = getConnection();
    const userPubkey = new PublicKey(walletAddress);

    const empireMint = new PublicKey(CONFIG.EMPIRE_MINT);
    const mkinMint = new PublicKey(CONFIG.MKIN_MINT);

    const userEmpireAta = await getAssociatedTokenAddress(
      empireMint,
      userPubkey,
    );
    const userMkinAta = await getAssociatedTokenAddress(mkinMint, userPubkey);

    const [empireAccount, mkinAccount] = await Promise.all([
      connection.getAccountInfo(userEmpireAta),
      connection.getAccountInfo(userMkinAta),
    ]);

    const needsEmpireAccount = !empireAccount;
    const needsMkinAccount = !mkinAccount;
    const accountsToCreate =
      (needsEmpireAccount ? 1 : 0) + (needsMkinAccount ? 1 : 0);

    // Calculate fees
    const {
      solAmount: baseFeeAmount,
      usdAmount: baseFeeUsd,
      solPrice,
    } = await getUsdInSol(CONFIG.CLAIM_FEE_USD);
    const accountCreationFeeUsd =
      accountsToCreate * CONFIG.TOKEN_ACCOUNT_CREATION_FEE_USD;
    const totalExpectedFeeUsd = CONFIG.CLAIM_FEE_USD + accountCreationFeeUsd;
    const { solAmount: totalExpectedFeeSol } =
      await getUsdInSol(totalExpectedFeeUsd);

    console.log(`💵 Fee calculation for user ${userId}:`);
    console.log(`   Wallet: ${walletAddress}`);
    console.log(
      `   Base fee: $${CONFIG.CLAIM_FEE_USD} = ${baseFeeAmount.toFixed(6)} SOL`,
    );
    console.log(
      `   Token accounts to create: ${accountsToCreate} (EMPIRE: ${needsEmpireAccount}, MKIN: ${needsMkinAccount})`,
    );
    console.log(
      `   Account creation fee: $${accountCreationFeeUsd.toFixed(2)}`,
    );
    console.log(
      `   Total fee: $${totalExpectedFeeUsd.toFixed(2)} = ${totalExpectedFeeSol.toFixed(6)} SOL`,
    );
    console.log(`   SOL price: $${solPrice.toFixed(2)}`);

    res.json({
      success: true,
      baseFeeUsd: CONFIG.CLAIM_FEE_USD,
      accountCreationFeeUsd,
      totalFeeUsd: totalExpectedFeeUsd,
      baseFeeSOL: baseFeeAmount,
      totalFeeSol: totalExpectedFeeSol,
      solPrice,
      accountsToCreate: {
        empire: needsEmpireAccount,
        mkin: needsMkinAccount,
        count: accountsToCreate,
      },
      empireMint: CONFIG.EMPIRE_MINT,
      mkinMint: CONFIG.MKIN_MINT,
    });
  } catch (error) {
    console.error("Error calculating fee:", error);
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
router.post("/claim", verifyFirebaseAuth, async (req, res) => {
  const operationId = `REVENUE_CLAIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const logPrefix = `[${operationId}]`;

  try {
    const db = admin.firestore();
    const userId = req.userId;
    const { feeSignature, distributionId } = req.body;

    if (!feeSignature || !distributionId) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: feeSignature and distributionId",
      });
    }

    console.log(`${logPrefix} 🚀 Revenue claim started`);
    console.log(`${logPrefix} User: ${userId}`);
    console.log(`${logPrefix} Distribution: ${distributionId}`);
    console.log(`${logPrefix} Fee TX: ${feeSignature}`);

    // Step 1: Check allocation exists and is claimable
    const docId = `${userId}_${distributionId}`;
    const allocationDoc = await db
      .collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .get();

    if (!allocationDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "No allocation found for this distribution",
      });
    }

    const allocation = allocationDoc.data();

    // Check if expired
    const now = Date.now();
    const expiresAt = allocation.expiresAt?.toMillis();
    if (expiresAt && now > expiresAt) {
      return res.status(400).json({
        success: false,
        error: "Allocation has expired",
      });
    }

    // Check if already claimed
    if (allocation.status === "claimed") {
      return res.status(400).json({
        success: false,
        error: "Already claimed for this distribution",
      });
    }

    // Step 2: Check for duplicate claim transaction
    const existingClaim = await db
      .collection(CONFIG.CLAIMS_COLLECTION)
      .where("feeTx", "==", feeSignature)
      .limit(1)
      .get();

    if (!existingClaim.empty) {
      return res.status(400).json({
        success: false,
        error: "This transaction has already been processed",
      });
    }

    // Step 3: Check and create token accounts if needed
    console.log(`${logPrefix} 🔍 Checking token accounts...`);
    const connection = getConnection();
    const userPubkey = new PublicKey(allocation.walletAddress);

    // Load gatekeeper keypair (byte array format)
    const gatekeeperKeypair = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.GATEKEEPER_KEYPAIR)),
    );
    const gatekeeperPubkey = gatekeeperKeypair.publicKey;

    const empireMint = new PublicKey(CONFIG.EMPIRE_MINT);
    const mkinMint = new PublicKey(CONFIG.MKIN_MINT);

    const userEmpireAta = await getAssociatedTokenAddress(
      empireMint,
      userPubkey,
    );
    const userMkinAta = await getAssociatedTokenAddress(mkinMint, userPubkey);

    const [empireAccount, mkinAccount] = await Promise.all([
      connection.getAccountInfo(userEmpireAta),
      connection.getAccountInfo(userMkinAta),
    ]);

    const needsEmpireAccount = !empireAccount;
    const needsMkinAccount = !mkinAccount;
    const accountsToCreate =
      (needsEmpireAccount ? 1 : 0) + (needsMkinAccount ? 1 : 0);

    console.log(`${logPrefix} Token accounts status:`);
    console.log(
      `   EMPIRE: ${needsEmpireAccount ? "❌ Missing" : "✅ Exists"}`,
    );
    console.log(`   MKIN: ${needsMkinAccount ? "❌ Missing" : "✅ Exists"}`);

    // Step 4: Calculate total expected fee (base + account creation)
    const {
      solAmount: baseFeeAmount,
      usdAmount: baseFeeUsd,
      solPrice,
    } = await getUsdInSol(CONFIG.CLAIM_FEE_USD);
    const accountCreationFeeUsd =
      accountsToCreate * CONFIG.TOKEN_ACCOUNT_CREATION_FEE_USD;
    const totalExpectedFeeUsd = CONFIG.CLAIM_FEE_USD + accountCreationFeeUsd;
    const { solAmount: totalExpectedFeeSol } =
      await getUsdInSol(totalExpectedFeeUsd);

    console.log(`${logPrefix} 💵 Fee breakdown:`);
    console.log(
      `   Base claim fee: ${baseFeeAmount.toFixed(6)} SOL ($${CONFIG.CLAIM_FEE_USD})`,
    );
    console.log(
      `   Token account creation: $${accountCreationFeeUsd.toFixed(2)} ($${CONFIG.TOKEN_ACCOUNT_CREATION_FEE_USD} × ${accountsToCreate} accounts)`,
    );
    console.log(
      `   Total expected: ${totalExpectedFeeSol.toFixed(6)} SOL ($${totalExpectedFeeUsd.toFixed(2)})`,
    );

    // Step 5: Verify fee payment (with tolerance for price fluctuation and overpayment)
    console.log(`${logPrefix} 🔍 Verifying fee payment...`);
    // UPDATED: Increased tolerance to handle SOL price volatility and timing differences
    const tolerance = 1.0; // 100% tolerance for price fluctuation (VERY LAX)
    const overpaymentTolerance = 3.0; // Allow up to 300% overpayment (VERY LAX)
    const minFee = totalExpectedFeeSol * (1 - tolerance);
    const maxFee = totalExpectedFeeSol * (1 + tolerance + overpaymentTolerance);

    console.log(
      `${logPrefix}   Validation range: ${minFee.toFixed(6)} SOL - ${maxFee.toFixed(6)} SOL`,
    );

    const isValidFee = await verifySolTransfer(feeSignature, minFee, maxFee);

    if (!isValidFee) {
      console.error(`${logPrefix} ❌ Fee verification failed`);
      console.error(
        `${logPrefix}   Expected: ${totalExpectedFeeSol.toFixed(6)} SOL (min: ${minFee.toFixed(6)}, max: ${maxFee.toFixed(6)})`,
      );

      // Debug: Log what was actually found in the transaction
      try {
        const connection = getConnection();
        const gatekeeperKeypair = Keypair.fromSecretKey(
          new Uint8Array(JSON.parse(process.env.GATEKEEPER_KEYPAIR)),
        );
        const tx = await connection.getParsedTransaction(feeSignature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta) {
          console.error(`${logPrefix}   🔍 Transaction details:`);
          const instructions = tx.transaction.message.instructions;
          let foundTransfer = false;
          for (const ix of instructions) {
            if (ix.program === "system" && ix.parsed?.type === "transfer") {
              foundTransfer = true;
              const info = ix.parsed.info;
              const solAmount = info.lamports / 1e9;
              console.error(
                `${logPrefix}     Transfer found: ${solAmount.toFixed(6)} SOL`,
              );
              console.error(`${logPrefix}     From: ${info.source}`);
              console.error(`${logPrefix}     To: ${info.destination}`);
              console.error(
                `${logPrefix}     Expected destination: ${gatekeeperKeypair.publicKey.toBase58()}`,
              );
              console.error(
                `${logPrefix}     Destination match: ${info.destination === gatekeeperKeypair.publicKey.toBase58()}`,
              );
              console.error(
                `${logPrefix}     Amount in range: ${solAmount >= minFee && solAmount <= maxFee}`,
              );
            }
          }
          if (!foundTransfer) {
            console.error(
              `${logPrefix}     No SOL transfer instruction found in transaction`,
            );
          }
        } else {
          console.error(
            `${logPrefix}   Transaction not found or has no metadata`,
          );
        }
      } catch (debugError) {
        console.error(
          `${logPrefix}   Could not fetch transaction for debugging:`,
          debugError.message,
        );
      }

      // Log failed attempt to transaction history
      await db.collection("transactionHistory").add({
        userId,
        walletAddress: allocation.walletAddress,
        type: "revenue_claim_failed",
        status: "failed",
        amount: 0,
        description: `Revenue claim failed: Invalid fee payment (expected ${totalExpectedFeeSol.toFixed(6)} SOL)`,
        feeSignature,
        distributionId,
        errorReason: "Invalid fee payment",
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
      });

      return res.status(400).json({
        success: false,
        error: "Invalid fee payment",
      });
    }

    console.log(
      `${logPrefix} ✅ Fee verified: ${totalExpectedFeeSol.toFixed(6)} SOL`,
    );

    // Step 3.5: Distribute site fee split ($0.90 total) + base fee to treasury
    const feeDistributionResult = await distributeFees(
      "revenue",
      0.9,
      {
        sourceWallet: "gatekeeper",
        treasuryDestination: "gatekeeper",
        extraTreasuryUsd: 0.1,
      },
    );
    if (!feeDistributionResult.success) {
      console.warn(
        `${logPrefix} ⚠️ Fee distribution failed: ${feeDistributionResult.error}`,
      );
    }

    // Step 4: Get payout amounts (multi-token)
    const payoutSol = allocation.amountSol || 0;
    const payoutEmpire = allocation.amountEmpire || 0;
    const payoutMkin = allocation.amountMkin || 0;

    console.log(`${logPrefix} 💰 Payout:`);
    console.log(`   ${payoutSol.toFixed(6)} SOL`);
    console.log(`   ${payoutEmpire.toFixed(2)} EMPIRE`);
    console.log(`   ${payoutMkin.toFixed(2)} MKIN`);
    console.log(
      `   Weight: ${(allocation.weight * 100).toFixed(2)}% (${allocation.nftCount} NFTs)`,
    );

    // Step 5: Check gatekeeper balance (SOL only - assuming tokens are pre-funded)
    const gatekeeperBalance = await connection.getBalance(gatekeeperPubkey);
    const gatekeeperBalanceSol = gatekeeperBalance / 1e9;

    const requiredSol = payoutSol + 0.005; // payout + gas buffer (multi-instruction tx)
    if (gatekeeperBalanceSol < requiredSol) {
      console.error(`${logPrefix} ❌ Insufficient gatekeeper SOL balance`);
      return res.status(503).json({
        success: false,
        error: "Service temporarily unavailable. Please try again later.",
      });
    }

    // Step 6: Build multi-token transfer transaction
    console.log(`${logPrefix} 💸 Building multi-token transfer transaction...`);

    const transaction = new Transaction();
    const { createAssociatedTokenAccountInstruction } =
      await import("@solana/spl-token");

    // Create token accounts if needed (FIRST)
    const accountsCreated = [];
    if (needsEmpireAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          gatekeeperPubkey, // payer
          userEmpireAta, // ata
          userPubkey, // owner
          empireMint, // mint
        ),
      );
      accountsCreated.push("EMPIRE");
      console.log(`${logPrefix}   ✓ Added EMPIRE token account creation`);
    }

    if (needsMkinAccount) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          gatekeeperPubkey,
          userMkinAta,
          userPubkey,
          mkinMint,
        ),
      );
      accountsCreated.push("MKIN");
      console.log(`${logPrefix}   ✓ Added MKIN token account creation`);
    }

    // Add SOL transfer
    if (payoutSol > 0) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: gatekeeperPubkey,
          toPubkey: userPubkey,
          lamports: Math.round(payoutSol * 1e9),
        }),
      );
      console.log(
        `${logPrefix}   ✓ Added SOL transfer: ${payoutSol.toFixed(6)}`,
      );
    }

    // Add EMPIRE token transfer
    if (payoutEmpire > 0) {
      const gatekeeperEmpireAta = await getAssociatedTokenAddress(
        empireMint,
        gatekeeperPubkey,
      );

      // Check gatekeeper EMPIRE balance
      const empireBalance =
        await connection.getTokenAccountBalance(gatekeeperEmpireAta);
      const empireAmount = Math.round(payoutEmpire * 1e5); // EMPIRE has 5 decimals!
      console.log(
        `${logPrefix}   Gatekeeper EMPIRE balance: ${empireBalance.value.uiAmount} (${empireBalance.value.amount} base units)`,
      );
      console.log(
        `${logPrefix}   EMPIRE to transfer: ${payoutEmpire} (${empireAmount} base units)`,
      );

      if (BigInt(empireBalance.value.amount) < BigInt(empireAmount)) {
        throw new Error(
          `Insufficient EMPIRE balance: has ${empireBalance.value.uiAmount}, needs ${payoutEmpire}`,
        );
      }

      transaction.add(
        createTransferInstruction(
          gatekeeperEmpireAta,
          userEmpireAta,
          gatekeeperPubkey,
          Math.round(payoutEmpire * 1e5), // EMPIRE has 5 decimals
        ),
      );
      console.log(
        `${logPrefix}   ✓ Added EMPIRE transfer: ${payoutEmpire.toFixed(2)}`,
      );
    }

    // Add MKIN token transfer
    if (payoutMkin > 0) {
      const gatekeeperMkinAta = await getAssociatedTokenAddress(
        mkinMint,
        gatekeeperPubkey,
      );

      // Check gatekeeper MKIN balance
      const mkinBalance =
        await connection.getTokenAccountBalance(gatekeeperMkinAta);
      const mkinAmount = Math.round(payoutMkin * 1e9);
      console.log(
        `${logPrefix}   Gatekeeper MKIN balance: ${mkinBalance.value.uiAmount} (${mkinBalance.value.amount} base units)`,
      );
      console.log(
        `${logPrefix}   MKIN to transfer: ${payoutMkin} (${mkinAmount} base units)`,
      );

      if (BigInt(mkinBalance.value.amount) < BigInt(mkinAmount)) {
        throw new Error(
          `Insufficient MKIN balance: has ${mkinBalance.value.uiAmount}, needs ${payoutMkin}`,
        );
      }

      transaction.add(
        createTransferInstruction(
          gatekeeperMkinAta,
          userMkinAta,
          gatekeeperPubkey,
          Math.round(payoutMkin * 1e9), // MKIN has 9 decimals
        ),
      );
      console.log(
        `${logPrefix}   ✓ Added MKIN transfer: ${payoutMkin.toFixed(2)}`,
      );
    }

    // Send transaction
    console.log(`${logPrefix} 📡 Sending multi-token transaction...`);
    let payoutSignature;
    try {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = gatekeeperPubkey;

      // Sign and send
      transaction.sign(gatekeeperKeypair);
      const rawTransaction = transaction.serialize();

      // Initial send
      payoutSignature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 3,
      });
      console.log(
        `${logPrefix}   🚀 Sent payout, initial signature: ${payoutSignature}`,
      );

      // Persistent retry loop
      console.log(
        `${logPrefix}   ⏳ Waiting for confirmation (persistent retry mode)...`,
      );

      const startTime = Date.now();
      const timeout = 90000; // 90s
      let confirmed = false;

      while (Date.now() - startTime < timeout) {
        const status = await connection.getSignatureStatus(payoutSignature);

        if (status && status.value) {
          if (
            status.value.confirmationStatus === "confirmed" ||
            status.value.confirmationStatus === "finalized"
          ) {
            if (status.value.err) {
              throw new Error(
                `Transaction failed on-chain: ${JSON.stringify(status.value.err)}`,
              );
            }
            console.log(
              `${logPrefix}   ✅ Confirmed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
            );
            confirmed = true;
            break;
          }
        }

        // Re-send every 2s
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          await connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 0,
          });
        } catch (e) {
          // Ignore "already processed"
        }
      }

      if (!confirmed) {
        throw new Error(
          "Transaction confirmation timed out (90s). It may still land.",
        );
      }
    } catch (payoutError) {
      console.error(`${logPrefix} ❌ Payout failed:`, payoutError);

      // Log failed payout for manual recovery
      await db.collection("failed_payouts").add({
        userId,
        type: "REVENUE_DISTRIBUTION",
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
        status: "PENDING_RECOVERY",
      });

      // Log failed attempt to transaction history
      await db.collection("transactionHistory").add({
        userId,
        walletAddress: allocation.walletAddress,
        type: "revenue_claim_failed",
        status: "failed",
        amount: 0,
        description: `Revenue claim payout failed: ${payoutError.message}`,
        feeSignature,
        distributionId,
        expectedAmountSol: payoutSol,
        expectedAmountEmpire: payoutEmpire,
        expectedAmountMkin: payoutMkin,
        errorReason: payoutError.message,
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
      });

      return res.status(500).json({
        success: false,
        error:
          "Payout failed. Your claim has been logged for manual processing. Please contact support.",
      });
    }

    // Step 7: Update allocation, create claim record, and log to transaction history
    const claimTimestamp = admin.firestore.Timestamp.now();

    await db.runTransaction(async (transaction) => {
      // Update allocation status
      transaction.update(allocationDoc.ref, {
        status: "claimed",
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
        status: "completed",
      });

      // Log successful claim to transaction history
      const txHistoryRef = db.collection("transactionHistory").doc();
      transaction.set(txHistoryRef, {
        userId,
        walletAddress: allocation.walletAddress,
        type: "revenue_claim",
        status: "completed",
        amount: payoutMkin, // Show MKIN as primary amount
        description: `Revenue distribution claimed: ${payoutMkin.toFixed(2)} MKIN, ${payoutEmpire.toFixed(2)} EMPIRE, ${payoutSol.toFixed(6)} SOL`,
        distributionId,
        amountSol: payoutSol,
        amountEmpire: payoutEmpire,
        amountMkin: payoutMkin,
        feeSignature,
        payoutSignature,
        accountsCreated: accountsCreated.join(", ") || "none",
        timestamp: claimTimestamp,
        createdAt: claimTimestamp,
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
router.get("/history", verifyFirebaseAuth, async (req, res) => {
  try {
    const db = admin.firestore();
    const userId = req.userId;

    const claimsSnapshot = await db
      .collection(CONFIG.CLAIMS_COLLECTION)
      .where("userId", "==", userId)
      .orderBy("claimedAt", "desc")
      .get();

    const claims = [];
    claimsSnapshot.forEach((doc) => {
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
    console.error("Error getting claim history:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
