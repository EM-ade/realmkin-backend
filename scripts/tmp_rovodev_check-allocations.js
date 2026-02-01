#!/usr/bin/env node

/**
 * Check what's in the revenueDistributionAllocations collection
 */

import "dotenv/config";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:3001";

async function checkAllocations() {
  console.log("🔍 Checking allocation data...\n");
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/leaderboard/secondary-market?limit=5`);
    const data = await response.json();
    
    console.log("📊 API Response:");
    console.log(JSON.stringify(data, null, 2));
    
    if (data.leaderboard && data.leaderboard.length > 0) {
      console.log("\n🏆 Top users:");
      data.leaderboard.forEach(user => {
        console.log(`${user.rank}. ${user.username} - NFT Count: ${user.nftCount}, Weight: ${user.weight}`);
      });
    } else {
      console.log("\n⚠️  No leaderboard data found!");
      console.log("   This means:");
      console.log("   1. No distribution has been run for this month, OR");
      console.log("   2. The allocations were cleared");
      console.log("\n💡 Run the distribution to populate data:");
      console.log("   node scripts/run-production-revenue-distribution.js");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkAllocations();
