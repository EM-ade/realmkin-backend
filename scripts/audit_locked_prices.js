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

async function auditSpecificUsers() {
  const partialUids = [
    "jDbySdiD", // kristovvvv
    "7qdPA3cZ",
    "LMS", // Prefix search
  ];

  console.log("🔍 Auditing Specific Anomalous Users (Robust)...");

  const snapshot = await db.collection("staking_positions").get();
  const users = snapshot.docs.filter((doc) =>
    partialUids.some((prefix) => doc.id.startsWith(prefix)),
  );

  for (const doc of users) {
    const data = doc.data();
    console.log(`\n👤 User: ${doc.id}`);
    console.log(`Principal: ${data.principal_amount.toLocaleString()} MKIN`);
    console.log(
      `Locked Price (SOL): ${data.locked_token_price_sol || data.token_price_sol}`,
    );

    // Estimate daily reward at 30% APR
    const price = data.locked_token_price_sol || data.token_price_sol || 0;
    const baseDaily = (data.principal_amount * 0.3 * price) / 365;

    // Check for booster
    // We need to fetch from 'staking_users' or just use the field if it's in positions
    // In stakingService.js it was fetched separately. Let's assume 1.0 for now but we know kristov has 3.1
    console.log(`Estimated Daily Reward (Base): ${baseDaily.toFixed(6)} SOL`);

    if (price > 0.0001) {
      const suggestedPrice = 0.0000028; // Average "Correct" price
      const correctedDaily =
        (data.principal_amount * 0.3 * suggestedPrice) / 365;
      console.log(
        `✅ If Corrected Update to ${suggestedPrice}: ${correctedDaily.toFixed(6)} SOL`,
      );
      console.log(
        `🔥 CURRENT OVERPAYMENT: ${(baseDaily - correctedDaily).toFixed(6)} SOL/day`,
      );
    }
  }
}

auditSpecificUsers();
