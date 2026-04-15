/**
 * Investigation Script for Missing Stakes
 * 
 * PURPOSE:
 * Investigate why user's stakes don't appear on the staking page despite
 * blockchain transactions showing they staked tokens.
 * 
 * USAGE:
 *   node scripts/investigate_missing_stakes.js [wallet_address]
 * 
 * EXAMPLE:
 *   node scripts/investigate_missing_stakes.js 7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC
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
const WALLET_TO_INVESTIGATE = process.argv[2] || "7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC";

// Collections
const USER_REWARDS_COLLECTION = "userRewards";
const POSITIONS_COLLECTION = "staking_positions";
const TRANSACTIONS_COLLECTION = "staking_transactions";
const POOL_COLLECTION = "staking_pool";
const STAKING_POOL_ID = "main_pool";

async function investigate() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 MISSING STAKES INVESTIGATION");
  console.log("=".repeat(80));
  console.log(`Wallet: ${WALLET_TO_INVESTIGATE}`);
  console.log(`Time: ${new Date().toISOString()}`);

  const results = {
    wallet: WALLET_TO_INVESTIGATE,
    firebaseUid: null,
    legacyStakes: [],
    legacyTotal: 0,
    positionsData: null,
    positionsTotal: 0,
    recordedTransactions: [],
    blockchainTransactions: [],
    discrepancy: null,
  };

  // Step 1: Find Firebase UID from wallet address
  console.log("\n📋 Step 1: Finding Firebase UID for wallet...");
  
  // Try wallets collection (reverse lookup)
  const walletsDoc = await db.collection("wallets").doc(WALLET_TO_INVESTIGATE.toLowerCase()).get();
  if (walletsDoc.exists) {
    results.firebaseUid = walletsDoc.data().uid;
    console.log(`   ✅ Found in wallets collection: ${results.firebaseUid}`);
  }

  // Try userRewards collection
  if (!results.firebaseUid) {
    console.log("   Searching userRewards by wallet address...");
    const userRewardsSnapshot = await db.collection(USER_REWARDS_COLLECTION).get();
    for (const doc of userRewardsSnapshot.docs) {
      const data = doc.data();
      if (data.walletAddress?.toLowerCase() === WALLET_TO_INVESTIGATE.toLowerCase()) {
        results.firebaseUid = doc.id;
        console.log(`   ✅ Found in userRewards: ${results.firebaseUid}`);
        break;
      }
    }
  }

  // Try users collection
  if (!results.firebaseUid) {
    console.log("   Searching users collection...");
    const usersSnapshot = await db.collection("users").get();
    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      if (data.walletAddress?.toLowerCase() === WALLET_TO_INVESTIGATE.toLowerCase()) {
        results.firebaseUid = doc.id;
        console.log(`   ✅ Found in users: ${results.firebaseUid}`);
        break;
      }
    }
  }

  if (!results.firebaseUid) {
    console.log("   ❌ Wallet not found in any collection!");
    console.log("\n⚠️  INVESTIGATION COMPLETE: User not found in Firestore");
    return results;
  }

  console.log(`\n✅ Firebase UID: ${results.firebaseUid}`);

  // Step 2: Check legacy stakes (users/{uid}/stakes/)
  console.log("\n📋 Step 2: Checking legacy stakes collection (users/{uid}/stakes/)...");
  
  const legacyStakesRef = db.collection("users").doc(results.firebaseUid).collection("stakes");
  const legacyStakesSnapshot = await legacyStakesRef.get();
  
  if (legacyStakesSnapshot.empty) {
    console.log("   ⚪ No legacy stakes found");
  } else {
    console.log(`   ✅ Found ${legacyStakesSnapshot.size} legacy stake(s):`);
    legacyStakesSnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`   - ${doc.id}: ${data.amount?.toLocaleString()} MKIN (status: ${data.status})`);
      results.legacyStakes.push({
        id: doc.id,
        ...data,
      });
      results.legacyTotal += data.amount || 0;
    });
    console.log(`   📊 Legacy total: ${results.legacyTotal.toLocaleString()} MKIN`);
  }

  // Step 3: Check staking_positions collection
  console.log("\n📋 Step 3: Checking staking_positions collection...");
  
  const positionsDoc = await db.collection(POSITIONS_COLLECTION).doc(results.firebaseUid).get();
  
  if (positionsDoc.exists) {
    results.positionsData = positionsDoc.data();
    results.positionsTotal = positionsDoc.data().principal_amount || 0;
    console.log("   ✅ Staking position found:");
    console.log(`   - Principal: ${results.positionsTotal.toLocaleString()} MKIN`);
    console.log(`   - Pending rewards: ${positionsDoc.data().pending_rewards || 0} SOL`);
    console.log(`   - Total claimed: ${positionsDoc.data().total_claimed_sol || 0} SOL`);
    console.log(`   - Last stake time: ${positionsDoc.data().last_stake_time?.toDate()?.toISOString() || "N/A"}`);
    console.log(`   - Locked token price: ${positionsDoc.data().locked_token_price_sol || 0} SOL/MKIN`);
  } else {
    console.log("   ❌ No staking position found!");
  }

  // Step 4: Check recorded staking transactions
  console.log("\n📋 Step 4: Checking recorded staking transactions...");
  
  const transactionsSnapshot = await db.collection(TRANSACTIONS_COLLECTION)
    .where("user_id", "==", results.firebaseUid)
    .where("type", "==", "STAKE")
    .get();
  
  if (transactionsSnapshot.empty) {
    console.log("   ⚪ No stake transactions recorded");
  } else {
    console.log(`   ✅ Found ${transactionsSnapshot.size} recorded transaction(s):`);
    transactionsSnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`   - ${doc.id}: ${data.amount_mkin?.toLocaleString()} MKIN`);
      console.log(`     TX: ${data.signature}`);
      console.log(`     Manual credit: ${data.manual_credit ? "YES" : "NO"}`);
      results.recordedTransactions.push({
        id: doc.id,
        ...data,
      });
    });
  }

  // Step 5: Calculate discrepancy
  console.log("\n📋 Step 5: Calculating discrepancy...");
  
  results.discrepancy = {
    legacyTotal: results.legacyTotal,
    positionsTotal: results.positionsTotal,
    difference: results.legacyTotal - results.positionsTotal,
    needsMigration: results.legacyTotal > results.positionsTotal,
  };

  console.log(`   Legacy stakes: ${results.discrepancy.legacyTotal.toLocaleString()} MKIN`);
  console.log(`   Positions total: ${results.discrepancy.positionsTotal.toLocaleString()} MKIN`);
  console.log(`   Difference: ${results.discrepancy.difference.toLocaleString()} MKIN`);
  
  if (results.discrepancy.needsMigration) {
    console.log("   ⚠️  MIGRATION NEEDED: Legacy stakes not reflected in positions!");
  } else if (results.discrepancy.difference === 0) {
    console.log("   ✅ No discrepancy found");
  } else {
    console.log("   ℹ️  Positions total is higher than legacy (user may have staked via new system)");
  }

  // Step 6: Check global pool stats
  console.log("\n📋 Step 6: Checking global staking pool...");
  
  const poolDoc = await db.collection(POOL_COLLECTION).doc(STAKING_POOL_ID).get();
  if (poolDoc.exists) {
    const poolData = poolDoc.data();
    console.log(`   Total staked: ${poolData.total_staked?.toLocaleString() || 0} MKIN`);
    console.log(`   Reward pool: ${poolData.reward_pool_sol || 0} SOL`);
  } else {
    console.log("   ⚪ Pool not initialized");
  }

  // Step 7: Generate recommendations
  console.log("\n" + "=".repeat(80));
  console.log("📝 RECOMMENDATIONS");
  console.log("=".repeat(80));

  if (results.discrepancy.needsMigration) {
    console.log("\n✅ ACTION REQUIRED: Run migration script to credit missing stakes");
    console.log(`   Command: node scripts/migrate_legacy_stakes.js ${results.firebaseUid}`);
    console.log(`   Amount to credit: ${results.discrepancy.difference.toLocaleString()} MKIN`);
  } else {
    console.log("\n✅ No migration needed for this user");
  }

  // Final summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 INVESTIGATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Firebase UID: ${results.firebaseUid}`);
  console.log(`Legacy stakes: ${results.legacyStakes.length} (${results.legacyTotal.toLocaleString()} MKIN)`);
  console.log(`Positions total: ${results.positionsTotal.toLocaleString()} MKIN`);
  console.log(`Discrepancy: ${results.discrepancy.difference.toLocaleString()} MKIN`);
  console.log(`Migration needed: ${results.discrepancy.needsMigration ? "YES" : "NO"}`);

  return results;
}

// Run investigation
investigate()
  .then((results) => {
    console.log("\n✅ Investigation complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Investigation failed:", error);
    process.exit(1);
  });
