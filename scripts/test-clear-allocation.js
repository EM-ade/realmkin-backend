#!/usr/bin/env node

/**
 * Test Script: Clear Test Allocation
 * 
 * Removes test allocations from the revenue distribution system.
 * Useful for resetting test state and running new tests.
 * 
 * Usage:
 *   node test-clear-allocation.js <wallet_address>
 *   node test-clear-allocation.js --all-test
 * 
 * Example:
 *   node test-clear-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU
 *   node test-clear-allocation.js --all-test  # Clear all test allocations
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
  const serviceAccount = await import(serviceAccountPath, { assert: { type: 'json' } }).then(m => m.default);
  
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
 * Clear allocation for specific wallet
 */
async function clearAllocationForWallet(walletAddress) {
  console.log('\n🧹 TEST SCRIPT: Clear Allocation');
  console.log('=' .repeat(80));
  console.log(`Wallet: ${walletAddress}`);
  console.log('=' .repeat(80));
  
  try {
    // Find user by wallet
    const usersSnapshot = await db.collection(CONFIG.USER_REWARDS_COLLECTION)
      .where('walletAddress', '==', walletAddress)
      .limit(1)
      .get();
    
    if (usersSnapshot.empty) {
      console.log(`⚠️  No user found with wallet: ${walletAddress}`);
      return;
    }
    
    const userId = usersSnapshot.docs[0].id;
    const distributionId = getCurrentDistributionId();
    const docId = `${userId}_${distributionId}`;
    
    console.log(`\n🔍 Looking for allocation:`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Distribution ID: ${distributionId}`);
    console.log(`   Document ID: ${docId}`);
    
    // Check if allocation exists
    const allocationDoc = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .get();
    
    if (!allocationDoc.exists) {
      console.log(`\n⚠️  No allocation found for this wallet in current distribution period.`);
      return;
    }
    
    const allocationData = allocationDoc.data();
    console.log(`\n📋 Found allocation:`);
    console.log(`   SOL: ${allocationData.solShare?.toFixed(6) || 0} SOL`);
    console.log(`   EMPIRE: ${allocationData.empireShare?.toFixed(2) || 0} EMPIRE`);
    console.log(`   MKIN: ${allocationData.mkinShare?.toFixed(2) || 0} MKIN`);
    console.log(`   Claimed: ${allocationData.claimed ? '✅ Yes' : '❌ No'}`);
    console.log(`   Is Test: ${allocationData.isTestAllocation ? '✅ Yes' : '❌ No'}`);
    
    // Delete the allocation
    console.log(`\n🗑️  Deleting allocation...`);
    await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .doc(docId)
      .delete();
    
    console.log(`✅ Allocation deleted successfully!`);
    
    // Optionally delete test user if created by script
    const userData = usersSnapshot.docs[0].data();
    if (userData.isTestUser && userId.startsWith('test_')) {
      console.log(`\n🗑️  Deleting test user: ${userId}`);
      await db.collection(CONFIG.USER_REWARDS_COLLECTION)
        .doc(userId)
        .delete();
      console.log(`✅ Test user deleted successfully!`);
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('✅ CLEAR COMPLETE');
    console.log('=' .repeat(80));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Clear all test allocations
 */
async function clearAllTestAllocations() {
  console.log('\n🧹 TEST SCRIPT: Clear All Test Allocations');
  console.log('=' .repeat(80));
  
  try {
    // Find all test allocations
    const testAllocationsSnapshot = await db.collection(CONFIG.ALLOCATIONS_COLLECTION)
      .where('isTestAllocation', '==', true)
      .get();
    
    if (testAllocationsSnapshot.empty) {
      console.log(`⚠️  No test allocations found.`);
      return;
    }
    
    console.log(`\n🔍 Found ${testAllocationsSnapshot.size} test allocation(s)`);
    
    // Delete all test allocations
    const batch = db.batch();
    let count = 0;
    
    for (const doc of testAllocationsSnapshot.docs) {
      const data = doc.data();
      console.log(`\n📋 Allocation ${doc.id}:`);
      console.log(`   Wallet: ${data.walletAddress}`);
      console.log(`   Claimed: ${data.claimed ? '✅ Yes' : '❌ No'}`);
      batch.delete(doc.ref);
      count++;
    }
    
    console.log(`\n🗑️  Deleting ${count} test allocation(s)...`);
    await batch.commit();
    console.log(`✅ All test allocations deleted successfully!`);
    
    // Delete test users
    const testUsersSnapshot = await db.collection(CONFIG.USER_REWARDS_COLLECTION)
      .where('isTestUser', '==', true)
      .get();
    
    if (!testUsersSnapshot.empty) {
      console.log(`\n🔍 Found ${testUsersSnapshot.size} test user(s)`);
      const userBatch = db.batch();
      
      for (const doc of testUsersSnapshot.docs) {
        console.log(`   Deleting test user: ${doc.id}`);
        userBatch.delete(doc.ref);
      }
      
      await userBatch.commit();
      console.log(`✅ All test users deleted successfully!`);
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('✅ CLEAR ALL COMPLETE');
    console.log('=' .repeat(80));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Parse command line arguments
const arg = process.argv[2];

if (!arg) {
  console.error('❌ ERROR: Wallet address or --all-test flag is required');
  console.log('\nUsage:');
  console.log('  node test-clear-allocation.js <wallet_address>');
  console.log('  node test-clear-allocation.js --all-test');
  console.log('\nExample:');
  console.log('  node test-clear-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU');
  console.log('  node test-clear-allocation.js --all-test');
  process.exit(1);
}

// Run the script
if (arg === '--all-test') {
  clearAllTestAllocations()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
} else {
  // Validate wallet address
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(arg)) {
    console.error('❌ ERROR: Invalid Solana wallet address format');
    process.exit(1);
  }
  
  clearAllocationForWallet(arg)
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}
