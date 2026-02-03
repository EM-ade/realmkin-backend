import admin from "firebase-admin";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import BoosterService from "../services/boosterService.js";

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Initialize Firebase
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../service-account.json"),
        "utf8",
      ),
    );
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("🔥 Firebase initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Firebase:", error.message);
    process.exit(1);
  }
}

const db = admin.firestore();

async function main() {
  try {
    console.log(
      `\n🚀 Starting GLOBAL Booster Refresh (Round 2 for New Additions)...`,
    );

    const boosterService = new BoosterService();

    // Get all staking positions
    const snapshot = await db.collection("staking_positions").get();

    if (snapshot.empty) {
      console.log("✅ No staking positions found.");
      return;
    }

    console.log(`📊 Found ${snapshot.size} staking positions to check.`);

    let updatedCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;

    for (const doc of snapshot.docs) {
      const uid = doc.id;
      const data = doc.data();
      const oldMultiplier = data.booster_multiplier || 1.0;

      try {
        // Force refresh for this user
        const newBoosters = await boosterService.refreshUserBoosters(uid);

        // Fetch updated doc to compare
        const updatedDoc = await db
          .collection("staking_positions")
          .doc(uid)
          .get();
        const newMultiplier = updatedDoc.data().booster_multiplier;

        const diff = newMultiplier - oldMultiplier;

        if (Math.abs(diff) > 0.0001) {
          console.log(`\n🔄 UPDATED User ${uid}:`);
          console.log(
            `   - Multiplier: ${oldMultiplier.toFixed(4)}x -> ${newMultiplier.toFixed(4)}x`,
          );
          console.log(`   - Boosters Found: ${newBoosters.length}`);
          updatedCount++;
        } else {
          process.stdout.write("."); // Progress dot for unchanged
          unchangedCount++;
        }
      } catch (e) {
        console.error(`\n❌ Failed to refresh user ${uid}: ${e.message}`);
        errorCount++;
      }
    }

    console.log(`\n\n🎉 GLOBAL REFRESH COMPLETE`);
    console.log(`   - Updated/Improved: ${updatedCount}`);
    console.log(`   - Unchanged: ${unchangedCount}`);
    console.log(`   - Errors: ${errorCount}`);
  } catch (error) {
    console.error("❌ Fatal Error:", error);
  } finally {
    process.exit(0);
  }
}

main();
