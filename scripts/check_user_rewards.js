import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8"),
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const USERS_TO_CHECK = [
  "jDbySdiDJQQWzZIFEBgn3UpWWUc2", // kristovvvv
  "7qdPA3cZKoNTUeONsX3E5zwFbo63", // User 2
  "LMSOK0KbD9XAkzrLtWa6f531mPm1", // User 3
];

async function checkRewards() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 VERIFYING REWARDS FOR AFFECTED USERS`);
  console.log("=".repeat(80));

  try {
    // 1. Get Pool Info
    const poolDoc = await db.collection("staking_pool").doc("main_pool").get();
    const poolData = poolDoc.data();
    const totalStaked = poolData.total_staked || 0;
    const rewardPool = poolData.reward_pool_sol || 0;

    console.log(`\n📊 Current Pool Stats:`);
    console.log(`   Total Staked: ${totalStaked.toLocaleString()} MKIN`);
    console.log(`   Reward Pool: ${rewardPool.toFixed(9)} SOL`);

    // 2. Check Specific Users
    console.log(`\n👥 User Status:`);

    for (const userId of USERS_TO_CHECK) {
      const doc = await db.collection("staking_positions").doc(userId).get();

      if (!doc.exists) {
        console.log(`\n❌ User ${userId}: Position not found`);
        continue;
      }

      const data = doc.data();
      const principal = data.principal_amount || 0;
      const pending = data.pending_rewards || 0;
      const share = (principal / totalStaked) * 100;

      console.log(`\n   User: ${userId}`);
      console.log(`     Principal: ${principal.toLocaleString()} MKIN`);
      console.log(`     Pool Share: ${share.toFixed(4)}%`);
      console.log(`     Pending Rewards: ${pending.toFixed(9)} SOL`);

      // Verify calculation
      const expected = (principal / totalStaked) * rewardPool;
      const diff = Math.abs(pending - expected);
      if (diff < 0.000001) {
        console.log(`     ✅ Calculation verified`);
      } else {
        console.log(`     ⚠️  Mismatch! Expected ${expected.toFixed(9)} SOL`);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

checkRewards().catch(console.error);
