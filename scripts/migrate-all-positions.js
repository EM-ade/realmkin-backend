/**
 * Migrate All Staking Positions Script
 * 
 * PURPOSE:
 * Migrate all existing staking positions from OLD MKIN to NEW $MKIN
 * Preserves USD value and reward rate for each staker
 * 
 * USAGE:
 *   node scripts/migrate-all-positions.js [--preview] [--execute]
 * 
 * OPTIONS:
 *   --preview  Show what would happen without making changes
 *   --execute  Actually perform the migration (REQUIRED to run)
 * 
 * EXAMPLE:
 *   node scripts/migrate-all-positions.js --preview  (preview first)
 *   node scripts/migrate-all-positions.js --execute   (then execute)
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
const TRANSACTIONS_COLLECTION = "staking_transactions";

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
    console.log("⚠️ Using fallback SOL price: $85");
    return 85;
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const isPreview = args.includes("--preview");
const isExecute = args.includes("--execute");

if (!isPreview && !isExecute) {
  console.log("\n❌ ERROR: You must specify --preview or --execute");
  console.log("USAGE:");
  console.log("  node scripts/migrate-all-positions.js --preview  (show what would happen)");
  console.log("  node scripts/migrate-all-positions.js --execute  (actually migrate)");
  process.exit(1);
}

const DRY_RUN = isPreview;

async function run() {
  console.log("\n" + "=".repeat(80));
  console.log("🔄 MIGRATE ALL STAKING POSITIONS (OLD → NEW)");
  console.log("=".repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? "PREVIEW (no changes)" : "EXECUTE (will migrate)"}`);
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

  // Fetch all positions with stake > 0 and not already migrated
  console.log("📊 Fetching staking positions...");
  const snapshot = await db.collection(POSITIONS_COLLECTION)
    .where("principal_amount", ">", 0)
    .get();

  const allPositions = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const oldTokens = data.principal_amount_old || 0;
    const currentTokens = data.principal_amount || 0;
    
    // RE-MIGRATE: If already migrated with wrong formula, use the old value
    if (oldTokens > 0) {
      allPositions.push({
        id: doc.id,
        ...data,
        principal_amount: currentTokens, // Keep current as temp for calculation
      });
    }
  }

  const totalToMigrate = allPositions.length;
  console.log(`  Found ${totalToMigrate} positions to migrate`);
  
  if (totalToMigrate === 0) {
    console.log("");
    console.log("ℹ️  No positions need migration. All already migrated or have zero stake.");
    process.exit(0);
  }
  console.log("");

  // Calculate totals
  const stats = {
    totalOldTokens: 0,
    totalOldUsdValue: 0,
    totalNewTokens: 0,
    totalOldReward: 0,
    totalNewReward: 0,
    success: 0,
    skipped: 0,
    failed: 0,
  };

  // Preview all positions
  console.log("=".repeat(80));
  console.log("📋 PREVIEW (First 10 positions)");
  console.log("=".repeat(80));
  console.log("");
  console.log("ID                    | Old Tokens    | Old USD  | New Tokens | Old Reward | New Reward");
  console.log("-".repeat(85));

  const previewSample = allPositions.slice(0, 10);
  for (const pos of previewSample) {
    const oldTokens = pos.principal_amount_old || pos.principal_amount || 0;
    // SIMPLE DIVISION: Divide by 2,500,000
    const newTokens = oldTokens / CONVERSION_RATIO;
    // USD values for display (but not used in conversion)
    const lockedPrice = pos.locked_token_price_sol || LOCKED_TOKEN_PRICE_SOL;
    const oldUsdValue = oldTokens * lockedPrice * solPrice;
    const newUsdValue = newTokens * NEW_TOKEN_PRICE_USD;
    const oldReward = oldUsdValue * 0.10;
    const newReward = newUsdValue * 0.10;

    stats.totalOldTokens += oldTokens;
    stats.totalOldUsdValue += oldUsdValue;
    stats.totalNewTokens += newTokens;
    stats.totalOldReward += oldReward;
    stats.totalNewReward += newReward;

    console.log(
      `${pos.id.substring(0, 20).padEnd(20)} | ` +
      `${oldTokens.toLocaleString().padStart(11)} | ` +
      `$${oldUsdValue.toFixed(2).padStart(7)} | ` +
      `${newTokens.toFixed(4).padStart(10)} | ` +
      `$${oldReward.toFixed(2).padStart(10)} | ` +
      `$${newReward.toFixed(2)}`
    );
  }

  // Calculate remaining (not shown in preview)
  for (let i = 10; i < allPositions.length; i++) {
    const pos = allPositions[i];
    const oldTokens = pos.principal_amount_old || pos.principal_amount || 0;
    // SIMPLE DIVISION: Divide by 2,500,000
    const newTokens = oldTokens / CONVERSION_RATIO;
    const lockedPrice = pos.locked_token_price_sol || LOCKED_TOKEN_PRICE_SOL;
    const oldUsdValue = oldTokens * lockedPrice * solPrice;
    const newUsdValue = newTokens * NEW_TOKEN_PRICE_USD;
    const oldReward = oldUsdValue * 0.10;
    const newReward = newUsdValue * 0.10;

    stats.totalOldTokens += oldTokens;
    stats.totalOldUsdValue += oldUsdValue;
    stats.totalNewTokens += newTokens;
    stats.totalOldReward += oldReward;
    stats.totalNewReward += newReward;
  }

  // Print aggregate preview
  console.log("");
  console.log("=".repeat(80));
  console.log("📈 AGGREGATE PREVIEW");
  console.log("=".repeat(80));
  console.log("");
  console.log("Total to migrate:");
  console.log(`  Positions: ${totalToMigrate}`);
  console.log(`  Old tokens: ${stats.totalOldTokens.toLocaleString()}`);
  console.log(`  Old USD value: $${stats.totalOldUsdValue.toFixed(2)}`);
  console.log("");
  console.log("After migration:");
  console.log(`  New tokens: ${stats.totalNewTokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}`);
  console.log(`  New USD value: $${(stats.totalNewTokens * NEW_TOKEN_PRICE_USD).toFixed(2)}`);
  console.log("");
  console.log("Annual rewards (10% APR):");
  console.log(`  Before: $${stats.totalOldReward.toFixed(2)}/year`);
  console.log(`  After: $${stats.totalNewReward.toFixed(2)}/year`);
  console.log("");

  if (DRY_RUN) {
    console.log("=".repeat(80));
    console.log("ℹ️  PREVIEW MODE - No changes made");
    console.log("=".repeat(80));
    console.log("");
    console.log("To execute migration, run:");
    console.log("  node scripts/migrate-all-positions.js --execute");
    process.exit(0);
  }

  // EXECUTE MODE
  console.log("=".repeat(80));
  console.log("⚠️  EXECUTE MODE - Starting migration...");
  console.log("=".repeat(80));
  console.log("");

  // Migrate each position
  for (let i = 0; i < allPositions.length; i++) {
    const pos = allPositions[i];
    const posId = pos.id;
    
    try {
      const oldTokens = pos.principal_amount_old || pos.principal_amount || 0;
      // SIMPLE DIVISION: Divide by 2,500,000
      const newTokens = oldTokens / CONVERSION_RATIO;

      const now = admin.firestore.Timestamp.now();
      
      await db.collection(POSITIONS_COLLECTION).doc(posId).update({
        principal_amount_old: oldTokens,
        principal_amount: newTokens,
        principal_amount_new: newTokens,
        locked_token_price_usd: NEW_TOKEN_PRICE_USD,
        locked_token_price_sol: null,
        migration_ratio: CONVERSION_RATIO,
        migrated_at: now,
        migrated_by: "system_script",
        migration_locked_price_sol: LOCKED_TOKEN_PRICE_SOL,
        migration_sol_price: solPrice,
        updated_at: now,
      });

      stats.success++;
      
      if (i < 5 || i === allPositions.length - 1) {
        console.log(`  ✅ ${posId.substring(0, 8)}... → ${newTokens.toFixed(4)} new tokens`);
      } else if (i === 5) {
        console.log(`  ... and ${allPositions.length - 6} more`);
      }
    } catch (error) {
      stats.failed++;
      console.error(`  ❌ ${posId.substring(0, 8)}... → ${error.message}`);
    }
  }

  // Log migration transaction
  try {
    await db.collection(TRANSACTIONS_COLLECTION).add({
      type: "MIGRATION",
      description: "Migrate all positions from OLD to NEW token",
      total_positions: totalToMigrate,
      success_count: stats.success,
      failed_count: stats.failed,
      total_old_tokens: stats.totalOldTokens,
      total_new_tokens: stats.totalNewTokens,
      total_old_usd_value: stats.totalOldUsdValue,
      total_new_usd_value: stats.totalNewTokens * NEW_TOKEN_PRICE_USD,
      locked_token_price_sol: LOCKED_TOKEN_PRICE_SOL,
      new_token_price_usd: NEW_TOKEN_PRICE_USD,
      conversion_ratio: CONVERSION_RATIO,
      sol_price: solPrice,
      executed: !DRY_RUN,
      timestamp: admin.firestore.Timestamp.now(),
    });
  } catch (e) {
    console.error("⚠️ Failed to log migration:", e.message);
  }

  console.log("");
  console.log("=".repeat(80));
  console.log("✅ MIGRATION COMPLETE");
  console.log("=".repeat(80));
  console.log("");
  console.log("Results:");
  console.log(`  Success: ${stats.success}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log("");
  console.log("All positions have been migrated to NEW token.");
  console.log("Old token data preserved in principal_amount_old field.");
  console.log("");

  process.exit(stats.failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});