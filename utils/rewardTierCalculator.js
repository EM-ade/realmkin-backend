/**
 * Revenue Share Tier Calculator - February 2026
 * 
 * Multi-tier reward distribution system:
 * - Holder Share: 35% of royalty pool to all NFT holders
 * - Tier 3 (Special Perks): 1.5 SOL pool for 12+ NFT minters
 * - Tier 2 (Top 5): 300K MKIN + 1.5 SOL for top 5 secondary buyers
 * - Tier 1 (Top 3): 450K EMPIRE + 300K MKIN + 1.5 SOL for top 3
 */

import { getFeeInSol } from './solPrice.js';

/**
 * Reward tier configurations for February 2026
 */
export const REWARD_TIERS = {
  // Holder Share: 35% of royalty distributed to all holders
  HOLDER_SHARE: {
    name: 'Holder Share',
    minNfts: 1,
    royaltyPercentage: 0.35, // 35% of royalty pool
    distributionType: 'proportional', // Based on NFT count
    includesListed: true, // Include listed NFTs in count
  },
  
  // Tier 3: Special Perks
  TIER_3: {
    name: 'Special Perks',
    minNfts: 12,
    poolSol: 1.5,
    poolEmpire: 0,
    poolMkin: 0,
    distributionType: 'secondary-market-weight', // Based on secondary purchases
  },
  
  // Tier 2: Top 5
  TIER_2: {
    name: 'Top 5',
    maxRank: 5,
    poolSol: 1.5,
    poolEmpire: 0,
    poolMkin: 300000,
    distributionType: 'rank-based',
    // Rank distribution: 1st=50%, 2nd=30%, 3rd=15%, 4th=3%, 5th=2%
    rankDistribution: [0.50, 0.30, 0.15, 0.03, 0.02],
  },
  
  // Tier 1: Top 3
  TIER_1: {
    name: 'Top 3',
    maxRank: 3,
    poolSol: 1.5,
    poolEmpire: 450000,
    poolMkin: 300000,
    distributionType: 'rank-based',
    // Rank distribution: 1st=60%, 2nd=30%, 3rd=10%
    rankDistribution: [0.60, 0.30, 0.10],
  },
};

/**
 * Get current SOL price in USD
 * @returns {Promise<number>} SOL price in USD
 */
export async function getSolPrice() {
  try {
    const { solPrice } = await getFeeInSol(1.0);
    return solPrice;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    return 140; // Fallback price
  }
}

/**
 * Calculate holder share rewards (35% royalty pool)
 * @param {Array} holders - Array of {userId, walletAddress, nftCount}
 * @param {number} totalRoyaltyPool - Total royalty pool in USD
 * @returns {Array} - Array with calculated rewards per user
 */
export function calculateHolderShare(holders, totalRoyaltyPool) {
  if (holders.length === 0 || totalRoyaltyPool <= 0) {
    return [];
  }

  const totalNfts = holders.reduce((sum, h) => sum + (h.nftCount || 0), 0);
  
  if (totalNfts === 0) {
    return [];
  }

  const holderSharePool = totalRoyaltyPool * REWARD_TIERS.HOLDER_SHARE.royaltyPercentage;

  return holders.map(holder => {
    const weight = holder.nftCount / totalNfts;
    const solValue = holderSharePool / 140; // Approximate, will be refined during distribution
    
    return {
      userId: holder.userId,
      walletAddress: holder.walletAddress,
      nftCount: holder.nftCount,
      tier: 'HOLDER_SHARE',
      weight,
      amountSol: solValue * weight,
      amountEmpire: 0,
      amountMkin: 0,
      holderShare: {
        amountSol: solValue * weight,
        amountEmpire: 0,
        amountMkin: 0,
      },
    };
  });
}

/**
 * Calculate Tier 3 rewards (12+ NFTs, secondary market pool)
 * @param {Array} eligibleUsers - Users with 12+ NFTs and secondary purchases
 * @param {Map} secondaryPurchaseCounts - Map of wallet -> purchase count
 * @returns {Array}
 */
export function calculateTier3Rewards(eligibleUsers, secondaryPurchaseCounts) {
  if (eligibleUsers.length === 0) {
    return [];
  }

  // Calculate total purchases across all eligible users
  const totalPurchases = eligibleUsers.reduce((sum, u) => {
    const purchases = secondaryPurchaseCounts.get(u.walletAddress) || 0;
    return sum + purchases;
  }, 0);

  if (totalPurchases === 0) {
    // If no purchase data, distribute equally among eligible
    const equalShare = REWARD_TIERS.TIER_3.poolSol / eligibleUsers.length;
    return eligibleUsers.map(user => ({
      userId: user.userId,
      walletAddress: user.walletAddress,
      nftCount: user.nftCount,
      tier: 'TIER_3',
      weight: 1 / eligibleUsers.length,
      amountSol: equalShare,
      amountEmpire: 0,
      amountMkin: 0,
      tier3: {
        amountSol: equalShare,
        amountEmpire: 0,
        amountMkin: 0,
      },
    }));
  }

  return eligibleUsers.map(user => {
    const purchases = secondaryPurchaseCounts.get(user.walletAddress) || 0;
    const weight = purchases / totalPurchases;
    
    return {
      userId: user.userId,
      walletAddress: user.walletAddress,
      nftCount: user.nftCount,
      tier: 'TIER_3',
      weight,
      amountSol: REWARD_TIERS.TIER_3.poolSol * weight,
      amountEmpire: 0,
      amountMkin: 0,
      tier3: {
        amountSol: REWARD_TIERS.TIER_3.poolSol * weight,
        amountEmpire: 0,
        amountMkin: 0,
      },
    };
  });
}

/**
 * Calculate rank-based rewards (Tier 1 and Tier 2)
 * @param {Array} leaderboard - Sorted leaderboard entries (already ranked)
 * @param {string} tier - 'TIER_1' or 'TIER_2'
 * @returns {Array}
 */
export function calculateRankBasedRewards(leaderboard, tier) {
  const tierConfig = REWARD_TIERS[tier];
  
  if (!tierConfig || leaderboard.length === 0) {
    return [];
  }

  // Get top N users based on tier maxRank
  const topUsers = leaderboard.slice(0, tierConfig.maxRank);

  return topUsers.map((user, index) => {
    const rankDistribution = tierConfig.rankDistribution[index] || 0;
    
    return {
      userId: user.userId,
      walletAddress: user.walletAddress,
      username: user.username,
      rank: index + 1,
      tier,
      weight: rankDistribution,
      amountSol: tierConfig.poolSol * rankDistribution,
      amountEmpire: tierConfig.poolEmpire * rankDistribution,
      amountMkin: tierConfig.poolMkin * rankDistribution,
      [tier.toLowerCase()]: {
        amountSol: tierConfig.poolSol * rankDistribution,
        amountEmpire: tierConfig.poolEmpire * rankDistribution,
        amountMkin: tierConfig.poolMkin * rankDistribution,
      },
    };
  });
}

/**
 * Merge multiple tier allocations per user
 * @param {Array} allocations - All tier allocations
 * @returns {Array} - Merged allocations per user
 */
export function mergeUserAllocations(allocations) {
  const userMap = new Map();
  
  for (const alloc of allocations) {
    const key = alloc.userId;
    if (!userMap.has(key)) {
      userMap.set(key, {
        userId: alloc.userId,
        walletAddress: alloc.walletAddress,
        username: alloc.username || null,
        tiers: [],
        amountSol: 0,
        amountEmpire: 0,
        amountMkin: 0,
        totalWeight: 0,
        holderShare: null,
        tier3: null,
        tier2: null,
        tier1: null,
      });
    }
    
    const user = userMap.get(key);
    
    // Add tier if not already present
    if (!user.tiers.includes(alloc.tier)) {
      user.tiers.push(alloc.tier);
    }
    
    // Sum up rewards
    user.amountSol += alloc.amountSol;
    user.amountEmpire += alloc.amountEmpire;
    user.amountMkin += alloc.amountMkin;
    user.totalWeight += alloc.weight;
    
    // Store tier-specific breakdown
    if (alloc.holderShare) {
      user.holderShare = alloc.holderShare;
    }
    if (alloc.tier3) {
      user.tier3 = alloc.tier3;
    }
    if (alloc.tier2) {
      user.tier2 = alloc.tier2;
    }
    if (alloc.tier1) {
      user.tier1 = alloc.tier1;
    }
  }
  
  return Array.from(userMap.values());
}

/**
 * Get all reward tiers with their requirements and rewards
 * @returns {Object} Tier information for frontend display
 */
export function getTierInformation() {
  return {
    HOLDER_SHARE: {
      name: 'Holder Share',
      icon: '🏰',
      requirement: 'Hold 1+ NFTs',
      reward: '35% of royalty pool',
      distributionBasis: 'Proportional to holdings',
    },
    TIER_3: {
      name: 'Special Perks',
      icon: '🔱',
      requirement: 'Mint 12+ NFTs',
      reward: '1.5 SOL pool',
      distributionBasis: 'Secondary market purchases',
    },
    TIER_2: {
      name: 'Top 5',
      icon: '⚔️',
      requirement: 'Top 5 leaderboard',
      reward: '300,000 MKIN + 1.5 SOL',
      distributionBasis: 'Rank-based',
    },
    TIER_1: {
      name: 'Top 3',
      icon: '👑',
      requirement: 'Top 3 leaderboard',
      reward: '450,000 EMPIRE + 300,000 MKIN + 1.5 SOL',
      distributionBasis: 'Rank-based',
    },
  };
}

export default {
  REWARD_TIERS,
  calculateHolderShare,
  calculateTier3Rewards,
  calculateRankBasedRewards,
  mergeUserAllocations,
  getSolPrice,
  getTierInformation,
};
