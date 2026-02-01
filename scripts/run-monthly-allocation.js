#!/usr/bin/env node

/**
 * Monthly Revenue Distribution Allocation Script
 * 
 * This script runs the monthly allocation process to identify eligible users
 * who can claim $5 in SOL for the current month.
 * 
 * Eligibility Requirements:
 * - User owns 30+ Realmkin NFTs
 * - User has purchased from Magic Eden secondary market
 * 
 * Usage:
 *   node backend-api/scripts/run-monthly-allocation.js --dry-run
 *   node backend-api/scripts/run-monthly-allocation.js --execute
 * 
 * Options:
 *   --dry-run    Test run without writing to database
 *   --execute    Real run with database writes
 *   --help       Show this help message
 */

import axios from 'axios';
import 'dotenv/config';

const API_BASE_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const SECRET_TOKEN = process.env.REVENUE_DISTRIBUTION_SECRET_TOKEN;

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isExecute = args.includes('--execute');
const showHelp = args.includes('--help') || args.includes('-h');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function showHelpMessage() {
  console.log(`
${colors.bright}Monthly Revenue Distribution Allocation Script${colors.reset}

This script identifies users eligible to claim $5 in SOL for the current month.

${colors.bright}Usage:${colors.reset}
  node backend-api/scripts/run-monthly-allocation.js [OPTIONS]

${colors.bright}Options:${colors.reset}
  --dry-run    Test run without writing to database (safe for testing)
  --execute    Real run with database writes (production)
  --help, -h   Show this help message

${colors.bright}Requirements:${colors.reset}
  - REVENUE_DISTRIBUTION_SECRET_TOKEN environment variable must be set
  - Backend API must be running at ${API_BASE_URL}

${colors.bright}Examples:${colors.reset}
  # Test run (safe, no changes)
  node backend-api/scripts/run-monthly-allocation.js --dry-run

  # Production run
  node backend-api/scripts/run-monthly-allocation.js --execute

${colors.bright}What it does:${colors.reset}
  1. Loads all users with wallet addresses
  2. Filters users with 30+ NFTs
  3. Checks Magic Eden secondary sale history (rate-limited)
  4. Marks eligible users for claiming in current month
  5. Sends Discord notification with results

${colors.bright}Estimated Time:${colors.reset}
  - First run: 10-15 minutes (1000 users)
  - Subsequent runs: 2-5 minutes (with cache)

${colors.bright}Rate Limiting:${colors.reset}
  - Magic Eden API: 20 req/sec, 120 req/min
  - Batch size: 10 users per batch
  - Delay: 6 seconds between batches
  - Safe for production use
`);
}

async function runAllocation() {
  if (!SECRET_TOKEN) {
    log('❌ ERROR: REVENUE_DISTRIBUTION_SECRET_TOKEN not set in environment', 'red');
    log('   Please set this variable in your .env file', 'yellow');
    process.exit(1);
  }

  if (!isDryRun && !isExecute) {
    log('❌ ERROR: Must specify either --dry-run or --execute', 'red');
    log('   Run with --help for usage information', 'yellow');
    process.exit(1);
  }

  log('\n' + '='.repeat(80), 'cyan');
  log('🚀 MONTHLY REVENUE DISTRIBUTION ALLOCATION', 'bright');
  log('='.repeat(80), 'cyan');
  log(`Timestamp: ${new Date().toISOString()}`, 'cyan');
  log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'EXECUTE (will write to database)'}`, isDryRun ? 'yellow' : 'green');
  log(`API URL: ${API_BASE_URL}`, 'cyan');
  log('='.repeat(80) + '\n', 'cyan');

  if (isDryRun) {
    log('⚠️  DRY RUN MODE - No changes will be made to the database', 'yellow');
  } else {
    log('⚠️  EXECUTE MODE - Changes will be written to the database!', 'red');
    log('   Press Ctrl+C within 5 seconds to cancel...', 'yellow');
    await new Promise(resolve => setTimeout(resolve, 5000));
    log('   ✅ Continuing with execution...\n', 'green');
  }

  try {
    const startTime = Date.now();

    log('📡 Calling allocation API endpoint...', 'blue');
    const response = await axios.post(
      `${API_BASE_URL}/api/revenue-distribution/allocate`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${SECRET_TOKEN}`,
        },
        params: {
          dryRun: isDryRun,
        },
        timeout: 1800000, // 30 minutes timeout
      }
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    if (response.data.success) {
      const stats = response.data.stats;

      log('\n' + '='.repeat(80), 'green');
      log('✅ ALLOCATION COMPLETED SUCCESSFULLY', 'green');
      log('='.repeat(80), 'green');
      log(`Distribution ID: ${stats.distributionId}`, 'cyan');
      log(`Total Users: ${stats.totalUsers}`, 'cyan');
      log(`NFT Eligible (30+ NFTs): ${stats.nftEligible}`, 'cyan');
      log(`Final Eligible (with secondary sales): ${stats.eligible}`, 'green');
      log(`Allocation Amount: $${stats.allocatedAmountUsd} per user`, 'cyan');
      log(`Total Allocated: $${stats.totalAllocatedUsd.toFixed(2)} USD`, 'bright');
      log(`Duration: ${duration}s`, 'cyan');
      log(`Dry Run: ${response.data.dryRun ? 'Yes' : 'No'}`, 'cyan');
      log('='.repeat(80) + '\n', 'green');

      // Summary
      if (isDryRun) {
        log('💡 This was a DRY RUN - no data was written', 'yellow');
        log('   Run with --execute to write to database', 'yellow');
      } else {
        log('✅ Allocations have been written to database', 'green');
        log('   Eligible users can now claim via the frontend UI', 'green');
      }

      // Next steps
      log('\n📋 Next Steps:', 'bright');
      if (isDryRun) {
        log('   1. Review the stats above', 'cyan');
        log('   2. Run with --execute to perform real allocation', 'cyan');
      } else {
        log('   1. Check allocation status:', 'cyan');
        log(`      curl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/api/revenue-distribution/allocation-status/${stats.distributionId}`, 'yellow');
        log('   2. Monitor claims via admin dashboard', 'cyan');
        log('   3. Users can now claim via frontend UI', 'cyan');
      }

      // Cache stats reminder
      log('\n📊 Cache Performance:', 'bright');
      log('   First run: ~10-15 minutes', 'cyan');
      log('   Subsequent runs: ~2-5 minutes (80%+ cache hit rate)', 'cyan');
      log('   Check cache stats:', 'cyan');
      log(`   curl -H "Authorization: Bearer $TOKEN" ${API_BASE_URL}/api/revenue-distribution/cache-stats`, 'yellow');

      process.exit(0);
    } else {
      log('\n❌ ALLOCATION FAILED', 'red');
      log(`Error: ${response.data.error}`, 'red');
      process.exit(1);
    }
  } catch (error) {
    log('\n❌ ERROR RUNNING ALLOCATION', 'red');
    
    if (error.response) {
      log(`Status: ${error.response.status}`, 'red');
      log(`Error: ${error.response.data?.error || error.response.statusText}`, 'red');
      
      if (error.response.status === 401) {
        log('\n💡 Tip: Check that REVENUE_DISTRIBUTION_SECRET_TOKEN is correct', 'yellow');
      }
      
      if (error.response.status === 400 && error.response.data?.error?.includes('already executed')) {
        log('\n💡 Allocation already exists for this month', 'yellow');
        log('   This is expected if you already ran allocation this month', 'yellow');
      }
    } else if (error.code === 'ECONNREFUSED') {
      log(`Cannot connect to backend API at ${API_BASE_URL}`, 'red');
      log('Please ensure the backend API is running', 'yellow');
    } else {
      log(error.message, 'red');
    }

    if (error.stack) {
      log('\nStack trace:', 'yellow');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Main execution
if (showHelp) {
  showHelpMessage();
  process.exit(0);
}

runAllocation();
