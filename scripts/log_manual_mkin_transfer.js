import admin from "firebase-admin";
import dotenv from "dotenv";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// Load environment variables
dotenv.config();

// Initialize Firebase
if (!admin.apps.length) {
  try {
    const serviceAccount = require("../firebase-service-account.json");
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error(
      "Failed to load firebase-service-account.json:",
      error.message,
    );
    process.exit(1);
  }
}

const db = admin.firestore();

async function logManualMkinTransfer() {
  const walletAddress = "AmzZqzfwUoT3AKq1CQDXXKDGaiQue14cyWyiBswpY5Ai";
  const amount = 1622;
  const txSignature =
    "3uLZ4BP1Qg2x3KHEsWrinSH3txrtddH5wBGvXjgsV7rK9raLC9oiUHhT1zDuU7K3QkbPQP3pcVwsYPRwJk1k2qk";
  const now = admin.firestore.Timestamp.now();

  console.log(`🔍 Looking up user with wallet: ${walletAddress}`);

  // 1. Find User ID
  let userId = null;
  const userSnapshot = await db
    .collection("users")
    .where("walletAddress", "==", walletAddress)
    .limit(1)
    .get();

  if (!userSnapshot.empty) {
    userId = userSnapshot.docs[0].id;
    console.log(`✅ Found user in 'users' collection: ${userId}`);
  } else {
    // Try user_rewards
    const rewardSnapshot = await db
      .collection("user_rewards")
      .where("walletAddress", "==", walletAddress)
      .limit(1)
      .get();
    if (!rewardSnapshot.empty) {
      userId = rewardSnapshot.docs[0].id; // Doc ID is usually userId in user_rewards
      console.log(`✅ Found user in 'user_rewards' collection: ${userId}`);
    }
  }

  if (!userId) {
    console.error("❌ Could not find user with this wallet address!");
    process.exit(1);
  }

  // 2. Check for existing pending/failed transaction to update
  console.log(`🔍 Checking for recent transactions for user ${userId}...`);
  const txSnapshot = await db
    .collection("transactions")
    .where("user_id", "==", userId)
    .where("amount", "==", amount) // MKIN amount usually stored as number
    .orderBy("timestamp", "desc")
    .limit(5)
    .get();

  let txDoc = null;

  txSnapshot.forEach((doc) => {
    const data = doc.data();
    console.log(
      `   Found TX: ${doc.id} | Type: ${data.type} | Status: ${data.status} | Amount: ${data.amount}`,
    );

    // Look for a relevant transaction to update (e.g., failed or pending claim/transfer)
    if (
      !txDoc &&
      (data.status === "PENDING" ||
        data.status === "FAILED" ||
        data.type === "CLAIM" ||
        data.type === "WITHDRAWAL" ||
        data.type === "TRANSFER")
    ) {
      txDoc = doc;
    }
  });

  if (txDoc) {
    console.log(`📝 Updating existing transaction ${txDoc.id}...`);
    await txDoc.ref.update({
      status: "COMPLETED",
      tx_signature: txSignature, // Standard field name?
      payout_signature: txSignature, // Alternative field name often used
      updated_at: now,
      manual_retry: true,
    });
    console.log(`✅ Transaction updated successfully!`);
  } else {
    console.log(`Mq Creating NEW transaction record...`);
    await db.collection("transactions").add({
      user_id: userId,
      type: "MANUAL_TRANSFER",
      amount: amount,
      token: "MKIN",
      status: "COMPLETED",
      tx_signature: txSignature,
      payout_signature: txSignature,
      timestamp: now,
      description: "Manual distribution of MKIN tokens",
      wallet_address: walletAddress,
    });
    console.log(`✅ New transaction record created!`);
  }
}

logManualMkinTransfer().catch(console.error);
