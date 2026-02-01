#!/usr/bin/env node

/**
 * Run Production Revenue Distribution
 * 
 * Triggers the revenue distribution on the live production backend.
 * This is the REAL run - not a dry-run.
 * 
 * Usage:
 *   node run-production-revenue-distribution.js [--dry-run]
 */

import "dotenv/config";
import fetch from 'node-fetch';

const PRODUCTION_URL = "https://realmkin-backend.onrender.com";
const SECRET_TOKEN = process.env.REVENUE_DISTRIBUTION_SECRET_TOKEN;

if (!SECRET_TOKEN) {
  console.error("❌ ERROR: REVENUE_DISTRIBUTION_SECRET_TOKEN not found in .env file");
  process.exit(1);
}

const isDryRun = process.argv.includes('--dry-run');

async function runProductionDistribution() {
  console.log("🚀 Running Revenue Distribution on PRODUCTION");
  console.log("=" .repeat(80));
  console.log(`🌐 Backend: ${PRODUCTION_URL}`);
  console.log(`🔒 Using secret token: ${SECRET_TOKEN.substring(0, 10)}...`);
  console.log(`⚠️  Mode: ${isDryRun ? 'DRY RUN (no actual distribution)' : '🔴 LIVE RUN (real distribution!)'}`);
  console.log("=" .repeat(80));
  
  if (!isDryRun) {
    console.log("\n⚠️  ⚠️  ⚠️  WARNING ⚠️  ⚠️  ⚠️");
    console.log("This will distribute REAL SOL, EMPIRE, and MKIN tokens to users!");
    console.log("Press Ctrl+C to cancel, or wait 5 seconds to continue...\n");
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log("▶️  Starting distribution...\n");
  }
  
  const startTime = Date.now();
  
  try {
    console.log("📡 Calling API endpoint...");
    const response = await fetch(`${PRODUCTION_URL}/api/revenue-distribution/allocate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SECRET_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dryRun: isDryRun
      })
    });
    
    const contentType = response.headers.get('content-type');
    let result;
    
    if (contentType && contentType.includes('application/json')) {
      result = await response.json();
    } else {
      const text = await response.text();
      console.error("❌ Unexpected response format:", text);
      process.exit(1);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log("\n" + "=".repeat(80));
    
    if (!response.ok || !result.success) {
      console.error("❌ DISTRIBUTION FAILED");
      console.error("Status:", response.status, response.statusText);
      console.error("Error:", result.error || result.message || "Unknown error");
      console.log("=".repeat(80));
      process.exit(1);
    }
    
    console.log("✅ DISTRIBUTION COMPLETED SUCCESSFULLY");
    console.log("=".repeat(80));
    console.log(`Distribution ID: ${result.distributionId || 'N/A'}`);
    console.log(`Total Users Scanned: ${result.totalUsers || 'N/A'}`);
    console.log(`NFT Eligible: ${result.nftEligible || 'N/A'}`);
    console.log(`Final Eligible: ${result.finalEligible || 'N/A'}`);
    console.log(`Duration: ${duration}s`);
    console.log(`Mode: ${isDryRun ? 'DRY RUN' : '🔴 LIVE RUN'}`);
    console.log("=".repeat(80));
    
    if (result.summary) {
      console.log("\n📊 Distribution Summary:");
      console.log(result.summary);
    }
    
    if (result.topAllocations && result.topAllocations.length > 0) {
      console.log("\n🏆 Top 5 Allocations:");
      result.topAllocations.slice(0, 5).forEach((alloc, idx) => {
        console.log(
          `   ${idx + 1}. ${alloc.userId.substring(0, 8)}... - ` +
          `${alloc.nftCount} NFTs (${alloc.weight}%) = ` +
          `${alloc.solShare.toFixed(6)} SOL + ` +
          `${alloc.empireShare.toFixed(2)} EMPIRE + ` +
          `${alloc.mkinShare.toFixed(2)} MKIN`
        );
      });
    }
    
    if (!isDryRun) {
      console.log("\n✅ REAL tokens have been distributed to user wallets!");
      console.log("💡 Check the backend logs and Discord for confirmation.");
    } else {
      console.log("\n💡 This was a DRY RUN - no actual tokens were distributed.");
      console.log("   To run for REAL, use: node run-production-revenue-distribution.js");
    }
    
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runProductionDistribution();
