import express from 'express';
import admin from 'firebase-admin';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configuration
const CONFIG = {
  DISTRIBUTION_AMOUNT: 35000,
  DISTRIBUTION_ID: 'one_time_mkin_distribution_2025_01_05_6am',
  BATCH_SIZE: 50,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000,
  HELIUS_TIMEOUT_MS: 30000,
  HELIUS_PAGE_LIMIT: 1000,
  HELIUS_RATE_LIMIT_DELAY_MS: 200,
  SECRET_TOKEN: process.env.DISTRIBUTION_SECRET_TOKEN || 'your-secret-token-here', // For security
};

// Simple in-memory logger
class SimpleLogger {
  constructor() {
    this.logs = [];
    this.startTime = new Date();
  }

  log(level, message, data = null) {
    const entry = { timestamp: new Date().toISOString(), level, message, data };
    this.logs.push(entry);
    console.log(`[${entry.timestamp}] ${level}: ${message}`, data || '');
  }

  info(msg, data) { this.log('INFO', msg, data); }
  success(msg, data) { this.log('SUCCESS', msg, data); }
  warning(msg, data) { this.log('WARNING', msg, data); }
  error(msg, data) { this.log('ERROR', msg, data); }
  debug(msg, data) { this.log('DEBUG', msg, data); }

  getLogs() { return this.logs; }
}

// NFT Verifier (simplified for route)
class NFTVerifier {
  constructor(logger) {
    this.logger = logger;
    this.heliusApiKey = process.env.HELIUS_API_KEY;
    this.magicEdenApiKey = process.env.MAGIC_EDEN_API_KEY;
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
  }

  isValidSolanaAddress(walletAddress) {
    const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return solanaRegex.test(walletAddress);
  }

  async verifyNFTOwnership(walletAddress, activeContracts) {
    if (!walletAddress || !activeContracts.length) return 0;
    if (!this.isValidSolanaAddress(walletAddress)) return 0;

    try {
      let allNFTs = [];
      
      if (this.heliusApiKey) {
        try {
          allNFTs = await this.fetchAllNFTsHelius(walletAddress);
        } catch (heliusError) {
          this.logger.warning(`Helius failed, trying Magic Eden`);
          if (this.magicEdenApiKey) {
            allNFTs = await this.fetchAllNFTsMagicEden(walletAddress, activeContracts);
          } else {
            throw heliusError;
          }
        }
      }
      
      const mkinNFTs = this.filterMKINNFTs(allNFTs, activeContracts);
      return mkinNFTs.length;
    } catch (error) {
      this.logger.error(`NFT verification failed for ${walletAddress}`, error.message);
      throw error;
    }
  }

  async fetchAllNFTsHelius(walletAddress) {
    let allNFTs = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.retryWithBackoff(async () => {
        return await axios.post(this.rpcUrl, {
          jsonrpc: '2.0',
          id: `nft-fetch-page-${page}`,
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: walletAddress,
            page: page,
            limit: CONFIG.HELIUS_PAGE_LIMIT,
            displayOptions: { showFungible: false, showNativeBalance: false, showInscription: false },
          },
        }, { headers: { 'Content-Type': 'application/json' }, timeout: CONFIG.HELIUS_TIMEOUT_MS });
      });

      if (response.data.error) throw new Error(`Helius API error: ${response.data.error.message}`);

      const items = response.data.result?.items || [];
      allNFTs = allNFTs.concat(items);
      hasMore = items.length === CONFIG.HELIUS_PAGE_LIMIT;
      
      if (hasMore) {
        page++;
        await new Promise(resolve => setTimeout(resolve, CONFIG.HELIUS_RATE_LIMIT_DELAY_MS));
      }
    }

    return allNFTs;
  }

  async fetchAllNFTsMagicEden(walletAddress, activeContracts) {
    const allNFTs = [];
    const symbols = ['the_realmkin_kins', 'Therealmkin', 'therealmkin'];

    for (const symbol of symbols) {
      try {
        const response = await this.retryWithBackoff(async () => {
          return await axios.get(`https://api-mainnet.magiceden.dev/v2/wallets/${walletAddress}/tokens`, {
            params: { collection_symbol: symbol, offset: 0, limit: 500 },
            headers: { 'Accept': 'application/json' },
            timeout: CONFIG.HELIUS_TIMEOUT_MS,
          });
        });

        if (response.data && Array.isArray(response.data)) {
          const transformed = response.data.map(item => ({
            id: item.mintAddress || item.mint,
            grouping: [{ group_key: 'collection', group_value: item.collection || activeContracts[0] }],
          }));
          allNFTs.push(...transformed);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        // Continue to next symbol
      }
    }

    return allNFTs;
  }

  filterMKINNFTs(nfts, activeContracts) {
    return nfts.filter(nft => {
      const collectionAddress = nft.grouping?.find(g => g.group_key === 'collection')?.group_value?.toLowerCase();
      return collectionAddress && activeContracts.includes(collectionAddress);
    });
  }

  async retryWithBackoff(fn, attempt = 0) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry = attempt < CONFIG.MAX_RETRIES && (error.response?.status === 429 || error.code === 'ECONNRESET');
      if (!shouldRetry) throw error;

      const delay = CONFIG.RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryWithBackoff(fn, attempt + 1);
    }
  }
}

// Distribution Service (condensed)
class DistributionService {
  constructor(logger, nftVerifier, db) {
    this.logger = logger;
    this.nftVerifier = nftVerifier;
    this.db = db;
    this.stats = {
      totalUsers: 0,
      eligibleUsers: 0,
      successfulDistributions: 0,
      failedDistributions: 0,
      skippedUsers: 0,
      retriedUsers: 0,
      totalTokensDistributed: 0,
      errors: [],
    };
    this.failedUsers = [];
    this.skippedUsers = [];
  }

  async execute(isDryRun = false) {
    this.logger.info('Starting distribution', { distributionId: CONFIG.DISTRIBUTION_ID, dryRun: isDryRun });

    if (!isDryRun) {
      const alreadyExecuted = await this.checkIfAlreadyExecuted();
      if (alreadyExecuted) {
        this.logger.warning('Distribution already executed');
        return { ...this.stats, alreadyExecuted: true };
      }
    }

    const activeContracts = await this.loadActiveContracts();
    const users = await this.loadUsersWithWallets();
    this.stats.totalUsers = users.length;

    await this.processUserBatches(users, activeContracts, isDryRun);
    return this.stats;
  }

  async checkIfAlreadyExecuted() {
    const snapshot = await this.db.collection('oneTimeDistribution')
      .where('distributionId', '==', CONFIG.DISTRIBUTION_ID)
      .where('status', '==', 'completed')
      .limit(1)
      .get();
    return !snapshot.empty;
  }

  async loadActiveContracts() {
    const snapshot = await this.db.collection('contractBonusConfigs').where('is_active', '==', true).get();
    const contracts = [];
    snapshot.forEach(doc => {
      const contractAddress = doc.id || doc.data().contract_address;
      if (contractAddress) contracts.push(contractAddress.toLowerCase());
    });
    return contracts;
  }

  async loadUsersWithWallets() {
    const snapshot = await this.db.collection('userRewards').where('walletAddress', '!=', null).get();
    const users = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.walletAddress?.trim()) {
        users.push({
          userId: doc.id,
          walletAddress: data.walletAddress,
          totalNFTs: data.totalNFTs || 0,
          totalRealmkin: data.totalRealmkin || 0,
        });
      }
    });
    return users;
  }

  async processUserBatches(users, activeContracts, isDryRun) {
    for (let i = 0; i < users.length; i += CONFIG.BATCH_SIZE) {
      const batch = users.slice(i, i + CONFIG.BATCH_SIZE);
      await this.processBatch(batch, activeContracts, isDryRun);
      if (i + CONFIG.BATCH_SIZE < users.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (this.failedUsers.length > 0) {
      await this.retryFailedUsers(activeContracts, isDryRun);
    }
  }

  async retryFailedUsers(activeContracts, isDryRun) {
    const usersToRetry = [...this.failedUsers];
    this.failedUsers = [];
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    for (let i = 0; i < usersToRetry.length; i += 10) {
      const batch = usersToRetry.slice(i, i + 10);
      await this.processBatch(batch, activeContracts, isDryRun, true);
      if (i + 10 < usersToRetry.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }

  async processBatch(users, activeContracts, isDryRun, isRetry = false) {
    const batchOperations = [];

    for (const user of users) {
      try {
        const result = await this.processUser(user, activeContracts, isDryRun);
        
        if (result.skipped) {
          this.skippedUsers.push(user);
          this.stats.skippedUsers++;
          continue;
        }
        
        if (result.eligible) {
          batchOperations.push({ user, nftCount: result.nftCount });
          if (isRetry) this.stats.retriedUsers++;
        }
      } catch (error) {
        const isTemporaryError = error.message?.includes('rate limit') || error.message?.includes('timeout');
        if (isTemporaryError && !isRetry) {
          this.failedUsers.push(user);
        } else {
          this.stats.failedDistributions++;
          this.stats.errors.push(`${user.userId}: ${error.message}`);
        }
      }
    }

    if (!isDryRun && batchOperations.length > 0) {
      await this.executeBatchWrite(batchOperations);
    } else if (isDryRun) {
      batchOperations.forEach(() => {
        this.stats.successfulDistributions++;
        this.stats.totalTokensDistributed += CONFIG.DISTRIBUTION_AMOUNT;
      });
    }

    this.stats.eligibleUsers += batchOperations.length;
  }

  async processUser(user, activeContracts, isDryRun) {
    if (!this.nftVerifier.isValidSolanaAddress(user.walletAddress)) {
      return { eligible: false, skipped: true };
    }

    if (!isDryRun) {
      const alreadyReceived = await this.checkUserAlreadyReceived(user.userId);
      if (alreadyReceived) return { eligible: false };
    }

    const nftCount = await this.nftVerifier.verifyNFTOwnership(user.walletAddress, activeContracts);
    return nftCount > 0 ? { eligible: true, nftCount } : { eligible: false };
  }

  async checkUserAlreadyReceived(userId) {
    const snapshot = await this.db.collection('oneTimeDistribution')
      .where('userId', '==', userId)
      .where('distributionId', '==', CONFIG.DISTRIBUTION_ID)
      .where('status', '==', 'completed')
      .get();
    return !snapshot.empty;
  }

  async executeBatchWrite(operations) {
    const batch = this.db.batch();

    for (const { user, nftCount } of operations) {
      const userRef = this.db.collection('userRewards').doc(user.userId);
      batch.update(userRef, {
        totalRealmkin: admin.firestore.FieldValue.increment(CONFIG.DISTRIBUTION_AMOUNT),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const transactionRef = this.db.collection('transactionHistory').doc();
      batch.set(transactionRef, {
        userId: user.userId,
        walletAddress: user.walletAddress,
        type: 'distribution',
        amount: CONFIG.DISTRIBUTION_AMOUNT,
        description: `One-time MKIN distribution (${CONFIG.DISTRIBUTION_ID})`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const distributionRef = this.db.collection('oneTimeDistribution').doc();
      batch.set(distributionRef, {
        userId: user.userId,
        walletAddress: user.walletAddress,
        amount: CONFIG.DISTRIBUTION_AMOUNT,
        nftCount: nftCount,
        distributionId: CONFIG.DISTRIBUTION_ID,
        status: 'completed',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      this.stats.successfulDistributions++;
      this.stats.totalTokensDistributed += CONFIG.DISTRIBUTION_AMOUNT;
    }

    await batch.commit();
  }
}

// Route handler
router.post('/execute', async (req, res) => {
  try {
    // Security check
    const token = req.headers['authorization']?.replace('Bearer ', '') || req.body.token;
    if (token !== CONFIG.SECRET_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const isDryRun = req.body.dryRun === true || req.query.dryRun === 'true';
    
    const logger = new SimpleLogger();
    const db = admin.firestore();
    const nftVerifier = new NFTVerifier(logger);
    const distributionService = new DistributionService(logger, nftVerifier, db);

    logger.info('Distribution triggered via HTTP', { isDryRun, timestamp: new Date().toISOString() });

    const stats = await distributionService.execute(isDryRun);

    res.json({
      success: true,
      stats,
      logs: logger.getLogs(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Distribution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Status check endpoint
router.get('/status', async (req, res) => {
  try {
    const db = admin.firestore();
    const snapshot = await db.collection('oneTimeDistribution')
      .where('distributionId', '==', CONFIG.DISTRIBUTION_ID)
      .get();

    res.json({
      distributionId: CONFIG.DISTRIBUTION_ID,
      executed: snapshot.size > 0,
      recipientCount: snapshot.size,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
