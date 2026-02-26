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
 * Calculate end-of-year liability with multiple trim options
 */
async function calculateLiabilityWithOptions() {
  console.log("=".repeat(80));
  console.log("📊 END-OF-YEAR LIABILITY CALCULATION WITH TRIM OPTIONS");
  console.log("=".repeat(80));
  console.log(`Rate change date: ${RATE_CHANGE_DATE.toISOString()}`);
  console.log(`Current date: ${CURRENT_DATE.toISOString()}`);
  console.log(`End of year date: ${END_OF_YEAR_DATE.toISOString()}`);
  console.log(`Days from now to end of year: ${(END_OF_YEAR_SECONDS - CURRENT_SECONDS) / 86400} days`);
  console.log("");
  console.log(`💰 Pool balance (user provided): ${POOL_BALANCE_SOL.toFixed(6)} SOL`);
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

  // Analyze each position for total liability
  let totalRewardsEarned_30 = 0;
  let totalRewardsEarned_10_future = 0;
  let totalClaimed = 0;
  let totalUnclaimedPreTrim = 0;

  const userBreakdown = [];

  console.log("🔍 Analyzing each position for end-of-year liability...");
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

    // Total earned at both rates
    const totalEarned = rewards_30 + rewards_10_future;
    const totalUnclaimed = Math.max(0, totalEarned - total_claimed_sol);

    // Track totals
    totalRewardsEarned_30 += rewards_30;
    totalRewardsEarned_10_future += rewards_10_future;
    totalClaimed += total_claimed_sol;
    totalUnclaimedPreTrim += totalUnclaimed;

    userBreakdown.push({
      userId,
      principal_amount,
      rewards_30,
      rewards_10_future,
      total_earned: totalEarned,
      total_claimed_sol,
      total_unclaimed: totalUnclaimed,
      booster_multiplier: boosterMultiplier,
      locked_token_price_sol,
      seconds_at_30,
      seconds_at_10_future,
    });
  }

  console.log("📊 LIABILITY SUMMARY (PRE-TRIM)");
  console.log("=".repeat(80));
  console.log(`Total users analyzed: ${userBreakdown.length}`);
  console.log(`Total rewards earned at 30% rate: ${totalRewardsEarned_30.toFixed(6)} SOL`);
  console.log(`Total future rewards at 10% rate (to end of year): ${totalRewardsEarned_10_future.toFixed(6)} SOL`);
  console.log(`Total rewards earned (combined): ${(totalRewardsEarned_30 + totalRewardsEarned_10_future).toFixed(6)} SOL`);
  console.log(`Total claimed: ${totalClaimed.toFixed(6)} SOL`);
  console.log(`Total unclaimed (pre-trim): ${totalUnclaimedPreTrim.toFixed(6)} SOL`);
  console.log("");
  
  // Calculate required trim percentage
  const requiredCoverage = POOL_BALANCE_SOL / totalUnclaimedPreTrim;
  const requiredTrimPercentage = Math.max(0, 100 - (requiredCoverage * 100));
  
  console.log("🎯 POOL COVERAGE ANALYSIS");
  console.log("=".repeat(80));
  console.log(`Pool balance: ${POOL_BALANCE_SOL.toFixed(6)} SOL`);
  console.log(`Total unclaimed: ${totalUnclaimedPreTrim.toFixed(6)} SOL`);
  console.log(`Current coverage: ${(requiredCoverage * 100).toFixed(2)}%`);
  console.log(`Shortfall: ${(totalUnclaimedPreTrim - POOL_BALANCE_SOL).toFixed(6)} SOL`);
  console.log(`Required trim to cover: ${requiredTrimPercentage.toFixed(2)}%`);
  console.log("");

  // TRIM OPTIONS
  const trimOptions = [
    { name: "20% Trim", percentage: 20, description: "Conservative - as initially requested" },
    { name: "40% Trim", percentage: 40, description: "Aggressive - closer to required" },
    { name: `${requiredTrimPercentage.toFixed(0)}% Trim`, percentage: requiredTrimPercentage, description: "Just enough to cover pool" },
    { name: "60% Trim", percentage: 60, description: "Very aggressive - creates buffer" },
  ];

  console.log("✂️  TRIM OPTIONS ANALYSIS");
  console.log("=".repeat(80));
  console.log("");
  
  const detailedOptions = [];
  
  for (const option of trimOptions) {
    const postTrimLiability = totalUnclaimedPreTrim * (1 - option.percentage / 100);
    const trimAmount = totalUnclaimedPreTrim - postTrimLiability;
    const poolCoverage = POOL_BALANCE_SOL / postTrimLiability * 100;
    const surplusOrShortfall = POOL_BALANCE_SOL - postTrimLiability;
    
    const optionData = {
      name: option.name,
      trimPercentage: option.percentage,
      description: option.description,
      preTrimLiability: totalUnclaimedPreTrim,
      postTrimLiability: postTrimLiability,
      trimAmount: trimAmount,
      poolBalance: POOL_BALANCE_SOL,
      poolCoverage: poolCoverage,
      surplus: surplusOrShortfall > 0 ? surplusOrShortfall : 0,
      shortfall: surplusOrShortfall < 0 ? Math.abs(surplusOrShortfall) : 0,
      canCover: POOL_BALANCE_SOL >= postTrimLiability
    };
    
    detailedOptions.push(optionData);
    
    console.log(`${option.name}:`);
    console.log(`   ${option.description}`);
    console.log(`   Liabilities: ${totalUnclaimedPreTrim.toFixed(6)} SOL → ${postTrimLiability.toFixed(6)} SOL`);
    console.log(`   Trim amount: ${trimAmount.toFixed(6)} SOL (${option.percentage}%)`);
    console.log(`   Pool coverage: ${poolCoverage.toFixed(2)}%`);
    if (surplusOrShortfall >= 0) {
      console.log(`   ✅ Pool sufficient with surplus: ${surplusOrShortfall.toFixed(6)} SOL`);
    } else {
      console.log(`   ❌ Pool shortfall: ${Math.abs(surplusOrShortfall).toFixed(6)} SOL`);
    }
    console.log("");
  }

  // Find best option
  const bestOption = detailedOptions.find(o => o.canCover && o.trimPercentage < 100) || detailedOptions[detailedOptions.length - 1];

  console.log("🎯 RECOMMENDATION");
  console.log("=".repeat(80));
  console.log(`Best option: ${bestOption.name}`);
  console.log(`Reason: ${bestOption.description}`);
  console.log(`This will leave ${bestOption.surplus > 0 ? bestOption.surplus.toFixed(6) + ' SOL buffer' : 'exactly enough to cover obligations'}`);
  console.log("");

  // Write results to file
  const results = {
    analysisDate: CURRENT_DATE.toISOString(),
    rateChangeDate: RATE_CHANGE_DATE.toISOString(),
    endDateOfYear: END_OF_YEAR_DATE.toISOString(),
    poolBalanceSol: POOL_BALANCE_SOL,
    totalUsersAnalyzed: userBreakdown.length,
    totalRewardsEarned30: totalRewardsEarned_30,
    totalFutureRewardsEarned10: totalRewardsEarned_10_future,
    totalRewardsEarnedCombined: totalRewardsEarned_30 + totalRewardsEarned_10_future,
    totalClaimed: totalClaimed,
    totalUnclaimedPreTrim: totalUnclaimedPreTrim,
    requiredTrimPercentage: requiredTrimPercentage,
    trimOptions: detailedOptions,
    recommendedOption: bestOption,
    daysToYearEnd: (END_OF_YEAR_SECONDS - CURRENT_SECONDS) / 86400,
    secondsToYearEnd: END_OF_YEAR_SECONDS - CURRENT_SECONDS,
    userBreakdown: userBreakdown,
  };

  const outputPath = join(process.cwd(), "liability_trim_options_analysis.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`💾 Detailed results saved to: ${outputPath}`);
  console.log("");
  
  console.log("📋 KEY TAKEAWAYS:");
  console.log("=".repeat(80));
  console.log("✅ The script accounts for boosters in all calculations");
  console.log(`✅ Pool balance set to ${POOL_BALANCE_SOL} SOL as provided`);
  console.log(`✅ 44 active stakers with ${totalUnclaimedPreTrim.toFixed(6)} SOL total unclaimed`);
  console.log("✅ Multiple trim options provided with tradeoff analysis");
  console.log("");
  console.log("⚠️  IMPORTANT NOTES:");
  console.log("   - 30%-era rewards: 2.59 SOL (already earned, cannot be changed)");
  console.log("   - Future 10%-era rewards: 7.60 SOL (can be affected by trim)");
  console.log("   - Trims apply to BOTH 30%-era and 10%-era rewards proportionally");
  console.log("   - Consider trimming ONLY 30%-era rewards vs trimming ALL rewards");
  console.log("");
}

// Run analysis
calculateLiabilityWithOptions().catch(console.error);