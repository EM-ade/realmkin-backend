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

async function addTestNftStake(walletAddress, nftMint, status = "claimable") {
  try {
    console.log(`\n📝 Adding test NFT stake...`);
    console.log(`   Wallet: ${walletAddress}`);
    console.log(`   NFT Mint: ${nftMint}`);
    console.log(`   Status: ${status}`);

    // Get current stats to calculate reward
    const stakesSnapshot = await db.collection("nft_stakes").get();
    const stakes = stakesSnapshot.docs.map((doc) => doc.data());
    
    const staked = stakes.filter((s) => s.status === "staked").length;
    const claimable = stakes.filter((s) => s.status === "claimable").length;
    
    const TOKEN_POOL = 20000;
    const totalStakedAndClaimable = staked + claimable + 1; // +1 for new NFT
    const rewardPerNft = TOKEN_POOL / totalStakedAndClaimable;

    console.log(`\n💰 Reward Calculation:`);
    console.log(`   Current Staked: ${staked}`);
    console.log(`   Current Claimable: ${claimable}`);
    console.log(`   After Adding: ${totalStakedAndClaimable}`);
    console.log(`   New Reward per NFT: ${rewardPerNft.toFixed(2)} $MKIN`);

    // Create the stake document
    const now = admin.firestore.Timestamp.now();
    const stakeData = {
      walletAddress,
      nftMint,
      status,
      collectionId: "the_realmkin",
      stakedAt: admin.firestore.Timestamp.fromDate(new Date("2026-04-20T00:00:00Z")),
      unlockAt: admin.firestore.Timestamp.fromDate(new Date("2026-04-30T23:59:59Z")),
      finalReward: rewardPerNft,
      estimatedReward: rewardPerNft,
      createdAt: admin.firestore.Timestamp.fromDate(new Date("2026-04-20T00:00:00Z")),
      updatedAt: now,
    };

    // Add to Firestore
    const docRef = await db.collection("nft_stakes").add(stakeData);
    
    console.log(`\n✅ NFT Stake Added Successfully!`);
    console.log(`   Document ID: ${docRef.id}`);
    console.log(`   Reward: ${rewardPerNft.toFixed(2)} $MKIN`);

    // Show updated stats
    console.log(`\n📊 Updated Stats:`);
    const updatedSnapshot = await db.collection("nft_stakes").get();
    const updatedStakes = updatedSnapshot.docs.map((doc) => doc.data());
    
    const updatedStaked = updatedStakes.filter((s) => s.status === "staked").length;
    const updatedClaimable = updatedStakes.filter((s) => s.status === "claimable").length;
    const updatedClaimed = updatedStakes.filter((s) => s.status === "claimed").length;
    const updatedForfeited = updatedStakes.filter((s) => s.status === "forfeited").length;

    console.log(`   Staked: ${updatedStaked}`);
    console.log(`   Claimable: ${updatedClaimable}`);
    console.log(`   Claimed: ${updatedClaimed}`);
    console.log(`   Forfeited: ${updatedForfeited}`);
    console.log(`   Total: ${updatedSnapshot.size}`);

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    process.exit(0);
  }
}

// Get arguments from command line
const args = process.argv.slice(2);
const walletAddress = args[0] || "ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tr";
const nftMint = args[1] || "TEST_NFT_" + Date.now();
const status = args[2] || "claimable";

console.log("🚀 NFT Staking - Add Test NFT");
console.log("=".repeat(60));

addTestNftStake(walletAddress, nftMint, status);
