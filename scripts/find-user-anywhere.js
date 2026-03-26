/**
 * Find a user across all Firestore collections
 * Searches: userRewards, users, staking_positions, profiles
 * 
 * USAGE:
 *   node scripts/find-user-anywhere.js <username|uid|wallet>
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";

console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function searchAllCollections(query) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔍 COMPREHENSIVE USER SEARCH: ${query}`);
  console.log("=".repeat(80));
  
  const normalizedQuery = query.toLowerCase().trim();
  const results = {
    userRewards: [],
    users: [],
    staking_positions: [],
    profiles: [],
  };
  
  // Search userRewards
  console.log(`\n📊 Searching userRewards collection...`);
  const userRewardsSnap = await db.collection("userRewards").get();
  userRewardsSnap.forEach(doc => {
    const data = doc.data();
    const username = (data.username || "").toLowerCase();
    const email = (data.email || "").toLowerCase().split("@")[0];
    const wallet = (data.walletAddress || "").toLowerCase();
    
    if (username === normalizedQuery || username.includes(normalizedQuery) ||
        email === normalizedQuery || email.includes(normalizedQuery) ||
        wallet === normalizedQuery || wallet.includes(normalizedQuery) ||
        doc.id.toLowerCase() === normalizedQuery) {
      results.userRewards.push({
        uid: doc.id,
        username: data.username || "N/A",
        walletAddress: data.walletAddress || "N/A",
        email: data.email || "N/A",
        totalRealmkin: data.totalRealmkin || 0,
      });
    }
  });
  console.log(`   Found: ${results.userRewards.length} match(es)`);
  
  // Search users collection
  console.log(`\n📊 Searching users collection...`);
  const usersSnap = await db.collection("users").get();
  usersSnap.forEach(doc => {
    const data = doc.data();
    const username = (data.username || "").toLowerCase();
    const email = (data.email || "").toLowerCase().split("@")[0];
    const displayName = (data.displayName || "").toLowerCase();
    const wallet = (data.walletAddress || "").toLowerCase();
    
    if (username === normalizedQuery || username.includes(normalizedQuery) ||
        email === normalizedQuery || email.includes(normalizedQuery) ||
        displayName === normalizedQuery || displayName.includes(normalizedQuery) ||
        wallet === normalizedQuery || wallet.includes(normalizedQuery) ||
        doc.id.toLowerCase() === normalizedQuery) {
      results.users.push({
        uid: doc.id,
        username: data.username || "N/A",
        displayName: data.displayName || "N/A",
        email: data.email || "N/A",
        walletAddress: data.walletAddress || "N/A",
      });
    }
  });
  console.log(`   Found: ${results.users.length} match(es)`);
  
  // Search staking_positions
  console.log(`\n📊 Searching staking_positions collection...`);
  const stakingSnap = await db.collection("staking_positions").get();
  stakingSnap.forEach(doc => {
    if (doc.id.toLowerCase().includes(normalizedQuery)) {
      const data = doc.data();
      results.staking_positions.push({
        uid: doc.id,
        principal: data.principal_amount || 0,
        pendingRewards: data.pending_rewards || 0,
      });
    }
  });
  console.log(`   Found: ${results.staking_positions.length} match(es)`);
  
  // Search profiles
  console.log(`\n📊 Searching profiles collection...`);
  const profilesSnap = await db.collection("profiles").get();
  profilesSnap.forEach(doc => {
    const data = doc.data();
    const username = (data.username || "").toLowerCase();
    const displayName = (data.displayName || "").toLowerCase();
    
    if (username === normalizedQuery || username.includes(normalizedQuery) ||
        displayName === normalizedQuery || displayName.includes(normalizedQuery) ||
        doc.id.toLowerCase() === normalizedQuery) {
      results.profiles.push({
        uid: doc.id,
        username: data.username || "N/A",
        displayName: data.displayName || "N/A",
      });
    }
  });
  console.log(`   Found: ${results.profiles.length} match(es)`);
  
  // Display results
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📋 SEARCH RESULTS`);
  console.log("=".repeat(80));
  
  let totalFound = 0;
  
  if (results.userRewards.length > 0) {
    console.log(`\n✅ userRewards collection:`);
    results.userRewards.forEach((user, idx) => {
      console.log(`   [${idx + 1}] UID: ${user.uid}`);
      console.log(`       Username: ${user.username}`);
      console.log(`       Wallet: ${user.walletAddress}`);
      console.log(`       Email: ${user.email}`);
      console.log(`       MKIN: ${user.totalRealmkin.toLocaleString()}`);
    });
    totalFound += results.userRewards.length;
  }
  
  if (results.users.length > 0) {
    console.log(`\n✅ users collection:`);
    results.users.forEach((user, idx) => {
      console.log(`   [${idx + 1}] UID: ${user.uid}`);
      console.log(`       Username: ${user.username}`);
      console.log(`       Display: ${user.displayName}`);
      console.log(`       Email: ${user.email}`);
      console.log(`       Wallet: ${user.walletAddress}`);
    });
    totalFound += results.users.length;
  }
  
  if (results.staking_positions.length > 0) {
    console.log(`\n✅ staking_positions collection:`);
    results.staking_positions.forEach((pos, idx) => {
      console.log(`   [${idx + 1}] UID: ${pos.uid}`);
      console.log(`       Principal: ${pos.principal.toLocaleString()} MKIN`);
      console.log(`       Pending: ${pos.pendingRewards.toFixed(9)} SOL`);
    });
    totalFound += results.staking_positions.length;
  }
  
  if (results.profiles.length > 0) {
    console.log(`\n✅ profiles collection:`);
    results.profiles.forEach((profile, idx) => {
      console.log(`   [${idx + 1}] UID: ${profile.uid}`);
      console.log(`       Username: ${profile.username}`);
      console.log(`       Display: ${profile.displayName}`);
    });
    totalFound += results.profiles.length;
  }
  
  if (totalFound === 0) {
    console.log(`\n❌ No matches found in any collection`);
    console.log(`\n💡 The user might:`);
    console.log(`   - Not exist yet (never staked/signed up)`);
    console.log(`   - Be in Firebase Auth only (check console)`);
    console.log(`   - Use a different username`);
  } else {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`💡 To get staking info for a user, run:`);
    const firstUser = results.userRewards[0] || results.users[0];
    if (firstUser) {
      console.log(`   node scripts/admin-tasks.js get-info ${firstUser.uid}`);
      console.log(`   OR`);
      console.log(`   node scripts/admin-tasks.js get-info ${firstUser.walletAddress || firstUser.username}`);
    }
    console.log(`${"=".repeat(80)}`);
  }
}

// Main
const searchQuery = process.argv[2];

if (!searchQuery) {
  console.log(`\n❌ Missing search query`);
  console.log(`\nUsage: node scripts/find-user-anywhere.js <username|uid|wallet>`);
  console.log(`\nExamples:`);
  console.log(`  node scripts/find-user-anywhere.js miaisobelck10`);
  console.log(`  node scripts/find-user-anywhere.js Kristovvvvv`);
  console.log(`  node scripts/find-user-anywhere.js 0x1234567890abcdef`);
  process.exit(1);
}

searchAllCollections(searchQuery).catch(console.error);
