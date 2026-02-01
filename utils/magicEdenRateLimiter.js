/**
 * Rate Limiter for Magic Eden API
 * Ensures we stay under 20 req/sec and 120 req/min limits
 */

import RATE_LIMITING_CONFIG from '../config/rateLimiting.js';

class MagicEdenRateLimiter {
  constructor() {
    this.lastRequestTime = 0;
    this.requestTimestamps = []; // Track timestamps for sliding window
    this.config = RATE_LIMITING_CONFIG.magicEden;
  }

  /**
   * Wait if necessary to comply with rate limits
   */
  async waitForRateLimit() {
    const now = Date.now();
    
    // Clean up old timestamps (older than 1 minute)
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    );
    
    // Check per-minute limit
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = 60000 - (now - oldestRequest) + 100; // Add 100ms buffer
      
      if (waitTime > 0) {
        console.log(`[Magic Eden Rate Limiter] Per-minute limit reached, waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Recursively check again after waiting
        return this.waitForRateLimit();
      }
    }
    
    // Check minimum delay between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.config.delayBetweenRequests) {
      const waitTime = this.config.delayBetweenRequests - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Update tracking
    this.lastRequestTime = Date.now();
    this.requestTimestamps.push(this.lastRequestTime);
  }

  /**
   * Execute a Magic Eden API call with rate limiting
   */
  async execute(apiCall) {
    await this.waitForRateLimit();
    return apiCall();
  }

  /**
   * Get current rate limit status
   */
  getStatus() {
    const now = Date.now();
    const recentRequests = this.requestTimestamps.filter(
      timestamp => now - timestamp < 60000
    );
    
    return {
      requestsInLastMinute: recentRequests.length,
      maxPerMinute: this.config.maxRequestsPerMinute,
      timeSinceLastRequest: now - this.lastRequestTime,
      minDelayBetweenRequests: this.config.delayBetweenRequests
    };
  }
}

// Singleton instance
const rateLimiter = new MagicEdenRateLimiter();

export default rateLimiter;
