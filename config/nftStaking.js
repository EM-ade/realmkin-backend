/**
 * NFT Staking Configuration
 * Centralized configuration for NFT staking system
 * 
 * Note: stakingEnabled can be overridden by Firestore config (config/nftStaking document)
 */

export const NFT_STAKING_CONFIG = {
  // Token pool for rewards (configurable via env var)
  TOKEN_POOL: parseInt(process.env.NFT_STAKING_TOKEN_POOL) || 20000,

  // NFT counts per collection (for calculating ELIGIBLE total - not for reward calc)
  NFT_COUNTS: {
    therealmkin: 2152,
    the_realmkin_kins: 50,
    the_realmkin: 44,
  },

  // Staking duration in days (used if no global period set)
  DURATION_DAYS: 30,

  // Global staking period (same end date for everyone)
  // Format: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
  // If set, all NFTs staked will unlock on the same date
  STAKING_PERIOD: process.env.NFT_STAKING_PERIOD_START && process.env.NFT_STAKING_PERIOD_END 
    ? { 
        start: process.env.NFT_STAKING_PERIOD_START, 
        end: process.env.NFT_STAKING_PERIOD_END 
      }
    : { start: "2025-03-01", end: "2025-03-30" }, // Default: March 2025

  // Fee per NFT in USD (collected but NOT distributed - kept separately)
  STAKE_FEE_PER_NFT: 0.30,

  // Enable/disable NFT staking (default: true, can be overridden by Firestore)
  ENABLED: process.env.NFT_STAKING_ENABLED === 'false' ? false : true,

  // Collection IDs for validation
  VALID_COLLECTIONS: ['therealmkin', 'the_realmkin_kins', 'the_realmkin'],

  // Collection addresses for ownership verification
  COLLECTION_ADDRESSES: {
    therealmkin: '89KnhXiCHb2eGP2jRGzEQX3B8NTyqHEVmu55syDWSnL8',
    the_realmkin_kins: 'EzjhzaTBqXohJTsaMKFSX6fgXcDJyXAV85NK7RK79u3Z',
    the_realmkin: 'eTQujiFKVvLJXdkAobg9JqULNdDrCt5t4WtDochmVSZ',
  },

  // Helius API for NFT verification
  HELIUS_RPC_URL: process.env.HELIUS_API_KEY 
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : null,
};

// Helper to check if staking period is currently open
export function isStakingPeriodOpen() {
  const now = new Date();
  const period = NFT_STAKING_CONFIG.STAKING_PERIOD;
  const startDate = new Date(period.start + "T00:00:00Z");
  const endDate = new Date(period.end + "T23:59:59Z");
  
  return now >= startDate && now <= endDate;
}

// Helper to check if staking period has ended (claimable now)
export function isStakingPeriodEnded() {
  const now = new Date();
  const period = NFT_STAKING_CONFIG.STAKING_PERIOD;
  const endDate = new Date(period.end + "T23:59:59Z");
  
  return now > endDate;
}

// Get current period status
export function getStakingPeriodStatus() {
  const period = NFT_STAKING_CONFIG.STAKING_PERIOD;
  const now = new Date();
  const startDate = new Date(period.start + "T00:00:00Z");
  const endDate = new Date(period.end + "T23:59:59Z");
  
  if (now < startDate) {
    return { status: "upcoming", message: `Staking opens ${period.start}` };
  } else if (now >= startDate && now <= endDate) {
    return { status: "open", message: `Staking open until ${period.end}` };
  } else {
    return { status: "closed", message: `Staking closed. Claims open until next period.` };
  }
}

// Total eligible NFTs (for display purposes only - NOT for reward calculation)
export const TOTAL_ELIGIBLE_NFTS = 
  NFT_STAKING_CONFIG.NFT_COUNTS.therealmkin +
  NFT_STAKING_CONFIG.NFT_COUNTS.the_realmkin_kins +
  NFT_STAKING_CONFIG.NFT_COUNTS.the_realmkin;

// Export for use elsewhere
export default {
  NFT_STAKING_CONFIG,
  TOTAL_ELIGIBLE_NFTS,
  isStakingPeriodOpen,
  isStakingPeriodEnded,
  getStakingPeriodStatus,
};