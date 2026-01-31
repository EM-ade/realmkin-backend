// Rate limiting configuration for external APIs
export const RATE_LIMITING_CONFIG = {
    // Magic Eden API rate limiting
    // Limits: 20 requests/second AND 120 requests/minute
    // To stay under 120/minute, we need 500ms between requests minimum
    magicEden: {
        delayBetweenRequests: 550, // 550ms = ~109 requests/minute (safe buffer)
        maxRequestsPerSecond: 18, // Stay under 20/second limit
        maxRequestsPerMinute: 110, // Stay under 120/minute limit
        batchSize: 5, // Process 5 NFT metadata requests per batch
        retryDelay: 2000, // Wait 2 seconds on rate limit (429)
        cacheTTL: 5 * 60 * 1000, // Cache NFT metadata for 5 minutes
    },
    
    // Helius API rate limiting
    helius: {
        maxRequestsPerSecond: 20, // Helius allows higher rates
        delayBetweenPages: 200, // Small delay between pagination requests
    },
    
    // Verification service rate limiting
    // Each user verification may make 1-3 Magic Eden calls depending on collection
    // With 550ms per ME call, we need significant delays between users
    verification: {
        batchSize: 3, // Users per batch
        delayBetweenBatches: 8000, // 8 seconds between batches
        delayBetweenUsers: 2500, // 2.5 seconds between users (allows multiple ME calls per user)
        maxUsersPerRun: 30, // Maximum users to process in one run
    },
    
    // Manual verification rate limiting
    manualVerification: {
        batchSize: 5, // Users per batch
        delayBetweenBatches: 3000, // 3 seconds between batches
        delayBetweenUsers: 1000, // 1 second between users
    }
};

export default RATE_LIMITING_CONFIG;
