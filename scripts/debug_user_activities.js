import admin from "firebase-admin";
import axios from "axios";
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
  const targetUsername = "Kristovvvvv"; // Case sensitive? likely stored as is.
  console.log(`Looking for user: ${targetUsername}...`);

  const usersRef = db.collection("users");
  const snapshot = await usersRef.where("username", "==", targetUsername).get();

  if (snapshot.empty) {
    console.error(`User '${targetUsername}' not found in 'users' collection.`);
    // Try lowercase
    const snapshotLower = await usersRef
      .where("username", "==", targetUsername.toLowerCase())
      .get();
    if (snapshotLower.empty) {
      console.error("User not found (lowercase check failed too).");
      process.exit(1);
    }
    console.log("Found user via lowercase match.");
    processUser(snapshotLower.docs[0]);
  } else {
    processUser(snapshot.docs[0]);
  }
}

async function processUser(userDoc) {
  const userData = userDoc.data();
  console.log(`User Found: ${userData.username} (ID: ${userDoc.id})`);

  // Get wallet from 'wallets' collection or userRewards
  let walletAddress = null;

  // Try 'wallets' collection first (reverse lookup if needed, but usually we look up by wallet)
  // But here we have the User ID, we need the wallet.
  // users collection usually has wallet? Or userRewards?

  // Let's check stored data in user doc
  // Inspect user doc for wallet
  if (userData.walletAddress) {
    walletAddress = userData.walletAddress;
    console.log(`Wallet found in user doc: ${walletAddress}`);
  } else {
    // Check userRewards
    const rewardsDoc = await db.collection("userRewards").doc(userDoc.id).get();
    if (rewardsDoc.exists && rewardsDoc.data().walletAddress) {
      walletAddress = rewardsDoc.data().walletAddress;
      console.log(`Wallet found in userRewards: ${walletAddress}`);
    } else {
      // Try to find in wallets collection where uid == userDoc.id
      const walletsRef = db.collection("wallets");
      const walletSnap = await walletsRef
        .where("uid", "==", userDoc.id)
        .limit(1)
        .get();
      if (!walletSnap.empty) {
        walletAddress = walletSnap.docs[0].id;
        console.log(`Wallet found in wallets collection: ${walletAddress}`);
      }
    }
  }

  if (!walletAddress) {
    console.error("Could not find wallet address for user.");
    process.exit(1);
  }

  // Fetch Magic Eden Activities
  console.log(
    `\nFetching Magic Eden activities for wallet: ${walletAddress}...`,
  );
  const collectionSymbol = "the_realmkin"; // known symbol
  const url = `https://api-mainnet.magiceden.dev/v2/wallets/${walletAddress}/activities?limit=500`; // Limit to 500

  try {
    const response = await axios.get(url, {
      headers: { Accept: "application/json" },
      timeout: 30000,
    });

    const activities = response.data;
    console.log(`Fetched ${activities.length} activities.`);

    // Filter for Realmkin
    const realmkinActivities = activities.filter((a) => {
      const sym = a.collection || a.collectionSymbol;
      return sym && sym.toLowerCase().includes(collectionSymbol);
    });

    console.log(
      `Found ${realmkinActivities.length} activities for '${collectionSymbol}'.`,
    );

    console.log("\n--- Activity Log ---");
    let buyNowCount = 0;
    let otherBuyCandidates = 0;

    realmkinActivities.forEach((a) => {
      const isBuyer = a.buyer === walletAddress;
      const type = a.type;
      const date = new Date(a.blockTime * 1000).toISOString();

      if (isBuyer) {
        console.log(
          `[BUYER] Type: ${type}, Date: ${date}, Signature: ${a.signature?.slice(0, 10)}...`,
        );
        if (type === "buyNow") buyNowCount++;
        else otherBuyCandidates++;
      } else if (a.seller === walletAddress) {
        // console.log(`[SELLER] Type: ${type}, Date: ${date}`);
      } else {
        // console.log(`[OTHER] Type: ${type} (Role: ${a.source || 'unknown'}), Date: ${date}`);
      }
    });

    console.log("\n--- Summary ---");
    console.log(`'buyNow' (Standard): ${buyNowCount}`);
    console.log(`Other types where user is buyer: ${otherBuyCandidates}`);
  } catch (err) {
    console.error("Error fetching ME data:", err.message);
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    }
  }
}

main().catch(console.error);
