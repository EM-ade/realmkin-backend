import admin from "firebase-admin";
import fetch from "node-fetch";
import { NFT_STAKING_CONFIG, TOTAL_ELIGIBLE_NFTS, isStakingPeriodOpen, isStakingPeriodEnded, getStakingPeriodStatus } from "../config/nftStaking.js";
import environmentConfig from "../config/environment.js";
import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, transfer, createTransferInstruction, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import bs58 from "bs58";

// Token Conversion Constants
const NEW_MKIN_MINT_ADDRESS = process.env.NEW_MKIN_MINT_ADDRESS || "Caj9oo8RWhkus2rTEHzjhd14bv4DokC9kQhfi1AcAFiD";

const NFT_STAKES_COLLECTION = "nft_stakes";

class NftStakingError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.name = "NftStakingError";
    this.code = code;
  }
}

class NftStakingService {
  constructor() {
    this._db = null;
    this._connection = null;
    this._vaultKeypair = null;
  }

  get db() {
    if (!this._db) {
      this._db = admin.firestore();
    }
    return this._db;
  }

  async _ensureInitialized() {
    if (!this._connection) {
      const networkConfig = environmentConfig.networkConfig;
      this._connection = new Connection(networkConfig.rpcUrl, 'finalized');
      
      // Use GATEKEEPER_KEYPAIR for NFT staking rewards
      const gatekeeperKeypairStr = process.env.GATEKEEPER_KEYPAIR;
      if (!gatekeeperKeypairStr) {
        throw new Error("GATEKEEPER_KEYPAIR not set in environment");
      }
      this._vaultKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(gatekeeperKeypairStr))
      );
    }
    return { connection: this._connection, vaultKeypair: this._vaultKeypair };
  }

  /**
   * Verify NFT ownership via Helius API
   */
  async _verifyNftOwnership(nftMint, expectedOwner) {
    if (!NFT_STAKING_CONFIG.HELIUS_RPC_URL) {
      throw new NftStakingError("Helius API not configured");
    }

    try {
      const response = await fetch(NFT_STAKING_CONFIG.HELIUS_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "verify-owner",
          method: "getAsset",
          params: { id: nftMint },
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        console.error(`❌ Helius API error:`, data.error);
        return false;
      }

      const result = data.result;
      
      // Check ownership - it's in the "ownership" object
      const ownership = result?.ownership;
      let owner = null;
      
      if (ownership) {
        owner = ownership.address || ownership.owner || ownership.authority?.address;
      }
      
      // Check if mint has freeze authority (capability to freeze)
      const freezeAuthority = result?.freeze_authority;
      const hasFreezeAuthority = freezeAuthority !== null && freezeAuthority !== undefined;
      console.log(`   NFT ${nftMint} has freeze_authority: ${freezeAuthority}, has capability: ${hasFreezeAuthority}`);

      // Check for delegate - if set, NFT might be in marketplace escrow
      const isDelegated = ownership?.delegated || false;
      const delegate = ownership?.delegate || null;
      if (delegate) {
        console.log(`   ⚠️ NFT ${nftMint} has delegate: ${delegate} - may be listed on marketplace`);
      }
      
      const isOwned = owner === expectedOwner;
      const isListed = delegate !== null; // If delegate is set, consider it potentially listed
      
      console.log(`   NFT ${nftMint}: owner=${owner}, expected=${expectedOwner}, valid=${isOwned}, delegated=${isDelegated}, listed=${isListed}`);
      
      return { owned: isOwned, listed: isListed };
    } catch (error) {
      console.error(`❌ Failed to verify NFT ownership:`, error.message);
      return false;
    }
  }

  /**
   * Get all NFTs for a wallet from Helius
   */
  async _getWalletNfts(walletAddress) {
    if (!NFT_STAKING_CONFIG.HELIUS_RPC_URL) {
      throw new NftStakingError("Helius API not configured");
    }

    try {
      let allAssets = [];
      let page = 1;
      let hasMore = true;
      const limit = 100;

      while (hasMore) {
        const response = await fetch(NFT_STAKING_CONFIG.HELIUS_RPC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "wallet-nfts",
            method: "getAssetsByOwner",
            params: {
              ownerAddress: walletAddress,
              page: page,
              limit: limit,
              options: {
                showUnverifiedCollections: false,
                showCollectionMetadata: false,
                showGrandTotal: false,
                showFungible: false,
                showNativeBalance: false,
              },
            },
          }),
        });

        const data = await response.json();
        const items = data.result?.items || [];
        
        if (items.length === 0) {
          hasMore = false;
        } else {
          allAssets = allAssets.concat(items);
          page++;
          if (items.length < limit) {
            hasMore = false;
          }
        }
      }

      return allAssets;
    } catch (error) {
      console.error(`❌ Failed to fetch wallet NFTs:`, error.message);
      return [];
    }
  }

  /**
   * Check if NFT belongs to one of our collections
   */
  _isValidCollection(nft) {
    const groupValue = nft?.grouping?.find(g => g.group_key === "collection")?.group_value;
    
    if (!groupValue) return false;
    
    return Object.values(NFT_STAKING_CONFIG.COLLECTION_ADDRESSES).includes(groupValue);
  }

  /**
   * Stake NFT(s) - User pays fee and locks NFT in our system
   */
  async stakeNfts(walletAddress, nftMints, feeSignature) {
    const operationId = `NFT-STAKE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logPrefix = `[${operationId}]`;

    console.log(`\n${"=".repeat(80)}`);
    console.log(`${logPrefix} 🚀 NFT STAKE OPERATION STARTED`);
    console.log(`${"=".repeat(80)}`);
    console.log(`${logPrefix} Wallet: ${walletAddress}`);
    console.log(`${logPrefix} NFTs: ${nftMints.length}`);
    console.log(`${logPrefix} Fee TX: ${feeSignature}`);

    if (!walletAddress || !nftMints || nftMints.length === 0) {
      throw new NftStakingError("Invalid wallet address or NFT list");
    }

    // Check if staking period is open
    const periodStatus = getStakingPeriodStatus();
    if (periodStatus.status === "upcoming") {
      throw new NftStakingError(`Staking not yet open. ${periodStatus.message}`);
    }
    if (periodStatus.status === "closed") {
      throw new NftStakingError(`Staking period has ended. ${periodStatus.message}`);
    }

    // Check Firestore config for stakingEnabled override
    const firestoreConfig = await this.getStakingConfig();
    if (firestoreConfig && firestoreConfig.stakingEnabled === false) {
      throw new NftStakingError("Staking is currently disabled. Please wait for the next staking period.");
    }

    // Calculate total fee
    const totalFeeUsd = nftMints.length * NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT;
    console.log(`${logPrefix} Total fee: $${totalFeeUsd} (${nftMints.length} NFTs × $${NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT})`);

    // 1. Verify fee payment - ENABLED
    const { getFeeInSol } = await import("../utils/solPrice.js");
    const feeData = await getFeeInSol(totalFeeUsd);
    const tolerance = 1.0; // 100% tolerance for rounding
    const minFee = feeData.solAmount * (1 - tolerance);
    const maxFee = feeData.solAmount * (1 + tolerance);
    
    // Verify the fee was actually paid
    const isValidFee = feeSignature && feeSignature !== "fee_disabled";
    
    if (!isValidFee) {
      console.log(`${logPrefix} ⚠️ No fee signature provided - REJECTING`);
      throw new NftStakingError("Fee payment required. Please pay the staking fee first.");
    } else {
      console.log(`${logPrefix} Fee TX provided: ${feeSignature}`);
    }
    
    console.log(`${logPrefix} Expected fee: $${totalFeeUsd} (verification: ${isValidFee ? 'pending' : 'skipped'})`);

    // 2. Fee distribution - DISABLED (collect but don't distribute)
    console.log(`${logPrefix} 💸 Fee distribution disabled (collected but not distributed)`);
    /*
    const { distributeFees } = await import("../utils/feeDistribution.js");
    const distributionResult = await distributeFees('nft_stake', totalFeeUsd, {
      treasuryDestination: "gatekeeper",
    });

    if (distributionResult.success) {
      console.log(`${logPrefix} ✅ Fee distributed successfully`);
    } else {
      console.warn(`${logPrefix} ⚠️ Fee distribution failed: ${distributionResult.error}`);
    }
    */

    // 3. Verify each NFT ownership and stake
    console.log(`${logPrefix} 🔍 Verifying NFT ownership...`);
    const now = admin.firestore.Timestamp.now();
    
    // Calculate unlock date - use global period end date (same for everyone)
    const periodEnd = new Date(NFT_STAKING_CONFIG.STAKING_PERIOD.end + "T23:59:59Z");
    const periodStart = new Date(NFT_STAKING_CONFIG.STAKING_PERIOD.start + "T00:00:00Z");
    
    // If staking period hasn't started yet, use stake time + 30 days
    // If staking period has started, use global end date
    let unlockAt;
    const nowDate = now.toDate();
    if (nowDate < periodStart) {
      // Period hasn't started yet - use 30 days from stake time
      unlockAt = new Date(nowDate.getTime() + NFT_STAKING_CONFIG.DURATION_DAYS * 24 * 60 * 60 * 1000);
    } else {
      // Period is active - use global end date for everyone
      unlockAt = periodEnd;
    }
    
    console.log(`${logPrefix} 📅 Staking period: ${NFT_STAKING_CONFIG.STAKING_PERIOD.start} to ${NFT_STAKING_CONFIG.STAKING_PERIOD.end}`);
    console.log(`${logPrefix} 📅 Unlock date for this NFT: ${unlockAt.toISOString()}`);
    
    const stakedResults = [];
    const failedMints = [];

    for (const mint of nftMints) {
      try {
        // Verify ownership via Helius - now returns { owned, listed }
        const ownershipCheck = await this._verifyNftOwnership(mint, walletAddress);
        
        if (!ownershipCheck.owned) {
          console.log(`${logPrefix} ❌ NFT ${mint} not owned by ${walletAddress}`);
          failedMints.push({ mint, reason: "Not owned by wallet" });
          continue;
        }

        // If NFT is delegated (listed on marketplace), reject staking
        if (ownershipCheck.listed) {
          console.log(`${logPrefix} ❌ NFT ${mint} is listed/delegated - cannot stake`);
          failedMints.push({ mint, reason: "NFT is listed on marketplace" });
          continue;
        }

        // Check if already staked
        const existingStake = await this.db
          .collection(NFT_STAKES_COLLECTION)
          .where("nftMint", "==", mint)
          .where("status", "in", ["staked", "claimable"])
          .limit(1)
          .get();

        if (!existingStake.empty) {
          console.log(`${logPrefix} ⚠️ NFT ${mint} already staked`);
          failedMints.push({ mint, reason: "Already staked" });
          continue;
        }

        // Determine collection
        const nfts = await this._getWalletNfts(walletAddress);
        const nft = nfts.find(a => a.id === mint || a.mint === mint);
        const groupValue = nft?.grouping?.find(g => g.group_key === "collection")?.group_value;
        
        let collectionId = "unknown";
        for (const [key, addr] of Object.entries(NFT_STAKING_CONFIG.COLLECTION_ADDRESSES)) {
          if (addr === groupValue) {
            collectionId = key;
            break;
          }
        }

        // Create stake record
        const stakeRef = this.db.collection(NFT_STAKES_COLLECTION).doc();
        await stakeRef.set({
          stakeId: stakeRef.id,
          walletAddress: walletAddress,
          nftMint: mint,
          collectionId: collectionId,
          stakedAt: now,
          unlockAt: admin.firestore.Timestamp.fromDate(unlockAt),
          status: "staked",
          // Estimated reward is calculated dynamically at claim time based on total staked
          estimatedReward: null, // Will be calculated at claim time
          finalReward: null,
          feePaidUsd: NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT,
          originalOwnerAtStake: walletAddress,
          lastCheckedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        console.log(`${logPrefix} ✅ Staked NFT: ${mint}`);
        stakedResults.push({ mint, stakeId: stakeRef.id });
      } catch (error) {
        console.error(`${logPrefix} ❌ Failed to stake ${mint}:`, error.message);
        failedMints.push({ mint, reason: error.message });
      }
    }

    console.log(`${logPrefix} 🎉 NFT Stake Operation Complete`);
    console.log(`${logPrefix}   Successful: ${stakedResults.length}`);
    console.log(`${logPrefix}   Failed: ${failedMints.length}`);

    return {
      success: true,
      operationId,
      staked: stakedResults,
      failed: failedMints,
      totalFeeUsd,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Unstake NFT - Check if 30 days passed
   */
  async unstakeNft(walletAddress, nftMint) {
    const operationId = `NFT-UNSTAKE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logPrefix = `[${operationId}]`;

    console.log(`\n${logPrefix} 🚀 NFT UNSTAKE OPERATION`);
    console.log(`${logPrefix} Wallet: ${walletAddress}, NFT: ${nftMint}`);

    // Find the stake
    const stakeSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .where("walletAddress", "==", walletAddress)
      .where("nftMint", "==", nftMint)
      .where("status", "==", "staked")
      .limit(1)
      .get();

    if (stakeSnapshot.empty) {
      throw new NftStakingError("No active stake found for this NFT");
    }

    const stakeDoc = stakeSnapshot.docs[0];
    const stakeData = stakeDoc.data();

    // Check if 30 days have passed
    const now = admin.firestore.Timestamp.now();
    const unlockTime = stakeData.unlockAt.toDate().getTime();
    const currentTime = now.toDate().getTime();
    const daysPassed = (currentTime - stakeData.stakedAt.toDate().getTime()) / (1000 * 60 * 60 * 24);
    const isUnlockable = currentTime >= unlockTime;

    console.log(`${logPrefix} Days staked: ${daysPassed.toFixed(1)}`);
    console.log(`${logPrefix} Unlockable: ${isUnlockable}`);

    if (isUnlockable) {
      // Calculate final reward dynamically based on total currently staked NFTs
      const allStakedSnapshot = await this.db
        .collection(NFT_STAKES_COLLECTION)
        .where("status", "in", ["staked", "claimable"])
        .get();
      
      const totalCurrentlyStaked = allStakedSnapshot.size;
      const finalReward = totalCurrentlyStaked > 0 
        ? NFT_STAKING_CONFIG.TOKEN_POOL / totalCurrentlyStaked 
        : 0;

      await stakeDoc.ref.update({
        status: "claimable",
        finalReward: finalReward,
        estimatedReward: finalReward, // Store for display
        updatedAt: now,
      });

      console.log(`${logPrefix} ✅ NFT unlocked - reward claimable: ${finalReward.toFixed(2)} $MKIN (based on ${totalCurrentlyStaked} total staked)`);

      return {
        success: true,
        nftMint,
        status: "claimable",
        reward: finalReward,
        totalStakedAtUnlock: totalCurrentlyStaked,
        message: `NFT unlocked! You can now claim ${finalReward.toFixed(2)} $MKIN`,
      };
    } else {
      // Early unstake - reward forfeited
      const daysRemaining = NFT_STAKING_CONFIG.DURATION_DAYS - daysPassed;
      
      await stakeDoc.ref.update({
        status: "forfeited",
        finalReward: 0,
        updatedAt: now,
      });

      console.log(`${logPrefix} ⚠️ Early unstake - reward forfeited`);
      console.log(`${logPrefix}   Days remaining: ${daysRemaining.toFixed(1)}`);

      return {
        success: true,
        nftMint,
        status: "forfeited",
        reward: 0,
        message: `Early unstake - reward forfeited (${daysRemaining.toFixed(1)} days early)`,
      };
    }
  }

/**
    * Claim rewards for wallet
    * Only allowed after staking period has ended
    */
  async claimRewards(walletAddress) {
    // Check if period has ended
    const firestoreConfig = await this.getStakingConfig();
    const periodEnd = firestoreConfig?.periodEnd || NFT_STAKING_CONFIG.STAKING_PERIOD.end;
    const periodEndDate = new Date(periodEnd + "T23:59:59Z");
    const nowDate = new Date();
    
    if (nowDate < periodEndDate) {
      throw new NftStakingError(`Cannot claim until staking period ends on ${periodEnd}`, 400);
    }

    // Get claimable stakes
    const claimableSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .where("walletAddress", "==", walletAddress)
      .where("status", "==", "claimable")
      .get();

    if (claimableSnapshot.empty) {
      return { success: true, claimed: 0, message: "No claimable rewards" };
    }

    let totalClaimed = 0;
    const nowFirestore = admin.firestore.Timestamp.now();

    // Mark as claimed
    const batch = this.db.batch();
    for (const doc of claimableSnapshot.docs) {
      const data = doc.data();
      totalClaimed += data.finalReward || data.estimatedReward;
      
      batch.update(doc.ref, {
        status: "claimed",
        releasedAt: nowFirestore,
        updatedAt: nowFirestore,
      });
    }

    await batch.commit();

    // Send tokens
    if (totalClaimed > 0) {
      try {
        const { connection, vaultKeypair } = await this._ensureInitialized();
        const tokenMint = new PublicKey(NEW_MKIN_MINT_ADDRESS);
        
        const vaultATA = await getAssociatedTokenAddress(tokenMint, vaultKeypair.publicKey);
        const userATA = await getAssociatedTokenAddress(tokenMint, new PublicKey(walletAddress));
        
        const transaction = new Transaction();
        
        // Create user ATA if needed
        let userATAExists = false;
        try {
          await getAccount(connection, userATA);
          userATAExists = true;
        } catch (e) {
          transaction.add(
            createAssociatedTokenAccountInstruction(
              vaultKeypair.publicKey,
              userATA,
              new PublicKey(walletAddress),
              tokenMint
            )
          );
        }
        
        // Add transfer
        const amountLamports = Math.round(totalClaimed * 1e9);
        transaction.add(
          createTransferInstruction(vaultATA, userATA, vaultKeypair.publicKey, amountLamports)
        );
        
        // Sign and send
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = vaultKeypair.publicKey;
        transaction.sign(vaultKeypair);
        
        const signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          maxRetries: 3
        });
        
        await connection.confirmTransaction(signature, 'confirmed');
        
        return {
          success: true,
          claimed: totalClaimed,
          count: claimableSnapshot.size,
          txSignature: signature,
          message: `Claimed ${totalClaimed} $MKIN`,
        };
      } catch (transferError) {
        return {
          success: true,
          claimed: totalClaimed,
          count: claimableSnapshot.size,
          warning: "Tokens not transferred",
          message: `Claimed ${totalClaimed} $MKIN (transfer failed)`,
        };
      }
    }

    return { success: true, claimed: totalClaimed, count: claimableSnapshot.size };
  }

  /**
   * Get user's staking stats
   */
  async getStakingStats(walletAddress) {
    const now = admin.firestore.Timestamp.now();

    // Get all stakes for wallet
    const stakesSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .where("walletAddress", "==", walletAddress)
      .get();

    const stakes = stakesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      stakedAt: doc.data().stakedAt?.toDate?.()?.toISOString(),
      unlockAt: doc.data().unlockAt?.toDate?.()?.toISOString(),
    }));

    const staked = stakes.filter(s => s.status === "staked");
    const claimable = stakes.filter(s => s.status === "claimable");
    const claimed = stakes.filter(s => s.status === "claimed");
    const forfeited = stakes.filter(s => s.status === "forfeited");

    // Calculate times
    let nextUnlockDate = null;
    if (staked.length > 0) {
      const earliest = staked.reduce((min, s) => {
        const unlockTime = new Date(s.unlockAt).getTime();
        return unlockTime < min ? unlockTime : min;
      }, Infinity);
      nextUnlockDate = new Date(earliest).toISOString();
    }

    // Get current reward rate for display (calculated at claim time)
    const totalStakedNow = staked.length;
    const currentRewardRate = totalStakedNow > 0 
      ? NFT_STAKING_CONFIG.TOKEN_POOL / totalStakedNow 
      : 0;

    const totalEstimated = staked.length * currentRewardRate;
    const totalClaimable = claimable.reduce((sum, s) => sum + (s.finalReward || 0), 0);
    const totalClaimed = claimed.reduce((sum, s) => sum + (s.finalReward || 0), 0);

    return {
      walletAddress,
      stakedNfts: staked,
      claimableNfts: claimable,
      claimedNfts: claimed,
      forfeitedNfts: forfeited,
      totalStaked: staked.length,
      totalClaimable,
      totalClaimed,
      totalEstimatedReward: totalEstimated,
      currentRewardRate,
      nextUnlockDate,
    };
  }

  /**
   * Get pool stats
   */
  async getPoolStats() {
    // Get all stakes
    const allSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .get();

    const stakes = allSnapshot.docs.map(doc => doc.data());
    
    const totalStaked = stakes.filter(s => s.status === "staked").length;
    const totalClaimable = stakes.filter(s => s.status === "claimable").length;
    const totalClaimed = stakes.filter(s => s.status === "claimed").length;
    const totalForfeited = stakes.filter(s => s.status === "forfeited").length;

    // Calculate current reward rate (dynamic - 20000 / actual staked)
    // If no one has staked yet, show the potential max rate (20000 / eligible)
    const currentRewardPerNft = totalStaked > 0 
      ? NFT_STAKING_CONFIG.TOKEN_POOL / totalStaked 
      : NFT_STAKING_CONFIG.TOKEN_POOL / TOTAL_ELIGIBLE_NFTS;

    // Get period status - checks Firestore first, then env config
    const firestoreConfig = await this.getStakingConfig();
    const isFirestoreEnabled = firestoreConfig?.stakingEnabled !== false;
    
    // Use period from Firestore if available, otherwise use config
    const periodStart = firestoreConfig?.periodStart || NFT_STAKING_CONFIG.STAKING_PERIOD.start;
    const periodEnd = firestoreConfig?.periodEnd || NFT_STAKING_CONFIG.STAKING_PERIOD.end;
    
    // Calculate period status based on actual period dates
    const now = new Date();
    const startDate = new Date(periodStart + "T00:00:00Z");
    const endDate = new Date(periodEnd + "T23:59:59Z");
    
    let periodStatusValue;
    let periodMessageValue;
    
    if (now < startDate) {
      periodStatusValue = "upcoming";
      periodMessageValue = `Staking opens ${periodStart}`;
    } else if (now >= startDate && now <= endDate) {
      periodStatusValue = "open";
      periodMessageValue = `Staking open until ${periodEnd}`;
    } else {
      periodStatusValue = "closed";
      periodMessageValue = `Staking closed. Claims open until next period.`;
    }

    return {
      totalPool: NFT_STAKING_CONFIG.TOKEN_POOL,
      totalEligibleNfts: TOTAL_ELIGIBLE_NFTS,
      totalNftsStaked: totalStaked,
      totalClaimable,
      totalClaimed,
      totalForfeited,
      currentRewardPerNft: currentRewardPerNft,
      estimatedRewardPerNft: currentRewardPerNft,
      stakingEnabled: NFT_STAKING_CONFIG.ENABLED && isFirestoreEnabled,
      durationDays: NFT_STAKING_CONFIG.DURATION_DAYS,
      feePerNft: NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT,
      stakingPeriod: { start: periodStart, end: periodEnd },
      periodStart,
      periodEnd,
      periodStatus: periodStatusValue,
      periodMessage: periodMessageValue,
      firestoreStakingEnabled: firestoreConfig?.stakingEnabled,
    };
  }

  /**
   * Get available NFTs in wallet (not staked)
   */
  async getAvailableNfts(walletAddress) {
    console.log(`🔍 Getting available NFTs for wallet: ${walletAddress}`);

    // Get user's NFTs from Helius
    const walletNfts = await this._getWalletNfts(walletAddress);
    
    // Get already staked OR claimable OR claimed NFT mints (all active/previous stakes)
    const stakedSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .where("walletAddress", "==", walletAddress)
      .where("status", "in", ["staked", "claimable", "claimed"])
      .get();

    const stakedMints = new Set(stakedSnapshot.docs.map(d => d.data().nftMint));

    // Filter to only our collections and not already staked or claimed
    const availableNfts = walletNfts
      .filter(nft => {
        const groupValue = nft?.grouping?.find(g => g.group_key === "collection")?.group_value;
        const isValidCollection = Object.values(NFT_STAKING_CONFIG.COLLECTION_ADDRESSES).includes(groupValue);
        const isNotStaked = !stakedMints.has(nft.id || nft.mint);
        return isValidCollection && isNotStaked;
      })
      .map(nft => ({
        mint: nft.id || nft.mint,
        name: nft.content?.metadata?.name || "Unknown",
        image: nft.content?.links?.image || nft.content?.metadata?.image || "",
        collection: (() => {
          const groupValue = nft?.grouping?.find(g => g.group_key === "collection")?.group_value;
          for (const [key, addr] of Object.entries(NFT_STAKING_CONFIG.COLLECTION_ADDRESSES)) {
            if (addr === groupValue) return key;
          }
          return "unknown";
        })(),
        // Reward will be calculated at claim time
        estimatedReward: null,
      }));

    console.log(`   Found ${availableNfts.length} available NFTs`);

    return availableNfts;
  }

  /**
   * Check if NFT was transferred (for monitoring)
   */
  async checkNftTransfer(stakeDoc) {
    const stakeData = stakeDoc.data();
    const currentOwner = await this._verifyNftOwnership(
      stakeData.nftMint,
      stakeData.originalOwnerAtStake
    );

    if (!currentOwner) {
      // NFT was transferred - mark as forfeited
      await stakeDoc.ref.update({
        status: "forfeited",
        finalReward: 0,
        lastCheckedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      });

      console.log(`⚠️ NFT ${stakeData.nftMint} transferred - marked as forfeited`);
      return true; // forfeited
    }

    return false; // still owned
  }

  /**
   * Check all stakes and update status from 'staked' to 'claimable' if period ended
   * Called by cron job
   */
  async checkAndUpdateStakeStatuses() {
    console.log("🔄 Checking stake statuses...");
    
    // Check if period has ended
    if (!isStakingPeriodEnded()) {
      console.log("⏳ Staking period not yet ended, skipping status update");
      return { updated: 0, message: "Period not ended" };
    }

    // Get all stakes with status 'staked'
    const stakedSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .where("status", "==", "staked")
      .get();

    if (stakedSnapshot.empty) {
      return { updated: 0, message: "No staked NFTs to update" };
    }

    console.log(`📋 Found ${stakedSnapshot.size} staked NFTs to check`);

    const now = admin.firestore.Timestamp.now();
    let updatedCount = 0;

    const batch = this.db.batch();
    for (const doc of stakedSnapshot.docs) {
      const data = doc.data();
      const unlockTime = data.unlockAt?.toDate?.()?.getTime() || 0;
      const currentTime = now.toDate().getTime();

      // Update to claimable if unlock time has passed
      if (currentTime >= unlockTime) {
        // Calculate final reward based on current staked count
        // Get total staked count for reward calculation
        const allStakedSnapshot = await this.db
          .collection(NFT_STAKES_COLLECTION)
          .where("status", "in", ["staked", "claimable"])
          .get();
        
        const totalStaked = allStakedSnapshot.size || 1;
        const finalReward = NFT_STAKING_CONFIG.TOKEN_POOL / totalStaked;

        batch.update(doc.ref, {
          status: "claimable",
          finalReward: finalReward,
          updatedAt: now,
        });
        updatedCount++;
      }
    }

    await batch.commit();
    console.log(`✅ Updated ${updatedCount} NFTs to claimable status`);

    // If we updated any stakes, also disable staking in Firestore
    if (updatedCount > 0) {
      await this.db.collection("config").doc("nftStaking").set({
        stakingEnabled: false,
        periodEndedAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });
      console.log(`✅ Disabled NFT staking (period ended)`);
    }

    return { updated: updatedCount, message: `Updated ${updatedCount} NFTs to claimable, staking disabled` };
  }

  /**
   * Enable NFT staking (for new period)
   */
  async enableStaking(newPeriodStart, newPeriodEnd) {
    const now = admin.firestore.Timestamp.now();
    
    await this.db.collection("config").doc("nftStaking").set({
      stakingEnabled: true,
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
      enabledAt: now,
      updatedAt: now,
    }, { merge: true });
    
    console.log(`✅ Enabled NFT staking for period ${newPeriodStart} - ${newPeriodEnd}`);
    return { success: true, message: `Staking enabled for ${newPeriodStart} - ${newPeriodEnd}` };
  }

  /**
   * Get staking config from Firestore (overrides env var)
   */
  async getStakingConfig() {
    const configDoc = await this.db.collection("config").doc("nftStaking").get();
    return configDoc.exists ? configDoc.data() : null;
  }
}

export default new NftStakingService();
export { NftStakingService, NftStakingError };