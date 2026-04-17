/**
 * NFT Staking Configuration
 * Centralized configuration for NFT staking system
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

  // Staking duration in days
  DURATION_DAYS: 30,

  // Fee per NFT in USD (collected but NOT distributed - kept separately)
  STAKE_FEE_PER_NFT: 0.30,

  // Enable/disable NFT staking (default: true)
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

// Total eligible NFTs (for display purposes only - NOT for reward calculation)
export const TOTAL_ELIGIBLE_NFTS = 
  NFT_STAKING_CONFIG.NFT_COUNTS.therealmkin +
  NFT_STAKING_CONFIG.NFT_COUNTS.the_realmkin_kins +
  NFT_STAKING_CONFIG.NFT_COUNTS.the_realmkin;

// Export for use elsewhere
export default {
  NFT_STAKING_CONFIG,
  TOTAL_ELIGIBLE_NFTS,
};