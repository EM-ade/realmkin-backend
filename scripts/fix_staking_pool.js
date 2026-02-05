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

async function fixStakingPool() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔧 FIXING STAKING POOL TOTALS`);
  console.log("=".repeat(80));

  try {
    await db.runTransaction(async (t) => {
      // ===== PHASE 1: ALL READS FIRST =====

      // 1. Read all staking positions
      console.log(`\n📊 Step 1: Reading all staking positions...`);
      const positionsSnapshot = await t.get(db.collection("staking_positions"));

      const userData = [];
      let totalStaked = 0;

      positionsSnapshot.forEach((doc) => {
        const data = doc.data();
        const principal = data.principal_amount || 0;
        if (principal > 0) {
          totalStaked += principal;
          userData.push({
            userId: doc.id,
            principal: principal,
            oldPending: data.pending_rewards || 0,
            ref: db.collection("staking_positions").doc(doc.id),
          });
        }
      });

      console.log(`✅ Found ${userData.length} users with active stakes`);
      console.log(`   Calculated total staked: ${totalStaked} MKIN`);

      // Show top 5 stakers
      const sortedUsers = [...userData].sort(
        (a, b) => b.principal - a.principal,
      );
      console.log(`\n   Top 5 stakers:`);
      sortedUsers.slice(0, 5).forEach((u, idx) => {
        console.log(
          `     ${idx + 1}. ${u.userId}: ${u.principal.toLocaleString()} MKIN`,
        );
      });

      // 2. Read pool data
      console.log(`\n📊 Step 2: Reading pool data...`);
      const poolRef = db.collection("staking_pool").doc("main_pool");
      const poolDoc = await t.get(poolRef);

      if (!poolDoc.exists) {
        throw new Error("Staking pool not found!");
      }

      const poolData = poolDoc.data();
      const currentTotal = poolData.total_staked || 0;
      const rewardPool = poolData.reward_pool_sol || 0;

      console.log(`   Current pool total: ${currentTotal} MKIN`);
      console.log(`   Reward pool: ${rewardPool} SOL`);
      console.log(`   Difference: ${totalStaked - currentTotal} MKIN`);

      if (Math.abs(totalStaked - currentTotal) < 0.01) {
        console.log(`\n✅ Pool total is already correct! No fix needed.`);
        return;
      }

      // ===== PHASE 2: ALL WRITES =====

      // 3. Update pool total
      console.log(`\n🔧 Step 3: Updating pool total...`);
      t.update(poolRef, {
        total_staked: totalStaked,
        updated_at: admin.firestore.Timestamp.now(),
      });

      console.log(
        `   ✅ Updated pool total: ${currentTotal} → ${totalStaked} MKIN`,
      );

      // 4. Update all users' pending rewards
      console.log(`\n💰 Step 4: Updating pending rewards for all users...`);

      let updatedCount = 0;
      for (const user of userData) {
        // Calculate user's share of reward pool
        const userShare = user.principal / totalStaked;
        const newPendingRewards = userShare * rewardPool;

        // Only update if there's a significant difference
        if (Math.abs(newPendingRewards - user.oldPending) > 0.000001) {
          t.update(user.ref, {
            pending_rewards: newPendingRewards,
            updated_at: admin.firestore.Timestamp.now(),
          });
          updatedCount++;

          if (updatedCount <= 5) {
            console.log(`   Updated ${user.userId}:`);
            console.log(
              `     Principal: ${user.principal.toLocaleString()} MKIN`,
            );
            console.log(`     Share: ${(userShare * 100).toFixed(4)}%`);
            console.log(
              `     Pending: ${user.oldPending.toFixed(9)} → ${newPendingRewards.toFixed(9)} SOL`,
            );
          }
        }
      }

      console.log(`\n   ✅ Updated ${updatedCount} users' pending rewards`);
      if (updatedCount > 5) {
        console.log(`   (Showing first 5 updates only)`);
      }
    });

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ POOL FIX COMPLETE`);
    console.log("=".repeat(80));
  } catch (error) {
    console.error(`\n❌ ERROR:`, error);
    console.error(`   Stack:`, error.stack);
  }
}

fixStakingPool().catch(console.error);
