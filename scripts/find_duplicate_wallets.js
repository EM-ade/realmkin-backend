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

async function findDuplicateWallets() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 FINDING DUPLICATE WALLET ADDRESSES IN userRewards`);
  console.log("=".repeat(80));

  try {
    // Fetch all userRewards documents
    console.log(`\n📊 Fetching all userRewards documents...`);
    const snapshot = await db.collection("userRewards").get();

    if (snapshot.empty) {
      console.log(`❌ No userRewards documents found!`);
      return;
    }

    console.log(`✅ Found ${snapshot.size} total userRewards documents`);

    // Group by wallet address
    const walletMap = new Map();

    snapshot.forEach((doc) => {
      const data = doc.data();
      const walletAddress = data.walletAddress;

      // Skip if no wallet address
      if (!walletAddress) {
        return;
      }

      // Normalize wallet address to lowercase
      const normalizedWallet = walletAddress.toLowerCase();

      if (!walletMap.has(normalizedWallet)) {
        walletMap.set(normalizedWallet, []);
      }

      walletMap.get(normalizedWallet).push({
        userId: doc.id,
        walletAddress: walletAddress, // Keep original case
        totalRealmkin: data.totalRealmkin || 0,
        pendingRewards: data.pendingRewards || 0,
        weeklyRate: data.weeklyRate || 0,
        nftCount: data.nftCount || 0,
        lastUpdate: data.lastUpdate?.toDate() || null,
        createdAt: data.createdAt?.toDate() || null,
      });
    });

    // Filter for duplicates (wallets with more than 1 user)
    const duplicates = Array.from(walletMap.entries()).filter(
      ([_, users]) => users.length > 1
    );

    if (duplicates.length === 0) {
      console.log(`\n✅ No duplicate wallet addresses found!`);
      console.log("=".repeat(80));
      return;
    }

    // Display results
    console.log(`\n⚠️  Found ${duplicates.length} wallet addresses with multiple users:`);
    console.log("=".repeat(80));

    let totalDuplicateUsers = 0;
    duplicates.forEach(([walletAddress, users], index) => {
      totalDuplicateUsers += users.length;

      console.log(`\n${index + 1}. Wallet: ${users[0].walletAddress}`);
      console.log(`   Normalized: ${walletAddress}`);
      console.log(`   Number of users: ${users.length}`);
      console.log(`   Users:`);

      // Sort by totalRealmkin descending
      users.sort((a, b) => b.totalRealmkin - a.totalRealmkin);

      users.forEach((user, userIndex) => {
        console.log(`\n   ${userIndex + 1}. User ID: ${user.userId}`);
        console.log(`      Total MKIN: ${user.totalRealmkin.toLocaleString()}`);
        console.log(`      Pending Rewards: ${user.pendingRewards}`);
        console.log(`      Weekly Rate: ${user.weeklyRate} MKIN/week`);
        console.log(`      NFT Count: ${user.nftCount}`);
        console.log(`      Last Update: ${user.lastUpdate || "N/A"}`);
        console.log(`      Created At: ${user.createdAt || "N/A"}`);
      });

      console.log(`\n   ${"-".repeat(76)}`);
    });

    console.log(`\n${"=".repeat(80)}`);
    console.log(`📊 SUMMARY:`);
    console.log(`   Total wallets with duplicates: ${duplicates.length}`);
    console.log(`   Total duplicate user accounts: ${totalDuplicateUsers}`);
    console.log(`   Average users per duplicate wallet: ${(totalDuplicateUsers / duplicates.length).toFixed(2)}`);
    console.log("=".repeat(80));

    // Calculate total MKIN across duplicates
    let totalMkinInDuplicates = 0;
    duplicates.forEach(([_, users]) => {
      users.forEach((user) => {
        totalMkinInDuplicates += user.totalRealmkin;
      });
    });

    console.log(`\n💰 Total MKIN across all duplicate accounts: ${totalMkinInDuplicates.toLocaleString()}`);
    console.log("=".repeat(80));

  } catch (error) {
    console.error(`\n❌ ERROR during search:`, error);
    console.error(`   Stack:`, error.stack);
  }
}

findDuplicateWallets().catch(console.error);
