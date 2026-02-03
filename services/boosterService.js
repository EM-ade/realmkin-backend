import NFTVerificationService from "./nftVerification.js";
import admin from "firebase-admin";

// Helius DAS API for fetching NFT metadata
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : null;

/**
 * BoosterService - Detects NFTs in user wallets and assigns appropriate staking boosters
 *
 * NFT Categories and Multipliers:
 * - Random 1/1: 1.17x multiplier
 * - Custom 1/1: 1.23x multiplier
 * - Solana Miner: 1.27x multiplier
 *
 * Boosters stack multiplicatively for maximum rewards
 */
class BoosterService {
  constructor() {
    // Lazy initialization
    this._db = null;
    this._nftVerification = null;

    // NFT category configurations with mint addresses
    this.NFT_CATEGORIES = {
      RANDOM_1_1: {
        name: "Random 1/1",
        type: "random_1_1",
        multiplier: 1.17,
        mints: [
          "4fdpMgnie15mLP8q6AQZbYnvPGQz6FzPrgVVRKfMyeC3",
          "6SVWe3GqymeP6mjgYNXvPnEYj6soi3fCzYxVTvS1kmJL",
          "7Ze45CngJ1DNUZaUYMNBpatDQoVqTL8Yjq2EPUYPVgbh",
          "E21XaE8zaoBZwt2roq7KppxjfFhrcDMpFa7ZMWsFreUh",
          "FMG9Be91LgVd9cb2YX15hPBFJ3iUhH2guB7RbCBFbDbg",
          "J4koZzipRmLjc4QzSbRsn8CdXCZCHUUmTbCSqAtvSJFZ",
          "khoX7jkUK98uMPv2yF9H9ftLJKTesgpmWbuvKpRvW8h",
          // New Random 1/1 boosters added 2026-01-09
          "LWVzjTiSKBZDWvWP4RmsXffqctmDH7GeZjchupwd1HF",
          "EXA4nEohnyY9XTeAzNsV3f9GXcYUh8cCpWV9qbjf1egS",
          "HchoYoGU9ZnVffHaEo1Aw9xitvqyhiP575GpebiSXNK4",
          "5MbExwqPUNL8yNuUb8JK9iCXHGGcLXEDkecgZDfSEJfu",
          // Random 1/1 booster added 2026-01-14
          "77MaUVBGU6ZbCexq6M5GFNDszgpjyMn1bACisKo4X1qR",
          // Random 1/1 boosters added 2026-01-27
          "JBWVVUGkJYA3uzXhRdmTuMiP8YFP2APZP7KFtnT6jpvh",
          "4j7RifoUKrnHFK6TJY7nctJBcozjjFYc8BebS5MNiNZY",
          "488u23w7YAA5uowkx72kqEiwcj6sgwWGhpMDrCvBPjgX",
          "8qaYjyY7qwUMeJjz8zPzncmxUozQ2mr2har2ZkhTWbU",
          // Random 1/1 booster added 2026-02-03
          "7LJok6gffFQo3rU2kqW7RPPtP9gcxRHV8zPEUgNBSmo",
        ],
      },
      CUSTOM_1_1: {
        name: "Custom 1/1",
        type: "custom_1_1",
        multiplier: 1.23,
        mints: [
          "AN3u7XKFSDCVAe4KopeHRZqpKByR2j9WRkTpq2SQ8ieo",
          "14PaqpEwRntJ3tVhFewBS3bFK8kjk5CX2YeiLWYvVabu",
          "2UsvdbGXg28B2piq3oW1rfMBQTQYhUGhCYRwJfNhUagr",
          "4G44MShUoWPtyQog7fCH6XTgNHqwEjTtcuGpHg4BxJ1p",
          "AukNaSscLLUKZuWm5eRxxukZ76kNt5iTB7Raeeevrhw",
          "HiW5i4yiumjcZHaHpgjAgHdCRZgpX3j6s9vSeukpxuAF",
          "PUjmyCPfyEd92D2cm4pppjGB1ddX6wnnttmEzxBHErD",
          // New Custom 1/1 booster added 2026-02-03
          "2KUdrXcUkqyGRZNFXhuzXGVP1cHoNJkX1snLm4riCB6z",
          // New Custom 1/1 booster added 2026-01-09
          "5j9xjtXjC3ZwfLsTHnZZEZKKa7uR75m8aXyS4rBbt8CB",
          // Custom 1/1 boosters added 2026-01-10
          "4aak3vYyJMyP5FJPW3avATDmXB7UBPCb3WVLFCtEDLJs",
          "EQjH6VMk9rsEK7bnEzBcyx9ZoYPhqW2KfGUgWAWBDnEh",
          // Custom 1/1 booster added 2026-01-13
          "4JD4WdXc7PFKgcgfa8kfVbUb1aCxYrVzmdkuPkiW6jbd",
          // Custom 1/1 booster added 2026-01-14
          "DdUb3GeoMaDQn52fWka1ZqWypCdh6DXq72gzS4BUefk5",
          // Custom 1/1 booster added 2026-01-19
          "31puRHydjyRuCNG4CBZSWvuh7ASR2h7UnhSrJCQqA3KQ",
          // Custom 1/1 booster added 2026-01-28
          "GHqXzk73Y5zuvBmcG5gNWo3teivgsDqjUEifN2N7xfwj",
        ],
      },
      SOLANA_MINER: {
        name: "Solana Miner",
        type: "solana_miner",
        multiplier: 1.27,
        mints: [
          "4dFgb3Zbcu2m3VwEfgxHkDKaijyxyhyhfRvgEfYtbuvc",
          "97psosjbGRs8j9KmG1gDcfiwajAkkzMifMfL1nsGpPZ9",
          "A5E5hsXsydS4ttrs3Y4ZRPLsBb2ormtDKeFcL5D7Q9vj",
          "EWbzAwkxJRZGoSXSuGq3Gz8eNX1g2muXdspsMimEB8EU",
          "HPaU5hLy3XzNygLTcmM1KWa1ceZvFD3xbAP5eCXoDNuh",
          "J4EshVN9yfnrqLcfpVXgVpfXd3ySEJkD2aTwfyiDrqDf",
          // Solana Miner boosters added 2026-01-10 to 2026-01-11
          "J2F9etQhMYNkwPAWctbJBwr3z4rMpYprdcqAKuNR4h4q",
          "5DD4yFFycyGhXgnqAh58HQ659uRjvr5KBTBbTcBTkhf5",
          "7pKZgMEVo1jnndSUCcDpY2Hpa3SapveooAmMPL2HCTWV",
          "BGtMZEb36SLHB3WceU61AwfdXbxy7k6vqXciWtvxSJsQ",
          // Solana Miner boosters added 2026-01-13
          "HmUpTxhKjYcPCwyCF65FyCRCyKP2WzUkrCrGFVDtT8YW",
          "A4mDu4sFNmjGDadPHpbFC2GNeyH6xF9NuejiPFnX7AMZ",
          // Solana Miner boosters added 2026-01-14
          "2eXCtf44NAudG7z8S2zDAgXmLHMcr2oj1vCvc537mHq3",
          "2MeksUy4XJ5aqT9ARrq773ugdnvsAmGTF8XdkzFoXDV6",
          // Solana Miner boosters added 2026-01-15
          "3K8y4VdZJfrwDuWRYXkKNsX3JrBiTpPyGKibhncvxUfU",
          "99egWJLHeRx6j2VNoAbpHs2XhTJmKWJBz2rVMeZqwRZ3",
          // Solana Miner booster added 2026-01-27
          "5K3LoBcsEgLpVCBDmbRsHQopPapt1KDfxHpspBdH6Fms",
          // Solana Miner booster added 2026-01-28
          "4iZFqT9hswYLXrTEq3WwJ1wNiYtkTzCfGDWgPjWR6H9J",
        ],
      },
    };

    // Cache for booster detection results (30 minutes - optimized for Helius credits)
    this.cache = new Map();
    this.CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    console.log(
      `📦 Booster cache TTL: ${this.CACHE_TTL}ms (${this.CACHE_TTL / 1000}s)`,
    );
  }

  get db() {
    if (!this._db) {
      this._db = admin.firestore();
    }
    return this._db;
  }

  get nftVerification() {
    if (!this._nftVerification) {
      this._nftVerification = new NFTVerificationService();
    }
    return this._nftVerification;
  }

  /**
   * Get user's wallet address from userRewards collection
   */
  async getUserWalletAddress(firebaseUid) {
    try {
      const userDoc = await this.db
        .collection("userRewards")
        .doc(firebaseUid)
        .get();

      if (!userDoc.exists) {
        throw new Error("User not found in userRewards");
      }

      return userDoc.data().walletAddress;
    } catch (error) {
      console.error(`Error getting wallet address for ${firebaseUid}:`, error);
      throw error;
    }
  }

  /**
   * Scan user's wallet for eligible NFTs and return detected boosters
   */
  async scanWalletForBoosters(walletAddress) {
    try {
      console.log(`🔍 Scanning wallet ${walletAddress} for booster NFTs...`);

      // Get all NFTs from wallet
      const allNFTs = await this.nftVerification.getNFTsByOwner(walletAddress);

      // Debug: Log NFT structure to understand the data
      console.log(`📦 Found ${allNFTs.length} total NFTs in wallet`);
      if (allNFTs.length > 0) {
        console.log(
          `📋 Sample NFT structure (first NFT):`,
          JSON.stringify(
            {
              id: allNFTs[0].id,
              mint: allNFTs[0].mint,
              content: allNFTs[0].content?.metadata?.name,
            },
            null,
            2,
          ),
        );
      }

      // Extract mint addresses - try both 'id' and 'mint' fields
      const walletMints = allNFTs
        .map((nft) => {
          const mintAddress = nft.id || nft.mint;
          return mintAddress?.toLowerCase();
        })
        .filter(Boolean);

      console.log(
        `🔑 Extracted ${walletMints.length} mint addresses from wallet`,
      );

      // Debug: Log all booster mints we're looking for
      const allBoosterMints = Object.values(this.NFT_CATEGORIES).flatMap(
        (cat) => cat.mints.map((m) => m.toLowerCase()),
      );
      console.log(
        `🎯 Looking for ${allBoosterMints.length} booster NFT mints across all categories`,
      );

      // Debug: Check for any matches
      const anyMatches = walletMints.filter((mint) =>
        allBoosterMints.includes(mint),
      );
      console.log(`🔍 Potential matches found: ${anyMatches.length}`);
      if (anyMatches.length > 0) {
        console.log(`   Matching mints:`, anyMatches);
      }

      const detectedBoosters = [];

      // Check each category
      for (const [categoryKey, category] of Object.entries(
        this.NFT_CATEGORIES,
      )) {
        const categoryMintsLower = category.mints.map((m) => m.toLowerCase());
        const matchingMints = category.mints.filter((mint) =>
          walletMints.includes(mint.toLowerCase()),
        );

        console.log(
          `   Checking ${category.name}: ${matchingMints.length}/${category.mints.length} matches`,
        );

        if (matchingMints.length > 0) {
          detectedBoosters.push({
            type: category.type,
            name: category.name,
            multiplier: category.multiplier,
            category: categoryKey,
            mints: matchingMints,
            detectedAt: new Date(),
          });

          console.log(
            `✅ Detected ${category.name} booster (${matchingMints.length} NFTs):`,
            matchingMints,
          );
        }
      }

      console.log(`📊 Total boosters detected: ${detectedBoosters.length}`);

      return detectedBoosters;
    } catch (error) {
      console.error(
        `Error scanning wallet ${walletAddress} for boosters:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Calculate stacked multiplier from multiple boosters
   * Boosters stack multiplicatively: 1.0 × 1.17 × 1.23 × 1.27 = 1.83x
   */
  calculateStackedMultiplier(boosters) {
    if (!boosters || boosters.length === 0) {
      return 1.0;
    }

    let totalMultiplier = 1.0;

    for (const booster of boosters) {
      // Stack based on count of NFTs in this category
      const count = booster.mints ? booster.mints.length : 1;

      // Multiplicative stacking: base ^ count
      // Example: 1.27 ^ 2 = 1.6129
      if (count > 0 && booster.multiplier > 1.0) {
        totalMultiplier *= Math.pow(booster.multiplier, count);
      }
    }

    return totalMultiplier;
  }

  /**
   * Update user's staking position with detected boosters
   * Creates position document if it doesn't exist to store booster data
   */
  async updateUserBoosters(firebaseUid, detectedBoosters) {
    try {
      const posRef = this.db.collection("staking_positions").doc(firebaseUid);

      await this.db.runTransaction(async (t) => {
        const posDoc = await t.get(posRef);

        if (!posDoc.exists) {
          console.log(
            `Creating staking position document for ${firebaseUid} with detected boosters`,
          );
          // Create a minimal staking position document to store booster data
          await t.set(posRef, {
            firebase_uid: firebaseUid,
            principal: 0,
            start_time: admin.firestore.Timestamp.now(),
            accumulated_rewards: 0,
            last_update: admin.firestore.Timestamp.now(),
            active_boosters: detectedBoosters,
            booster_multiplier:
              this.calculateStackedMultiplier(detectedBoosters),
            boosters_updated_at: admin.firestore.Timestamp.now(),
            created_at: admin.firestore.Timestamp.now(),
          });
          return;
        }

        const posData = posDoc.data();
        const oldBoosters = posData.active_boosters || [];

        // Update with new boosters
        await t.set(posRef, {
          ...posData,
          active_boosters: detectedBoosters,
          booster_multiplier: this.calculateStackedMultiplier(detectedBoosters),
          boosters_updated_at: admin.firestore.Timestamp.now(),
          updated_at: admin.firestore.Timestamp.now(),
        });

        // Log booster changes
        if (JSON.stringify(oldBoosters) !== JSON.stringify(detectedBoosters)) {
          console.log(`🔄 Updated boosters for ${firebaseUid}:`, {
            old: oldBoosters.length,
            new: detectedBoosters.length,
            multiplier: this.calculateStackedMultiplier(detectedBoosters),
          });

          // Add to booster history
          const historyRef = this.db.collection("booster_history").doc();
          await t.set(historyRef, {
            user_id: firebaseUid,
            old_boosters: oldBoosters,
            new_boosters: detectedBoosters,
            old_multiplier: this.calculateStackedMultiplier(oldBoosters),
            new_multiplier: this.calculateStackedMultiplier(detectedBoosters),
            timestamp: admin.firestore.Timestamp.now(),
          });
        }
      });

      return detectedBoosters;
    } catch (error) {
      console.error(`Error updating boosters for ${firebaseUid}:`, error);
      throw error;
    }
  }

  /**
   * Detect and assign boosters for a user
   * Main entry point for booster detection
   * Returns detected boosters even if database update fails
   */
  async detectAndAssignBoosters(firebaseUid) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🎯 BOOSTER DETECTION STARTED for user: ${firebaseUid}`);
    console.log(`${"=".repeat(60)}`);

    try {
      // Check cache first
      const cacheKey = `boosters_${firebaseUid}`;
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        console.log(
          `📦 Using cached boosters for ${firebaseUid} (${cached.boosters.length} boosters)`,
        );
        return cached.boosters;
      }
      console.log(`📦 No valid cache found, scanning wallet...`);

      // Get user's wallet address
      console.log(`👤 Fetching wallet address for user ${firebaseUid}...`);
      const walletAddress = await this.getUserWalletAddress(firebaseUid);
      if (!walletAddress) {
        console.log(`❌ No wallet address found for ${firebaseUid}`);
        return [];
      }
      console.log(`✅ Wallet address: ${walletAddress}`);

      // Scan wallet for eligible NFTs
      const detectedBoosters = await this.scanWalletForBoosters(walletAddress);

      // Try to update user's staking position, but return boosters anyway
      try {
        console.log(
          `💾 Saving ${detectedBoosters.length} boosters to database...`,
        );
        await this.updateUserBoosters(firebaseUid, detectedBoosters);
        console.log(`✅ Boosters saved to database`);
      } catch (updateError) {
        console.warn(
          `⚠️ Failed to update database with boosters for ${firebaseUid}:`,
          updateError.message,
        );
      }

      // Cache result
      this.cache.set(cacheKey, {
        boosters: detectedBoosters,
        timestamp: Date.now(),
      });

      console.log(
        `🎯 BOOSTER DETECTION COMPLETE: ${detectedBoosters.length} boosters found`,
      );
      console.log(`${"=".repeat(60)}\n`);

      return detectedBoosters;
    } catch (error) {
      console.error(`❌ Error detecting boosters for ${firebaseUid}:`, error);
      console.error(`   Stack:`, error.stack);
      // Return empty array instead of throwing to allow staking page to load
      return [];
    }
  }

  /**
   * Refresh boosters for a specific user (bypasses cache)
   */
  async refreshUserBoosters(firebaseUid) {
    // Clear cache for this user
    const cacheKey = `boosters_${firebaseUid}`;
    this.cache.delete(cacheKey);

    // Redetect boosters
    return await this.detectAndAssignBoosters(firebaseUid);
  }

  /**
   * Get current boosters for a user (from cache or database)
   */
  async getUserBoosters(firebaseUid) {
    try {
      // Check cache first
      const cacheKey = `boosters_${firebaseUid}`;
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.boosters;
      }

      // Get from database
      const posDoc = await this.db
        .collection("staking_positions")
        .doc(firebaseUid)
        .get();

      if (!posDoc.exists) {
        return [];
      }

      const boosters = posDoc.data().active_boosters || [];

      // Cache result
      this.cache.set(cacheKey, {
        boosters: boosters,
        timestamp: Date.now(),
      });

      return boosters;
    } catch (error) {
      console.error(`Error getting boosters for ${firebaseUid}:`, error);
      return [];
    }
  }

  /**
   * Get all available booster categories (for frontend display)
   */
  getBoosterCategories() {
    return Object.entries(this.NFT_CATEGORIES).map(([key, category]) => ({
      key,
      name: category.name,
      type: category.type,
      multiplier: category.multiplier,
      mintCount: category.mints.length,
    }));
  }

  /**
   * Periodic scanning of all active staking users
   * Call this from a scheduled job
   *
   * Rate-limited implementation:
   * - Processes users in batches to avoid API rate limits
   * - Adds delays between batches
   * - Prevents simultaneous API calls to Helius
   */
  async refreshAllActiveBoosters() {
    try {
      console.log(
        "🔄 Starting periodic booster refresh for all active stakers...",
      );

      // Get all users with active staking positions
      const positionsSnapshot = await this.db
        .collection("staking_positions")
        .where("principal_amount", ">", 0)
        .get();

      const totalUsers = positionsSnapshot.size;
      console.log(`📊 Found ${totalUsers} active stakers to refresh`);

      if (totalUsers === 0) {
        console.log("✅ No active stakers to refresh");
        return;
      }

      // Configuration for rate limiting
      const BATCH_SIZE = 5; // Process 5 users at a time
      const DELAY_BETWEEN_BATCHES = 2000; // 2 second delay between batches
      const DELAY_BETWEEN_USERS = 500; // 500ms delay between users in a batch

      const userIds = positionsSnapshot.docs.map((doc) => doc.id);
      let processedCount = 0;
      let successCount = 0;
      let failureCount = 0;

      // Process in batches
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(userIds.length / BATCH_SIZE);

        console.log(
          `📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} users)...`,
        );

        // Process users in batch sequentially with delays
        for (const firebaseUid of batch) {
          try {
            await this.refreshUserBoosters(firebaseUid);
            successCount++;
            console.log(
              `  ✅ [${processedCount + 1}/${totalUsers}] Refreshed boosters for ${firebaseUid}`,
            );
          } catch (error) {
            failureCount++;
            console.error(
              `  ❌ [${processedCount + 1}/${totalUsers}] Failed to refresh boosters for ${firebaseUid}:`,
              error.message,
            );
          }

          processedCount++;

          // Add delay between users (except for last user in batch)
          if (
            processedCount < totalUsers &&
            batch.indexOf(firebaseUid) < batch.length - 1
          ) {
            await new Promise((resolve) =>
              setTimeout(resolve, DELAY_BETWEEN_USERS),
            );
          }
        }

        // Add delay between batches (except for last batch)
        if (i + BATCH_SIZE < userIds.length) {
          console.log(
            `⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, DELAY_BETWEEN_BATCHES),
          );
        }
      }

      console.log(
        `✅ Completed booster refresh: ${successCount} success, ${failureCount} failed, ${totalUsers} total`,
      );
    } catch (error) {
      console.error("Error in periodic booster refresh:", error);
    }
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Fetch NFT metadata including image URL for a given mint address
   * Uses Helius DAS API for fast, reliable metadata fetching
   * @param {string} mintAddress - The NFT mint address
   * @returns {Promise<Object|null>} NFT metadata with image, name, etc.
   */
  async getNFTMetadata(mintAddress) {
    try {
      // Check cache first
      const cacheKey = `nft_metadata_${mintAddress}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL * 12) {
        // 1 hour cache for metadata
        return cached.data;
      }

      if (!HELIUS_RPC_URL) {
        console.warn("⚠️ HELIUS_API_KEY not set, cannot fetch NFT metadata");
        return null;
      }

      console.log(`🖼️ Fetching NFT metadata for ${mintAddress}...`);

      const response = await fetch(HELIUS_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "booster-metadata",
          method: "getAsset",
          params: { id: mintAddress },
        }),
      });

      if (!response.ok) {
        console.error(`❌ Failed to fetch metadata: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.error) {
        console.error(`❌ Helius API error:`, data.error);
        return null;
      }

      const asset = data.result;
      if (!asset) {
        console.warn(`⚠️ No asset data found for ${mintAddress}`);
        return null;
      }

      // Extract relevant metadata
      const metadata = {
        mint: mintAddress,
        name: asset.content?.metadata?.name || "Unknown NFT",
        symbol: asset.content?.metadata?.symbol || "",
        description: asset.content?.metadata?.description || "",
        image:
          asset.content?.links?.image || asset.content?.files?.[0]?.uri || null,
        attributes: asset.content?.metadata?.attributes || [],
        collection:
          asset.grouping?.find((g) => g.group_key === "collection")
            ?.group_value || null,
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: metadata,
        timestamp: Date.now(),
      });

      console.log(
        `✅ Fetched metadata for ${metadata.name}: ${metadata.image ? "has image" : "no image"}`,
      );
      return metadata;
    } catch (error) {
      console.error(
        `❌ Error fetching NFT metadata for ${mintAddress}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Fetch metadata for multiple NFT mint addresses
   * @param {string[]} mintAddresses - Array of mint addresses
   * @returns {Promise<Object[]>} Array of NFT metadata objects
   */
  async getBatchNFTMetadata(mintAddresses) {
    if (!mintAddresses || mintAddresses.length === 0) {
      return [];
    }

    try {
      // Fetch metadata for each mint in parallel (with concurrency limit)
      const results = await Promise.all(
        mintAddresses.slice(0, 10).map((mint) => this.getNFTMetadata(mint)),
      );

      return results.filter(Boolean); // Remove null results
    } catch (error) {
      console.error("❌ Error fetching batch NFT metadata:", error);
      return [];
    }
  }

  /**
   * Get boosters with full NFT metadata including images
   * This is the main method for frontend to get displayable booster data
   * AUTO-DETECTS boosters if none are found in database (Solution 1)
   * @param {string} firebaseUid - User's Firebase UID
   * @returns {Promise<Object>} Boosters with metadata
   */
  async getBoostersWithMetadata(firebaseUid) {
    try {
      // First get the user's boosters from database/cache
      let boosters = await this.getUserBoosters(firebaseUid);

      // AUTO-DETECT: If no boosters found, trigger detection automatically
      if (!boosters || boosters.length === 0) {
        console.log(
          `🔍 No boosters in database for ${firebaseUid}, triggering auto-detection...`,
        );
        try {
          boosters = await this.detectAndAssignBoosters(firebaseUid);
          console.log(
            `✅ Auto-detection complete: ${boosters.length} boosters found`,
          );
        } catch (detectionError) {
          console.error(
            `⚠️ Auto-detection failed for ${firebaseUid}:`,
            detectionError.message,
          );
          // Return empty result if detection fails
          return {
            boosters: [],
            stackedMultiplier: 1.0,
            nftDetails: [],
            autoDetectionAttempted: true,
            autoDetectionFailed: true,
          };
        }
      }

      // If still no boosters after detection, return empty
      if (!boosters || boosters.length === 0) {
        return {
          boosters: [],
          stackedMultiplier: 1.0,
          nftDetails: [],
          autoDetectionAttempted: true,
        };
      }

      // Collect all mint addresses from all boosters
      const allMints = boosters.flatMap((b) => b.mints || []);

      // Fetch metadata for all NFTs
      const nftMetadata = await this.getBatchNFTMetadata(allMints);

      // Create a map for quick lookup
      const metadataMap = new Map(nftMetadata.map((m) => [m.mint, m]));

      // Enrich boosters with NFT details
      const enrichedBoosters = boosters.map((booster) => ({
        ...booster,
        nftDetails: (booster.mints || []).map(
          (mint) =>
            metadataMap.get(mint) || {
              mint,
              name: "Unknown NFT",
              image: null,
            },
        ),
      }));

      return {
        boosters: enrichedBoosters,
        stackedMultiplier: this.calculateStackedMultiplier(boosters),
        nftDetails: nftMetadata,
      };
    } catch (error) {
      console.error(
        `❌ Error getting boosters with metadata for ${firebaseUid}:`,
        error,
      );
      return {
        boosters: [],
        stackedMultiplier: 1.0,
        nftDetails: [],
        error: error.message,
      };
    }
  }
}

export default BoosterService;
