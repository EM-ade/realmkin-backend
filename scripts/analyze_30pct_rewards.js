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

// Constants for reward calculation
const SECONDS_IN_YEAR = 365 * 24 * 60 * 60; // 31,536,000
const RATE_30 = 0.3; // 30% APR (old rate)
const RATE_10 = 0.1; // 10% APR (new rate)

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
 * Analyze damage from 30% → 10% rate change
 */
async function analyzeDamage() {
  console.log("=".repeat(80));
  console.log("💥 DAMAGE ASSESSMENT: 30% → 10% Rate Change");
  console.log("=".repeat(80));
  console.log(`Rate change date: ${RATE_CHANGE_DATE.toISOString()}`);
  console.log(`Current date: ${CURRENT_DATE.toISOString()}`);
  console.log(`Time since rate change: ${(CURRENT_SECONDS - RATE_CHANGE_SECONDS) / 86400} days`);
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
    console.log("⚠️  No staking positions found. No damage assessment needed.");
    return;
  }

  // Fetch pool balance
  console.log("💰 Fetching pool balance...");
  const poolRef = db.collection("staking_pool").doc("staking_global");
  const poolDoc = await poolRef.get();
  
  const poolBalanceSol = poolDoc.exists ? (poolDoc.data().reward_pool_sol || 0) : 0;
  console.log(`✅ Pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
  console.log("");

  // Analyze each position
  const analysisResults = [];
  let totalRewardsEarned_30 = 0;
  let totalRewardsEarned_10_post = 0;
  let totalClaimed = 0;

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
    let seconds_at_10 = 0;

    // Calculate time spent at each rate
    if (startSeconds < RATE_CHANGE_SECONDS) {
      seconds_at_30 = RATE_CHANGE_SECONDS - startSeconds;
    }

    if (startSeconds < CURRENT_SECONDS) {
      seconds_at_10 = CURRENT_SECONDS - Math.max(startSeconds, RATE_CHANGE_SECONDS);
    }

    // Skip if no time at either rate
    if (seconds_at_30 <= 0 && seconds_at_10 <= 0) {
      continue;
    }

    // Get booster multiplier
    const boosterMultiplier = calculateBoosterMultiplier(active_boosters);

    // Calculate rewards at 30% rate
    const rewards_30 = calculateRewards(
      principal_amount,
      locked_token_price_sol,
      seconds_at_30,
      RATE_30,
      boosterMultiplier
    );

    // Calculate rewards at 10% rate (post-change only)
    const rewards_10_post = calculateRewards(
      principal_amount,
      locked_token_price_sol,
      seconds_at_10,
      RATE_10,
      boosterMultiplier
    );

    // Total earned at both rates
    const totalEarned = rewards_30 + rewards_10_post;

    // Skip if total earned is negligible
    if (totalEarned < 0.000001) {
      continue;
    }

    // Track totals
    totalRewardsEarned_30 += rewards_30;
    totalRewardsEarned_10_post += rewards_10_post;
    totalClaimed += total_claimed_sol;

    analysisResults.push({
      userId,
      principal_amount,
      startSeconds,
      locked_token_price_sol,
      seconds_at_30,
      seconds_at_10,
      rewards_30,
      rewards_10_post,
      totalEarned,
      total_claimed_sol,
      total_claimable: Math.max(0, totalEarned - total_claimed_sol),
      boosterMultiplier,
      active_boosters,
    });
  }

  console.log("📊 ANALYSIS SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total users analyzed: ${analysisResults.length}`);
  console.log(`Total rewards earned at 30% rate: ${totalRewardsEarned_30.toFixed(6)} SOL`);
  console.log(`Total rewards earned at 10% rate (2 days): ${totalRewardsEarned_10_post.toFixed(6)} SOL`);
  console.log(`Total rewards earned (combined): ${(totalRewardsEarned_30 + totalRewardsEarned_10_post).toFixed(6)} SOL`);
  console.log(`Total claimed: ${totalClaimed.toFixed(6)} SOL`);
  console.log(`Total unclaimed: ${(totalRewardsEarned_30 + totalRewardsEarned_10_post - totalClaimed).toFixed(6)} SOL`);
  console.log("");
  console.log(`💰 Pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
  console.log(`💸 Pool shortfall: ${Math.max(0, (totalRewardsEarned_30 + totalRewardsEarned_10_post - totalClaimed_sol - poolBalanceSol)).toFixed(6)} SOL`);
  console.log("");

  // Calculate what each user would get if paid in full
  console.log("📋 Per-User Breakdown (top 20 by earned rewards):");
  analysisResults
    .sort((a, b) => b.totalEarned - a.totalEarned)
    .slice(0, 20)
    .forEach((result) => {
      const days_staked_30 = ((result.seconds_at_30 / 86400).toFixed(2));
      const days_staked_10 = ((result.seconds_at_10 / 86400).toFixed(2));
      console.log(
        `User ${result.userId}: ` +
          `${result.total_claimable.toFixed(6)} SOL unclaimable | ` +
          `${result.rewards_30.toFixed(6)} SOL at 30% (${days_staked_30} days) + ` +
          `${result.rewards_10_post.toFixed(6)} SOL at 10% (${days_staked_10} days) - ` +
          `${result.total_claimed_sol.toFixed(6)} SOL claimed = ` +
          `Principal: ${result.principal_amount.toLocaleString()} MKIN`
      );
    });

  // Generate summary statistics
  const activeUsers = analysisResults.length;
  const totalUnclaimed = totalRewardsEarned_30 + totalRewardsEarned_10_post - totalClaimed;
  const shortfall = Math.max(0, totalUnclaimed - poolBalanceSol);
  const surplus = poolBalanceSol - totalUnclaimed;

  console.log("");
  console.log("🎯 KEY FINDINGS:");
  console.log("=".repeat(80));
  console.log(`Active stakers: ${activeUsers}`);
  console.log(`Total unclaimed rewards: ${totalUnclaimed.toFixed(6)} SOL`);
  console.log(`Available pool balance: ${poolBalanceSol.toFixed(6)} SOL`);
  
  if (shortfall > 0) {
    const coverage = ((poolBalanceSol / totalUnclaimed) * 100).toFixed(1);
    console.log(`⚠️  SHORTFALL DETECTED`);
    console.log(`   Pool can only cover ${coverage}% of unclaimed rewards`);
    console.log(`   Additional SOL needed: ${shortfall.toFixed(6)} SOL`);
    console.log("");
    console.log("💡 RECOMMENDATION:");
    console.log("   Pool is insufficient. Present trimming options:");
    console.log("   1. Proportional trim: Pay ${coverage}% to all users");
    console.log("      - Example: If 8.9 SOL covers 70%, all users get 70% of earned 30%-era rewards");
    console.log("   2. Per-user cap: Set max payout per user at $max_per_user SOL");
    console.log("      - Example: If 100 users, max = 0.089 SOL each");
    console.log("   3. Phase-in: Stretch payments over time as pool grows from entry fees");
    console.log("      - Estimate: Pool earns ~0.5 SOL/month from 5% entry fees");
    console.log("      - 8.9 SOL at 0.5/month covers ~18 months of payouts");
  } else {
    const surplus = poolBalanceSol - totalUnclaimed;
    console.log(`✅  POOL IS SUFFICIENT`);
    console.log(`   Surplus: ${surplus.toFixed(6)} SOL`);
    console.log("");
    console.log("💡 RECOMMENDATION:");
    console.log("   Pool can cover all unclaimed 30%-era + 10%-era rewards.");
    console.log("   Proceed with migration to pay users what they earned in full.");
  }

  console.log("");
  console.log("📊 DATA EXPORTS");
  console.log("=".repeat(80));
  
  // Write JSON summary
  const jsonSummary = {
    analysisDate: CURRENT_DATE.toISOString(),
    rateChangeDate: RATE_CHANGE_DATE.toISOString(),
    timeSinceRateChangeDays: (CURRENT_SECONDS - RATE_CHANGE_SECONDS) / 86400,
    currentTimeDate: CURRENT_DATE.toISOString(),
    poolBalanceSol: poolBalanceSol,
    totalUsersAnalyzed: activeUsers,
    totalRewardsEarned30: totalRewardsEarned_30,
    totalRewardsEarned10: totalRewardsEarned_10_post,
    totalRewardsEarnedCombined: totalRewardsEarned_30 + totalRewardsEarned_10_post,
    totalClaimed: totalClaimed,
    totalUnclaimed: totalUnclaimed,
    poolCanCover: poolBalanceSol >= totalUnclaimed,
    poolShortfall: Math.max(0, totalUnclaimed - poolBalanceSol),
    poolSurplus: surplus,
    coveragePercentage: poolBalanceSol > 0 ? ((poolBalanceSol / totalUnclaimed) * 100) : 0,
    userBreakdown: analysisResults.map((r) => ({
      userId: r.userId,
      principal_amount: r.principal_amount,
      rewards_30: r.rewards_30,
      rewards_10_post: r.rewards_10_post,
      total_claimed_sol: r.total_claimed_sol,
      total_claimable: r.total_claimable,
      total_earned: r.totalEarned,
      seconds_at_30: r.seconds_at_30,
      seconds_at_10: r.seconds_at_10,
      boosterMultiplier: r.boosterMultiplier,
      locked_token_price_sol: r.locked_token_price_sol,
    })),
  };

  const jsonPath = join(process.cwd(), "analysis-summary.json");
  writeFileSync(jsonPath, JSON.stringify(jsonSummary, null, 2));
  console.log(`✅ JSON summary: ${jsonPath}`);

  // Write CSV breakdown
  const csvHeader =
    "userId,principal_amount,rewards_30,rewards_10_post,total_claimed_sol,total_claimable,seconds_at_30,seconds_at_10,boosterMultiplier\n";
  let csvContent = csvHeader;

  analysisResults.forEach((r) => {
    const row =
      `${r.userId},${r.principal_amount},${r.rewards_30},${r.rewards_10_post},${r.total_claimed_sol},${r.total_claimable},${r.seconds_at_30},${r.seconds_at_10},${r.boosterMultiplier}\n`;
    csvContent += row;
  });

  const csvPath = join(process.cwd(), "per-user-breakdown.csv");
  writeFileSync(csvPath, csvContent);
  console.log(`✅ CSV breakdown: ${csvPath}`);

  // Console summary (human-readable summary)
  console.log("");
  console.log("📄 REPORT FILES GENERATED:");
  console.log(`   1. analysis-summary.json - Machine-readable full data`);
  console.log(`   2. per-user-breakdown.csv - Spreadsheet-compatible user data`);
  console.log("");

  console.log("🎯 ACTION REQUIRED:");
  console.log("   1. Review the analysis files");
  console.log("   2. Decide on trimming approach if shortfall exists");
  console.log("   3. Confirm rate change timing is accurate");
  console.log("   4. Proceed to migration script design");
}

// Run analysis
analyzeDamage().catch(console.error);
