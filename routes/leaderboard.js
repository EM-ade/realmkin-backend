import express from "express";
import admin from "firebase-admin";

const router = express.Router();

// In-memory cache for leaderboard data
const leaderboardCache = {
  mining: { data: null, timestamp: 0 },
  secondaryMarket: { data: null, timestamp: 0 },
};

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

function getCachedData(cacheKey) {
  const cached = leaderboardCache[cacheKey];
  // Check if cached exists and has valid data
  if (cached && cached.data && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`[Leaderboard] Cache HIT for ${cacheKey} (age: ${Math.floor((Date.now() - cached.timestamp) / 1000)}s)`);
    return cached.data;
  }
  console.log(`[Leaderboard] Cache MISS for ${cacheKey} (cached: ${!!cached}, hasData: ${!!(cached?.data)})`);
  return null;
}

function setCachedData(cacheKey, data) {
  leaderboardCache[cacheKey] = {
    data,
    timestamp: Date.now(),
  };
  console.log(`[Leaderboard] Cached ${cacheKey} for ${CACHE_DURATION / 1000}s`);
}

/**
 * Invalidate secondary market cache
 * Called when secondary sale cache is refreshed
 */
export function invalidateSecondaryMarketCache() {
  const keysToInvalidate = Object.keys(leaderboardCache).filter(key => 
    key.startsWith('secondaryMarket')
  );
  
  keysToInvalidate.forEach(key => {
    leaderboardCache[key] = { data: null, timestamp: 0 };
  });
  
  console.log(`[Leaderboard] Invalidated ${keysToInvalidate.length} secondary market cache entries`);
  return keysToInvalidate.length;
}

/**
 * GET /leaderboard/mining
 * Returns top miners based on total claimed rewards or current staked amount
 */
router.get("/mining", async (req, res) => {
  try {
    const { 
      type = "rewards", // "rewards" or "staked" 
      limit = 10,
      period = "all" // "all", "weekly", "daily"
    } = req.query;

    const db = admin.firestore();
    let leaderboard = [];

    if (type === "rewards") {
      // Top miners by total claimed SOL rewards
      const positionsRef = db.collection("staking_positions");
      const snapshot = await positionsRef
        .where("total_claimed_sol", ">", 0)
        .orderBy("total_claimed_sol", "desc")
        .limit(parseInt(limit))
        .get();

      // OPTIMIZATION: Batch get all usernames to avoid N+1 query
      // This reduces reads from 11 (1 + 10) to 2 (1 + 1 batch)
      const userIds = snapshot.docs.map(doc => doc.id);
      const userDocs = await db.getAll(...userIds.map(id => db.collection("users").doc(id)));
      const userMap = new Map();
      userDocs.forEach(doc => {
        if (doc.exists) {
          userMap.set(doc.id, doc.data());
        }
      });

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;
        const userData = userMap.get(userId) || {};
        let displayName = userData.username || `User${userId.slice(-4)}`;

        leaderboard.push({
          userId,
          username: displayName,
          rank: leaderboard.length + 1,
          value: data.total_claimed_sol || 0,
          valueLabel: `${(data.total_claimed_sol || 0).toFixed(6)} SOL`,
          metadata: {
            principalAmount: data.principal_amount || 0,
            totalAccruedSol: data.total_accrued_sol || 0,
            stakeStartTime: data.stake_start_time?.toMillis() || null,
            lastStakeTime: data.last_stake_time?.toMillis() || null,
            activeBoosters: data.active_boosters || [],
            boosterMultiplier: calculateBoosterMultiplier(data.active_boosters || [])
          },
          breakdown: {
            "Staked": `${(data.principal_amount || 0).toLocaleString()} MKIN`,
            "Claimed": `${(data.total_claimed_sol || 0).toFixed(6)} SOL`
          }
        });
      }
    } else if (type === "staked") {
      // Top miners by current staked amount
      const positionsRef = db.collection("staking_positions");
      const snapshot = await positionsRef
        .where("principal_amount", ">", 0)
        .orderBy("principal_amount", "desc")
        .limit(parseInt(limit))
        .get();

      // OPTIMIZATION: Batch get all usernames to avoid N+1 query
      // This reduces reads from 11 (1 + 10) to 2 (1 + 1 batch)
      const userIds = snapshot.docs.map(doc => doc.id);
      const userDocs = await db.getAll(...userIds.map(id => db.collection("users").doc(id)));
      const userMap = new Map();
      userDocs.forEach(doc => {
        if (doc.exists) {
          userMap.set(doc.id, doc.data());
        }
      });

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;
        const userData = userMap.get(userId) || {};
        let displayName = userData.username || `User${userId.slice(-4)}`;

        leaderboard.push({
          userId,
          username: displayName,
          rank: leaderboard.length + 1,
          value: data.principal_amount || 0,
          valueLabel: `${(data.principal_amount || 0).toLocaleString()} MKIN`,
          metadata: {
            totalClaimedSol: data.total_claimed_sol || 0,
            totalAccruedSol: data.total_accrued_sol || 0,
            pendingRewards: data.pending_rewards || 0,
            stakeStartTime: data.stake_start_time?.toMillis() || null,
            lastStakeTime: data.last_stake_time?.toMillis() || null,
            activeBoosters: data.active_boosters || [],
            boosterMultiplier: calculateBoosterMultiplier(data.active_boosters || [])
          },
          breakdown: {
            "Staked": `${(data.principal_amount || 0).toLocaleString()} MKIN`,
            "Rewards": `${(data.total_claimed_sol || 0).toFixed(6)} SOL`
          }
        });
      }
    }

    // Add period filtering if needed (for weekly/daily leaderboards)
    if (period === "weekly" || period === "daily") {
      const now = new Date();
      const cutoffTime = new Date();
      
      if (period === "weekly") {
        cutoffTime.setDate(now.getDate() - 7);
      } else if (period === "daily") {
        cutoffTime.setDate(now.getDate() - 1);
      }

      // Filter entries based on activity in the period
      leaderboard = leaderboard.filter(entry => {
        const lastActivity = entry.metadata.lastStakeTime || entry.metadata.stakeStartTime;
        return lastActivity && lastActivity > cutoffTime.getTime();
      });

      // Re-rank after filtering
      leaderboard.forEach((entry, index) => {
        entry.rank = index + 1;
      });
    }

    res.json({
      success: true,
      leaderboard,
      metadata: {
        type,
        period,
        totalEntries: leaderboard.length,
        lastUpdated: new Date().toISOString(),
        criteria: type === "rewards" ? "Total SOL Claimed" : "Current MKIN Staked"
      }
    });

  } catch (error) {
    console.error("Error fetching mining leaderboard:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch mining leaderboard",
      message: error.message
    });
  }
});

/**
 * GET /leaderboard/mining/top3
 * Returns top 3 miners for quick display
 */
router.get("/mining/top3", async (req, res) => {
  try {
    const { type = "rewards" } = req.query;

    // Use the main mining endpoint but limit to 3
    const response = await new Promise((resolve, reject) => {
      // Simulate internal API call
      const mockReq = { query: { type, limit: 3, period: "all" } };
      const mockRes = {
        json: (data) => resolve(data),
        status: (code) => ({ json: (data) => reject(new Error(data.message)) })
      };

      // Call the main endpoint logic
      router.handle({ method: "GET", url: "/mining", query: mockReq.query }, mockRes);
    });

    if (response.success) {
      // Add special formatting for top 3
      const top3 = response.leaderboard.slice(0, 3).map((entry, index) => ({
        ...entry,
        medal: ["🥇", "🥈", "🥉"][index],
        tier: ["1st", "2nd", "3rd"][index]
      }));

      res.json({
        success: true,
        top3,
        metadata: {
          ...response.metadata,
          displayType: "top3"
        }
      });
    } else {
      throw new Error("Failed to fetch leaderboard data");
    }

  } catch (error) {
    console.error("Error fetching top 3 miners:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch top 3 miners",
      message: error.message
    });
  }
});

/**
 * GET /leaderboard/mining/top10
 * Returns top 10 miners by total rewards or staked amount
 */
router.get("/mining/top10", async (req, res) => {
  try {
    const type = req.query.type || "rewards"; // "rewards" or "staked"
    const cacheKey = `mining_${type}_top10`;
    
    // Check cache first
    const cached = getCachedData(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const db = admin.firestore();
    let leaderboard = [];

    if (type === "rewards") {
      // Top miners by total claimed SOL rewards
      const positionsRef = db.collection("staking_positions");
      const snapshot = await positionsRef
        .where("total_claimed_sol", ">", 0)
        .orderBy("total_claimed_sol", "desc")
        .limit(10)
        .get();

      // Batch get all usernames (fix N+1 query)
      const userIds = snapshot.docs.map(doc => doc.id);
      const userDocs = await db.getAll(...userIds.map(id => db.collection("users").doc(id)));
      const userMap = new Map();
      userDocs.forEach(doc => {
        if (doc.exists) {
          userMap.set(doc.id, doc.data());
        }
      });

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;
        const userData = userMap.get(userId) || {};
        let displayName = userData.username || `User${userId.slice(-4)}`;

        leaderboard.push({
          userId,
          username: displayName,
          rank: leaderboard.length + 1,
          value: data.total_claimed_sol || 0,
          valueLabel: `${(data.total_claimed_sol || 0).toFixed(6)} SOL`,
          metadata: {
            principalAmount: data.principal_amount || 0,
            totalAccruedSol: data.total_accrued_sol || 0,
            activeBoosters: data.active_boosters || [],
            boosterMultiplier: calculateBoosterMultiplier(data.active_boosters || [])
          }
        });
      }
    } else if (type === "staked") {
      // Top miners by current staked amount
      const positionsRef = db.collection("staking_positions");
      const snapshot = await positionsRef
        .where("principal_amount", ">", 0)
        .orderBy("principal_amount", "desc")
        .limit(10)
        .get();

      // Batch get all usernames (fix N+1 query)
      const userIds = snapshot.docs.map(doc => doc.id);
      const userDocs = await db.getAll(...userIds.map(id => db.collection("users").doc(id)));
      const userMap = new Map();
      userDocs.forEach(doc => {
        if (doc.exists) {
          userMap.set(doc.id, doc.data());
        }
      });

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;
        const userData = userMap.get(userId) || {};
        let displayName = userData.username || `User${userId.slice(-4)}`;

        leaderboard.push({
          userId,
          username: displayName,
          rank: leaderboard.length + 1,
          value: data.principal_amount || 0,
          valueLabel: `${(data.principal_amount || 0).toLocaleString()} MKIN`,
          metadata: {
            totalClaimedSol: data.total_claimed_sol || 0,
            activeBoosters: data.active_boosters || [],
            boosterMultiplier: calculateBoosterMultiplier(data.active_boosters || [])
          }
        });
      }
    }

    const response = {
      success: true,
      top10: leaderboard,
      metadata: {
        type,
        totalEntries: leaderboard.length,
        lastUpdated: new Date().toISOString(),
        criteria: type === "rewards" ? "Total SOL Claimed" : "Current MKIN Staked",
        displayType: "top10",
        cached: false
      }
    };
    
    // Cache the response
    setCachedData(cacheKey, response);
    
    res.json(response);

  } catch (error) {
    console.error("Error fetching top 10 miners:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch top 10 miners",
      message: error.message
    });
  }
});

/**
 * Helper: Calculate Booster Multiplier
 * Same logic as in stakingService.js
 */
function calculateBoosterMultiplier(activeBoosters = []) {
  if (!activeBoosters || activeBoosters.length === 0) {
    return 1.0;
  }

  let maxMultiplier = 1.0;

  for (const booster of activeBoosters) {
    const type = booster.type?.toLowerCase() || "";

    if (type.includes("realmkin_miner") || type.includes("miner")) {
      maxMultiplier = Math.max(maxMultiplier, 2.0); // Top tier
    } else if (type.includes("customized") || type.includes("custom")) {
      maxMultiplier = Math.max(maxMultiplier, 1.5); // Mid tier
    } else if (type.includes("realmkin") || type.includes("1/1")) {
      maxMultiplier = Math.max(maxMultiplier, 1.25); // Lowest tier
    }
  }

  return maxMultiplier;
}

/**
 * GET /api/leaderboard/secondary-market
 * Get top users by secondary market NFT purchases
 */
router.get('/secondary-market', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const cacheKey = `secondaryMarket_top${limit}`;
    
    console.log(`[Leaderboard] Secondary market leaderboard request (limit: ${limit})`);
    
    // Check cache first
    const cached = getCachedData(cacheKey);
    if (cached) {
      console.log(`[Leaderboard] Returning cached secondary market data`);
      return res.json(cached);
    }
    
    const db = admin.firestore();
    console.log(`[Leaderboard] Fetching top ${limit} secondary market buyers from database`);
    
    // Query all cached entries (can't filter by salesCount in query without index)
    const cacheRef = db.collection('secondarySaleCache');
    const cacheSnapshot = await cacheRef.get();
    
    if (cacheSnapshot.empty) {
      console.log('[Leaderboard] No secondary market data in cache');
      return res.json({ 
        leaderboard: [],
        message: 'No secondary market data available yet. Please run the cache refresh first.'
      });
    }
    
    // Filter for users with sales and sort by salesCount in memory
    const sortedDocs = cacheSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(doc => (doc.salesCount || 0) > 0) // Only users with actual sales
      .sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0))
      .slice(0, limit);
    
    if (sortedDocs.length === 0) {
      console.log('[Leaderboard] No users with secondary market sales found');
      return res.json({ 
        leaderboard: [],
        message: 'No users have purchased from secondary market yet.'
      });
    }
    
    // Optimized: Batch fetch all user data upfront
    console.log(`[Leaderboard] Batch fetching user data for ${sortedDocs.length} wallets...`);
    
    // Step 1: Batch get from wallets collection (primary source)
    const walletAddresses = sortedDocs.map(doc => doc.walletAddress || doc.id);
    const walletLookup = new Map();
    
    // Fetch wallets in batches (Firestore limit: 500 per batch)
    const BATCH_SIZE = 500;
    for (let i = 0; i < walletAddresses.length; i += BATCH_SIZE) {
      const batch = walletAddresses.slice(i, i + BATCH_SIZE);
      const walletDocs = await Promise.all(
        batch.map(addr => db.collection('wallets').doc(addr.toLowerCase()).get())
      );
      
      walletDocs.forEach((doc, idx) => {
        if (doc.exists) {
          const data = doc.data();
          const originalAddress = batch[idx];
          walletLookup.set(originalAddress, {
            userId: data.uid || data.userId,
            username: data.username,
            source: 'wallets'
          });
        }
      });
    }
    
    console.log(`[Leaderboard] Found ${walletLookup.size} users in wallets collection`);
    
    // Step 2: For wallets not found, check userRewards (single query)
    const notFoundWallets = walletAddresses.filter(addr => !walletLookup.has(addr));
    if (notFoundWallets.length > 0) {
      console.log(`[Leaderboard] Checking userRewards for ${notFoundWallets.length} remaining wallets...`);
      
      // Query userRewards for all missing wallets (uses IN operator, max 30 at a time)
      const QUERY_LIMIT = 30;
      for (let i = 0; i < notFoundWallets.length; i += QUERY_LIMIT) {
        const batchWallets = notFoundWallets.slice(i, i + QUERY_LIMIT);
        const userRewardsSnapshot = await db.collection('userRewards')
          .where('walletAddress', 'in', batchWallets)
          .get();
        
        userRewardsSnapshot.forEach(doc => {
          const data = doc.data();
          walletLookup.set(data.walletAddress, {
            userId: doc.id,
            source: 'userRewards'
          });
        });
      }
      
      console.log(`[Leaderboard] Found ${walletLookup.size} total users after userRewards check`);
    }
    
    // Step 3: Batch get user profiles for all found userIds
    const userIds = Array.from(new Set(
      Array.from(walletLookup.values())
        .map(data => data.userId)
        .filter(id => id)
    ));
    
    console.log(`[Leaderboard] Fetching ${userIds.length} user profiles...`);
    const userProfiles = new Map();
    
    if (userIds.length > 0) {
      // Batch get user documents
      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batchIds = userIds.slice(i, i + BATCH_SIZE);
        const userDocs = await Promise.all(
          batchIds.map(id => db.collection('users').doc(id).get())
        );
        
        userDocs.forEach((doc, idx) => {
          if (doc.exists) {
            const data = doc.data();
            userProfiles.set(batchIds[idx], {
              username: data.username || data.email?.split('@')[0],
              avatarUrl: data.avatarUrl
            });
          }
        });
      }
    }
    
    console.log(`[Leaderboard] Fetched ${userProfiles.size} user profiles`);
    
    // Step 4: Build leaderboard (no async operations needed)
    const leaderboard = sortedDocs.map((cacheData, index) => {
      const walletAddress = cacheData.walletAddress || cacheData.id;
      const walletData = walletLookup.get(walletAddress);
      
      let userId = walletData?.userId || null;
      let username = `User ${walletAddress.slice(0, 6)}`;
      let avatarUrl = undefined;
      
      // Get username from wallet lookup
      if (walletData?.username) {
        username = walletData.username;
      }
      
      // Get full profile data if userId found
      if (userId) {
        const profile = userProfiles.get(userId);
        if (profile) {
          username = profile.username || username;
          avatarUrl = profile.avatarUrl;
        }
      }
      
      return {
        rank: index + 1,
        userId: userId || walletAddress,
        username,
        nftCount: cacheData.salesCount || 0,
        walletAddress,
        avatarUrl,
      };
    });
    
    // Get the latest cache timestamp
    const latestCache = sortedDocs[0]; // First doc has most recent data
    const lastUpdated = latestCache?.lastCheckedAt?.toDate?.().toISOString() || new Date().toISOString();
    
    const response = { 
      leaderboard,
      lastUpdated,
      cacheStatus: 'active',
      nextUpdate: 'Daily at 02:00 AM WAT (Nigerian time)',
      source: 'secondarySaleCache',
      cached: false
    };
    
    // Cache the response
    setCachedData(cacheKey, response);
    
    res.json(response);
  } catch (error) {
    console.error('[Leaderboard] Error fetching secondary market leaderboard:', error);
    res.status(500).json({
      error: 'Failed to fetch leaderboard',
      details: error.message,
    });
  }
});

export default router;