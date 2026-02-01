#!/usr/bin/env node

/**
 * Clear Revenue Distribution for a Specific Month
 * 
 * This allows you to re-run the distribution for a specific month.
 * Use with caution - this will delete allocation records!
 */

import "dotenv/config";
import fetch from 'node-fetch';

const PRODUCTION_URL = "https://realmkin-backend.onrender.com";
const SECRET_TOKEN = process.env.REVENUE_DISTRIBUTION_SECRET_TOKEN;

if (!SECRET_TOKEN) {
  console.error("❌ ERROR: REVENUE_DISTRIBUTION_SECRET_TOKEN not found");
  process.exit(1);
}

// Get distribution ID from command line or use current month
const args = process.argv.slice(2);
const distributionId = args[0] || `revenue_dist_${new Date().getFullYear()}_${String(new Date().getMonth() + 1).padStart(2, '0')}`;

console.log("🗑️  Clear Revenue Distribution Allocations");
console.log("=" .repeat(80));
console.log(`Distribution ID: ${distributionId}`);
console.log(`Backend: ${PRODUCTION_URL}`);
console.log("=" .repeat(80));
console.log("\n⚠️  WARNING: This will delete allocation records!");
console.log("⚠️  This allows you to re-run the distribution for this month.");
console.log("\nPress Ctrl+C to cancel, or wait 3 seconds to continue...\n");

await new Promise(resolve => setTimeout(resolve, 3000));

async function clearDistribution() {
  try {
    console.log("📡 Calling clear endpoint...");
    
    const response = await fetch(`${PRODUCTION_URL}/api/revenue-distribution/clear-allocations`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SECRET_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        distributionId
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("❌ Failed to clear distribution");
      console.error("Status:", response.status, response.statusText);
      console.error("Error:", error);
      process.exit(1);
    }
    
    const result = await response.json();
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ DISTRIBUTION CLEARED SUCCESSFULLY");
    console.log("=".repeat(80));
    console.log(`Distribution ID: ${result.distributionId || distributionId}`);
    console.log(`Records Deleted: ${result.deletedCount || 'N/A'}`);
    console.log("=".repeat(80));
    console.log("\n💡 You can now run the distribution script again:");
    console.log("   node scripts/run-production-revenue-distribution.js");
    
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

clearDistribution();
