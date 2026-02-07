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

async function normalizePrices() {
  const targets = [
    { uid: "jDbySdiDJQQWzZIFEBgn3UpWWUc2", targetPrice: 0.0000028157 }, // kristovvvv (divide by 100)
    { uid: "7qdPA3cZKoNTUeONsX3E5zwFbo63", targetPrice: 0.0000028 }, // (~262x reduction) - FIXED UID (ONsX)
    { uid: "LMSOK0KbD9XAkzrLtWa6f531mPm1", targetPrice: 0.0000028 }, // (~3377x reduction)
  ];

  console.log("🚀 Starting Bulk Price Normalization...");

  for (const target of targets) {
    const docRef = db.collection("staking_positions").doc(target.uid);
    try {
      const doc = await docRef.get();
      if (!doc.exists) {
        console.log(`❌ User not found: ${target.uid}`);
        continue;
      }

      const data = doc.data();
      const oldPrice = data.locked_token_price_sol || data.token_price_sol;

      // Safety check: skip if already normalized
      if (oldPrice < 0.00001 && oldPrice > 0) {
        console.log(
          `👤 User ${target.uid}: Price already normal (${oldPrice}). Skipping.`,
        );
        continue;
      }

      console.log(`\n👤 User: ${target.uid}`);
      console.log(`   Old Price: ${oldPrice}`);
      console.log(`   New Price: ${target.targetPrice}`);

      await docRef.update({
        locked_token_price_sol: target.targetPrice,
        token_price_sol: target.targetPrice,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        normalization_log: {
          previous_price: oldPrice,
          normalized_at: new Date().toISOString(),
        },
      });

      console.log(`   ✅ Normalized!`);
    } catch (err) {
      console.error(`   ❌ Failed for ${target.uid}:`, err.message);
    }
  }
}

normalizePrices();
