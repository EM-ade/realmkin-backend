const admin = require("firebase-admin");
const serviceAccount = require("../firebase-service-account.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function checkRecentClaims() {
  console.log("🔍 Checking recent claim transactions (last 30 days)...");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const claimsSnapshot = await db
      .collection("staking_transactions")
      .where("type", "==", "claim")
      .where("status", "==", "verified") // Assuming 'verified' means success
      .where(
        "created_at",
        ">=",
        admin.firestore.Timestamp.fromDate(thirtyDaysAgo),
      )
      .orderBy("created_at", "desc")
      .limit(50)
      .get();

    if (claimsSnapshot.empty) {
      console.log("❌ No successful claims found in the last 30 days.");
    } else {
      console.log(
        `✅ Found ${claimsSnapshot.size} successful claims in the last 30 days.`,
      );

      let totalClaimed = 0;
      claimsSnapshot.forEach((doc) => {
        const data = doc.data();
        totalClaimed += data.amount_sol || 0; // Assuming amount_sol is the reward
        console.log(
          `   - ${data.created_at.toDate().toISOString()} | User: ${data.firebase_uid.substring(0, 8)}... | Amount: ${data.amount_sol || 0} SOL`,
        );
      });
      console.log(
        `\n💰 Total SOL claimed recently: ${totalClaimed.toFixed(6)} SOL`,
      );
    }
  } catch (error) {
    console.error("Error fetching claims:", error);
  }
}

checkRecentClaims();
