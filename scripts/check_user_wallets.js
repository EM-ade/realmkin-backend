import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
  const targetUid = "jDbySdiDJQQWzZIFEBgn3UpWWUc2"; // Kristovvvvv's ID
  console.log(`Checking wallets for User UID: ${targetUid}`);

  const walletsRef = db.collection("wallets");

  // Try 'uid' field
  let snapshot = await walletsRef.where("uid", "==", targetUid).get();

  if (snapshot.empty) {
    console.log("No wallets found with field 'uid' matching.");
    // Try 'userId' field (legacy?)
    snapshot = await walletsRef.where("userId", "==", targetUid).get();
  }

  if (snapshot.empty) {
    console.log("No wallets found linked to this UID.");
  } else {
    console.log(`Found ${snapshot.size} linked wallets:`);
    snapshot.forEach((doc) => {
      console.log(` - Wallet Address: ${doc.id}, Data:`, doc.data());
    });
  }
}

main().catch(console.error);
