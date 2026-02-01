import express from "express";
import admin from "firebase-admin";

const router = express.Router();

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

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;

        // Get username from users collection (per Firebase schema)
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // Use actual username from users collection
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

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;

        // Get username from users collection (per Firebase schema)
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};

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

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;

        // Get username from users collection
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
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

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const userId = doc.id;

        // Get username from users collection
        const userDoc = await db.collection("users").doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
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

    res.json({
      success: true,
      top10: leaderboard,
      metadata: {
        type,
        totalEntries: leaderboard.length,
        lastUpdated: new Date().toISOString(),
        criteria: type === "rewards" ? "Total SOL Claimed" : "Current MKIN Staked",
        displayType: "top10"
      }
    });

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
    const db = admin.firestore();
    const limit = parseInt(req.query.limit) || 10;
    
    // Get current distribution ID
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const distributionId = `revenue_dist_${year}_${month}`;
    
    console.log(`[Leaderboard] Fetching top ${limit} secondary market buyers for ${distributionId}`);
    
    // Check if collection exists first
    const collectionRef = db.collection('revenueDistributionAllocations');
    const testSnapshot = await collectionRef.limit(1).get();
    
    if (testSnapshot.empty) {
      console.log('[Leaderboard] No revenue distribution data available yet');
      return res.json({ 
        leaderboard: [],
        message: 'No revenue distribution has been run yet. Please run the monthly allocation first.'
      });
    }
    
    // Query revenue distribution allocations ordered by nftCount
    let allocationsSnapshot;
    try {
      allocationsSnapshot = await collectionRef
        .where('distributionId', '==', distributionId)
        .orderBy('nftCount', 'desc')
        .limit(limit)
        .get();
    } catch (indexError) {
      // If index doesn't exist, fallback to fetching all and sorting in memory
      console.log('[Leaderboard] Firestore index not found, using fallback query');
      const allAllocations = await collectionRef
        .where('distributionId', '==', distributionId)
        .get();
      
      // Sort in memory and limit
      const sortedDocs = allAllocations.docs
        .sort((a, b) => (b.data().nftCount || 0) - (a.data().nftCount || 0))
        .slice(0, limit);
      
      allocationsSnapshot = { docs: sortedDocs, empty: sortedDocs.length === 0 };
    }
    
    if (allocationsSnapshot.empty) {
      console.log('[Leaderboard] No allocations found for this month');
      return res.json({ 
        leaderboard: [],
        message: `No revenue distribution allocations found for ${distributionId}`
      });
    }
    
    // Build leaderboard with user details
    const leaderboard = await Promise.all(
      allocationsSnapshot.docs.map(async (doc, index) => {
        const allocation = doc.data();
        const userId = allocation.userId;
        
        // Get user profile
        let username = `User ${userId.slice(0, 6)}`;
        let avatarUrl = undefined;
        
        try {
          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            username = userData.username || userData.email?.split('@')[0] || username;
            avatarUrl = userData.avatarUrl;
          }
        } catch (error) {
          console.error(`Error fetching user ${userId}:`, error);
        }
        
        return {
          rank: index + 1,
          userId,
          username,
          nftCount: allocation.nftCount || 0,
          weight: allocation.weight || 0,
          avatarUrl,
        };
      })
    );
    
    res.json({ leaderboard });
  } catch (error) {
    console.error('[Leaderboard] Error fetching secondary market leaderboard:', error);
    res.status(500).json({
      error: 'Failed to fetch leaderboard',
      details: error.message,
    });
  }
});

export default router;