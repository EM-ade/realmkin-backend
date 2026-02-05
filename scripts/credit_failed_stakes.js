import admin from "firebase-admin";
import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8"),
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/**
 * Manual stake crediting script for users affected by the fee verification bug
 *
 * This script manually credits stakes to users who:
 * 1. Sent valid token transfers to the vault
 * 2. Paid the correct SOL fees
 * 3. Were rejected due to the minAmountSol = 0 bug
 *
 * IMPORTANT: This script should only be run ONCE per transaction to avoid double-crediting
 */

const POOL_COLLECTION = "staking_pool";
const POSITIONS_COLLECTION = "staking_positions";
const TRANSACTIONS_COLLECTION = "staking_transactions";
const STAKING_POOL_ID = "main_pool";

// Failed stakes to credit (verified transactions)
const FAILED_STAKES = [
  {
    operationId: "STAKE-1770269234500-lxdk8ojkr",
    userId: "7qdPA3cZKoNTUeONsX3E5zwFbo63",
    amount: 45095,
    txSignature:
      "55vXCK1oufU3MQqN3HUPpZMUq8MkTX1fsLthxQnovVVEkFBWbfTq4fL7YpoDmUrbunktS898GzL76Ayk3vmAgShF",
    feeSignature:
      "55vXCK1oufU3MQqN3HUPpZMUq8MkTX1fsLthxQnovVVEkFBWbfTq4fL7YpoDmUrbunktS898GzL76Ayk3vmAgShF",
    feeInSol: 0.009809643,
    feeInMkin: 2254.75,
    timestamp: new Date("2026-02-05T05:27:14.500Z"),
    userWallet: "H6jRGZyLdNfKZtp9S4SsBu79KEvn9FSqb3tWig9d1der",
    mkinPriceUsd: 0.0003943,
    solPriceUsd: 90.63,
  },
  {
    operationId: "STAKE-1770245216802-wexiomagm",
    userId: "jDbySdiDJQQWzZIFEBgn3UpWWUc2",
    amount: 57118,
    txSignature:
      "47kQLahdBCEoAyher2BXmzU6Mg7x47ERPJBAbZGFf3WnUKQy9o71oEsTW1VM1KxkfAkLuFLnXY7nZLYek6Dz37EV",
    feeSignature:
      "47kQLahdBCEoAyher2BXmzU6Mg7x47ERPJBAbZGFf3WnUKQy9o71oEsTW1VM1KxkfAkLuFLnXY7nZLYek6Dz37EV",
    feeInSol: 0.012329258,
    feeInMkin: 2855.9,
    timestamp: new Date("2026-02-04T22:46:56.802Z"),
    userWallet: "C9FtYnGW6MHSBqWLfoQnQtmsS9Mb2mAwbdmEKbvRfTuZ",
    mkinPriceUsd: 0.0003943,
    solPriceUsd: 91.3340767,
  },
  {
    operationId: "STAKE-1770246357797-a9se8u2fh",
    userId: "LMSOK0KbD9XAkzrLtWa6f531mPm1",
    amount: 38316,
    txSignature:
      "2f1BT9yCx7ecdHD2mCTQTg45f7rnAswWSMoJtRLiiuhip1MtAGo3WSajLwp75VcJKCWRVZWrXc47G6vKQHwLXHWW",
    feeSignature:
      "2f1BT9yCx7ecdHD2mCTQTg45f7rnAswWSMoJtRLiiuhip1MtAGo3WSajLwp75VcJKCWRVZWrXc47G6vKQHwLXHWW",
    feeInSol: 0.008368272,
    feeInMkin: 1915.8,
    timestamp: new Date("2026-02-04T23:05:57.797Z"),
    userWallet: "DqaXvrN6vsLBbQ3eQ7kfxefrYe8Efr1tLS6HkDsL2hRD",
    mkinPriceUsd: 0.0003943,
    solPriceUsd: 90.26953042,
  },
];

async function verifyTransactionOnChain(
  txSignature,
  expectedAmount,
  userWallet,
) {
  console.log(`\n🔍 Verifying transaction on-chain: ${txSignature}`);

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  );

  const tx = await connection.getParsedTransaction(txSignature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    console.error(`❌ Transaction not found: ${txSignature}`);
    return false;
  }

  console.log(`✅ Transaction found (slot: ${tx.slot})`);

  // Verify token transfer
  const instructions = tx.transaction.message.instructions;
  let tokenTransferFound = false;
  let solTransferFound = false;

  for (const ix of instructions) {
    if (ix.program === "spl-token" && ix.parsed?.type === "transfer") {
      const amount = parseInt(ix.parsed.info.amount) / 1e9;
      console.log(`  📦 Token transfer: ${amount} MKIN`);
      if (Math.abs(amount - expectedAmount) < 0.01) {
        tokenTransferFound = true;
        console.log(
          `  ✅ Token amount matches expected: ${expectedAmount} MKIN`,
        );
      }
    }

    if (ix.program === "system" && ix.parsed?.type === "transfer") {
      const solAmount = ix.parsed.info.lamports / 1e9;
      console.log(`  💰 SOL transfer: ${solAmount.toFixed(9)} SOL`);
      solTransferFound = true;
    }
  }

  if (!tokenTransferFound) {
    console.error(`❌ Token transfer not found or amount mismatch`);
    return false;
  }

  if (!solTransferFound) {
    console.error(`❌ SOL fee transfer not found`);
    return false;
  }

  console.log(`✅ Transaction verified successfully`);
  return true;
}

async function creditStake(stakeData) {
  const db = admin.firestore();
  const {
    operationId,
    userId,
    amount,
    txSignature,
    feeSignature,
    feeInSol,
    feeInMkin,
    timestamp,
    mkinPriceUsd,
    solPriceUsd,
  } = stakeData;

  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔧 MANUAL STAKE CREDIT: ${operationId}`);
  console.log("=".repeat(80));
  console.log(`User ID: ${userId}`);
  console.log(`Amount: ${amount} MKIN`);
  console.log(`TX Signature: ${txSignature}`);
  console.log(`Fee: ${feeInSol.toFixed(9)} SOL`);

  // 1. Check if already processed
  console.log(`\n📋 Step 1: Checking for duplicate...`);
  const existingTx = await db
    .collection(TRANSACTIONS_COLLECTION)
    .where("signature", "==", txSignature)
    .limit(1)
    .get();

  if (!existingTx.empty) {
    console.log(`⚠️  Transaction already processed! Skipping...`);
    console.log(`   Existing doc ID: ${existingTx.docs[0].id}`);
    return { success: false, reason: "already_processed" };
  }

  // 2. Verify transaction on-chain
  console.log(`\n🔍 Step 2: Verifying transaction on-chain...`);
  const isValid = await verifyTransactionOnChain(
    txSignature,
    amount,
    stakeData.userWallet,
  );

  if (!isValid) {
    console.log(`❌ Transaction verification failed! Skipping...`);
    return { success: false, reason: "verification_failed" };
  }

  // 3. Get current MKIN/SOL price for locked price
  console.log(`\n📊 Step 3: Fetching current token price...`);
  const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
  const tokenPriceSol = await getMkinPriceSOL();
  console.log(`Current MKIN/SOL price: ${tokenPriceSol.toFixed(9)}`);

  // 4. Credit stake in Firestore transaction
  console.log(`\n💾 Step 4: Crediting stake in Firestore...`);

  const now = admin.firestore.Timestamp.now();

  try {
    await db.runTransaction(async (t) => {
      const poolRef = db.collection(POOL_COLLECTION).doc(STAKING_POOL_ID);
      const posRef = db.collection(POSITIONS_COLLECTION).doc(userId);

      const [poolDoc, posDoc] = await Promise.all([
        t.get(poolRef),
        t.get(posRef),
      ]);

      // Get pool data
      let poolData = poolDoc.exists
        ? poolDoc.data()
        : {
            total_staked: 0,
            reward_pool_sol: 0,
            acc_reward_per_share: 0,
            last_reward_time: now,
          };

      // Get position data
      let posData = posDoc.exists
        ? posDoc.data()
        : {
            user_id: userId,
            principal_amount: 0,
            pending_rewards: 0,
            total_accrued_sol: 0,
            total_claimed_sol: 0,
          };

      const previousPrincipal = posData.principal_amount || 0;
      const previousRewardPool = poolData.reward_pool_sol || 0;

      // Add entry fee to reward pool
      poolData.reward_pool_sol = previousRewardPool + feeInSol;

      // Update principal
      posData.principal_amount = previousPrincipal + amount;

      // Set stake times
      if (!posData.stake_start_time) {
        posData.stake_start_time =
          admin.firestore.Timestamp.fromDate(timestamp);
      }
      posData.last_stake_time = admin.firestore.Timestamp.fromDate(timestamp);

      // Set locked token price (weighted average)
      const existingLockedPrice = posData.locked_token_price_sol || 0;
      if (previousPrincipal > 0 && existingLockedPrice > 0) {
        posData.locked_token_price_sol =
          (existingLockedPrice * previousPrincipal + tokenPriceSol * amount) /
          posData.principal_amount;
      } else {
        posData.locked_token_price_sol = tokenPriceSol;
      }

      // Update pool total
      poolData.total_staked = (poolData.total_staked || 0) + amount;
      poolData.last_reward_time = now;
      poolData.updated_at = now;

      // Track entry fees
      posData.total_entry_fees_sol =
        (posData.total_entry_fees_sol || 0) + feeInSol;
      posData.total_entry_fees_mkin_value =
        (posData.total_entry_fees_mkin_value || 0) + feeInMkin;
      posData.updated_at = now;

      console.log(
        `  📊 Pool: ${poolData.total_staked} MKIN total (+${amount})`,
      );
      console.log(
        `  📊 Reward pool: ${poolData.reward_pool_sol.toFixed(9)} SOL (+${feeInSol.toFixed(9)})`,
      );
      console.log(
        `  📊 User principal: ${posData.principal_amount} MKIN (+${amount})`,
      );

      // Write pool data
      t.set(poolRef, poolData);

      // Write position data
      t.set(posRef, posData);

      // Log transaction
      const txRef = db.collection(TRANSACTIONS_COLLECTION).doc();
      const txData = {
        user_id: userId,
        type: "STAKE",
        amount_mkin: amount,
        signature: txSignature,
        fee_tx: feeSignature,
        fee_amount_sol: feeInSol,
        fee_amount_mkin_value: feeInMkin,
        fee_percent: 5,
        mkin_price_usd: mkinPriceUsd,
        sol_price_usd: solPriceUsd,
        timestamp: admin.firestore.Timestamp.fromDate(timestamp),
        manual_credit: true,
        manual_credit_reason: "Fee verification bug - minAmountSol = 0",
        manual_credit_timestamp: now,
        operation_id: operationId,
      };
      t.set(txRef, txData);

      console.log(`  ✅ All writes queued for atomic commit`);
    });

    console.log(`✅ STAKE CREDITED SUCCESSFULLY!`);
    console.log(`   User: ${userId}`);
    console.log(`   Amount: ${amount} MKIN`);
    console.log(`   Fee: ${feeInSol.toFixed(9)} SOL added to reward pool`);

    return { success: true };
  } catch (error) {
    console.error(`❌ FIRESTORE TRANSACTION FAILED!`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return { success: false, reason: "firestore_error", error: error.message };
  }
}

async function main() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔧 MANUAL STAKE CREDITING SCRIPT`);
  console.log(`   Reason: Fee verification bug (minAmountSol = 0)`);
  console.log(`   Stakes to credit: ${FAILED_STAKES.length}`);
  console.log("=".repeat(80));

  const results = [];

  for (const stake of FAILED_STAKES) {
    const result = await creditStake(stake);
    results.push({
      operationId: stake.operationId,
      userId: stake.userId,
      amount: stake.amount,
      ...result,
    });
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 SUMMARY`);
  console.log("=".repeat(80));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log(`\n✅ Successfully credited stakes:`);
    successful.forEach((r) => {
      console.log(
        `   - ${r.operationId}: ${r.amount} MKIN to user ${r.userId}`,
      );
    });
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed to credit:`);
    failed.forEach((r) => {
      console.log(`   - ${r.operationId}: ${r.reason} (${r.error || "N/A"})`);
    });
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`🎉 SCRIPT COMPLETED`);
  console.log("=".repeat(80));
}

main().catch(console.error);
