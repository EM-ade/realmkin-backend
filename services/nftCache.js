/**
 * NFT Ownership Cache Service
 * Caches NFT ownership data to reduce Helius API calls
 */

class NFTCache {
  constructor(options = {}) {
    this.cache = new Map(); // walletAddress -> { nfts, timestamp, transactionCount }
    this.cacheDuration = options.cacheDuration || 60 * 60 * 1000; // 1 hour default (optimized for Helius credits)
    this.transactionThreshold = options.transactionThreshold || 5; // Invalidate if 5+ new transactions
    
    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Generate cache key
   */
  getCacheKey(walletAddress, collectionId = null) {
    return collectionId ? `${walletAddress}:${collectionId}` : walletAddress;
  }

  /**
   * Get cached NFT data
   * @returns {Array|null} - NFTs or null if cache miss
   */
  get(walletAddress, collectionId = null) {
    const key = this.getCacheKey(walletAddress, collectionId);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    const age = now - cached.timestamp;

    // Check if cache expired
    if (age > this.cacheDuration) {
      console.log(`[NFTCache] Cache expired for ${walletAddress} (age: ${(age / 1000).toFixed(0)}s)`);
      this.cache.delete(key);
      return null;
    }

    console.log(`[NFTCache] Cache HIT for ${walletAddress} (age: ${(age / 1000).toFixed(0)}s)`);
    return cached.nfts;
  }

  /**
   * Set cached NFT data
   */
  set(walletAddress, nfts, collectionId = null, transactionCount = 0) {
    const key = this.getCacheKey(walletAddress, collectionId);
    
    this.cache.set(key, {
      nfts: nfts,
      timestamp: Date.now(),
      transactionCount: transactionCount,
      walletAddress: walletAddress,
      collectionId: collectionId
    });

    console.log(`[NFTCache] Cached ${nfts.length} NFTs for ${walletAddress}`);
  }

  /**
   * Invalidate cache for a wallet if transaction count changed significantly
   */
  shouldInvalidate(walletAddress, newTransactionCount, collectionId = null) {
    const key = this.getCacheKey(walletAddress, collectionId);
    const cached = this.cache.get(key);

    if (!cached) {
      return false; // No cache to invalidate
    }

    const txDiff = Math.abs(newTransactionCount - cached.transactionCount);
    
    if (txDiff >= this.transactionThreshold) {
      console.log(
        `[NFTCache] Invalidating ${walletAddress} due to transaction count change ` +
        `(cached: ${cached.transactionCount}, current: ${newTransactionCount})`
      );
      this.cache.delete(key);
      return true;
    }

    return false;
  }

  /**
   * Manually invalidate cache for a wallet
   */
  invalidate(walletAddress, collectionId = null) {
    const key = this.getCacheKey(walletAddress, collectionId);
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      console.log(`[NFTCache] Manually invalidated cache for ${walletAddress}`);
    }
    
    return deleted;
  }

  /**
   * Clear all cache
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[NFTCache] Cleared all cache (${size} entries)`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    let totalEntries = 0;
    let expiredEntries = 0;
    let validEntries = 0;

    for (const [key, cached] of this.cache.entries()) {
      totalEntries++;
      const age = now - cached.timestamp;
      
      if (age > this.cacheDuration) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      totalEntries,
      validEntries,
      expiredEntries,
      cacheDuration: this.cacheDuration,
      cacheHitRate: this.getHitRate()
    };
  }

  /**
   * Calculate cache hit rate (basic implementation)
   */
  getHitRate() {
    // This is a simplified version - in production you'd track hits/misses
    return this.cache.size > 0 ? 'N/A (tracking not implemented)' : '0%';
  }

  /**
   * Start periodic cleanup of expired entries
   */
  startCleanup() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup expired cache entries
   */
  cleanupExpired() {
    const now = Date.now();
    let removed = 0;

    for (const [key, cached] of this.cache.entries()) {
      const age = now - cached.timestamp;
      
      if (age > this.cacheDuration) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[NFTCache] Cleaned up ${removed} expired entries`);
    }
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get all cached wallet addresses (for debugging)
   */
  getCachedWallets() {
    const wallets = new Set();
    
    for (const cached of this.cache.values()) {
      wallets.add(cached.walletAddress);
    }
    
    return Array.from(wallets);
  }
}

// Export singleton instance
const nftCache = new NFTCache({
  cacheDuration: 60 * 60 * 1000, // 1 hour (optimized for Helius credits)
  transactionThreshold: 5 // Invalidate if 5+ new transactions
});

export default nftCache;
