/**
 * Find a user's wallet address by username
 * This script helps you find the wallet address to use with admin-tasks.js
 * 
 * USAGE:
 *   node scripts/find-user-wallet.js <username>
 * 
 * EXAMPLES:
 *   node scripts/find-user-wallet.js miaisobelck10
 *   node scripts/find-user-wallet.js Kristovvvvv
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin
console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function findUser(searchQuery) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 FINDING USER: ${searchQuery}`);
  console.log("=".repeat(80));
  
  try {
    const normalizedQuery = searchQuery.toLowerCase().trim();
    const usersSnapshot = await db.collection("userRewards").get();
    
    console.log(`\n📊 Scanning ${usersSnapshot.size} users...\n`);
    
    const matches = [];
    
    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      const username = (data.username || "").toLowerCase();
      const email = (data.email || "").toLowerCase();
      const emailPrefix = email.split("@")[0];
      const walletAddress = (data.walletAddress || "").toLowerCase();
      
      // Check for matches
      let matchType = null;
      
      if (username === normalizedQuery || emailPrefix === normalizedQuery) {
        matchType = "EXACT";
      } else if (username.includes(normalizedQuery) || emailPrefix.includes(normalizedQuery)) {
        matchType = "PARTIAL";
      } else if (walletAddress === normalizedQuery || walletAddress === searchQuery) {
        matchType = "WALLET";
      } else if (walletAddress.includes(normalizedQuery)) {
        matchType = "WALLET_PARTIAL";
      }
      
      if (matchType) {
        matches.push({
          uid: doc.id,
          username: data.username || "N/A",
          walletAddress: data.walletAddress || "N/A",
          totalRealmkin: data.totalRealmkin || 0,
          email: data.email || "N/A",
          matchType,
        });
      }
    }
    
    if (matches.length === 0) {
      console.log(`❌ No matches found for: ${searchQuery}`);
      return;
    }
    
    // Sort by match type (EXACT first, then PARTIAL, then WALLET matches)
    const matchOrder = { "EXACT": 1, "PARTIAL": 2, "WALLET": 3, "WALLET_PARTIAL": 4 };
    matches.sort((a, b) => matchOrder[a.matchType] - matchOrder[b.matchType]);
    
    console.log(`✅ Found ${matches.length} match(es):\n`);
    
    matches.forEach((match, idx) => {
      console.log(`${"=".repeat(80)}`);
      console.log(`Match #${idx + 1} [${match.matchType}]`);
      console.log(`${"=".repeat(80)}`);
      console.log(`   UID:          ${match.uid}`);
      console.log(`   Username:     ${match.username}`);
      console.log(`   Wallet:       ${match.walletAddress}`);
      console.log(`   Email:        ${match.email}`);
      console.log(`   MKIN Balance: ${match.totalRealmkin.toLocaleString()}`);
      console.log();
    });
    
    console.log(`${"=".repeat(80)}`);
    console.log(`💡 To get this user's staking info, run:`);
    console.log(`   node scripts/admin-tasks.js get-info ${matches[0].walletAddress}`);
    console.log(`   OR`);
    console.log(`   node scripts/admin-tasks.js get-info ${matches[0].username}`);
    console.log(`${"=".repeat(80)}`);
    
  } catch (error) {
    console.error(`❌ Error:`, error.message);
    console.error(`   Stack:`, error.stack);
  }
}

// Main
const searchQuery = process.argv[2];

if (!searchQuery) {
  console.log(`\n❌ Missing search query`);
  console.log(`\nUsage: node scripts/find-user-wallet.js <username|wallet>`);
  console.log(`\nExamples:`);
  console.log(`  node scripts/find-user-wallet.js miaisobelck10`);
  console.log(`  node scripts/find-user-wallet.js Kristovvvvv`);
  console.log(`  node scripts/find-user-wallet.js 0x1234567890abcdef`);
  process.exit(1);
}

findUser(searchQuery).catch(console.error);
