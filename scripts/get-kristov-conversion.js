/**
 * Kristov Stake Conversion Analysis
 *
 * Finds Kristov's staking position and calculates the exact and rounded
 * conversion ratio from old MKIN to new $MKIN tokens.
 *
 * USAGE:
 *   node scripts/get-kristov-conversion.js
 *
 * BUSINESS RULES:
 *   - Kristov's total stake should be equivalent to $150 USD
 *   - New $MKIN token price = $6.67 USD per 1 $MKIN
 *   - $MKIN to receive = 150 / 6.67
 *   - Conversion ratio = principal_amount / $MKIN_to_receive
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin
console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const TARGET_USD = 150;
const MKIN_PRICE_USD = 6.67;

/**
 * Round to nearest multiple of a base (e.g., 100000 or 1000000).
 */
function roundToNearest(value, base) {
  return Math.round(value / base) * base;
}

function formatNumber(n, decimals = 2) {
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

async function main() {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 KRISTOV STAKE ANALYSIS`);
  console.log("=".repeat(60));

  // Kristov's known Firebase UID (from prior investigation scripts)
  const kristovUid = "jDbySdiDJQQWzZIFEBgn3UpWWUc2";

  // Step 1: Fetch userRewards for wallet/identity info
  console.log(`\n📋 Fetching userRewards for UID: ${kristovUid}`);
  const userDoc = await db.collection("userRewards").doc(kristovUid).get();

  if (!userDoc.exists) {
    console.log(`⚠️  WARNING: No userRewards document found for UID: ${kristovUid}`);
    console.log(`   Will proceed with staking position lookup only.\n`);
  }

  const userData = userDoc.exists ? userDoc.data() : {};
  const walletAddress = userData.walletAddress || "N/A";
  const username = userData.username || "N/A";
  const email = userData.email || "N/A";

  console.log(`Firebase UID:   ${kristovUid}`);
  console.log(`Wallet Address: ${walletAddress}`);
  console.log(`Username:       ${username}`);
  console.log(`Email:          ${email}`);

  // Step 2: Fetch staking position
  console.log(`\n📋 Fetching staking position...`);
  const stakingDoc = await db.collection("staking_positions").doc(kristovUid).get();

  if (!stakingDoc.exists) {
    console.log(`\n⚠️  WARNING: No staking position found for UID: ${kristovUid}`);
    console.log(`   Cannot calculate conversion ratio.\n`);
    process.exit(0);
  }

  const stakingData = stakingDoc.data();
  const principalAmount = stakingData.principal_amount;

  console.log(`\n📋 Staking Position Fields:`);
  for (const [key, value] of Object.entries(stakingData)) {
    console.log(`   ${key}: ${value}`);
  }

  if (principalAmount === undefined || principalAmount === null) {
    console.log(`\n⚠️  WARNING: principal_amount field is missing or null in staking position`);
    console.log(`   Cannot calculate conversion ratio.\n`);
    process.exit(0);
  }

  // Step 3: Calculate conversion
  const mkinToReceive = TARGET_USD / MKIN_PRICE_USD;
  const exactRatio = principalAmount / mkinToReceive;
  const roundedRatio100k = roundToNearest(exactRatio, 100000);
  const roundedRatio1M = roundToNearest(exactRatio, 1000000);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`KRISTOV STAKE ANALYSIS`);
  console.log("=".repeat(60));
  console.log(`Firebase UID:            ${kristovUid}`);
  console.log(`Wallet:                  ${walletAddress}`);
  console.log(`Total Staked (old MKIN): ${formatNumber(principalAmount)}`);
  console.log(``);
  console.log(`CONVERSION CALCULATION:`);
  console.log(`Target USD value:        $${TARGET_USD}`);
  console.log(`$MKIN price:             $${MKIN_PRICE_USD}`);
  console.log(`$MKIN to receive:        ${TARGET_USD} / ${MKIN_PRICE_USD} = ${formatNumber(mkinToReceive, 6)}`);
  console.log(``);
  console.log(`EXACT ratio:             ${formatNumber(exactRatio, 6)} old MKIN = 1 $MKIN`);
  console.log(`ROUNDED ratio (nearest 100k): ${formatNumber(roundedRatio100k)} old MKIN = 1 $MKIN`);
  console.log(`ROUNDED ratio (nearest 1M):   ${formatNumber(roundedRatio1M)} old MKIN = 1 $MKIN`);
  console.log("=".repeat(60));

  console.log(`\n✅ Analysis complete.\n`);
}

main().catch((err) => {
  console.error(`\n❌ Error:`, err);
  process.exit(1);
});
