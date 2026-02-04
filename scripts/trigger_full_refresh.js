import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase
const serviceAccountPath = path.join(
  __dirname,
  "../../gatekeeper/serviceAccountKey.json",
);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function main() {
  console.log("🚀 Starting Full Leaderboard Refresh Trigger...");

  // 1. Delete Metadata to force ALL-TIME fetch
  console.log("🗑️  Deleting _metadata from secondarySaleCache...");
  await db.collection("secondarySaleCache").doc("_metadata").delete();
  console.log("✅ Metadata deleted. Next fetch will be ALL-TIME.");

  // 2. Call the refresh endpoint
  console.log("🔄 Triggering refresh endpoint...");
  try {
    const response = await axios.post(
      "http://localhost:3001/api/revenue-distribution/refresh-secondary-market",
      {
        limit: 500, // Ensure we get enough data
        forceRefresh: true,
      },
    );
    console.log("✅ Refresh triggered successfully!");
    console.log("Response:", response.data);
  } catch (error) {
    console.error("❌ Error triggering refresh:", error.message);
    console.log("⚠️  Make sure the backend server (npm start) is running!");
  }
}

main().catch(console.error);
