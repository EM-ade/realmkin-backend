import axios from 'axios';
import admin from 'firebase-admin';
import magicEdenRateLimiter from '../utils/magicEdenRateLimiter.js';

/**
 * Secondary Sale Verification Service
 * 
 * Detects if a wallet has purchased NFTs from Magic Eden secondary market.
 * Uses aggressive caching and rate limiting to stay under Magic Eden API limits:
 * - 20 requests/second
 * - 120 requests/minute
 * 
 * Strategy:
 * - Cache results for 30 days (positive results cached forever)
 * - Batch process users with 6s delays between batches
 * - Reuse existing magicEdenRateLimiter
 */
class SecondarySaleVerificationService {
  constructor() {
    this.rateLimiter = magicEdenRateLimiter;
    this._db = null; // Lazy-initialized
    this.CACHE_COLLECTION = 'secondarySaleCache';
    this.CACHE_TTL_DAYS = 30; // Cache negative results for 30 days
    this.BATCH_SIZE = parseInt(process.env.REVENUE_DISTRIBUTION_BATCH_SIZE || '10');
    this.BATCH_DELAY_MS = parseInt(process.env.REVENUE_DISTRIBUTION_BATCH_DELAY_MS || '6000');
    
    // Magic Eden marketplace program IDs (to detect secondary sales)
    this.MAGIC_EDEN_V2_PROGRAM = 'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K';
    this.MAGIC_EDEN_V1_PROGRAM = 'MEisE1HzehtrDpAAT8PnLHjpSSkRYakotTuJRPjTpo8';
    
    this.collectionSymbols = ['the_realmkin'];
  }

  // Lazy-initialize Firestore connection
  get db() {
    if (!this._db) {
      this._db = admin.firestore();
    }
    return this._db;
  }

  /**
   * Check if a wallet has made secondary market purchases
   * Uses cache first, only queries API if cache miss or expired
   * 
   * @param {string} walletAddress - Solana wallet address
   * @returns {Promise<boolean>} - True if wallet has secondary sales
   */
  async hasSecondarySale(walletAddress) {
    try {
      // Step 1: Check cache first
      const cached = await this.getCachedResult(walletAddress);
      if (cached && !this.isCacheExpired(cached)) {
        console.log(`✅ Cache hit for ${walletAddress}: ${cached.hasSecondarySale}`);
        return cached.hasSecondarySale;
      }

      // Step 2: Cache miss or expired - query Magic Eden API (rate limited)
      console.log(`🔍 Cache miss for ${walletAddress}, querying Magic Eden...`);
      const result = await this.checkMagicEdenHistory(walletAddress);

      // Step 3: Cache the result (with count)
      await this.cacheResult(walletAddress, result.hasSecondarySale, result.salesCount);

      return result.hasSecondarySale;
    } catch (error) {
      console.error(`❌ Error checking secondary sale for ${walletAddress}:`, error.message);
      
      // If we have cached data (even if expired), return it on error
      const cached = await this.getCachedResult(walletAddress);
      if (cached) {
        console.warn(`⚠️ Using expired cache due to API error for ${walletAddress}`);
        return cached.hasSecondarySale;
      }
      
      // Default to false if no cache and API fails
      return false;
    }
  }

  /**
   * Batch verify multiple wallets with rate limiting
   * Processes in batches with delays to respect Magic Eden rate limits
   * 
   * @param {Array<string>} wallets - Array of wallet addresses
   * @param {Function} progressCallback - Optional callback for progress updates
   * @returns {Promise<Array>} - Array of { wallet, hasSecondarySale, cached }
   */
  async batchVerifyUsers(wallets, progressCallback = null) {
    const results = [];
    const totalWallets = wallets.length;
    
    console.log(`🚀 Starting batch verification for ${totalWallets} wallets`);
    console.log(`📊 Batch size: ${this.BATCH_SIZE}, Delay: ${this.BATCH_DELAY_MS}ms`);
    
    for (let i = 0; i < wallets.length; i += this.BATCH_SIZE) {
      const batch = wallets.slice(i, i + this.BATCH_SIZE);
      const batchNumber = Math.floor(i / this.BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalWallets / this.BATCH_SIZE);
      
      console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} wallets)...`);
      
      // Process batch (each call checks cache first)
      const batchResults = await Promise.all(
        batch.map(async (wallet) => {
          const cached = await this.getCachedResult(wallet);
          const wasCached = cached && !this.isCacheExpired(cached);
          const hasSecondarySale = await this.hasSecondarySale(wallet);
          
          return {
            wallet,
            hasSecondarySale,
            cached: wasCached
          };
        })
      );
      
      results.push(...batchResults);
      
      // Progress reporting
      const cacheHits = batchResults.filter(r => r.cached).length;
      const apiCalls = batchResults.filter(r => !r.cached).length;
      console.log(`   ✅ Completed: ${results.length}/${totalWallets}`);
      console.log(`   📊 Cache hits: ${cacheHits}, API calls: ${apiCalls}`);
      
      if (progressCallback) {
        progressCallback({
          processed: results.length,
          total: totalWallets,
          cacheHits,
          apiCalls,
          batchNumber,
          totalBatches
        });
      }
      
      // Delay between batches (critical for rate limiting!)
      if (i + this.BATCH_SIZE < wallets.length) {
        const delaySeconds = this.BATCH_DELAY_MS / 1000;
        console.log(`   ⏳ Waiting ${delaySeconds}s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY_MS));
      }
    }
    
    // Summary
    const totalCacheHits = results.filter(r => r.cached).length;
    const totalApiCalls = results.filter(r => !r.cached).length;
    const totalWithSales = results.filter(r => r.hasSecondarySale).length;
    
    console.log(`\n✅ Batch verification complete!`);
    console.log(`   Total processed: ${results.length}`);
    console.log(`   Cache hits: ${totalCacheHits} (${((totalCacheHits/results.length)*100).toFixed(1)}%)`);
    console.log(`   API calls: ${totalApiCalls}`);
    console.log(`   With secondary sales: ${totalWithSales}`);
    
    return results;
  }

  /**
   * Query Magic Eden API to check wallet transaction history
   * This is rate-limited by magicEdenRateLimiter
   * 
   * @param {string} walletAddress - Solana wallet address
   * @returns {Promise<{hasSecondarySale: boolean, salesCount: number}>} - Secondary sale info
   */
  async checkMagicEdenHistory(walletAddress) {
    try {
      // Use rate limiter to execute API call safely
      const result = await this.rateLimiter.execute(async () => {
        // Query Magic Eden API for wallet activities
        // Note: Magic Eden API v2 endpoint for wallet activities
        const url = `https://api-mainnet.magiceden.dev/v2/wallets/${walletAddress}/activities`;
        
        const response = await axios.get(url, {
          headers: {
            'Accept': 'application/json'
          },
          timeout: 30000
        });

        if (!response.data || !Array.isArray(response.data)) {
          console.warn(`⚠️ Unexpected response format from Magic Eden for ${walletAddress}`);
          return false;
        }

        // Look for secondary market purchases (buyNow transactions)
        // Exclude mint, list, and other non-purchase activities
        const secondaryTransactions = response.data.filter(activity => {
          const type = activity.type?.toLowerCase();
          const buyer = activity.buyer; // Must have a buyer field
          
          // Only count buyNow transactions (actual purchases)
          // acceptBid is seller accepting, not buyer purchasing
          const isBuyTransaction = type === 'buynow' && buyer;
          
          // Check if it's one of our collections
          const collectionSymbol = activity.collection || activity.collectionSymbol;
          const isRealmkinCollection = this.collectionSymbols.some(symbol => 
            collectionSymbol?.toLowerCase().includes(symbol.toLowerCase())
          );
          
          return isBuyTransaction && isRealmkinCollection;
        });

        const salesCount = secondaryTransactions.length;
        
        if (salesCount > 0) {
          console.log(`✨ Found ${salesCount} secondary sale(s) for ${walletAddress}`);
          return { hasSecondarySale: true, salesCount };
        }

        return { hasSecondarySale: false, salesCount: 0 };
      });

      return result;
    } catch (error) {
      // Check if it's a 404 (wallet not found) - this is normal, not an error
      if (error.response?.status === 404) {
        console.log(`📭 No Magic Eden activity found for ${walletAddress} (404)`);
        return { hasSecondarySale: false, salesCount: 0 };
      }

      // Check if rate limited
      if (error.response?.status === 429) {
        console.error(`🚨 Rate limited by Magic Eden for ${walletAddress}`);
        throw new Error('Magic Eden rate limit exceeded');
      }

      console.error(`❌ Magic Eden API error for ${walletAddress}:`, error.message);
      throw error;
    }
  }

  /**
   * Get cached result from Firestore
   * 
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object|null>} - Cached data or null
   */
  async getCachedResult(walletAddress) {
    try {
      const docRef = this.db.collection(this.CACHE_COLLECTION).doc(walletAddress);
      const doc = await docRef.get();
      
      if (!doc.exists) {
        return null;
      }

      return doc.data();
    } catch (error) {
      console.error(`Error reading cache for ${walletAddress}:`, error.message);
      return null;
    }
  }

  /**
   * Cache the result in Firestore
   * 
   * @param {string} walletAddress - Wallet address
   * @param {boolean} hasSecondarySale - Result to cache
   */
  async cacheResult(walletAddress, hasSecondarySale, salesCount = 0) {
    try {
      const now = admin.firestore.Timestamp.now();
      const cacheData = {
        walletAddress,
        hasSecondarySale,
        salesCount, // Store the count of secondary market purchases
        lastCheckedAt: now,
        firstCheckedAt: now, // Will be preserved on updates
      };

      // Calculate expiration
      if (hasSecondarySale) {
        // Positive results never expire (once bought secondary, always true)
        cacheData.cacheExpiresAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + (365 * 24 * 60 * 60 * 1000) // 1 year (effectively permanent)
        );
      } else {
        // Negative results expire after CACHE_TTL_DAYS (user might buy later)
        cacheData.cacheExpiresAt = admin.firestore.Timestamp.fromMillis(
          Date.now() + (this.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
        );
      }

      const docRef = this.db.collection(this.CACHE_COLLECTION).doc(walletAddress);
      
      // Check if document exists to preserve firstCheckedAt
      const existingDoc = await docRef.get();
      if (existingDoc.exists) {
        cacheData.firstCheckedAt = existingDoc.data().firstCheckedAt || now;
      }

      await docRef.set(cacheData, { merge: true });
      
      console.log(`💾 Cached result for ${walletAddress}: ${hasSecondarySale}`);
    } catch (error) {
      console.error(`Error caching result for ${walletAddress}:`, error.message);
      // Don't throw - caching failure shouldn't break the flow
    }
  }

  /**
   * Check if cached result is expired
   * 
   * @param {Object} cachedData - Cached data from Firestore
   * @returns {boolean} - True if expired
   */
  isCacheExpired(cachedData) {
    if (!cachedData || !cachedData.cacheExpiresAt) {
      return true;
    }

    const now = Date.now();
    const expiresAt = cachedData.cacheExpiresAt.toMillis();
    
    return now > expiresAt;
  }

  /**
   * Get collection activities from Magic Eden
   * Returns buyNow transactions to track secondary market buyers
   * 
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @param {Object} options - Query options
   * @param {number} options.limit - Max results per page (default: 500)
   * @param {number} options.offset - Pagination offset
   * @returns {Promise<Array>} - Array of { buyer, tokenMint, price, blockTime, signature }
   */
  async getCollectionActivities(collectionSymbol = 'the_realmkin', options = {}) {
    try {
      const { limit = 500, offset = 0 } = options;
      console.log(`📊 Fetching collection activities for: ${collectionSymbol} (limit: ${limit}, offset: ${offset})`);
      
      const url = `https://api-mainnet.magiceden.dev/v2/collections/${collectionSymbol}/activities`;
      
      // Use rate limiter to execute API call
      const response = await this.rateLimiter.execute(async () => {
        return await axios.get(url, {
          headers: {
            'Accept': 'application/json',
          },
          params: {
            offset,
            limit,
          },
          timeout: 30000, // 30 second timeout
        });
      });
      
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('No data returned from Magic Eden activities endpoint');
      }
      
      const activities = response.data;
      console.log(`📦 Received ${activities.length} activities`);
      
      // Filter for buyNow transactions only (actual secondary market purchases)
      const buyTransactions = activities.filter(activity => {
        const type = activity.type?.toLowerCase();
        const buyer = activity.buyer;
        
        // Only count buyNow transactions with a buyer
        return type === 'buynow' && buyer;
      });
      
      console.log(`✅ Found ${buyTransactions.length} buyNow transactions`);
      
      // Return relevant transaction data
      return buyTransactions.map(tx => ({
        buyer: tx.buyer,
        tokenMint: tx.tokenMint,
        price: tx.price || 0,
        blockTime: tx.blockTime,
        signature: tx.signature,
        source: tx.source || 'unknown',
      }));
      
    } catch (error) {
      console.error(`❌ Error fetching activities for ${collectionSymbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get collection holder stats from Magic Eden
   * Returns all holders and their NFT counts in a single API call
   * 
   * @param {string} collectionSymbol - Magic Eden collection symbol
   * @returns {Promise<Array>} - Array of { ownerAddress, count }
   */
  async getCollectionHolderStats(collectionSymbol = 'the_realmkin') {
    try {
      console.log(`📊 Fetching holder stats for collection: ${collectionSymbol}`);
      
      const url = `https://api-mainnet.magiceden.dev/v2/collections/${collectionSymbol}/holder_stats`;
      
      // Use rate limiter to execute API call
      const response = await this.rateLimiter.execute(async () => {
        return await axios.get(url, {
          headers: {
            'Accept': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        });
      });
      
      if (!response.data) {
        throw new Error('No data returned from Magic Eden holder_stats');
      }
      
      // Handle Magic Eden response format
      // Response structure: { symbol, totalSupply, uniqueHolders, topHolders: [{owner, tokens}, ...] }
      let holders = response.data;
      if (!Array.isArray(holders)) {
        if (holders.topHolders && Array.isArray(holders.topHolders)) {
          console.log(`📊 Collection stats: ${holders.uniqueHolders} unique holders, ${holders.totalSupply} total supply`);
          holders = holders.topHolders;
        } else if (holders.holders && Array.isArray(holders.holders)) {
          holders = holders.holders;
        } else if (holders.results && Array.isArray(holders.results)) {
          holders = holders.results;
        } else {
          throw new Error('Unexpected response format from Magic Eden holder_stats');
        }
      }
      
      console.log(`✅ Received holder stats: ${holders.length} holders`);
      
      // Return holders sorted by NFT count (descending)
      return holders
        .map(holder => ({
          ownerAddress: holder.owner || holder.ownerAddress || holder.address,
          count: holder.tokens || holder.count || holder.amount || 0,
        }))
        .filter(h => h.ownerAddress && h.count > 0)
        .sort((a, b) => b.count - a.count);
      
    } catch (error) {
      console.error(`❌ Error fetching holder stats for ${collectionSymbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get cache statistics
   * 
   * @returns {Promise<Object>} - Cache stats
   */
  async getCacheStats() {
    try {
      const snapshot = await this.db.collection(this.CACHE_COLLECTION).get();
      const now = Date.now();
      
      let totalCached = 0;
      let withSecondarySales = 0;
      let expired = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data();
        totalCached++;
        
        if (data.hasSecondarySale) {
          withSecondarySales++;
        }
        
        if (this.isCacheExpired(data)) {
          expired++;
        }
      });

      return {
        totalCached,
        withSecondarySales,
        withoutSecondarySales: totalCached - withSecondarySales,
        expired,
        valid: totalCached - expired,
        cacheHitRate: totalCached > 0 ? ((totalCached - expired) / totalCached * 100).toFixed(1) : 0
      };
    } catch (error) {
      console.error('Error getting cache stats:', error.message);
      return null;
    }
  }

  /**
   * Clear expired cache entries (maintenance function)
   * 
   * @returns {Promise<number>} - Number of entries deleted
   */
  async clearExpiredCache() {
    try {
      const snapshot = await this.db.collection(this.CACHE_COLLECTION).get();
      const batch = this.db.batch();
      let deleteCount = 0;

      snapshot.forEach(doc => {
        const data = doc.data();
        if (this.isCacheExpired(data)) {
          batch.delete(doc.ref);
          deleteCount++;
        }
      });

      if (deleteCount > 0) {
        await batch.commit();
        console.log(`🗑️ Cleared ${deleteCount} expired cache entries`);
      }

      return deleteCount;
    } catch (error) {
      console.error('Error clearing expired cache:', error.message);
      return 0;
    }
  }
}

// Export singleton instance
const secondarySaleVerificationService = new SecondarySaleVerificationService();
export default secondarySaleVerificationService;
