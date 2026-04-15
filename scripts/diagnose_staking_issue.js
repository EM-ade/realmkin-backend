/**
 * Comprehensive Diagnostic Tool for Missing Stakes
 * 
 * PURPOSE:
 * Diagnose why a user's stakes don't appear on the staking page.
 * Checks ALL possible failure points in the staking flow.
 * 
 * USAGE:
 *   node scripts/diagnose_staking_issue.js [wallet_address_or_firebase_uid]
 * 
 * EXAMPLES:
 *   node scripts/diagnose_staking_issue.js 7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC
 *   node scripts/diagnose_staking_issue.js 7qdPA3cZKoNTUeONsX3E5zwFbo63
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
const QUERY = process.argv[2];

if (!QUERY) {
  console.error("❌ Please provide a wallet address or Firebase UID");
  console.error("\nUsage:");
  console.error("  node scripts/diagnose_staking_issue.js <wallet_or_uid>");
  console.error("\nExamples:");
  console.error("  node scripts/diagnose_staking_issue.js 7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC");
  console.error("  node scripts/diagnose_staking_issue.js 7qdPA3cZKoNTUeONsX3E5zwFbo63");
  process.exit(1);
}

// Collections
const USER_REWARDS_COLLECTION = "userRewards";
const POSITIONS_COLLECTION = "staking_positions";
const TRANSACTIONS_COLLECTION = "staking_transactions";
const POOL_COLLECTION = "staking_pool";
const STAKING_POOL_ID = "main_pool";

// Solana connection
const SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.HELIUS_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

async function findUser(query) {
  console.log("\n🔍 Step 1: Finding user...");
  
  const result = {
    firebaseUid: null,
    walletAddress: null,
    source: null,
  };

  // Check if query is a Firebase UID (28 chars, alphanumeric)
  if (query.length >= 20 && query.length <= 30 && !query.includes(':')) {
    console.log(`   Trying as Firebase UID: ${query}`);
    const userRewardsDoc = await db.collection(USER_REWARDS_COLLECTION).doc(query).get();
    if (userRewardsDoc.exists) {
      result.firebaseUid = query;
      result.walletAddress = userRewardsDoc.data().walletAddress;
      result.source = "userRewards by UID";
      console.log(`   ✅ Found in userRewards: ${result.walletAddress}`);
      return result;
    }
  }

  // Check if query looks like a wallet address (base58, ~44 chars)
  if (query.length >= 32 && query.length <= 44) {
    console.log(`   Trying as wallet address: ${query}`);
    
    // Try wallets collection (reverse lookup)
    const walletsDoc = await db.collection("wallets").doc(query.toLowerCase()).get();
    if (walletsDoc.exists) {
      result.firebaseUid = walletsDoc.data().uid;
      result.walletAddress = query;
      result.source = "wallets collection";
      console.log(`   ✅ Found in wallets: UID=${result.firebaseUid}`);
      return result;
    }

    // Search userRewards
    const userRewardsSnapshot = await db.collection(USER_REWARDS_COLLECTION).get();
    for (const doc of userRewardsSnapshot.docs) {
      const data = doc.data();
      if (data.walletAddress?.toLowerCase() === query.toLowerCase()) {
        result.firebaseUid = doc.id;
        result.walletAddress = data.walletAddress;
        result.source = "userRewards by wallet";
        console.log(`   ✅ Found in userRewards: UID=${result.firebaseUid}`);
        return result;
      }
    }

    // Search users collection
    const usersSnapshot = await db.collection("users").get();
    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      if (data.walletAddress?.toLowerCase() === query.toLowerCase()) {
        result.firebaseUid = doc.id;
        result.walletAddress = data.walletAddress;
        result.source = "users collection";
        console.log(`   ✅ Found in users: UID=${result.firebaseUid}`);
        return result;
      }
    }
  }

  console.log(`   ❌ User not found for query: ${query}`);
  return result;
}

async function verifyTransactionOnChain(signature, expectedAmount) {
  try {
    const tx = await connection.getParsedTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { found: false, error: "Transaction not found" };
    }

    if (tx.meta?.err) {
      return { found: true, success: false, error: "Transaction failed on-chain" };
    }

    // Find token transfers
    const instructions = tx.transaction.message.instructions || [];
    const tokenTransfers = [];
    
    for (const ix of instructions) {
      if (ix.program === "spl-token" && ix.parsed?.type === "transfer") {
        const amount = parseInt(ix.parsed.info.amount) / 1e9;
        tokenTransfers.push({
          amount,
          source: ix.parsed.info.source,
          destination: ix.parsed.info.destination,
        });
      }
    }

    return {
      found: true,
      success: true,
      slot: tx.slot,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      tokenTransfers,
    };
  } catch (error) {
    return { found: false, error: error.message };
  }
}

async function diagnose() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 COMPREHENSIVE STAKING DIAGNOSTIC");
  console.log("=".repeat(80));
  console.log(`Query: ${QUERY}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Step 1: Find user
  const user = await findUser(QUERY);
  
  if (!user.firebaseUid) {
    console.log("\n❌ DIAGNOSIS COMPLETE: User not found in Firestore");
    console.log("\n💡 Possible causes:");
    console.log("   - User hasn't connected wallet to their account");
    console.log("   - Wallet address is incorrect");
    console.log("   - User signed up with different wallet");
    return;
  }

  console.log(`\n✅ User found:`);
  console.log(`   Firebase UID: ${user.firebaseUid}`);
  console.log(`   Wallet: ${user.walletAddress}`);
  console.log(`   Source: ${user.source}`);

  // Step 2: Check staking_positions
  console.log("\n📋 Step 2: Checking staking_positions...");
  const positionsDoc = await db.collection(POSITIONS_COLLECTION).doc(user.firebaseUid).get();
  
  const positionsData = positionsDoc.exists ? positionsDoc.data() : null;
  const positionsTotal = positionsData?.principal_amount || 0;

  if (positionsData) {
    console.log("   ✅ Staking position exists:");
    console.log(`   - Principal: ${positionsTotal.toLocaleString()} MKIN`);
    console.log(`   - Pending rewards: ${positionsData.pending_rewards || 0} SOL`);
    console.log(`   - Total claimed: ${positionsData.total_claimed_sol || 0} SOL`);
    console.log(`   - Last stake: ${positionsData.last_stake_time?.toDate()?.toISOString() || "N/A"}`);
    console.log(`   - Locked price: ${positionsData.locked_token_price_sol || 0} SOL/MKIN`);
    console.log(`   - Entry fees paid: ${positionsData.total_entry_fees_sol || 0} SOL`);
  } else {
    console.log("   ❌ No staking position found!");
  }

  // Step 3: Check legacy stakes
  console.log("\n📋 Step 3: Checking legacy stakes (users/{uid}/stakes/)...");
  const legacyStakesRef = db.collection("users").doc(user.firebaseUid).collection("stakes");
  const legacyStakesSnapshot = await legacyStakesRef.get();
  
  let legacyTotal = 0;
  if (!legacyStakesSnapshot.empty) {
    console.log(`   ⚠️  Found ${legacyStakesSnapshot.size} legacy stake(s):`);
    legacyStakesSnapshot.forEach((doc) => {
      const data = doc.data();
      console.log(`   - ${doc.id}: ${data.amount?.toLocaleString()} MKIN (${data.status})`);
      legacyTotal += data.amount || 0;
    });
    console.log(`   Legacy total: ${legacyTotal.toLocaleString()} MKIN`);
  } else {
    console.log("   ⚪ No legacy stakes");
  }

  // Step 4: Check recorded transactions
  console.log("\n📋 Step 4: Checking recorded stake transactions...");
  const txSnapshot = await db.collection(TRANSACTIONS_COLLECTION)
    .where("user_id", "==", user.firebaseUid)
    .where("type", "==", "STAKE")
    .orderBy("timestamp", "desc")
    .limit(10)
    .get();

  if (txSnapshot.empty) {
    console.log("   ⚪ No stake transactions recorded");
  } else {
    console.log(`   Found ${txSnapshot.size} transaction(s):`);
    txSnapshot.forEach((doc) => {
      const data = doc.data();
      const date = data.timestamp?.toDate()?.toISOString() || "N/A";
      console.log(`   - ${doc.id}: ${data.amount_mkin?.toLocaleString()} MKIN (${date})`);
      console.log(`     TX: ${data.signature?.substring(0, 20)}...`);
      console.log(`     Manual credit: ${data.manual_credit ? "YES" : "NO"}`);
    });
  }

  // Step 5: Check wallet mapping
  console.log("\n📋 Step 5: Checking wallet mapping consistency...");
  
  const userRewardsDoc = await db.collection(USER_REWARDS_COLLECTION).doc(user.firebaseUid).get();
  const usersDoc = await db.collection("users").doc(user.firebaseUid).get();
  
  const walletFromUserRewards = userRewardsDoc.exists ? userRewardsDoc.data().walletAddress : null;
  const walletFromUsers = usersDoc.exists ? usersDoc.data().walletAddress : null;

  console.log(`   userRewards wallet: ${walletFromUserRewards || "N/A"}`);
  console.log(`   users wallet: ${walletFromUsers || "N/A"}`);
  console.log(`   Match: ${walletFromUserRewards === walletFromUsers ? "✅" : "❌ MISMATCH"}`);

  // Step 6: Calculate discrepancies
  console.log("\n📋 Step 6: Discrepancy analysis...");
  
  const discrepancy = legacyTotal - positionsTotal;
  console.log(`   Legacy stakes: ${legacyTotal.toLocaleString()} MKIN`);
  console.log(`   Positions total: ${positionsTotal.toLocaleString()} MKIN`);
  console.log(`   Difference: ${discrepancy.toLocaleString()} MKIN`);

  if (discrepancy > 0) {
    console.log("   ⚠️  LEGACY STAKES NOT MIGRATED!");
  } else if (discrepancy < 0) {
    console.log("   ℹ️  Positions higher than legacy (normal if user staked via new system)");
  } else if (legacyTotal === 0 && positionsTotal === 0) {
    console.log("   ❌ NO STAKES FOUND ANYWHERE!");
  } else {
    console.log("   ✅ Amounts match");
  }

  // Step 7: Check global pool
  console.log("\n📋 Step 7: Global pool stats...");
  const poolDoc = await db.collection(POOL_COLLECTION).doc(STAKING_POOL_ID).get();
  if (poolDoc.exists) {
    const poolData = poolDoc.data();
    console.log(`   Total staked: ${poolData.total_staked?.toLocaleString() || 0} MKIN`);
    console.log(`   Reward pool: ${poolData.reward_pool_sol || 0} SOL`);
  }

  // Step 8: Diagnosis & Recommendations
  console.log("\n" + "=".repeat(80));
  console.log("📝 DIAGNOSIS & RECOMMENDATIONS");
  console.log("=".repeat(80));

  if (!positionsData && legacyTotal > 0) {
    console.log("\n🔴 ISSUE: User has legacy stakes but no staking_positions entry");
    console.log("   Fix: Run migration script");
    console.log(`   Command: node scripts/migrate_legacy_stakes.js ${user.firebaseUid}`);
  } else if (discrepancy > 0) {
    console.log("\n🟡 ISSUE: Legacy stakes not fully migrated");
    console.log(`   Missing: ${discrepancy.toLocaleString()} MKIN`);
    console.log("   Fix: Run migration script");
    console.log(`   Command: node scripts/migrate_legacy_stakes.js ${user.firebaseUid}`);
  } else if (!positionsData && legacyTotal === 0) {
    console.log("\n🔴 ISSUE: User has NO stakes recorded anywhere");
    console.log("   Possible causes:");
    console.log("   - User sent tokens but backend verification failed");
    console.log("   - User used wrong wallet address");
    console.log("   - Transaction signatures were never submitted to backend");
    console.log("\n   Next steps:");
    console.log("   1. Ask user for transaction signatures from Solscan");
    console.log("   2. Verify transactions on-chain");
    console.log("   3. Manually credit stakes using credit_missing_stakes.js");
  } else {
    console.log("\n✅ No obvious issues found");
    console.log("   If user still reports missing stakes, check:");
    console.log("   - Frontend is calling correct API endpoint");
    console.log("   - User is authenticated with correct Firebase UID");
    console.log("   - No errors in backend logs during stake verification");
  }

  // Final summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 SUMMARY");
  console.log("=".repeat(80));
  console.log(`Firebase UID: ${user.firebaseUid}`);
  console.log(`Wallet: ${user.walletAddress}`);
  console.log(`Legacy stakes: ${legacyTotal.toLocaleString()} MKIN`);
  console.log(`Positions total: ${positionsTotal.toLocaleString()} MKIN`);
  console.log(`Discrepancy: ${discrepancy.toLocaleString()} MKIN`);
}

diagnose()
  .then(() => {
    console.log("\n✅ Diagnostic complete!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Diagnostic failed:", error);
    process.exit(1);
  });
