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

async function checkClaimedNfts(walletAddress) {
  try {
    console.log(`\n🔍 Checking claimed NFTs for wallet: ${walletAddress}\n`);

    // Get all stakes for this wallet
    const stakesSnapshot = await db
      .collection("nft_stakes")
      .where("walletAddress", "==", walletAddress)
      .get();

    const stakes = stakesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    console.log(`📊 Total Stakes: ${stakes.length}\n`);

    // Group by status
    const byStatus = {};
    stakes.forEach((stake) => {
      if (!byStatus[stake.status]) {
        byStatus[stake.status] = [];
      }
      byStatus[stake.status].push(stake);
    });

    // Display by status
    Object.entries(byStatus).forEach(([status, nfts]) => {
      console.log(`${status.toUpperCase()} (${nfts.length}):`);
      nfts.forEach((nft) => {
        console.log(
          `  - ${nft.nftMint.slice(0, 8)}... | Reward: ${nft.finalReward || 0}`
        );
      });
      console.log();
    });

    // Check if claimed NFTs can be staked again
    if (byStatus.claimed && byStatus.claimed.length > 0) {
      console.log("✅ Claimed NFTs found - they should appear in available NFTs");
      console.log(
        "   (Only 'staked' and 'claimable' are excluded from available)\n"
      );
    }

  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    process.exit(0);
  }
}

// Get wallet from command line or use default
const walletAddress = process.argv[2] || "ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tr";

console.log("🚀 Check Claimed NFTs");
console.log("=".repeat(60));

checkClaimedNfts(walletAddress);
