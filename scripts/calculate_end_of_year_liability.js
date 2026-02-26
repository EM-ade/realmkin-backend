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
// Rate change: Saturday February 7, 2026 (2 days ago from current date Feb 9, 2026)
const RATE_CHANGE_DATE = new Date("2026-02-07T00:00:00.00Z");
const RATE_CHANGE_SECONDS = Math.floor(RATE_CHANGE_DATE.getTime() / 1000);
const CURRENT_DATE = new Date();
const CURRENT_SECONDS = Math.floor(CURRENT_DATE.getTime() / 1000);

// End of year date (December 31, 2026)
const END_OF_YEAR_DATE = new Date("2026-12-31T23:59:59.00Z");
const END_OF_YEAR_SECONDS = Math.floor(END_OF_YEAR_DATE.getTime() / 1000);

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
 * Calculate end-of-year liability with 20% trim
 */
async function calculateLiability() {
  console.log("=".repeat(80));
  console.log("📊 END-OF-YEAR LIABILITY CALCULATION WITH 20% TRIM");
  console.log("=".repeat(80));
  console.log(`Rate change date: ${RATE_CHANGE_DATE.toISOString()}`);
  console.log(`Current date: ${CURRENT_DATE.toISOString()}`);
  console.log(`End of year date: ${END_OF_YEAR_DATE.toISOString()}`);
  console.log(`Days from now to end of year: ${(END_OF_YEAR_SECONDS - CURRENT_SECONDS) / 86400} days`);
  console.log(`Total days in year: 365`);
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

  // Fetch pool balance
  console.log("💰 Fetching pool balance...");
  const poolRef = db.collection("staking_pool").doc("staking_global");
  const poolDoc = await poolRef.get();
  
  const poolBalanceSol = poolDoc.exists ? (poolDoc.data().reward_pool_sol || 0) : 0;
  console.log(`✅ Pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
  console.log("");

  // Analyze each position for total liability
  let totalRewardsEarned_30 = 0;
  let totalRewardsEarned_10_future = 0;
  let totalClaimed = 0;
  let totalUnclaimedPreTrim = 0;

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

    console.log(`   User ${userId.substring(0, 8)}...: ${totalUnclaimed.toFixed(6)} SOL unclaimed (${rewards_30.toFixed(6)} @ 30% + ${rewards_10_future.toFixed(6)} @ 10% - ${total_claimed_sol.toFixed(6)} claimed)`);
  }

  // Apply 20% trim
  const totalUnclaimedPostTrim = totalUnclaimedPreTrim * 0.8; // 20% trim = 80% payout
  const trimAmount = totalUnclaimedPreTrim - totalUnclaimedPostTrim;

  console.log("📊 LIABILITY SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total users analyzed: ${positions.length}`);
  console.log(`Total rewards earned at 30% rate: ${totalRewardsEarned_30.toFixed(6)} SOL`);
  console.log(`Total future rewards at 10% rate (to end of year): ${totalRewardsEarned_10_future.toFixed(6)} SOL`);
  console.log(`Total rewards earned (combined): ${(totalRewardsEarned_30 + totalRewardsEarned_10_future).toFixed(6)} SOL`);
  console.log(`Total claimed: ${totalClaimed.toFixed(6)} SOL`);
  console.log(`Total unclaimed (pre-trim): ${totalUnclaimedPreTrim.toFixed(6)} SOL`);
  console.log("");
  console.log(`✂️  WITH 20% TRIM:`);
  console.log(`   Total unclaimed (post-trim): ${totalUnclaimedPostTrim.toFixed(6)} SOL`);
  console.log(`   Trim amount: ${trimAmount.toFixed(6)} SOL`);
  console.log("");
  console.log(`💰 Pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
  console.log(`📊 Pool coverage: ${(poolBalanceSol / totalUnclaimedPostTrim * 100).toFixed(2)}%`);
  console.log(`💸 Pool shortfall: ${Math.max(0, totalUnclaimedPostTrim - poolBalanceSol).toFixed(6)} SOL`);
  console.log(`📈 Pool surplus: ${Math.max(0, poolBalanceSol - totalUnclaimedPostTrim).toFixed(6)} SOL`);
  console.log("");

  // Generate summary statistics
  const activeUsers = positions.length;
  const shortfall = Math.max(0, totalUnclaimedPostTrim - poolBalanceSol);
  const surplus = Math.max(0, poolBalanceSol - totalUnclaimedPostTrim);

  console.log("🎯 KEY FINDINGS:");
  console.log("=".repeat(80));
  console.log(`Active stakers: ${activeUsers}`);
  console.log(`Total liability after 20% trim: ${totalUnclaimedPostTrim.toFixed(6)} SOL`);
  
  if (shortfall > 0) {
    console.log(`⚠️  POOL SHORTFALL DETECTED`);
    console.log(`   Pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
    console.log(`   Required: ${totalUnclaimedPostTrim.toFixed(6)} SOL`);
    console.log(`   Shortfall: ${shortfall.toFixed(6)} SOL`);
    console.log(`   Need to add ${(shortfall).toFixed(6)} SOL to cover all obligations`);
  } else {
    console.log(`✅  POOL IS SUFFICIENT`);
    console.log(`   Pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
    console.log(`   Required: ${totalUnclaimedPostTrim.toFixed(6)} SOL`);
    console.log(`   Surplus: ${surplus.toFixed(6)} SOL`);
    console.log(`   Buffer: ${(surplus / totalUnclaimedPostTrim * 100).toFixed(2)}% above required amount`);
  }

  console.log("");
  console.log("📋 BREAKDOWN:");
  console.log(`   30%-era earned rewards: ${totalRewardsEarned_30.toFixed(6)} SOL`);
  console.log(`   Future 10%-era rewards: ${totalRewardsEarned_10_future.toFixed(6)} SOL`);
  console.log(`   Total earned: ${(totalRewardsEarned_30 + totalRewardsEarned_10_future).toFixed(6)} SOL`);
  console.log(`   Less 20% trim: ${(totalRewardsEarned_30 + totalRewardsEarned_10_future) * 0.2} SOL`);
  console.log(`   Net payable: ${totalUnclaimedPostTrim.toFixed(6)} SOL`);

  // Write results to file
  const results = {
    analysisDate: CURRENT_DATE.toISOString(),
    rateChangeDate: RATE_CHANGE_DATE.toISOString(),
    endDateOfYear: END_OF_YEAR_DATE.toISOString(),
    poolBalanceSol: poolBalanceSol,
    totalUsersAnalyzed: activeUsers,
    totalRewardsEarned30: totalRewardsEarned_30,
    totalFutureRewardsEarned10: totalRewardsEarned_10_future,
    totalRewardsEarnedCombined: totalRewardsEarned_30 + totalRewardsEarned_10_future,
    totalClaimed: totalClaimed,
    totalUnclaimedPreTrim: totalUnclaimedPreTrim,
    totalUnclaimedPostTrim: totalUnclaimedPostTrim,
    trimPercentage: 20,
    trimAmount: trimAmount,
    poolCoveragePercentage: (poolBalanceSol / totalUnclaimedPostTrim) * 100,
    poolCanCover: poolBalanceSol >= totalUnclaimedPostTrim,
    poolShortfall: Math.max(0, totalUnclaimedPostTrim - poolBalanceSol),
    poolSurplus: Math.max(0, poolBalanceSol - totalUnclaimedPostTrim),
    daysToYearEnd: (END_OF_YEAR_SECONDS - CURRENT_SECONDS) / 86400,
    secondsToYearEnd: END_OF_YEAR_SECONDS - CURRENT_SECONDS,
  };

  const outputPath = join(process.cwd(), "end_of_year_liability_analysis.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log("");
  console.log(`💾 Results saved to: ${outputPath}`);
  console.log("");
  console.log("🎯 RECOMMENDATION:");
  if (poolBalanceSol >= totalUnclaimedPostTrim) {
    console.log("   ✅ Pool has sufficient balance to cover all trimmed obligations");
    console.log("   ✅ Proceed with 20% proportional trim implementation");
  } else {
    console.log("   ❌ Pool balance insufficient even after 20% trim");
    console.log(`   ❌ Need additional ${(shortfall).toFixed(6)} SOL to cover obligations`);
  }
}

// Run analysis
calculateLiability().catch(console.error);