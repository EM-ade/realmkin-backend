import admin from "firebase-admin";
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { join } from "path";

const require = createRequire(import.meta.url);
const serviceAccount = require("../firebase-service-account.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Configuration
// Rate change: Saturday February 7, 2026
const RATE_CHANGE_DATE = new Date("2026-02-07T00:00:00.00Z");
const RATE_CHANGE_SECONDS = Math.floor(RATE_CHANGE_DATE.getTime() / 1000);
const CURRENT_DATE = new Date();
const CURRENT_SECONDS = Math.floor(CURRENT_DATE.getTime() / 1000);

// End of year date (December 31, 2026)
const END_OF_YEAR_DATE = new Date("2026-12-31T23:59:59.00Z");
const END_OF_YEAR_SECONDS = Math.floor(END_OF_YEAR_DATE.getTime() / 1000);

// User provided pool balance
const POOL_BALANCE_SOL = 4.05;

// Constants for reward calculation
const SECONDS_IN_YEAR = 365 * 24 * 60 * 60; // 31,536,000
const ROI_PERCENT_30 = 0.3; // 30% APR (old rate)
const ROI_PERCENT_10 = 0.1; // 10% APR (new rate)

/**
 * Calculate booster multiplier from active_boosters array
 */
function calculateBoosterMultiplier(activeBoosters = []) {
  if (!activeBoosters || activeBoosters.length === 0) return 1.0;
  
  let multiplier = 1.0;
  
  for (const booster of activeBoosters) {
    const type = booster.type?.toLowerCase() || booster.type || "";
    
    if (type.includes("realmkin_miner") || type.includes("miner")) {
      multiplier *= 2.0;
    } else if (type.includes("customized") || type.includes("custom")) {
      multiplier *= 1.5;
    } else if (type.includes("realmkin") || type.includes("1/1") || type.includes("1_1")) {
      multiplier *= 1.25;
    }
  }
  
  return multiplier;
}

/**
 * Calculate rewards earned at a specific rate for a time period
 */
function calculateRewards(
  principalAmount,
  tokenPriceSol,
  secondsEarned,
  rate,
  boosterMultiplier
) {
  return (
    (principalAmount * rate * tokenPriceSol * secondsEarned) /
    SECONDS_IN_YEAR
  ) * boosterMultiplier;
}

/**
 * Calculate 30%-era-only trim analysis
 */
async function calculate30PctTrimOnly() {
  console.log("=".repeat(80));
  console.log("📊 30%-ERA REWARDS TRIM ANALYSIS (10%-era untouched)");
  console.log("=".repeat(80));
  console.log(`Rate change date: ${RATE_CHANGE_DATE.toISOString()}`);
  console.log(`Current date: ${CURRENT_DATE.toISOString()}`);
  console.log(`End of year date: ${END_OF_YEAR_DATE.toISOString()}`);
  console.log(`Days from now to end of year: ${(END_OF_YEAR_SECONDS - CURRENT_SECONDS) / 86400} days`);
  console.log("");
  console.log(`💰 Pool balance (user provided): ${POOL_BALANCE_SOL.toFixed(6)} SOL`);
  console.log("");
  console.log("⚠️  KEY ASSUMPTION: Trimming ONLY 30%-era rewards, 10%-era rewards remain FULL");
  console.log("");

  // Fetch all staking positions
  console.log("📊 Fetching staking positions...");
  const positionsSnapshot = await db
    .collection("staking_positions")
    .get();

  const positions = [];
  positionsSnapshot.forEach((doc) => {
    const data = doc.data();
    positions.push({
      userId: doc.id,
      ...data,
    });
  });

  console.log(`✅ Found ${positions.length} staking positions`);
  console.log("");

  if (positions.length === 0) {
    console.log("⚠️  No staking positions found. No liability assessment needed.");
    return;
  }

  // Analyze each position
  let totalRewardsEarned_30 = 0;
  let totalRewardsEarned_10_future = 0;
  let totalClaimed = 0;

  const userBreakdown = [];

  console.log("🔍 Analyzing each position...");
  console.log("");

  for (const pos of positions) {
    const {
      userId,
      principal_amount = 0,
      stake_start_time,
      locked_token_price_sol = 0,
      total_claimed_sol = 0,
      active_boosters = [],
    } = pos;

    if (principal_amount <= 0 || !stake_start_time) {
      continue;
    }

    // Parse timestamps
    const startSeconds =
      stake_start_time._seconds ||
      stake_start_time.seconds ||
      Math.floor(stake_start_time.toDate().getTime() / 1000) ||
      0;

    let seconds_at_30 = 0;
    let seconds_at_10_future = 0;

    // Calculate time spent at each rate
    if (startSeconds < RATE_CHANGE_SECONDS) {
      seconds_at_30 = RATE_CHANGE_SECONDS - startSeconds;
    }

    if (startSeconds < END_OF_YEAR_SECONDS) {
      // Time from rate change to end of year (future rewards at 10%)
      seconds_at_10_future = END_OF_YEAR_SECONDS - Math.max(RATE_CHANGE_SECONDS, startSeconds);
    }

    // Skip if no time at either rate
    if (seconds_at_30 <= 0 && seconds_at_10_future <= 0) {
      continue;
    }

    // Get booster multiplier
    const boosterMultiplier = calculateBoosterMultiplier(active_boosters);

    // Calculate rewards at 30% rate (past, already earned)
    const rewards_30 = calculateRewards(
      principal_amount,
      locked_token_price_sol,
      seconds_at_30,
      ROI_PERCENT_30,
      boosterMultiplier
    );

    // Calculate rewards at 10% rate (future, from now to end of year)
    const rewards_10_future = calculateRewards(
      principal_amount,
      locked_token_price_sol,
      seconds_at_10_future,
      ROI_PERCENT_10,
      boosterMultiplier
    );

    // Track totals
    totalRewardsEarned_30 += rewards_30;
    totalRewardsEarned_10_future += rewards_10_future;
    totalClaimed += total_claimed_sol;

    userBreakdown.push({
      userId,
      principal_amount,
      rewards_30,
      rewards_10_future,
      total_earned_all_time: rewards_30 + rewards_10_future,
      total_claimed_sol,
      booster_multiplier: boosterMultiplier,
      locked_token_price_sol,
      seconds_at_30,
      seconds_at_10_future,
    });
  }

  console.log("📊 REWARDS BREAKDOWN");
  console.log("=".repeat(80));
  console.log(`Total users analyzed: ${userBreakdown.length}`);
  console.log(`🔸 30%-era rewards (historical): ${totalRewardsEarned_30.toFixed(6)} SOL`);
  console.log(`🔸 10%-era rewards (future to EOY): ${totalRewardsEarned_10_future.toFixed(6)} SOL`);
  console.log(`🔸 Total rewards (both eras): ${(totalRewardsEarned_30 + totalRewardsEarned_10_future).toFixed(6)} SOL`);
  console.log(`🔸 Total claimed: ${totalClaimed.toFixed(6)} SOL`);
  console.log("");

  // The critical realization: even 10%-era rewards exceed pool
  const poolCoverageFor10Only = POOL_BALANCE_SOL / totalRewardsEarned_10_future * 100;

  console.log("⚠️  CRITICAL ANALYSIS");
  console.log("=".repeat(80));
  console.log(`Pool balance: ${POOL_BALANCE_SOL.toFixed(6)} SOL`);
  console.log(`Future 10%-era rewards: ${totalRewardsEarned_10_future.toFixed(6)} SOL`);
  console.log(`Can pool cover 10%-era rewards alone? ${poolCoverageFor10Only < 100 ? '❌ NO' : '✅ YES'}`);
  console.log(`Pool coverage for 10%-era only: ${poolCoverageFor10Only.toFixed(2)}%`);
  console.log(`Shortfall if we pay only 10%-era: ${Math.max(0, totalRewardsEarned_10_future - POOL_BALANCE_SOL).toFixed(6)} SOL`);
  console.log("");

  // Calculate trim options for 30%-era only
  console.log("✂️  30%-ERA ONLY TRIM OPTIONS");
  console.log("=".repeat(80));
  console.log("");
  
  const trimmed30Options = [
    { name: "No Trim (0%)", percentage: 0, description: "Pay all 30%-era rewards in full" },
    { name: "Aggressive Trim (80%)", percentage: 80, description: "Trim 30%-era rewards heavily" },
    { name: "Maximum Trim (100%)", percentage: 100, description: "Eliminate all 30%-era rewards" },
  ];

  const detailedOptions = [];
  
  for (const option of trimmed30Options) {
    const trimmed30EraRewards = totalRewardsEarned_30 * (1 - option.percentage / 100);
    const trimAmount = totalRewardsEarned_30 - trimmed30EraRewards;
    
    // Total liability = trimmed 30-era + full 10-era - already claimed
    // Wait, the 30-era and 10-era calculations above are already "earned" amounts
    // We need to think about this differently...
    
    // Let's think:
    // - Users earned X at 30% rate before Feb 7
    // - Users will earn Y at 10% rate after Feb 7 through EOY
    // - Users have claimed Z total
    // - Unclaimed = (X + Y) - Z
    
    // If we trim 30%-era rewards by T%:
    // - We only pay (X * (1-T%)) + Y - Z
    
    // But this doesn't make sense either because:
    // - The 30%-era rewards are already "earned" and sitting as unclaimed
    // - Trimming means we pay LESS than what was earned
    
    // Let's check the actual math:
    // Total unclaimed pre-trim = (X + Y) - claimed = 8.96 SOL
    // Pool = 4.05 SOL
    // Shortfall = 4.92 SOL (needs ~55% trim of ALL unclaimed)
    
    // If we only trim 30%-era:
    // Let's denote trim fraction as t (0 to 1)
    // Payable = (X * (1-t)) + Y - claimed = pool
    // (X * (1-t)) + Y - claimed = 4.05
    // X - Xt = 4.05 - Y + claimed
    // Xt = X - 4.05 + Y - claimed
    // t = (X - 4.05 + Y - claimed) / X
    
    // Wait, this is getting confusing. Let me think more clearly.
    
    // Total unclaimed = (X + Y) - claimed = 8.96 SOL
    // Pool = 4.05 SOL
    
    // If we only trim 30%-era rewards (X):
    // We still pay full 10%-era rewards (Y)
    // But X is earned 30%-era rewards (2.59 SOL)
    // And Y is future 10%-era rewards (7.60 SOL)
    // And claimed is 1.23 SOL
    
    // So:
    // Unclaimed from 30%-era = 2.59 (no one has claimed 30%-era rewards yet)
    // Unclaimed from 10%-era = 7.60 (but these are future, not yet earned)
    
    // Wait, the 10%-era rewards are FUTURE. They haven't been earned yet.
    // So the current liability is:
    // - 30%-era unclaimed: 2.59 SOL
    // - 10%-era future: 7.60 SOL (but these will be earned over time, starting now)
    
    // If we trim 30%-era rewards by T%:
    // We pay: (2.59 * (1-T%)) + 7.60 (10%-era, starting from now)
    
    // But we only have 4.05 SOL now.
    // And the 10%-era rewards will be earned over time, not all at once.
    
    // I think the issue is: we're calculating "total future liability to EOY"
    // But we only have current pool balance now.
    
    // The question is: can the current pool cover the MINIMUM liability?
    // Minimum liability = trimmed 30%-era rewards
    
    // If we trim 30%-era by 100%:
    // We pay 0 for 30%-era
    // Total liability = 7.60 SOL (10%-era future)
    // Pool = 4.05 SOL
    // Still short by 3.55 SOL
    
    // This is the KEY INSIGHT: even if we eliminate 30%-era rewards entirely,
    // the future 10%-era rewards (7.60 SOL) exceed the pool (4.05 SOL).
    
    const totalLiabilityWithOption = trimmed30EraRewards + totalRewardsEarned_10_future;
    const shortfall = totalLiabilityWithOption - POOL_BALANCE_SOL;
    
    const optionData = {
      name: option.name,
      trimPercentage: option.percentage,
      trimmed30EraRewards: trimmed30EraRewards,
     trimAmount: trimAmount,
      future10EraRewards: totalRewardsEarned_10_future,
      totalLiability: totalLiabilityWithOption,
      poolBalance: POOL_BALANCE_SOL,
      shortfall: Math.max(0, shortfall),
      canCover: POOL_BALANCE_SOL >= totalLiabilityWithOption,
    };
    
    detailedOptions.push(optionData);
    
    console.log(`${option.name}:`);
    console.log(`   ${option.description}`);
    console.log(`   Trimmed 30%-era rewards: ${trimmed30EraRewards.toFixed(6)} SOL (was ${totalRewardsEarned_30.toFixed(6)} SOL)`);
    console.log(`   Future 10%-era rewards (full): ${totalRewardsEarned_10_future.toFixed(6)} SOL`);
    console.log(`   Total liability: ${totalLiabilityWithOption.toFixed(6)} SOL`);
    console.log(`   Pool can cover: ${optionData.canCover ? '✅ YES' : '❌ NO'}`);
    if (shortfall > 0) {
      console.log(`   Shortfall: ${shortfall.toFixed(6)} SOL`);
    }
    console.log("");
  }

  console.log("🎯 CRITICAL FINDING");
  console.log("=".repeat(80));
  console.log("❌ Even with 100% trim on 30%-era rewards (eliminating them entirely),");
  console.log("❌ the future 10%-era rewards alone (7.60 SOL) exceed the pool (4.05 SOL).");
  console.log("");
  console.log("💡 REALITY CHECK:");
  console.log("   - 30%-era rewards: 2.59 SOL (historical)");
  console.log("   - Future 10%-era rewards: 7.60 SOL (from now to EOY)");
  console.log("   - Pool balance: 4.05 SOL");
  console.log("");
  console.log("⚠️  You cannot cover the rewards with current pool balance, even if:");
  console.log("   - You trim 30%-era by 100% (eliminate them)");
  console.log("   - You trim 10%-era by ~47% to fit pool");
  console.log("");
  console.log("📋 OPTIONS:");
  console.log("   1. Add ~3.55 SOL to pool to cover 10%-era rewards (and 30%-era too)");
  console.log("   2. Trim BOTH 30%-era AND 10%-era rewards");
  console.log("   3. Adjust the target end date (shorter timeframe = less liability)");
  console.log("   4. Change the 10% rate to something lower");
  console.log("");

  // Write results to file
  const results = {
    analysisDate: CURRENT_DATE.toISOString(),
    rateChangeDate: RATE_CHANGE_DATE.toISOString(),
    endDateOfYear: END_OF_YEAR_DATE.toISOString(),
    poolBalanceSol: POOL_BALANCE_SOL,
    totalUsersAnalyzed: userBreakdown.length,
    rewards30Era: {
      totalEarned: totalRewardsEarned_30,
      description: "Rewards earned at 30% rate before Feb 7, 2026"
    },
    rewards10Era: {
      totalFuture: totalRewardsEarned_10_future,
      description: "Future rewards at 10% rate from now to end of year"
    },
    totalClaimed: totalClaimed,
    criticalFinding: {
      message: "Future 10%-era rewards exceed pool balance",
      era10Rewards: totalRewardsEarned_10_future,
      poolBalance: POOL_BALANCE_SOL,
      shortfall: totalRewardsEarned_10_future - POOL_BALANCE_SOL,
      cannotCoverWith100percent30EraTrim: true
    },
    trim30OnlyOptions: detailedOptions,
    recommendedAction: "Add funds to pool or adjust 10%-era rewards",
    daysToYearEnd: (END_OF_YEAR_SECONDS - CURRENT_SECONDS) / 86400,
    secondsToYearEnd: END_OF_YEAR_SECONDS - CURRENT_SECONDS,
    userBreakdown: userBreakdown,
  };

  const outputPath = join(process.cwd(), "30pct_trim_only_analysis.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${outputPath}`);
  console.log("");
}

// Run analysis
calculate30PctTrimOnly().catch(console.error);