/**
 * Migration Script: Legacy Stakes to Staking Positions
 * 
 * PURPOSE:
 * Migrate stakes from the legacy users/{uid}/stakes/ subcollection
 * to the current staking_positions/{uid} collection.
 * 
 * This fixes the issue where users staked tokens but their stakes
 * don't appear on the staking page because they were recorded in
 * the wrong Firestore collection.
 * 
 * USAGE:
 *   # Migrate specific user
 *   node scripts/migrate_legacy_stakes.js <firebase_uid>
 * 
 *   # Migrate all users with legacy stakes
 *   node scripts/migrate_legacy_stakes.js --all
 * 
 *   # Dry run (see what would be migrated without making changes)
 *   node scripts/migrate_legacy_stakes.js <firebase_uid> --dry-run
 * 
 * EXAMPLES:
 *   node scripts/migrate_legacy_stakes.js 7qdPA3cZKoNTUeONsX3E5zwFbo63
 *   node scripts/migrate_legacy_stakes.js --all
 *   node scripts/migrate_legacy_stakes.js --all --dry-run
 */

import admin from "firebase-admin";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";

// Initialize Firebase Admin
console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Configuration
const TARGET_UID = process.argv[2];
const MIGRATE_ALL = TARGET_UID === "--all";
const DRY_RUN = process.argv.includes("--dry-run");

// Collections
const USER_REWARDS_COLLECTION = "userRewards";
const POSITIONS_COLLECTION = "staking_positions";
const TRANSACTIONS_COLLECTION = "staking_transactions";
const POOL_COLLECTION = "staking_pool";
const STAKING_POOL_ID = "main_pool";

async function getMkinPriceSOL() {
  try {
    const { getMkinPriceSOL: fetchPrice } = await import("../utils/mkinPrice.js");
    return await fetchPrice();
  } catch (error) {
    console.error("⚠️  Failed to fetch MKIN/SOL price, using 0.0000001 as fallback");
    return 0.0000001;
  }
}

async function migrateUser(firebaseUid) {
  console.log("\n" + "=".repeat(80));
  console.log(`🔄 MIGRATING USER: ${firebaseUid}`);
  console.log("=".repeat(80));

  const result = {
    uid: firebaseUid,
    legacyStakes: [],
    legacyTotal: 0,
    existingPositions: null,
    migrationAmount: 0,
    success: false,
    error: null,
    skipped: false,
    skipReason: null,
  };

  try {
    // Step 1: Get user's legacy stakes
    console.log("\n📋 Step 1: Fetching legacy stakes...");
    const legacyStakesRef = db.collection("users").doc(firebaseUid).collection("stakes");
    const legacyStakesSnapshot = await legacyStakesRef.get();

    if (legacyStakesSnapshot.empty) {
      console.log("   ⚪ No legacy stakes found - skipping");
      result.skipped = true;
      result.skipReason = "no_legacy_stakes";
      return result;
    }

    legacyStakesSnapshot.forEach((doc) => {
      const data = doc.data();
      result.legacyStakes.push({
        id: doc.id,
        ...data,
      });
      result.legacyTotal += data.amount || 0;
    });

    console.log(`   ✅ Found ${legacyStakesSnapshot.size} legacy stake(s):`);
    result.legacyStakes.forEach((stake) => {
      console.log(`   - ${stake.id}: ${stake.amount?.toLocaleString()} MKIN (${stake.status})`);
    });
    console.log(`   📊 Legacy total: ${result.legacyTotal.toLocaleString()} MKIN`);

    // Step 2: Check if stakes already migrated
    console.log("\n📋 Step 2: Checking for existing migration markers...");
    const alreadyMigrated = result.legacyStakes.some(
      (stake) => stake.migrated_to_positions === true
    );

    if (alreadyMigrated) {
      console.log("   ⚠️  Some stakes already marked as migrated");
      const migratedStakes = result.legacyStakes.filter(
        (stake) => stake.migrated_to_positions === true
      );
      const unmigratedStakes = result.legacyStakes.filter(
        (stake) => !stake.migrated_to_positions
      );
      const unmigratedTotal = unmigratedStakes.reduce(
        (sum, stake) => sum + (stake.amount || 0),
        0
      );
      console.log(`   - Migrated: ${migratedStakes.length} stakes`);
      console.log(`   - Unmigrated: ${unmigratedStakes.length} stakes (${unmigratedTotal.toLocaleString()} MKIN)`);

      if (unmigratedTotal === 0) {
        console.log("   ✅ All stakes already migrated - skipping");
        result.skipped = true;
        result.skipReason = "already_migrated";
        return result;
      }

      result.legacyTotal = unmigratedTotal;
      result.legacyStakes = unmigratedStakes;
    }

    // Step 3: Get or create staking position
    console.log("\n📋 Step 3: Checking staking_positions...");
    const positionsRef = db.collection(POSITIONS_COLLECTION).doc(firebaseUid);
    const positionsDoc = await positionsRef.get();

    if (positionsDoc.exists) {
      result.existingPositions = positionsDoc.data();
      console.log("   ✅ Existing position found:");
      console.log(`   - Current principal: ${result.existingPositions.principal_amount?.toLocaleString() || 0} MKIN`);
      console.log(`   - Pending rewards: ${result.existingPositions.pending_rewards || 0} SOL`);
      console.log(`   - Last stake time: ${result.existingPositions.last_stake_time?.toDate()?.toISOString() || "N/A"}`);
    } else {
      console.log("   ⚪ No existing position - will create new one");
    }

    // Step 4: Fetch current token price for locked price calculation
    console.log("\n📋 Step 4: Fetching current MKIN/SOL price...");
    const tokenPriceSol = await getMkinPriceSOL();
    console.log(`   Current price: ${tokenPriceSol.toFixed(9)} SOL/MKIN`);

    // Step 5: Calculate migration amounts
    console.log("\n📋 Step 5: Calculating migration details...");
    result.migrationAmount = result.legacyTotal;

    const newPrincipal = (result.existingPositions?.principal_amount || 0) + result.migrationAmount;
    const oldPrincipal = result.existingPositions?.principal_amount || 0;

    console.log(`   Existing principal: ${oldPrincipal.toLocaleString()} MKIN`);
    console.log(`   Migration amount: ${result.migrationAmount.toLocaleString()} MKIN`);
    console.log(`   New principal: ${newPrincipal.toLocaleString()} MKIN`);

    // Calculate locked token price (weighted average if adding to existing)
    let lockedPrice = tokenPriceSol;
    if (oldPrincipal > 0 && result.existingPositions?.locked_token_price_sol > 0) {
      lockedPrice =
        (result.existingPositions.locked_token_price_sol * oldPrincipal +
          tokenPriceSol * result.migrationAmount) /
        newPrincipal;
      console.log(`   Weighted locked price: ${lockedPrice.toFixed(9)} SOL/MKIN`);
    } else {
      console.log(`   Locked price: ${lockedPrice.toFixed(9)} SOL/MKIN`);
    }

    // Step 6: Perform migration (or dry run)
    console.log("\n📋 Step 6: " + (DRY_RUN ? "DRY RUN - Would perform" : "Performing") + " migration...");

    if (DRY_RUN) {
      console.log("   📝 Would update:");
      console.log(`   - Create/update ${POSITIONS_COLLECTION}/${firebaseUid}`);
      console.log(`   - Set principal_amount to ${newPrincipal.toLocaleString()} MKIN`);
      console.log(`   - Set locked_token_price_sol to ${lockedPrice.toFixed(9)} SOL/MKIN`);
      console.log(`   - Update pool total_staked by +${result.migrationAmount.toLocaleString()} MKIN`);
      console.log(`   - Mark ${result.legacyStakes.length} legacy stakes as migrated`);
      console.log(`   - Log ${result.legacyStakes.length} migration transaction(s)`);

      result.success = true;
      return result;
    }

    // Actual migration
    const now = admin.firestore.Timestamp.now();

    await db.runTransaction(async (t) => {
      const poolRef = db.collection(POOL_COLLECTION).doc(STAKING_POOL_ID);

      // Get pool data
      const poolDoc = await t.get(poolRef);
      let poolData = poolDoc.exists
        ? poolDoc.data()
        : {
            total_staked: 0,
            reward_pool_sol: 0,
            last_reward_time: now,
          };

      // Update pool
      poolData.total_staked = (poolData.total_staked || 0) + result.migrationAmount;
      poolData.last_reward_time = now;
      poolData.updated_at = now;

      // Update/create position
      const positionData = result.existingPositions || {
        user_id: firebaseUid,
        principal_amount: 0,
        pending_rewards: 0,
        total_accrued_sol: 0,
        total_claimed_sol: 0,
      };

      positionData.principal_amount = newPrincipal;
      positionData.locked_token_price_sol = lockedPrice;
      positionData.updated_at = now;

      // Set stake times if not already set
      if (!positionData.stake_start_time) {
        positionData.stake_start_time = now;
      }
      positionData.last_stake_time = now;

      // Write position
      t.set(positionsRef, positionData);

      // Write pool
      t.set(poolRef, poolData);

      // Log transactions for each migrated stake
      for (const stake of result.legacyStakes) {
        const txRef = db.collection(TRANSACTIONS_COLLECTION).doc();
        const txData = {
          user_id: firebaseUid,
          type: "STAKE",
          amount_mkin: stake.amount || 0,
          signature: stake.tx_signature || "legacy_migration",
          timestamp: stake.start_date || now,
          manual_credit: true,
          manual_credit_reason: "Migration from legacy users/{uid}/stakes/ collection",
          manual_credit_timestamp: now,
          legacy_stake_id: stake.id,
          migration_batch: Date.now(),
        };
        t.set(txRef, txData);

        // Mark legacy stake as migrated
        const legacyStakeRef = db.collection("users").doc(firebaseUid).collection("stakes").doc(stake.id);
        t.update(legacyStakeRef, {
          migrated_to_positions: true,
          migrated_at: now,
        });
      }

      console.log(`   ✅ Transaction prepared:`);
      console.log(`   - Pool total: ${poolData.total_staked.toLocaleString()} MKIN`);
      console.log(`   - User principal: ${positionData.principal_amount.toLocaleString()} MKIN`);
      console.log(`   - Logged ${result.legacyStakes.length} migration transaction(s)`);
    });

    console.log("   ✅ MIGRATION COMMITTED SUCCESSFULLY!");
    result.success = true;
  } catch (error) {
    console.error("   ❌ Migration failed:", error.message);
    result.error = error.message;
  }

  return result;
}

async function migrateAllUsers() {
  console.log("\n" + "=".repeat(80));
  console.log("🔄 MIGRATING ALL USERS WITH LEGACY STAKES");
  console.log("=".repeat(80));

  const results = [];
  let totalMigrated = 0;
  let totalAmount = 0;

  // Get all users with legacy stakes
  console.log("\n📋 Scanning for users with legacy stakes...");
  const usersSnapshot = await db.collection("users").get();

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const stakesRef = db.collection("users").doc(uid).collection("stakes");
    const stakesSnapshot = await stakesRef.get();

    if (!stakesSnapshot.empty) {
      console.log(`\n   Found user with legacy stakes: ${uid} (${stakesSnapshot.size} stakes)`);
      const result = await migrateUser(uid);
      results.push(result);

      if (result.success && !result.skipped) {
        totalMigrated++;
        totalAmount += result.migrationAmount;
      }
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("📊 ALL USERS MIGRATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Users processed: ${results.length}`);
  console.log(`Successfully migrated: ${totalMigrated}`);
  console.log(`Total amount migrated: ${totalAmount.toLocaleString()} MKIN`);

  const failed = results.filter((r) => !r.success);
  if (failed.length > 0) {
    console.log(`\n❌ Failed migrations:`);
    failed.forEach((r) => {
      console.log(`   - ${r.uid}: ${r.error}`);
    });
  }

  return results;
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔧 LEGACY STAKES MIGRATION SCRIPT");
  console.log("=".repeat(80));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE MIGRATION"}`);
  console.log(`Target: ${MIGRATE_ALL ? "ALL USERS" : TARGET_UID || "DEFAULT USER"}`);
  console.log(`Time: ${new Date().toISOString()}`);

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN MODE - No changes will be made to Firestore");
  } else {
    console.log("\n⚠️  WARNING: This will modify Firestore data!");
    console.log("   Use --dry-run first to preview changes.");
  }

  let results;

  if (MIGRATE_ALL) {
    results = await migrateAllUsers();
  } else if (TARGET_UID) {
    const result = await migrateUser(TARGET_UID);
    results = [result];
  } else {
    console.log("\n❌ Please provide a Firebase UID or use --all flag");
    console.log("\nUsage:");
    console.log("  node scripts/migrate_legacy_stakes.js <firebase_uid>");
    console.log("  node scripts/migrate_legacy_stakes.js --all");
    console.log("  Add --dry-run to preview without making changes");
    return;
  }

  // Final summary
  console.log("\n" + "=".repeat(80));
  console.log("🎉 MIGRATION COMPLETE");
  console.log("=".repeat(80));

  const successful = results.filter((r) => r.success && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`⏭️  Skipped: ${skipped.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log(`\n✅ Successfully migrated:`);
    successful.forEach((r) => {
      console.log(`   - ${r.uid}: ${r.migrationAmount.toLocaleString()} MKIN`);
    });
  }

  if (skipped.length > 0) {
    console.log(`\n⏭️  Skipped:`);
    skipped.forEach((r) => {
      console.log(`   - ${r.uid}: ${r.skipReason}`);
    });
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed:`);
    failed.forEach((r) => {
      console.log(`   - ${r.uid}: ${r.error}`);
    });
  }

  console.log("\n" + "=".repeat(80));
  console.log("✅ Script completed!");
  console.log("=".repeat(80));
}

main().catch((error) => {
  console.error("\n❌ Script failed:", error);
  process.exit(1);
});
