/**
 * Add Test Allocation for Revenue Distribution
 * 
 * Manually creates an allocation for a test wallet
 * Usage: node scripts/add-test-allocation.js
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from realmkin directory (where Firebase creds are)
dotenv.config({ path: path.resolve(__dirname, '../../../realmkin/.env') });

// Initialize Firebase Admin
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    console.error('❌ Missing Firebase credentials in environment variables:');
    console.error(`   FIREBASE_PROJECT_ID: ${projectId ? '✓' : '✗'}`);
    console.error(`   FIREBASE_CLIENT_EMAIL: ${clientEmail ? '✓' : '✗'}`);
    console.error(`   FIREBASE_PRIVATE_KEY: ${privateKey ? '✓' : '✗'}`);
    console.error('\n💡 Make sure .env file exists in gatekeeper directory');
    process.exit(1);
  }

  // Handle case where private key is a JSON blob
  if (privateKey.trim().startsWith('{')) {
    try {
      const json = JSON.parse(privateKey);
      if (json.private_key) {
        privateKey = json.private_key;
        console.log('✓ Extracted private key from JSON blob');
      }
    } catch (e) {
      console.warn('⚠️  Failed to parse FIREBASE_PRIVATE_KEY as JSON, using as-is.');
    }
  }

  // Format private key (replace escaped newlines)
  privateKey = privateKey.replace(/\\n/g, '\n');

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  console.log(`✓ Firebase Admin initialized with project: ${projectId}\n`);
}

const db = admin.firestore();

// Configuration
const TEST_WALLET = 'ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp';
const DISTRIBUTION_ID = 'revenue_dist_2026_02';

// Test allocation amounts (small share)
const TEST_ALLOCATION = {
  amountSol: 0.001,
  amountEmpire: 100,
  amountMkin: 500,
  nftCount: 5, // Simulated NFT count
  weight: 0.001, // Small weight for testing
};

async function addTestAllocation() {
  console.log('🧪 Adding Test Allocation');
  console.log('========================\n');
  console.log(`Wallet: ${TEST_WALLET}`);
  console.log(`Distribution: ${DISTRIBUTION_ID}`);
  console.log(`Amounts:`);
  console.log(`  - SOL: ${TEST_ALLOCATION.amountSol}`);
  console.log(`  - EMPIRE: ${TEST_ALLOCATION.amountEmpire}`);
  console.log(`  - MKIN: ${TEST_ALLOCATION.amountMkin}`);
  console.log(`  - NFT Count: ${TEST_ALLOCATION.nftCount}`);
  console.log(`  - Weight: ${(TEST_ALLOCATION.weight * 100).toFixed(2)}%\n`);

  try {
    // Step 1: Find or create user
    console.log('🔍 Looking up user...');
    
    // Check if wallet mapping exists
    const walletDoc = await db.collection('wallets').doc(TEST_WALLET.toLowerCase()).get();
    
    let userId;
    if (walletDoc.exists) {
      userId = walletDoc.data().uid;
      console.log(`✅ Found existing user: ${userId}`);
    } else {
      console.log('⚠️  Wallet mapping not found in Firebase.');
      console.log('This wallet needs to be connected through the app first.');
      console.log('\nPlease:');
      console.log('1. Connect this wallet in the Realmkin app');
      console.log('2. Run this script again\n');
      return;
    }

    // Step 2: Check if allocation already exists
    const docId = `${userId}_${DISTRIBUTION_ID}`;
    const existingAllocation = await db.collection('revenueDistributionAllocations')
      .doc(docId)
      .get();

    if (existingAllocation.exists) {
      const existing = existingAllocation.data();
      console.log('⚠️  Allocation already exists for this user/distribution:');
      console.log(`   Status: ${existing.status}`);
      console.log(`   SOL: ${existing.amountSol}`);
      console.log(`   EMPIRE: ${existing.amountEmpire}`);
      console.log(`   MKIN: ${existing.amountMkin}`);
      
      const overwrite = process.argv.includes('--overwrite');
      if (!overwrite) {
        console.log('\n💡 To overwrite, run with --overwrite flag\n');
        return;
      }
      console.log('\n🔄 Overwriting existing allocation...');
    }

    // Step 3: Create allocation
    console.log('💾 Creating allocation document...');
    
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
    );

    await db.collection('revenueDistributionAllocations').doc(docId).set({
      distributionId: DISTRIBUTION_ID,
      userId: userId,
      walletAddress: TEST_WALLET,
      nftCount: TEST_ALLOCATION.nftCount,
      weight: TEST_ALLOCATION.weight,
      amountSol: TEST_ALLOCATION.amountSol,
      amountEmpire: TEST_ALLOCATION.amountEmpire,
      amountMkin: TEST_ALLOCATION.amountMkin,
      hasSecondarySale: false, // Testing mode
      allocatedAmountUsd: 5.0, // Legacy field
      eligibleAt: now,
      expiresAt: expiresAt,
      status: 'pending',
      secondarySaleCheckedAt: now,
      testAllocation: true, // Mark as test
    });

    console.log('✅ Test allocation created successfully!\n');
    console.log('📋 Summary:');
    console.log(`   Document ID: ${docId}`);
    console.log(`   Status: pending`);
    console.log(`   Expires: ${new Date(expiresAt.toMillis()).toISOString()}`);
    console.log('\n🎉 User should now be eligible to claim revenue distribution!');
    console.log('   Test by visiting the Account page in the app.\n');

  } catch (error) {
    console.error('❌ Error creating test allocation:', error);
    throw error;
  }
}

// Run
addTestAllocation()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
