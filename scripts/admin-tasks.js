/**
 * Administrative Tasks Script for Realmkin Staking System
 * 
 * USAGE:
 *   node scripts/admin-tasks.js [task] [username|wallet] [amount]
 * 
 * TASKS:
 *   1. add-stake <username|wallet> <amount> - Add MKIN to a user's stake
 *   2. get-info <username|wallet> - Get total mined and staked for a user
 *   3. both - Run both tasks for the specified users
 * 
 * EXAMPLES:
 *   # Add 50 million MKIN to Kristovvvvv's stake
 *   node scripts/admin-tasks.js add-stake Kristovvvvv 50000000
 * 
 *   # Get info by username
 *   node scripts/admin-tasks.js get-info miaisobelck10
 * 
 *   # Get info by wallet address (more reliable!)
 *   node scripts/admin-tasks.js get-info 0x1234567890abcdef1234567890abcdef12345678
 * 
 *   # Run both tasks (add 50M to Kristovvvvv, get info for miaisobelck10)
 *   node scripts/admin-tasks.js both
 * 
 * IMPORTANT:
 * - This script uses Firebase Admin SDK and requires service account credentials
 * - Ensure firebase-service-account.json exists in the backend-api directory
 * - This script directly modifies Firestore - use with caution!
 * - Always verify the user exists before adding stake
 * - Searching by wallet address is more reliable than username
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
const auth = admin.auth();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Look up a user's Firebase UID by username, wallet address, or UID
 * Searches userRewards and users collections for matching username, email prefix, wallet address, or UID
 * @param {string} query - Username, wallet address, or Firebase UID to search for
 * @returns {Promise<{uid: string, username: string, walletAddress: string, totalRealmkin: number} | null>}
 */
async function lookupUser(query) {
  console.log(`\n🔍 Looking up user: ${query}...`);
  
  try {
    const normalizedQuery = query.toLowerCase().trim();
    let foundUser = null;
    
    // First: Try direct UID lookup in userRewards (fastest path)
    console.log(`   Checking userRewards by UID...`);
    const userRewardsDoc = await db.collection("userRewards").doc(query).get();
    if (userRewardsDoc.exists) {
      const data = userRewardsDoc.data();
      foundUser = {
        uid: query,
        username: data.username || `User_${query.slice(0, 8)}`,
        walletAddress: data.walletAddress,
        totalRealmkin: data.totalRealmkin || 0,
        email: data.email,
        source: 'userRewards',
      };
      console.log(`   ✅ Found by direct UID lookup in userRewards`);
    }
    
    // Search userRewards collection if not found by UID
    if (!foundUser) {
      console.log(`   Searching userRewards collection...`);
      const usersSnapshot = await db.collection("userRewards").get();
      
      // First pass: Check if query is a wallet address (exact match)
      for (const doc of usersSnapshot.docs) {
        const data = doc.data();
        const walletAddress = (data.walletAddress || "").toLowerCase();
        
        if (walletAddress === normalizedQuery || walletAddress === query) {
          foundUser = {
            uid: doc.id,
            username: data.username || `User_${doc.id.slice(0, 8)}`,
            walletAddress: data.walletAddress,
            totalRealmkin: data.totalRealmkin || 0,
            email: data.email,
            source: 'userRewards',
          };
          console.log(`   (Found by wallet address in userRewards)`);
          break;
        }
      }
      
      // Second pass: exact match on username field in userRewards
      if (!foundUser) {
        for (const doc of usersSnapshot.docs) {
          const data = doc.data();
          const userData = (data.username || "").toLowerCase();
          
          if (userData === normalizedQuery) {
            foundUser = {
              uid: doc.id,
              username: data.username,
              walletAddress: data.walletAddress,
              totalRealmkin: data.totalRealmkin || 0,
              email: data.email,
              source: 'userRewards',
            };
            console.log(`   (Found by exact username match in userRewards)`);
            break;
          }
        }
      }
      
      // Third pass: check if query matches email prefix in userRewards
      if (!foundUser) {
        for (const doc of usersSnapshot.docs) {
          const data = doc.data();
          const email = data.email || "";
          const emailPrefix = email.split("@")[0].toLowerCase();
          
          if (emailPrefix === normalizedQuery) {
            foundUser = {
              uid: doc.id,
              username: data.username || emailPrefix,
              walletAddress: data.walletAddress,
              totalRealmkin: data.totalRealmkin || 0,
              email: data.email,
              source: 'userRewards',
            };
            console.log(`   (Found by email prefix match in userRewards)`);
            break;
          }
        }
      }
      
      // Fourth pass: partial match in userRewards
      if (!foundUser) {
        for (const doc of usersSnapshot.docs) {
          const data = doc.data();
          const userData = (data.username || "").toLowerCase();
          
          if (userData.includes(normalizedQuery)) {
            foundUser = {
              uid: doc.id,
              username: data.username,
              walletAddress: data.walletAddress,
              totalRealmkin: data.totalRealmkin || 0,
              email: data.email,
              source: 'userRewards',
            };
            console.log(`   (Found by partial username match in userRewards)`);
            break;
          }
        }
      }
    }
    
    // If not found in userRewards, search users collection
    if (!foundUser) {
      console.log(`   Searching users collection...`);
      const usersCollectionSnap = await db.collection("users").get();
      
      for (const doc of usersCollectionSnap.docs) {
        const data = doc.data();
        const username = (data.username || "").toLowerCase();
        const email = (data.email || "").toLowerCase().split("@")[0];
        const displayName = (data.displayName || "").toLowerCase();
        const walletAddress = (data.walletAddress || "").toLowerCase();
        
        if (username === normalizedQuery || email === normalizedQuery || 
            displayName === normalizedQuery || walletAddress === normalizedQuery ||
            walletAddress === query.toLowerCase() || doc.id === query) {
          foundUser = {
            uid: doc.id,
            username: data.username || `User_${doc.id.slice(0, 8)}`,
            walletAddress: data.walletAddress,
            totalRealmkin: 0, // Not available in users collection
            email: data.email,
            displayName: data.displayName,
            source: 'users',
          };
          console.log(`   (Found in users collection)`);
          break;
        }
      }
      
      // Partial match in users collection
      if (!foundUser) {
        for (const doc of usersCollectionSnap.docs) {
          const data = doc.data();
          const username = (data.username || "").toLowerCase();
          const email = (data.email || "").toLowerCase().split("@")[0];
          const displayName = (data.displayName || "").toLowerCase();
          
          if (username.includes(normalizedQuery) || email.includes(normalizedQuery) ||
              displayName.includes(normalizedQuery)) {
            foundUser = {
              uid: doc.id,
              username: data.username || `User_${doc.id.slice(0, 8)}`,
              walletAddress: data.walletAddress,
              totalRealmkin: 0,
              email: data.email,
              displayName: data.displayName,
              source: 'users',
            };
            console.log(`   (Found by partial match in users collection)`);
            break;
          }
        }
      }
    }
    
    if (foundUser) {
      console.log(`\n✅ User found:`);
      console.log(`   UID: ${foundUser.uid}`);
      console.log(`   Username: ${foundUser.username}`);
      console.log(`   Wallet: ${foundUser.walletAddress || "N/A"}`);
      console.log(`   Source: ${foundUser.source}`);
      if (foundUser.source === 'userRewards') {
        console.log(`   MKIN Balance: ${foundUser.totalRealmkin.toLocaleString()}`);
      } else {
        console.log(`   ⚠️  User has no staking account yet (not in userRewards)`);
      }
    } else {
      console.log(`❌ User not found: ${query}`);
      console.log(`\n💡 Tip: You can also search by wallet address or Firebase UID directly`);
    }
    
    return foundUser;
  } catch (error) {
    console.error(`❌ Error looking up user:`, error.message);
    return null;
  }
}

/**
 * Get user's staking position
 * @param {string} uid - Firebase UID
 * @returns {Promise<{principal: number, pendingRewards: number, totalClaimed: number, activeBoosters: Array} | null>}
 */
async function getStakingPosition(uid) {
  try {
    const posDoc = await db.collection("staking_positions").doc(uid).get();
    
    if (!posDoc.exists) {
      return null;
    }
    
    const data = posDoc.data();
    return {
      principal: data.principal_amount || 0,
      pendingRewards: data.pending_rewards || 0,
      totalClaimed: data.total_claimed_sol || 0,
      activeBoosters: data.active_boosters || [],
      boosterMultiplier: data.booster_multiplier || 1,
      lockedTokenPrice: data.locked_token_price_sol || 0,
      stakeStartTime: data.stake_start_time?.toDate(),
      lastStakeTime: data.last_stake_time?.toDate(),
    };
  } catch (error) {
    console.error(`❌ Error getting staking position:`, error.message);
    return null;
  }
}

/**
 * Get total mined (claimed) rewards for a user from staking transactions
 * @param {string} uid - Firebase UID
 * @returns {Promise<{totalMined: number, claimCount: number, totalClaimedSol: number}>}
 */
async function getTotalMined(uid) {
  try {
    // Query all claim transactions for this user
    const claimsSnapshot = await db
      .collection("staking_transactions")
      .where("user_id", "==", uid)
      .where("type", "==", "claim")
      .get();
    
    let totalMined = 0;
    let claimCount = 0;
    
    claimsSnapshot.forEach((doc) => {
      const tx = doc.data();
      totalMined += tx.amount_sol || 0;
      claimCount++;
    });
    
    // Also check the user's staking position for total_claimed_sol
    // This is the authoritative source for lifetime claimed rewards
    const posDoc = await db.collection("staking_positions").doc(uid).get();
    let totalClaimedSol = 0;
    if (posDoc.exists) {
      const posData = posDoc.data();
      totalClaimedSol = posData.total_claimed_sol || 0;
    }
    
    return {
      totalMined,
      claimCount,
      totalClaimedSol, // Lifetime total from staking position
    };
  } catch (error) {
    console.error(`❌ Error getting total mined:`, error.message);
    return { totalMined: 0, claimCount: 0, totalClaimedSol: 0 };
  }
}

/**
 * Get global staking pool data
 * @returns {Promise<{totalStaked: number, rewardPool: number}>}
 */
async function getPoolData() {
  try {
    const poolDoc = await db.collection("staking_pool").doc("main_pool").get();
    
    if (!poolDoc.exists) {
      return { totalStaked: 0, rewardPool: 0 };
    }
    
    const data = poolDoc.data();
    return {
      totalStaked: data.total_staked || 0,
      rewardPool: data.reward_pool_sol || 0,
    };
  } catch (error) {
    console.error(`❌ Error getting pool data:`, error.message);
    return { totalStaked: 0, rewardPool: 0 };
  }
}

// ============================================================================
// TASK 1: ADD STAKE
// ============================================================================

/**
 * Add MKIN to a user's stake
 * @param {string} username - Username to add stake to
 * @param {number} amount - Amount of MKIN to add
 * @returns {Promise<boolean>}
 */
async function addStake(username, amount) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`💰 TASK 1: ADD STAKE`);
  console.log(`   User: ${username}`);
  console.log(`   Amount: ${amount.toLocaleString()} MKIN`);
  console.log("=".repeat(80));
  
  // 1. Look up user
  const user = await lookupUser(username);
  if (!user) {
    console.log(`\n❌ ABORTED: User not found`);
    return false;
  }
  
  // 2. Get current staking position
  console.log(`\n📊 Step 2: Getting current staking position...`);
  const position = await getStakingPosition(user.uid);
  
  let currentStake = 0;
  if (position) {
    currentStake = position.principal;
    console.log(`   Current stake: ${currentStake.toLocaleString()} MKIN`);
    console.log(`   Pending rewards: ${position.pendingRewards.toFixed(9)} SOL`);
    console.log(`   Total claimed: ${position.totalClaimed.toFixed(9)} SOL`);
  } else {
    console.log(`   No existing staking position found`);
  }
  
  // 3. Get pool data
  console.log(`\n🏊 Step 3: Getting pool data...`);
  const poolData = await getPoolData();
  console.log(`   Total staked (before): ${poolData.totalStaked.toLocaleString()} MKIN`);
  console.log(`   Reward pool: ${poolData.rewardPool.toFixed(9)} SOL`);
  
  // 4. Perform the update in a transaction
  console.log(`\n📝 Step 4: Updating Firestore...`);
  
  try {
    await db.runTransaction(async (t) => {
      const posRef = db.collection("staking_positions").doc(user.uid);
      const poolRef = db.collection("staking_pool").doc("main_pool");
      
      // Update user's staking position
      const newPosData = {
        principal_amount: currentStake + amount,
        updated_at: admin.firestore.Timestamp.now(),
      };
      
      // If no existing position, create it
      if (!position) {
        newPosData.user_id = user.uid;
        newPosData.pending_rewards = 0;
        newPosData.total_accrued_sol = 0;
        newPosData.total_claimed_sol = 0;
        newPosData.stake_start_time = admin.firestore.Timestamp.now();
        newPosData.last_stake_time = admin.firestore.Timestamp.now();
        
        // Get current token price for locked price
        const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
        const tokenPriceSol = await getMkinPriceSOL();
        newPosData.locked_token_price_sol = tokenPriceSol;
      }
      
      t.set(posRef, newPosData, { merge: true });
      
      // Update pool total
      t.update(poolRef, {
        total_staked: poolData.totalStaked + amount,
        updated_at: admin.firestore.Timestamp.now(),
      });
      
      console.log(`   ✅ Transaction committed`);
    });
    
    // 5. Log the transaction
    console.log(`\n📜 Step 5: Logging transaction...`);
    const txRef = db.collection("staking_transactions").doc();
    await txRef.set({
      user_id: user.uid,
      type: "stake",
      amount_mkin: amount,
      amount_sol: 0, // No SOL involved in admin stake
      signature: `admin_credit_${Date.now()}`,
      timestamp: admin.firestore.Timestamp.now(),
      manual_credit: true,
      manual_credit_reason: `Administrative stake addition - ${amount.toLocaleString()} MKIN`,
      created_at: admin.firestore.Timestamp.now(),
    });
    
    console.log(`   ✅ Transaction logged: ${txRef.id}`);
    
    // 6. Show results
    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ STAKE ADDITION COMPLETE`);
    console.log("=".repeat(80));
    console.log(`   User: ${user.username} (${user.uid})`);
    console.log(`   Amount added: ${amount.toLocaleString()} MKIN`);
    console.log(`   Previous stake: ${currentStake.toLocaleString()} MKIN`);
    console.log(`   New stake: ${(currentStake + amount).toLocaleString()} MKIN`);
    console.log(`   Pool total (new): ${(poolData.totalStaked + amount).toLocaleString()} MKIN`);
    console.log(`\n💡 Note: This was an administrative credit. No SOL fees were charged.`);
    
    return true;
  } catch (error) {
    console.error(`\n❌ ERROR: Transaction failed:`, error.message);
    console.error(`   Stack:`, error.stack);
    return false;
  }
}

// ============================================================================
// TASK 2: GET TOTAL MINED AND STAKED
// ============================================================================

/**
 * Get total mined and staked for a user
 * @param {string} username - Username to query
 * @returns {Promise<{staked: number, totalMined: number} | null>}
 */
async function getInfo(username) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 TASK 2: GET TOTAL MINED AND STAKED`);
  console.log(`   User: ${username}`);
  console.log("=".repeat(80));
  
  // 1. Look up user
  const user = await lookupUser(username);
  if (!user) {
    console.log(`\n❌ ABORTED: User not found`);
    return null;
  }
  
  // 2. Get staking position
  console.log(`\n📊 Step 2: Getting staking information...`);
  const position = await getStakingPosition(user.uid);
  
  let staked = 0;
  if (position) {
    staked = position.principal;
    console.log(`   ✅ Staked: ${staked.toLocaleString()} MKIN`);
    console.log(`      Pending rewards: ${position.pendingRewards.toFixed(9)} SOL`);
    console.log(`      Total claimed (all time): ${position.totalClaimed.toFixed(9)} SOL`);
    
    if (position.activeBoosters?.length > 0) {
      console.log(`      Active boosters: ${position.activeBoosters.length}`);
      console.log(`      Booster multiplier: ${position.boosterMultiplier}x`);
    }
    
    if (position.lockedTokenPrice > 0) {
      console.log(`      Locked token price: ${position.lockedTokenPrice.toFixed(9)} SOL/MKIN`);
    }
  } else {
    console.log(`   ❌ No staking position found`);
  }
  
  // 3. Get total mined from transaction history
  console.log(`\n⛏️  Step 3: Calculating total mined...`);
  const minedData = await getTotalMined(user.uid);
  console.log(`   ✅ Total mined (from transactions): ${minedData.totalMined.toFixed(9)} SOL`);
  console.log(`      Number of claims: ${minedData.claimCount}`);
  console.log(`   ✅ Total claimed (lifetime): ${minedData.totalClaimedSol.toFixed(9)} SOL`);
  
  // 4. Get additional user info
  console.log(`\n👤 Step 4: Additional user information...`);
  console.log(`   UID: ${user.uid}`);
  console.log(`   Wallet: ${user.walletAddress || "N/A"}`);
  console.log(`   MKIN balance: ${user.totalRealmkin.toLocaleString()}`);
  
  // 5. Calculate pool share
  console.log(`\n🏊 Step 5: Pool statistics...`);
  const poolData = await getPoolData();
  const poolShare = staked > 0 ? ((staked / poolData.totalStaked) * 100) : 0;
  console.log(`   Global pool total: ${poolData.totalStaked.toLocaleString()} MKIN`);
  console.log(`   User's pool share: ${poolShare.toFixed(6)}%`);
  console.log(`   Reward pool: ${poolData.rewardPool.toFixed(9)} SOL`);
  
  // 6. Summary
  console.log(`\n${"=".repeat(80)}`);
  console.log(`📊 SUMMARY FOR: ${user.username}`);
  console.log("=".repeat(80));
  console.log(`   💰 Total Staked: ${staked.toLocaleString()} MKIN`);
  console.log(`   ⛏️  Total Mined (claims): ${minedData.totalMined.toFixed(9)} SOL`);
  console.log(`   💵 Total Claimed (lifetime): ${minedData.totalClaimedSol.toFixed(9)} SOL`);
  console.log(`   📈 Pending Rewards: ${position?.pendingRewards.toFixed(9) || 0} SOL`);
  console.log(`   🎯 Pool Share: ${poolShare.toFixed(6)}%`);
  console.log(`   💵 MKIN Balance: ${user.totalRealmkin.toLocaleString()}`);
  
  return {
    staked,
    totalMined: minedData.totalMined,
    totalClaimed: minedData.totalClaimedSol,
    pendingRewards: position?.pendingRewards || 0,
    poolShare,
  };
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const task = args[0]?.toLowerCase();
  const username1 = args[1];
  const amount = args[2] ? parseInt(args[2], 10) : 50000000;
  const username2 = args[2] && !args[2].match(/^\d+$/) ? args[2] : "miaisobelck10";
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔧 REALMKIN ADMINISTRATIVE TASKS`);
  console.log("=".repeat(80));
  console.log(`   Task: ${task || "none specified"}`);
  console.log(`   Args: ${args.join(", ") || "none"}`);
  
  try {
    if (task === "add-stake" && username1) {
      await addStake(username1, amount);
    } else if (task === "get-info" && username1) {
      await getInfo(username1);
    } else if (task === "both") {
      // Run both tasks: add 50M to Kristovvvvv, get info for miaisobelck10
      const user1 = username1 || "Kristovvvvv";
      const user2 = username2 || "miaisobelck10";
      const stakeAmount = amount || 50000000;
      
      console.log(`\n📋 Running both tasks:`);
      console.log(`   1. Add ${stakeAmount.toLocaleString()} MKIN to ${user1}`);
      console.log(`   2. Get info for ${user2}`);
      
      await addStake(user1, stakeAmount);
      await getInfo(user2);
    } else {
      console.log(`\n❌ Invalid usage`);
      console.log(`\nUsage:`);
      console.log(`  node scripts/admin-tasks.js add-stake <username> [amount]`);
      console.log(`  node scripts/admin-tasks.js get-info <username>`);
      console.log(`  node scripts/admin-tasks.js both [username1] [username2]`);
      console.log(`\nExamples:`);
      console.log(`  node scripts/admin-tasks.js add-stake Kristovvvvv 50000000`);
      console.log(`  node scripts/admin-tasks.js get-info miaisobelck10`);
      console.log(`  node scripts/admin-tasks.js both`);
    }
  } catch (error) {
    console.error(`\n❌ FATAL ERROR:`, error.message);
    console.error(`   Stack:`, error.stack);
    process.exit(1);
  }
  
  console.log(`\n✅ Script completed`);
  process.exit(0);
}

// Run main
main().catch(console.error);
