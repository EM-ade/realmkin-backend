/**
 * Preview Token Migration Script
 * 
 * PURPOSE:
 * Preview what the conversion from old MKIN to new $MKIN would look like for all staking positions.
 * This is a VIEW-ONLY script - no changes are made to Firestore.
 * 
 * USAGE:
 *   node scripts/preview-token-migration.js
 * 
 * OUTPUT:
 * - Total positions and their current stakes
 * - Conversion preview (old tokens → new tokens)
 * - Average stake amounts
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";
import fetch from "node-fetch";

// Initialize Firebase Admin
console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Collections
const POSITIONS_COLLECTION = "staking_positions";
const POOL_COLLECTION = "staking_pool";

// Configuration - UPDATE THESE VALUES
const LOCKED_TOKEN_PRICE_SOL = 0.0000030340; // The locked price for old stakers (provided by user)
const NEW_TOKEN_PRICE_USD = 5.39; // Current price of new $MKIN (provided by user)
const CONVERSION_RATIO = 2_500_000; // 2,500,000 old = 1 new

// Get current SOL price
async function getSolPrice() {
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT");
    const data = await response.json();
    return parseFloat(data.price);
  } catch (e) {
    console.log("⚠️ Using fallback SOL price: $92");
    return 92;
  }
}

// Calculate conversion for a single position
function calculateConversion(principalAmount, lockedPriceSol) {
  const solPrice = getSolPrice(); // Will be fetched
  const oldUsdValue = principalAmount * lockedPriceSol;
  const newTokenCount = oldUsdValue / NEW_TOKEN_PRICE_USD;
  const oldReward = oldUsdValue * 0.10; // 10% APR
  const newReward = newTokenCount * NEW_TOKEN_PRICE_USD * 0.10;
  
  return {
    oldTokens: principalAmount,
    oldUsdValue,
    newTokenCount,
    oldReward,
    newReward,
  };
}

async function run() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 TOKEN MIGRATION PREVIEW");
  console.log("=".repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("");
  console.log("Configuration:");
  console.log(`  Locked token price (SOL): ${LOCKED_TOKEN_PRICE_SOL}`);
  console.log(`  New token price (USD): $${NEW_TOKEN_PRICE_USD}`);
  console.log(`  Conversion ratio: ${CONVERSION_RATIO.toLocaleString()}:1`);
  console.log("");

  // Get SOL price
  const solPrice = await getSolPrice();
  console.log(`  Current SOL price: $${solPrice.toFixed(2)}`);
  console.log("");

  // Fetch all positions
  console.log("📊 Fetching staking positions...");
  const snapshot = await db.collection(POSITIONS_COLLECTION)
    .where("principal_amount", ">", 0)
    .get();

  const positions = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
  }));

  const totalPositions = positions.length;
  console.log(`  Found ${totalPositions} positions with principal_amount > 0`);
  console.log("");

  // Calculate stats
  const stats = {
    totalOldTokens: 0,
    totalOldUsdValue: 0,
    totalNewTokens: 0,
    totalOldReward: 0,
    totalNewReward: 0,
    zeroPositions: 0,
  };

  // Sample positions
  const samples = [];
  const nonZeroSamples = positions.filter(p => p.principal_amount > 0).slice(0, 10);

  for (const pos of positions) {
    const tokens = pos.principal_amount || 0;
    const lockedPrice = pos.locked_token_price_sol || LOCKED_TOKEN_PRICE_SOL;
    
    const oldUsdValue = tokens * lockedPrice * solPrice;
    const newTokens = oldUsdValue / NEW_TOKEN_PRICE_USD;
    const oldReward = oldUsdValue * 0.10;
    const newReward = newTokens * NEW_TOKEN_PRICE_USD * 0.10;

    stats.totalOldTokens += tokens;
    stats.totalOldUsdValue += oldUsdValue;
    stats.totalNewTokens += newTokens;
    stats.totalOldReward += oldReward;
    stats.totalNewReward += newReward;

    if (tokens === 0) {
      stats.zeroPositions++;
    }
  }

  // Calculate averages
  const avgOldTokens = stats.totalOldTokens / totalPositions;
  const avgOldUsdValue = stats.totalOldUsdValue / totalPositions;
  const avgNewTokens = stats.totalNewTokens / totalPositions;
  const avgOldReward = stats.totalOldReward / totalPositions;
  const avgNewReward = stats.totalNewReward / totalPositions;

  // Print results
  console.log("=".repeat(80));
  console.log("📈 AGGREGATE RESULTS");
  console.log("=".repeat(80));
  console.log("");
  console.log("Total Statistics:");
  console.log(`  Total positions: ${totalPositions}`);
  console.log(`  Positions with stake > 0: ${totalPositions - stats.zeroPositions}`);
  console.log("");
  console.log("Total Staked (OLD system):");
  console.log(`  Total old tokens: ${stats.totalOldTokens.toLocaleString()}`);
  console.log(`  Total USD value: $${stats.totalOldUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log("");
  // totalNewUsdValue should equal totalOldUsdValue (that's the whole point of USD-based conversion)
  const totalNewUsdValue = stats.totalOldUsdValue;
  
  console.log("After Conversion (NEW system):");
  console.log(`  Total new tokens: ${stats.totalNewTokens.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`);
  console.log(`  Total USD value: $${totalNewUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log("");
  console.log("Annual Rewards (10% APR):");
  console.log(`  Current (OLD): $${stats.totalOldReward.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/year`);
  console.log(`  After migration (NEW): $${stats.totalNewReward.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/year`);
  console.log("");
  console.log("Average Per Staker:");
  console.log(`  Avg old tokens: ${avgOldTokens.toLocaleString()}`);
  console.log(`  Avg old USD value: $${avgOldUsdValue.toFixed(2)}`);
  console.log(`  Avg new tokens: ${avgNewTokens.toFixed(4)}`);
  console.log(`  Avg old reward: $${avgOldReward.toFixed(2)}/year`);
  console.log(`  Avg new reward: $${avgNewReward.toFixed(2)}/year`);
  console.log("");

  // Sample individual positions
  if (nonZeroSamples.length > 0) {
    console.log("=".repeat(80));
    console.log("📋 SAMPLE POSITIONS (First 10)");
    console.log("=".repeat(80));
    console.log("");
    console.log("ID                    | Old Tokens      | Old USD    | New Tokens | Old Reward | New Reward");
    console.log("-".repeat(85));
    
    for (const pos of nonZeroSamples) {
      const tokens = pos.principal_amount || 0;
      const lockedPrice = pos.locked_token_price_sol || LOCKED_TOKEN_PRICE_SOL;
      const oldUsdValue = tokens * lockedPrice * solPrice;
      const newTokens = oldUsdValue / NEW_TOKEN_PRICE_USD;
      const oldReward = oldUsdValue * 0.10;
      const newReward = newTokens * NEW_TOKEN_PRICE_USD * 0.10;

      console.log(
        `${pos.id.substring(0, 20).padEnd(20)} | ` +
        `${tokens.toLocaleString().padStart(12)} | ` +
        `$${oldUsdValue.toFixed(2).padStart(8)} | ` +
        `${newTokens.toFixed(4).padStart(10)} | ` +
        `$${oldReward.toFixed(2).padStart(9)} | ` +
        `$${newReward.toFixed(2)}`
      );
    }
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("ℹ️  This is a VIEW-ONLY preview. No changes have been made to Firestore.");
  console.log("=".repeat(80));

  process.exit(0);
}

run().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});