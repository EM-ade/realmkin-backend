import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("../firebase-service-account.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function calculateFinalReward() {
  const targetUid = "jDbySdiDJQQWzZIFEBgn3UpWWUc2";

  try {
    const posDoc = await db
      .collection("staking_positions")
      .doc(targetUid)
      .get();
    const userDoc = await db.collection("staking_users").doc(targetUid).get();

    // Find first stake transaction
    const txs = await db
      .collection("staking_transactions")
      .where("user_id", "==", targetUid)
      .where("type", "==", "stake")
      .orderBy("timestamp", "asc")
      .limit(1)
      .get();

    let startTime;
    if (!txs.empty) {
      startTime = txs.docs[0].data().timestamp.toMillis();
      console.log(
        `✅ Found original stake date: ${txs.docs[0].data().timestamp.toDate().toISOString()}`,
      );
    } else {
      // Fallback to roughly 43 days ago as discussed
      startTime = Date.now() - 43 * 24 * 3600 * 1000;
      console.log(`⚠️ No stake tx found, using 43-day fallback.`);
    }

    const pos = posDoc.data();
    const userData = userDoc.exists ? userDoc.data() : { totalMiningRate: 1.0 };

    const principal = pos.principal_amount;
    const lockedPrice = pos.locked_token_price_sol;
    const boosterMultiplier = userData.totalMiningRate || 3.1166666666666667; // Use confirmed 3.1x booster

    const principalSol = principal * lockedPrice;

    const ROI_PERCENT = 0.3;
    const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
    const now = Date.now();
    const secondsElapsed = (now - startTime) / 1000;

    const totalPending =
      (principalSol * ROI_PERCENT * boosterMultiplier * secondsElapsed) /
      SECONDS_IN_YEAR;

    console.log(`\n💎 KRISTOVVVV REWARD CALCULATION:`);
    console.log(`Principal: ${principal.toLocaleString()} MKIN`);
    console.log(`Locked Price: ${lockedPrice} SOL`);
    console.log(`Booster: ${boosterMultiplier.toFixed(2)}x`);
    console.log(`Time: ${(secondsElapsed / (24 * 3600)).toFixed(1)} days`);
    console.log(`------------------------------`);
    console.log(`TOTAL REWARD: ${totalPending.toFixed(6)} SOL`);
    console.log(`------------------------------`);
  } catch (error) {
    console.error("Calculation failed:", error);
  }
}

calculateFinalReward();
