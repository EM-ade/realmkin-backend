/**
 * Calculate total staking rewards claimed (in SOL)
 * Queries staking_transactions collection for claim records
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Firebase
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (error) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
} else {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}

const db = admin.firestore();

async function calculateTotalClaims() {
  try {
    console.log('🔍 Calculating Total Staking Claims...\n');
    console.log('='.repeat(80));
    
    // Get staking_global state
    console.log('📊 Step 1: Getting current reward pool state...\n');
    try {
      const globalRef = db.collection('staking_pool').doc('staking_global');
      const globalDoc = await globalRef.get();
      
      if (globalDoc.exists) {
        const globalData = globalDoc.data();
        console.log('Current Staking Pool State:');
        console.log(`   Total Staked: ${globalData.total_staked?.toLocaleString() || 0} MKIN`);
        console.log(`   Reward Pool SOL: ${globalData.reward_pool_sol?.toFixed(6) || 0} SOL`);
        console.log(`   Last Reward Time: ${globalData.last_reward_time?.toDate().toISOString() || 'N/A'}`);
        console.log(`   Acc Reward/Share: ${globalData.acc_reward_per_share || 0}\n`);
      } else {
        console.log('⚠️ No global staking state found\n');
      }
    } catch (err) {
      console.log('⚠️ Could not access staking_pool collection:', err.message);
      console.log('   (This is OK if using different database)\n');
    }
    
    // Get all staking transactions
    console.log('📊 Step 2: Querying staking transactions...\n');
    
    // Try to get claim transactions
    console.log('   Checking staking_transactions collection...');
    const transactionsSnapshot = await db.collection('staking_transactions')
      .where('type', '==', 'claim')
      .get();
    
    console.log(`   Found ${transactionsSnapshot.size} claim transactions\n`);
    
    let totalClaimedSOL = 0;
    let totalClaimedMKIN = 0;
    let claimsByUser = new Map();
    const recentClaims = [];
    
    transactionsSnapshot.forEach(doc => {
      const tx = doc.data();
      const solAmount = tx.sol_amount || tx.amount_sol || tx.reward_amount || 0;
      const mkinAmount = tx.mkin_amount || tx.amount || 0;
      const userId = tx.user_id || tx.wallet || 'unknown';
      const timestamp = tx.timestamp || tx.created_at || tx.claimed_at;
      
      totalClaimedSOL += solAmount;
      totalClaimedMKIN += mkinAmount;
      
      // Track per user
      if (!claimsByUser.has(userId)) {
        claimsByUser.set(userId, { sol: 0, mkin: 0, count: 0 });
      }
      const userStats = claimsByUser.get(userId);
      userStats.sol += solAmount;
      userStats.mkin += mkinAmount;
      userStats.count++;
      
      // Track recent claims
      recentClaims.push({
        id: doc.id,
        user: userId.substring(0, 8) + '...',
        solAmount,
        mkinAmount,
        timestamp: timestamp?.toDate?.() || new Date(timestamp)
      });
    });
    
    // Sort recent claims by date
    recentClaims.sort((a, b) => b.timestamp - a.timestamp);
    
    // Alternative: Check stakes collection for rewards_earned
    console.log('📊 Step 3: Checking stakes collection for earned rewards...\n');
    
    const stakesSnapshot = await db.collectionGroup('stakes').get();
    console.log(`   Found ${stakesSnapshot.size} total stakes\n`);
    
    let totalRewardsFromStakes = 0;
    let activeStakes = 0;
    let completedStakes = 0;
    
    stakesSnapshot.forEach(doc => {
      const stake = doc.data();
      const rewardsEarned = stake.rewards_earned || 0;
      totalRewardsFromStakes += rewardsEarned;
      
      if (stake.status === 'active') activeStakes++;
      else if (stake.status === 'completed') completedStakes++;
    });
    
    // Display results
    console.log('='.repeat(80));
    console.log('📈 STAKING CLAIMS SUMMARY');
    console.log('='.repeat(80));
    
    console.log('\n💰 FROM TRANSACTION HISTORY:');
    console.log(`   Total Claims: ${transactionsSnapshot.size}`);
    console.log(`   Total Claimed (SOL): ${totalClaimedSOL.toFixed(6)} SOL`);
    console.log(`   Total Claimed (MKIN): ${totalClaimedMKIN.toLocaleString()} MKIN`);
    console.log(`   Unique Claimers: ${claimsByUser.size}`);
    
    console.log('\n💎 FROM STAKES COLLECTION:');
    console.log(`   Total Stakes: ${stakesSnapshot.size}`);
    console.log(`   Active Stakes: ${activeStakes}`);
    console.log(`   Completed Stakes: ${completedStakes}`);
    console.log(`   Total Rewards Earned: ${totalRewardsFromStakes.toLocaleString()} MKIN`);
    
    // Calculate value at current SOL price (~$170)
    const solPriceUSD = 170;
    const totalValueUSD = totalClaimedSOL * solPriceUSD;
    
    console.log('\n💵 VALUE ESTIMATE:');
    console.log(`   SOL Price: $${solPriceUSD}`);
    console.log(`   Total Value Claimed: ~$${totalValueUSD.toFixed(2)} USD`);
    
    console.log('\n='.repeat(80));
    
    // Top claimers
    if (claimsByUser.size > 0) {
      const topClaimers = Array.from(claimsByUser.entries())
        .map(([userId, stats]) => ({
          user: userId.substring(0, 8) + '...',
          ...stats
        }))
        .sort((a, b) => b.sol - a.sol);
      
      console.log('\n🏆 TOP 10 CLAIMERS (by SOL):');
      console.log('-'.repeat(80));
      console.log('Rank | User        | Claims | SOL Amount    | MKIN Amount');
      console.log('-'.repeat(80));
      
      topClaimers.slice(0, 10).forEach((user, index) => {
        console.log(
          `${(index + 1).toString().padStart(4)} | ` +
          `${user.user.padEnd(11)} | ` +
          `${user.count.toString().padStart(6)} | ` +
          `${user.sol.toFixed(6).padStart(13)} | ` +
          `${user.mkin.toLocaleString().padStart(11)}`
        );
      });
      console.log('-'.repeat(80));
    }
    
    // Recent claims
    if (recentClaims.length > 0) {
      console.log('\n📅 RECENT CLAIMS (Last 10):');
      console.log('-'.repeat(80));
      console.log('Date                 | User        | SOL       | MKIN');
      console.log('-'.repeat(80));
      
      recentClaims.slice(0, 10).forEach(claim => {
        console.log(
          `${claim.timestamp.toISOString().substring(0, 19).replace('T', ' ')} | ` +
          `${claim.user.padEnd(11)} | ` +
          `${claim.solAmount.toFixed(4).padStart(9)} | ` +
          `${claim.mkinAmount.toFixed(2)}`
        );
      });
      console.log('-'.repeat(80));
    }
    
    console.log('\n✅ Calculation complete!\n');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error calculating claims:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

calculateTotalClaims();
