const admin = require("firebase-admin");
const serviceAccount = require("../../gatekeeper/serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function inspectUser(usernameFragment) {
  console.log(`\n🔍 Searching for users matching "${usernameFragment}"...`);

  // Search in 'users' collection
  const usersSnap = await db.collection("users").get(); // Get all to filter locally since querying substring is hard
  const matches = [];

  usersSnap.forEach((doc) => {
    const data = doc.data();
    if (
      data.username &&
      data.username.toLowerCase().includes(usernameFragment.toLowerCase())
    ) {
      matches.push({ id: doc.id, ...data });
    }
  });

  if (matches.length === 0) {
    console.log("❌ No matching users found.");
    return;
  }

  for (const user of matches) {
    console.log(`\n👤 User: ${user.username} (ID: ${user.id})`);
    console.log(`   - Wallet: ${user.walletAddress}`);
    console.log(
      `   - Created: ${user.createdAt ? user.createdAt.toDate() : "N/A"}`,
    );
    console.log(`   - MergedInto: ${user.mergedInto || "No"}`);
    console.log(
      `   - MergedAt: ${user.mergedAt ? user.mergedAt.toDate() : "N/A"}`,
    );

    // Check userRewards
    const rewardDoc = await db.collection("userRewards").doc(user.id).get();
    if (rewardDoc.exists) {
      console.log(`   🏆 Rewards:`, rewardDoc.data());
    } else {
      console.log(`   ⚠️ No userRewards document found.`);
    }
  }
}

async function run() {
  await inspectUser("Kristov");
  await inspectUser("Manchester");
}

run();
