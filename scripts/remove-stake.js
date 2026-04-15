/**
 * Remove MKIN from a user's stake (Administrative Unstake)
 * 
 * USAGE:
 *   node scripts/remove-stake.js <uid> <amount>
 * 
 * EXAMPLE:
 *   node scripts/remove-stake.js jDbySdiDJQQWzZIFEBgn3UpWWUc2 150167.701
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";

console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function removeStake(uid, amount) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔻 ADMINISTRATIVE UNSTAKE`);
  console.log(`   User: ${uid}`);
  console.log(`   Amount: ${amount.toLocaleString()} MKIN`);
  console.log("=".repeat(80));
  
  try {
    // Get user's current staking position
    console.log(`\n📊 Getting current staking position...`);
    const posDoc = await db.collection("staking_positions").doc(uid).get();
    
    if (!posDoc.exists) {
      console.log(`❌ No staking position found for user ${uid}`);
      return false;
    }
    
    const posData = posDoc.data();
    const currentStake = posData.principal_amount || 0;
    
    console.log(`   Current stake: ${currentStake.toLocaleString()} MKIN`);
    
    if (amount > currentStake) {
      console.log(`❌ Error: Cannot remove ${amount.toLocaleString()} MKIN (insufficient stake)`);
      return false;
    }
    
    // Get pool data
    console.log(`\n🏊 Getting pool data...`);
    const poolDoc = await db.collection("staking_pool").doc("main_pool").get();
    const poolData = poolDoc.data();
    const poolTotal = poolData.total_staked || 0;
    console.log(`   Pool total (before): ${poolTotal.toLocaleString()} MKIN`);
    
    // Perform the unstake in a transaction
    console.log(`\n📝 Updating Firestore...`);
    
    await db.runTransaction(async (t) => {
      const posRef = db.collection("staking_positions").doc(uid);
      const poolRef = db.collection("staking_pool").doc("main_pool");
      
      // Update user's staking position
      t.update(posRef, {
        principal_amount: currentStake - amount,
        updated_at: admin.firestore.Timestamp.now(),
      });
      
      // Update pool total
      t.update(poolRef, {
        total_staked: poolTotal - amount,
        updated_at: admin.firestore.Timestamp.now(),
      });
      
      console.log(`   ✅ Transaction committed`);
    });
    
    // Log the transaction
    console.log(`\n📜 Logging transaction...`);
    const txRef = db.collection("staking_transactions").doc();
    await txRef.set({
      user_id: uid,
      type: "unstake",
      amount_mkin: amount,
      amount_sol: 0,
      signature: `admin_unstake_${Date.now()}`,
      timestamp: admin.firestore.Timestamp.now(),
      manual_credit: true,
      manual_credit_reason: `Administrative unstake - ${amount.toLocaleString()} MKIN removed`,
      created_at: admin.firestore.Timestamp.now(),
    });
    
    console.log(`   ✅ Transaction logged: ${txRef.id}`);
    
    // Show results
    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ UNSTAKE COMPLETE`);
    console.log("=".repeat(80));
    console.log(`   User: ${uid}`);
    console.log(`   Amount removed: ${amount.toLocaleString()} MKIN`);
    console.log(`   Previous stake: ${currentStake.toLocaleString()} MKIN`);
    console.log(`   New stake: ${(currentStake - amount).toLocaleString()} MKIN`);
    console.log(`   Pool total (new): ${(poolTotal - amount).toLocaleString()} MKIN`);
    
    return true;
  } catch (error) {
    console.error(`\n❌ ERROR: Transaction failed:`, error.message);
    console.error(`   Stack:`, error.stack);
    return false;
  }
}

// Main
const args = process.argv.slice(2);
const uid = args[0];
const amount = parseFloat(args[1]);

if (!uid || !amount || amount <= 0) {
  console.log(`\n❌ Invalid usage`);
  console.log(`\nUsage: node scripts/remove-stake.js <uid> <amount>`);
  console.log(`\nExample: node scripts/remove-stake.js jDbySdiDJQQWzZIFEBgn3UpWWUc2 150167.701`);
  process.exit(1);
}

removeStake(uid, amount).then(success => {
  if (success) {
    console.log(`\n✅ Script completed successfully`);
    process.exit(0);
  } else {
    console.log(`\n❌ Script failed`);
    process.exit(1);
  }
}).catch(console.error);
