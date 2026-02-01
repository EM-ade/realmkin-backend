#!/usr/bin/env node

/**
 * Test Script: Secondary Sale Detection
 * 
 * Tests the secondary sale verification service with sample wallets
 * to ensure Magic Eden API integration works correctly.
 * 
 * Usage:
 *   node backend-api/scripts/test-secondary-sale-detection.js
 */

import 'dotenv/config';
import admin from 'firebase-admin';
import secondarySaleVerificationService from '../services/secondarySaleVerification.js';

// Initialize Firebase (required for Firestore cache)
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
}

// Test wallets (you can add real wallet addresses here)
const TEST_WALLETS = [
  // Add some test wallet addresses here
  // Example: 'ABC123...',
];

console.log('\n' + '='.repeat(80));
console.log('🧪 SECONDARY SALE DETECTION TEST');
console.log('='.repeat(80));
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Test Wallets: ${TEST_WALLETS.length}`);
console.log('='.repeat(80) + '\n');

async function runTests() {
  if (TEST_WALLETS.length === 0) {
    console.log('⚠️  No test wallets provided');
    console.log('   Add wallet addresses to TEST_WALLETS array in this script');
    console.log('   Example usage:\n');
    console.log('   const TEST_WALLETS = [');
    console.log('     "YourWalletAddress1Here",');
    console.log('     "YourWalletAddress2Here",');
    console.log('   ];\n');
    process.exit(0);
  }

  try {
    // Test 1: Check cache stats
    console.log('📊 Test 1: Cache Statistics');
    console.log('-'.repeat(80));
    const cacheStats = await secondarySaleVerificationService.getCacheStats();
    console.log('Cache Stats:', JSON.stringify(cacheStats, null, 2));
    console.log('✅ Cache stats retrieved\n');

    // Test 2: Check individual wallets
    console.log('🔍 Test 2: Individual Wallet Checks');
    console.log('-'.repeat(80));
    
    for (let i = 0; i < TEST_WALLETS.length; i++) {
      const wallet = TEST_WALLETS[i];
      console.log(`\nWallet ${i + 1}/${TEST_WALLETS.length}: ${wallet}`);
      
      const startTime = Date.now();
      const hasSecondary = await secondarySaleVerificationService.hasSecondarySale(wallet);
      const duration = Date.now() - startTime;
      
      console.log(`  Result: ${hasSecondary ? '✅ HAS secondary sales' : '❌ NO secondary sales'}`);
      console.log(`  Duration: ${duration}ms`);
    }

    // Test 3: Batch processing
    if (TEST_WALLETS.length > 1) {
      console.log('\n\n📦 Test 3: Batch Processing');
      console.log('-'.repeat(80));
      
      const startTime = Date.now();
      const results = await secondarySaleVerificationService.batchVerifyUsers(
        TEST_WALLETS,
        (progress) => {
          console.log(`Progress: ${progress.processed}/${progress.total} (${((progress.processed/progress.total)*100).toFixed(1)}%)`);
        }
      );
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      console.log('\nBatch Results:');
      results.forEach((result, i) => {
        console.log(`  ${i + 1}. ${result.wallet.substring(0, 8)}... - ${result.hasSecondarySale ? '✅' : '❌'} ${result.cached ? '(cached)' : '(API)'}`);
      });
      
      console.log(`\nTotal Duration: ${duration}s`);
      console.log(`Average: ${(parseFloat(duration) / TEST_WALLETS.length).toFixed(2)}s per wallet`);
    }

    // Test 4: Cache stats after test
    console.log('\n\n📊 Test 4: Cache Statistics (After Test)');
    console.log('-'.repeat(80));
    const cacheStatsAfter = await secondarySaleVerificationService.getCacheStats();
    console.log('Cache Stats:', JSON.stringify(cacheStatsAfter, null, 2));
    
    const newCacheEntries = cacheStatsAfter.totalCached - cacheStats.totalCached;
    if (newCacheEntries > 0) {
      console.log(`✅ Added ${newCacheEntries} new cache entries`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL TESTS COMPLETED');
    console.log('='.repeat(80));
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run tests
runTests();
