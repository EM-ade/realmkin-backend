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

async function fixKristovPrice() {
  const targetUid = "jDbySdiDJQQWzZIFEBgn3UpWWUc2";
  const docRef = db.collection("staking_positions").doc(targetUid);

  try {
    const doc = await docRef.get();
    if (!doc.exists) {
      console.log("❌ User not found");
      return;
    }

    const data = doc.data();
    const currentPrice = data.locked_token_price_sol;

    console.log(`🔍 Current Locked Price (SOL): ${currentPrice}`);

    // Safety check: Only fix if it's the expected anomalous value (~0.00028)
    if (currentPrice < 0.0001) {
      console.log(
        "⚠️ Price seems normal (< 0.0001). Aborting fix to prevent double-correction.",
      );
      return;
    }

    const newPrice = currentPrice / 100;
    console.log(`✅ New Corrected Price (SOL): ${newPrice}`);

    // Update
    await docRef.update({
      locked_token_price_sol: newPrice,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log("🚀 Successfully updated locked_token_price_sol.");
  } catch (error) {
    console.error("❌ Fix failed:", error);
  }
}

fixKristovPrice();
