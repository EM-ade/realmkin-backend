import admin from "firebase-admin";
import fs from "fs";

// Initialize Firebase
const serviceAccount = JSON.parse(
  fs.readFileSync("./backend-api/firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function getNftStakingStats() {
  try {
    console.log("📊 Fetching NFT Staking Stats...\n");

    // Get all stakes
    const stakesSnapshot = await db.collection("nft_stakes").get();

    const stakes = stakesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Group by status
    const staked = stakes.filter((s) => s.status === "staked");
    const claimable = stakes.filter((s) => s.status === "claimable");
    const claimed = stakes.filter((s) => s.status === "claimed");
    const forfeited = stakes.filter((s) => s.status === "forfeited");

    // Calculate rewards
    const TOKEN_POOL = 20000;
    const totalStakedAndClaimable = staked.length + claimable.length;
    const rewardPerNft =
      totalStakedAndClaimable > 0 ? TOKEN_POOL / totalStakedAndClaimable : 0;

    const totalClaimableRewards = claimable.reduce((sum, s) => {
      return sum + (s.finalReward || rewardPerNft);
    }, 0);

    const totalClaimedRewards = claimed.reduce((sum, s) => {
      return sum + (s.finalReward || 0);
    }, 0);

    console.log("=".repeat(60));
    console.log("NFT STAKING STATISTICS");
    console.log("=".repeat(60));
    console.log(`\n📈 STAKING STATUS:`);
    console.log(`   Staked NFTs:        ${staked.length}`);
    console.log(`   Claimable NFTs:     ${claimable.length}`);
    console.log(`   Claimed NFTs:       ${claimed.length}`);
    console.log(`   Forfeited NFTs:     ${forfeited.length}`);
    console.log(`   Total NFTs:         ${stakes.length}`);

    console.log(`\n💰 REWARDS:`);
    console.log(`   Token Pool:         ${TOKEN_POOL.toLocaleString()} $MKIN`);
    console.log(
      `   Reward per NFT:     ${rewardPerNft.toFixed(2)} $MKIN (${totalStakedAndClaimable} NFTs)`
    );
    console.log(
      `   Total Claimable:    ${totalClaimableRewards.toFixed(2)} $MKIN`
    );
    console.log(`   Total Claimed:      ${totalClaimedRewards.toFixed(2)} $MKIN`);
    console.log(
      `   Remaining Pool:     ${(TOKEN_POOL - totalClaimedRewards).toFixed(2)} $MKIN`
    );

    console.log(`\n👥 USERS WITH CLAIMABLE REWARDS:`);
    const userClaimable = {};
    claimable.forEach((nft) => {
      if (!userClaimable[nft.walletAddress]) {
        userClaimable[nft.walletAddress] = {
          count: 0,
          total: 0,
        };
      }
      userClaimable[nft.walletAddress].count++;
      userClaimable[nft.walletAddress].total +=
        nft.finalReward || rewardPerNft;
    });

    Object.entries(userClaimable)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .forEach(([wallet, data]) => {
        console.log(
          `   ${wallet.slice(0, 8)}... : ${data.count} NFT(s) = ${data.total.toFixed(2)} $MKIN`
        );
      });

    console.log(`\n👥 USERS WITH CLAIMED REWARDS:`);
    const userClaimed = {};
    claimed.forEach((nft) => {
      if (!userClaimed[nft.walletAddress]) {
        userClaimed[nft.walletAddress] = {
          count: 0,
          total: 0,
        };
      }
      userClaimed[nft.walletAddress].count++;
      userClaimed[nft.walletAddress].total += nft.finalReward || 0;
    });

    Object.entries(userClaimed)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .forEach(([wallet, data]) => {
        console.log(
          `   ${wallet.slice(0, 8)}... : ${data.count} NFT(s) = ${data.total.toFixed(2)} $MKIN`
        );
      });

    console.log("\n" + "=".repeat(60));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

getNftStakingStats();
