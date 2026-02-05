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

const USER_ID = "jDbySdiDJQQWzZIFEBgn3UpWWUc2";

async function investigateUser() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 INVESTIGATING USER: ${USER_ID}`);
  console.log(`   Username: kristovvvv`);
  console.log("=".repeat(80));

  try {
    // 1. Check staking position
    console.log(`\n📊 Step 1: Checking staking position...`);
    const posDoc = await db.collection("staking_positions").doc(USER_ID).get();

    if (!posDoc.exists) {
      console.log(`❌ No staking position found!`);
    } else {
      const posData = posDoc.data();
      console.log(`✅ Staking position found:`);
      console.log(`   Principal: ${posData.principal_amount || 0} MKIN`);
      console.log(`   Pending rewards: ${posData.pending_rewards || 0} SOL`);
      console.log(`   Total accrued: ${posData.total_accrued_sol || 0} SOL`);
      console.log(`   Total claimed: ${posData.total_claimed_sol || 0} SOL`);
      console.log(
        `   Locked token price: ${posData.locked_token_price_sol || 0} SOL`,
      );
      console.log(
        `   Stake start: ${posData.stake_start_time?.toDate() || "N/A"}`,
      );
      console.log(
        `   Last stake: ${posData.last_stake_time?.toDate() || "N/A"}`,
      );
      console.log(`   Last update: ${posData.updated_at?.toDate() || "N/A"}`);

      if (posData.active_boosters) {
        console.log(`   Active boosters: ${posData.active_boosters.length}`);
        posData.active_boosters.forEach((b) => {
          console.log(
            `     - ${b.name}: ${b.multiplier}x (${b.mints?.length || 0} NFTs)`,
          );
        });
      }

      if (posData.booster_multiplier) {
        console.log(`   Booster multiplier: ${posData.booster_multiplier}x`);
      }
    }

    // 2. Check user rewards
    console.log(`\n💰 Step 2: Checking user rewards...`);
    const rewardsDoc = await db.collection("userRewards").doc(USER_ID).get();

    if (!rewardsDoc.exists) {
      console.log(`❌ No user rewards found!`);
    } else {
      const rewardsData = rewardsDoc.data();
      console.log(`✅ User rewards found:`);
      console.log(`   Wallet: ${rewardsData.walletAddress || "N/A"}`);
      console.log(`   Total MKIN: ${rewardsData.totalRealmkin || 0}`);
      console.log(`   Pending rewards: ${rewardsData.pendingRewards || 0}`);
      console.log(`   Weekly rate: ${rewardsData.weeklyRate || 0} MKIN/week`);
      console.log(`   NFT count: ${rewardsData.nftCount || 0}`);
      console.log(
        `   Last update: ${rewardsData.lastUpdate?.toDate() || "N/A"}`,
      );
    }

    // 3. Check staking pool
    console.log(`\n🏊 Step 3: Checking staking pool...`);
    const poolDoc = await db.collection("staking_pool").doc("main_pool").get();

    if (!poolDoc.exists) {
      console.log(`❌ No staking pool found!`);
    } else {
      const poolData = poolDoc.data();
      console.log(`✅ Staking pool found:`);
      console.log(`   Total staked: ${poolData.total_staked || 0} MKIN`);
      console.log(`   Reward pool: ${poolData.reward_pool_sol || 0} SOL`);
      console.log(
        `   Acc reward per share: ${poolData.acc_reward_per_share || 0}`,
      );
      console.log(
        `   Last reward time: ${poolData.last_reward_time?.toDate() || "N/A"}`,
      );
      console.log(`   Updated at: ${poolData.updated_at?.toDate() || "N/A"}`);
    }

    // 4. Check recent staking transactions
    console.log(`\n📜 Step 4: Checking recent staking transactions...`);
    const txSnapshot = await db
      .collection("staking_transactions")
      .where("user_id", "==", USER_ID)
      .orderBy("timestamp", "desc")
      .limit(5)
      .get();

    if (txSnapshot.empty) {
      console.log(`❌ No staking transactions found!`);
    } else {
      console.log(`✅ Found ${txSnapshot.size} recent transactions:`);
      txSnapshot.forEach((doc, idx) => {
        const tx = doc.data();
        console.log(`\n   Transaction ${idx + 1}:`);
        console.log(`     Type: ${tx.type}`);
        console.log(`     Amount: ${tx.amount_mkin || 0} MKIN`);
        console.log(`     Signature: ${tx.signature}`);
        console.log(`     Timestamp: ${tx.timestamp?.toDate() || "N/A"}`);
        console.log(`     Manual credit: ${tx.manual_credit || false}`);
        if (tx.manual_credit_reason) {
          console.log(`     Reason: ${tx.manual_credit_reason}`);
        }
      });
    }

    // 5. Calculate expected rewards
    console.log(`\n🧮 Step 5: Calculating expected rewards...`);
    if (posDoc.exists && poolDoc.exists) {
      const posData = posDoc.data();
      const poolData = poolDoc.data();

      const principal = posData.principal_amount || 0;
      const totalStaked = poolData.total_staked || 1; // Avoid division by zero
      const rewardPool = poolData.reward_pool_sol || 0;

      const userShare = principal / totalStaked;
      const expectedRewards = userShare * rewardPool;

      console.log(`   User principal: ${principal} MKIN`);
      console.log(`   Total staked: ${totalStaked} MKIN`);
      console.log(`   User share: ${(userShare * 100).toFixed(4)}%`);
      console.log(`   Reward pool: ${rewardPool} SOL`);
      console.log(`   Expected rewards: ${expectedRewards.toFixed(9)} SOL`);
      console.log(`   Actual pending: ${posData.pending_rewards || 0} SOL`);

      const difference = expectedRewards - (posData.pending_rewards || 0);
      if (Math.abs(difference) > 0.000001) {
        console.log(`   ⚠️  MISMATCH: ${difference.toFixed(9)} SOL difference`);
      } else {
        console.log(`   ✅ Rewards match expected value`);
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ INVESTIGATION COMPLETE`);
    console.log("=".repeat(80));
  } catch (error) {
    console.error(`\n❌ ERROR during investigation:`, error);
    console.error(`   Stack:`, error.stack);
  }
}

investigateUser().catch(console.error);
