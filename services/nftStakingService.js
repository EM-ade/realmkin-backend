import admin from "firebase-admin";
import fetch from "node-fetch";
import { NFT_STAKING_CONFIG, TOTAL_ELIGIBLE_NFTS } from "../config/nftStaking.js";

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
  }

  get db() {
    if (!this._db) {
      this._db = admin.firestore();
    }
    return this._db;
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

    // Calculate total fee
    const totalFeeUsd = nftMints.length * NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT;
    console.log(`${logPrefix} Total fee: $${totalFeeUsd} (${nftMints.length} NFTs × $${NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT})`);

    // 1. Verify fee payment - DISABLED FOR TESTING
    // const { getFeeInSol } = await import("../utils/solPrice.js");
    // const feeData = await getFeeInSol(totalFeeUsd);
    // const tolerance = 1.0;
    // const minFee = feeData.solAmount * (1 - tolerance);
    // const maxFee = feeData.solAmount * (1 + tolerance);
    // const { default: stakingService } = await import("./stakingService.js");
    // const isValidFee = await stakingService._verifySolTransfer(feeSignature, minFee, maxFee);
    // if (!isValidFee) throw new NftStakingError("Invalid fee payment");
    console.log(`${logPrefix} ✅ Fee verification disabled for testing`);
    console.log(`${logPrefix} Expected fee: $${totalFeeUsd} (not verified)`);

    // 2. Distribute fee using existing fee distribution
    // TEMPORARILY DISABLED FOR TESTING - Enable after testing
    console.log(`${logPrefix} 💸 Fee distribution disabled for testing ($${totalFeeUsd})`);
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
    const unlockAt = new Date(now.toDate().getTime() + NFT_STAKING_CONFIG.DURATION_DAYS * 24 * 60 * 60 * 1000);
    
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
   */
  async claimRewards(walletAddress) {
    const operationId = `NFT-CLAIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logPrefix = `[${operationId}]`;

    console.log(`\n${logPrefix} 🚀 NFT CLAIM OPERATION`);
    console.log(`${logPrefix} Wallet: ${walletAddress}`);

    // Get all claimable stakes for this wallet
    const claimableSnapshot = await this.db
      .collection(NFT_STAKES_COLLECTION)
      .where("walletAddress", "==", walletAddress)
      .where("status", "==", "claimable")
      .get();

    if (claimableSnapshot.empty) {
      return {
        success: true,
        claimed: 0,
        message: "No claimable rewards",
      };
    }

    let totalClaimed = 0;
    const now = admin.firestore.Timestamp.now();

    // Mark all as claimed AND released (so they can be staked again)
    const batch = this.db.batch();
    for (const doc of claimableSnapshot.docs) {
      const data = doc.data();
      totalClaimed += data.finalReward || data.estimatedReward;
      
      batch.update(doc.ref, {
        status: "claimed",
        releasedAt: now,
        updatedAt: now,
      });
    }

    await batch.commit();

    console.log(`${logPrefix} ✅ Claimed: ${totalClaimed} $MKIN`);

    return {
      success: true,
      claimed: totalClaimed,
      count: claimableSnapshot.size,
      message: `Claimed ${totalClaimed} $MKIN from ${claimableSnapshot.size} NFT(s)`,
    };
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

    return {
      totalPool: NFT_STAKING_CONFIG.TOKEN_POOL,
      totalEligibleNfts: TOTAL_ELIGIBLE_NFTS,
      totalNftsStaked: totalStaked,
      totalClaimable,
      totalClaimed,
      totalForfeited,
      currentRewardPerNft: currentRewardPerNft,
      estimatedRewardPerNft: currentRewardPerNft, // For UI display
      stakingEnabled: NFT_STAKING_CONFIG.ENABLED,
      durationDays: NFT_STAKING_CONFIG.DURATION_DAYS,
      feePerNft: NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT,
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
}

export default new NftStakingService();
export { NftStakingService, NftStakingError };