#!/usr/bin/env node

/**
 * Test Script: Add Manual Allocation
 * 
 * Manually adds a wallet to the revenue distribution for testing purposes.
 * This bypasses the normal eligibility checks and directly creates an allocation.
 * 
 * Usage:
 *   node test-add-manual-allocation.js <wallet_address> [amount_usd]
 * 
 * Example:
 *   node test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5
 */

import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env') });

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || join(__dirname, '../serviceAccountKey.json');
  
  // Import service account - use file:// URL for ES modules on Windows
  let serviceAccount;
  try {
    // Convert to file:// URL for ES module import (works on all platforms)
    const { pathToFileURL } = await import('url');
    const serviceAccountUrl = pathToFileURL(serviceAccountPath).href;
    serviceAccount = await import(serviceAccountUrl, { assert: { type: 'json' } }).then(m => m.default);
  } catch (importError) {
    // Fallback: try reading as JSON file
    const fs = await import('fs');
    serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  }
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

const db = admin.firestore();

// Configuration
const CONFIG = {
  USER_REWARDS_COLLECTION: 'userRewards',
  ALLOCATIONS_COLLECTION: 'revenue_allocations',
  MKIN_MINT: 'BKDGf6DnDHK87GsZpdWXyBqiNdcNb6KnoFcYbWPUhJLA',
  EMPIRE_MINT: 'EmpirdtfUMfBQXEjnNmTngeimjfizfuSBD3TN9zqzydj',
  // Distribution pool amounts (same as production)
  POOL_SOL: 0.1,      // 0.1 SOL for testing
  POOL_EMPIRE: 100,   // 100 EMPIRE for testing  
  POOL_MKIN: 100,     // 100 MKIN for testing
};

/**
 * Generate distribution ID for current month
 */
function getCurrentDistributionId() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Find or create user by wallet address
 */
async function findOrCreateUser(walletAddress) {
  console.log(`🔍 Looking for user with wallet: ${walletAddress}`);
  
  // Search for existing user
  const usersSnapshot = await db.collection(CONFIG.USER_REWARDS_COLLECTION)
    .where('walletAddress', '==', walletAddress)
    .limit(1)
    .get();
  
  if (!usersSnapshot.empty) {
    const userDoc = usersSnapshot.docs[0];
    console.log(`✅ Found existing user: ${userDoc.id}`);
    return {
      userId: userDoc.id,
      userData: userDoc.data()
    };
  }
  
  // Create new test user
  console.log(`📝 Creating new test user for wallet: ${walletAddress}`);
  const newUserId = `test_${Date.now()}`;
  const newUserData = {
    walletAddress,
    displayName: `Test User ${walletAddress.substring(0, 8)}`,
    totalRealmkin: 1, // At least 1 NFT for eligibility
    createdAt: admin.firestore.Timestamp.now(),
    isTestUser: true,
  };
  
  await db.collection(CONFIG.USER_REWARDS_COLLECTION)
    .doc(newUserId)
    .set(newUserData);
  
  console.log(`✅ Created test user: ${newUserId}`);
  return {
    userId: newUserId,
    userData: newUserData
  };
}

/**
 * Add manual allocation for testing
 */
async function addManualAllocation(walletAddress, amountUsd = 5.0) {
  console.log('\n🧪 TEST SCRIPT: Add Manual Allocation');
  console.log('=' .repeat(80));
  console.log(`Wallet: ${walletAddress}`);
  console.log(`Amount: $${amountUsd}`);
  console.log('=' .repeat(80));
  
  try {
    // Step 1: Find or create user
    const { userId, userData } = await findOrCreateUser(walletAddress);
    
    // Step 2: Get current distribution ID
    const distributionId = getCurrentDistributionId();
    console.log(`\n📅 Distribution ID: ${distributionId}`);
    
    // Step 3: Check if allocation already exists
    const docId = `${userId}_${distributionId}`;
    const existingDoc = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .get();
    
    if (existingDoc.exists && existingDoc.data().claimed) {
      console.log(`⚠️  Allocation already exists and has been claimed!`);
      console.log(`   To test again, clear the allocation first or wait for next month.`);
      return;
    }
    
    if (existingDoc.exists && !existingDoc.data().claimed) {
      console.log(`⚠️  Allocation already exists but not claimed. Using existing allocation.`);
    }
    
    // Step 4: Calculate weight-based shares (assuming 1 NFT for test)
    const nftCount = userData.totalRealmkin || 1;
    const weight = 100; // 100% for single test user
    
    // Calculate shares based on NFT weight
    const solShare = (CONFIG.POOL_SOL * weight) / 100;
    const empireShare = (CONFIG.POOL_EMPIRE * weight) / 100;
    const mkinShare = (CONFIG.POOL_MKIN * weight) / 100;
    
    console.log(`\n💰 Allocation Details:`);
    console.log(`   NFT Count: ${nftCount}`);
    console.log(`   Weight: ${weight}%`);
    console.log(`   SOL: ${solShare.toFixed(6)} SOL`);
    console.log(`   EMPIRE: ${empireShare.toFixed(2)} EMPIRE`);
    console.log(`   MKIN: ${mkinShare.toFixed(2)} MKIN`);
    console.log(`   USD Value: $${amountUsd.toFixed(2)}`);
    
    // Step 5: Create allocation document
    const now = admin.firestore.Timestamp.now();
    const allocationData = {
      userId,
      walletAddress,
      distributionId,
      nftCount,
      weight,
      solShare,
      empireShare,
      mkinShare,
      allocatedAmountUsd: amountUsd,
      eligibleAt: now,
      claimed: false,
      claimedAt: null,
      claimSignature: null,
      isTestAllocation: true,
      createdByScript: true,
      scriptRunAt: now,
    };
    
    console.log(`\n📝 Writing allocation to Firestore...`);
    await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .set(allocationData, { merge: true });
    
    console.log(`✅ Allocation created successfully!`);
    
    // Step 6: Summary
    console.log('\n' + '=' .repeat(80));
    console.log('✅ TEST ALLOCATION COMPLETE');
    console.log('=' .repeat(80));
    console.log(`User ID: ${userId}`);
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Distribution ID: ${distributionId}`);
    console.log(`Allocation Document ID: ${docId}`);
    console.log(`Amount: $${amountUsd.toFixed(2)}`);
    console.log(`\n💡 Next Steps:`);
    console.log(`   1. User can now check eligibility via: GET /api/revenue-distribution/check-eligibility`);
    console.log(`   2. User can claim via: POST /api/revenue-distribution/claim`);
    console.log(`   3. User will receive:`);
    console.log(`      - ${solShare.toFixed(6)} SOL`);
    console.log(`      - ${empireShare.toFixed(2)} EMPIRE`);
    console.log(`      - ${mkinShare.toFixed(2)} MKIN`);
    console.log('=' .repeat(80));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse command line arguments
const walletAddress = process.argv[2];
const amountUsd = parseFloat(process.argv[3]) || 5.0;

if (!walletAddress) {
  console.error('❌ ERROR: Wallet address is required');
  console.log('\nUsage:');
  console.log('  node test-add-manual-allocation.js <wallet_address> [amount_usd]');
  console.log('\nExample:');
  console.log('  node test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5');
  process.exit(1);
}

// Validate wallet address (basic Solana address check)
if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
  console.error('❌ ERROR: Invalid Solana wallet address format');
  process.exit(1);
}

// Run the script
addManualAllocation(walletAddress, amountUsd)
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
