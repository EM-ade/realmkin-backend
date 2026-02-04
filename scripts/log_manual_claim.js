import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env") });

const serviceAccountPath = path.join(
  __dirname,
  "../../gatekeeper/serviceAccountKey.json",
);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function main() {
  const userId = "jDbySdiDJQQWzZIFEBgn3UpWWUc2";
  const txSignature =
    "4EtjBqiQH5XPwMTPTGi55Bh8jTERTyghCvLcskggy16As6XxygQ5xo1jGHGqURN32pkHR8tSN7w6jyXb8uLQUcPV";
  const amountSol = 0.436038;
  const now = admin.firestore.Timestamp.now();

  console.log(`🚀 Logging manual claim for user ${userId}...`);

  await db.runTransaction(async (t) => {
    const posRef = db.collection("staking_positions").doc(userId);
    const txRef = db.collection("staking_transactions").doc();

    const posDoc = await t.get(posRef);
    if (!posDoc.exists) throw new Error("Position not found");

    const posData = posDoc.data();

    // Reset pending rewards, update totals
    const newTotalClaimed = (posData.total_claimed_sol || 0) + amountSol;
    const newTotalAccrued = (posData.total_accrued_sol || 0) + amountSol;

    console.log(
      `   Resetting pending_rewards (was ${posData.pending_rewards})`,
    );
    console.log(`   Updating total_claimed_sol to ${newTotalClaimed}`);

    t.update(posRef, {
      pending_rewards: 0,
      total_claimed_sol: newTotalClaimed,
      total_accrued_sol: newTotalAccrued,
      updated_at: now,
    });

    // Create transaction record
    t.set(txRef, {
      user_id: userId,
      type: "CLAIM",
      amount_sol: amountSol,
      fee_tx: "MANUAL_OVERRIDE", // Flagging as manual
      fee_amount_sol: 0,
      fee_amount_usd: 0,
      timestamp: now,
      notes: `Manual transfer tx: ${txSignature}`,
    });
  });

  console.log("✅ Database updated successfully.");
}

main().catch(console.error);
