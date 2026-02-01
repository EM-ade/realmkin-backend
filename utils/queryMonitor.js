/**
 * Firebase Query Monitor
 * Tracks and logs Firebase read operations to help monitor quota usage
 */

class QueryMonitor {
  constructor() {
    this.stats = {
      totalReads: 0,
      readsByCollection: {},
      readsByEndpoint: {},
      startTime: Date.now(),
    };
    
    // Log stats every 5 minutes
    setInterval(() => this.logStats(), 5 * 60 * 1000);
  }

  /**
   * Track a Firebase read operation
   */
  trackRead(collection, count = 1, endpoint = 'unknown') {
    this.stats.totalReads += count;
    
    // Track by collection
    if (!this.stats.readsByCollection[collection]) {
      this.stats.readsByCollection[collection] = 0;
    }
    this.stats.readsByCollection[collection] += count;
    
    // Track by endpoint
    if (!this.stats.readsByEndpoint[endpoint]) {
      this.stats.readsByEndpoint[endpoint] = 0;
    }
    this.stats.readsByEndpoint[endpoint] += count;
  }

  /**
   * Get current stats
   */
  getStats() {
    const uptimeHours = ((Date.now() - this.stats.startTime) / (1000 * 60 * 60)).toFixed(2);
    const readsPerHour = (this.stats.totalReads / parseFloat(uptimeHours)).toFixed(0);
    
    return {
      ...this.stats,
      uptimeHours: parseFloat(uptimeHours),
      readsPerHour: parseInt(readsPerHour),
      estimatedDailyReads: parseInt(readsPerHour) * 24,
    };
  }

  /**
   * Log stats to console
   */
  logStats() {
    const stats = this.getStats();
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 FIREBASE QUERY MONITOR - Stats Summary');
    console.log('='.repeat(80));
    console.log(`Uptime: ${stats.uptimeHours} hours`);
    console.log(`Total Reads: ${stats.totalReads.toLocaleString()}`);
    console.log(`Reads/Hour: ${stats.readsPerHour.toLocaleString()}`);
    console.log(`Est. Daily: ${stats.estimatedDailyReads.toLocaleString()}`);
    console.log(`Free Tier Limit: 50,000 reads/day`);
    console.log(`Quota Resets: Daily at 1:00 AM WAT (Nigerian time)`);
    
    if (stats.estimatedDailyReads > 50000) {
      console.log(`⚠️  WARNING: Estimated daily reads EXCEED free tier!`);
    } else {
      const percentUsed = ((stats.estimatedDailyReads / 50000) * 100).toFixed(1);
      console.log(`✅ Within limits (${percentUsed}% of free tier)`);
    }
    
    console.log('\nReads by Collection:');
    const sortedCollections = Object.entries(stats.readsByCollection)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    sortedCollections.forEach(([collection, count]) => {
      const percent = ((count / stats.totalReads) * 100).toFixed(1);
      console.log(`  ${collection}: ${count.toLocaleString()} (${percent}%)`);
    });
    
    console.log('\nReads by Endpoint:');
    const sortedEndpoints = Object.entries(stats.readsByEndpoint)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    sortedEndpoints.forEach(([endpoint, count]) => {
      const percent = ((count / stats.totalReads) * 100).toFixed(1);
      console.log(`  ${endpoint}: ${count.toLocaleString()} (${percent}%)`);
    });
    
    console.log('='.repeat(80) + '\n');
  }

  /**
   * Reset stats (useful for testing)
   */
  reset() {
    this.stats = {
      totalReads: 0,
      readsByCollection: {},
      readsByEndpoint: {},
      startTime: Date.now(),
    };
    console.log('📊 Query monitor stats reset');
  }
}

// Export singleton instance
const queryMonitor = new QueryMonitor();
export default queryMonitor;
