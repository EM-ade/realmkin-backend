/**
 * Shared Rate Limiter for Helius API
 * Ensures all operations (withdrawals, verification, NFT fetching) respect rate limits
 */

class RateLimiter {
  constructor(options = {}) {
    this.maxRequestsPerSecond = options.maxRequestsPerSecond || 10;
    this.maxConcurrent = options.maxConcurrent || 3;
    this.queue = [];
    this.activeRequests = 0;
    this.requestTimestamps = [];
  }

  /**
   * Execute a function with rate limiting
   * @param {Function} fn - Async function to execute
   * @param {string} label - Label for logging
   * @returns {Promise} - Result of the function
   */
  async execute(fn, label = 'request') {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    // Don't process if we're at max concurrent requests
    if (this.activeRequests >= this.maxConcurrent) {
      return;
    }

    // Don't process if queue is empty
    if (this.queue.length === 0) {
      return;
    }

    // Check rate limit
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < 1000
    );

    if (this.requestTimestamps.length >= this.maxRequestsPerSecond) {
      // Wait before retrying
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = 1000 - (now - oldestTimestamp);
      setTimeout(() => this.processQueue(), waitTime);
      return;
    }

    // Dequeue and execute
    const { fn, label, resolve, reject } = this.queue.shift();
    this.activeRequests++;
    this.requestTimestamps.push(now);

    console.log(`[RateLimiter] Executing: ${label} (active: ${this.activeRequests}, queued: ${this.queue.length})`);

    fn()
      .then(result => {
        this.activeRequests--;
        resolve(result);
        this.processQueue(); // Process next item
      })
      .catch(error => {
        this.activeRequests--;
        reject(error);
        this.processQueue(); // Process next item
      });
  }

  /**
   * Get current queue status
   */
  getStatus() {
    return {
      activeRequests: this.activeRequests,
      queuedRequests: this.queue.length,
      requestsInLastSecond: this.requestTimestamps.length,
    };
  }
}

// Singleton instance for Helius API
const heliusRateLimiter = new RateLimiter({
  maxRequestsPerSecond: 10, // Helius free tier allows ~10 req/sec
  maxConcurrent: 3, // Only 3 concurrent requests at a time
});

// Singleton for general Solana RPC
const solanaRateLimiter = new RateLimiter({
  maxRequestsPerSecond: 5, // More conservative for public RPC
  maxConcurrent: 2,
});

export { RateLimiter, heliusRateLimiter, solanaRateLimiter };
