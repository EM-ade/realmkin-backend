/**
 * Revenue Share Formula Test Script
 * 
 * Tests the multi-tier reward calculation for February 2026+
 * Run: node backend-api/scripts/test-revenue-share-formula.js
 */

import { 
  REWARD_TIERS,
  calculateHolderShare,
  calculateTier3Rewards,
  calculateRankBasedRewards,
  mergeUserAllocations,
  getTierInformation,
} from '../utils/rewardTierCalculator.js';

console.log('🧪 Testing Revenue Share Formula - February 2026\n');

// Test data
const mockHolders = [
  { userId: 'user1', walletAddress: 'wallet1', nftCount: 10 },
  { userId: 'user2', walletAddress: 'wallet2', nftCount: 20 },
  { userId: 'user3', walletAddress: 'wallet3', nftCount: 5 },
  { userId: 'user4', walletAddress: 'wallet4', nftCount: 15 },
  { userId: 'user5', walletAddress: 'wallet5', nftCount: 8 },
];

const mockLeaderboard = [
  { userId: 'user1', walletAddress: 'wallet1', username: 'Alice', purchaseCount: 15 },
  { userId: 'user2', walletAddress: 'wallet2', username: 'Bob', purchaseCount: 10 },
  { userId: 'user3', walletAddress: 'wallet3', username: 'Charlie', purchaseCount: 5 },
  { userId: 'user4', walletAddress: 'wallet4', username: 'Diana', purchaseCount: 3 },
  { userId: 'user5', walletAddress: 'wallet5', username: 'Eve', purchaseCount: 2 },
];

const TOTAL_ROYALTY_POOL_USD = 1000; // $1000 for testing

console.log('📊 Test Configuration:');
console.log(`   Total Royalty Pool: $${TOTAL_ROYALTY_POOL_USD} USD`);
console.log(`   Holders: ${mockHolders.length}`);
console.log(`   Leaderboard entries: ${mockLeaderboard.length}\n`);

// Test Holder Share
console.log('🏰 Testing Holder Share (35% royalty pool)...');
const holderSharePool = TOTAL_ROYALTY_POOL_USD * REWARD_TIERS.HOLDER_SHARE.royaltyPercentage;
console.log(`   Pool: $${holderSharePool} USD (35% of $${TOTAL_ROYALTY_POOL_USD})`);

const holderAllocations = calculateHolderShare(mockHolders, holderSharePool);
console.log('   Results:');
holderAllocations.forEach(h => {
  console.log(`   - ${h.userId}: ${h.nftCount} NFTs → $${(h.amountSol * 140).toFixed(2)} USD ≈ ${h.amountSol.toFixed(6)} SOL`);
});

// Test Tier 3
console.log('\n🔱 Testing Tier 3 (Special Perks - 12+ NFTs)...');
const tier3Eligible = mockHolders.filter(u => u.nftCount >= REWARD_TIERS.TIER_3.minNfts);
console.log(`   Eligible users: ${tier3Eligible.length} (12+ NFTs)`);

const purchaseMap = new Map(mockLeaderboard.map(u => [u.walletAddress, u.purchaseCount]));
const tier3Allocations = calculateTier3Rewards(tier3Eligible, purchaseMap);
console.log('   Results:');
tier3Allocations.forEach(t => {
  const purchases = purchaseMap.get(t.walletAddress) || 0;
  console.log(`   - ${t.userId}: ${purchases} purchases → ${t.amountSol.toFixed(6)} SOL`);
});

// Test Tier 2
console.log('\n⚔️  Testing Tier 2 (Top 5)...');
const tier2Allocations = calculateRankBasedRewards(mockLeaderboard, 'TIER_2');
console.log('   Results:');
tier2Allocations.forEach(t => {
  console.log(`   - Rank ${t.rank}: ${t.username} → ${t.amountMkin.toLocaleString()} MKIN + ${t.amountSol.toFixed(6)} SOL`);
});

// Test Tier 1
console.log('\n👑 Testing Tier 1 (Top 3)...');
const tier1Allocations = calculateRankBasedRewards(mockLeaderboard, 'TIER_1');
console.log('   Results:');
tier1Allocations.forEach(t => {
  console.log(`   - Rank ${t.rank}: ${t.username} → ${t.amountEmpire.toLocaleString()} EMPIRE + ${t.amountMkin.toLocaleString()} MKIN + ${t.amountSol.toFixed(6)} SOL`);
});

// Test Merge
console.log('\n🔀 Testing Allocation Merge...');
const allAllocations = [...holderAllocations, ...tier3Allocations, ...tier2Allocations, ...tier1Allocations];
const merged = mergeUserAllocations(allAllocations);
console.log(`   Merged ${allAllocations.length} tier allocations → ${merged.length} unique users`);

console.log('\n📋 Final User Rewards Summary:');
merged.forEach(u => {
  console.log(`\n   ${u.userId} (${u.username || 'Unknown'}):`);
  console.log(`   Tiers: ${u.tiers.join(', ')}`);
  console.log(`   Total: ${u.amountSol.toFixed(6)} SOL + ${u.amountMkin.toLocaleString()} MKIN + ${u.amountEmpire.toLocaleString()} EMPIRE`);
  
  if (u.holderShare) {
    console.log(`     • Holder Share: ${u.holderShare.amountSol.toFixed(6)} SOL`);
  }
  if (u.tier3) {
    console.log(`     • Tier 3: ${u.tier3.amountSol.toFixed(6)} SOL`);
  }
  if (u.tier2) {
    console.log(`     • Tier 2: ${u.tier2.amountMkin.toLocaleString()} MKIN`);
  }
  if (u.tier1) {
    console.log(`     • Tier 1: ${u.tier1.empire.toLocaleString()} EMPIRE + ${u.tier1.amountMkin.toLocaleString()} MKIN`);
  }
});

// Test tier information
console.log('\n📖 Tier Information:');
const tierInfo = getTierInformation();
Object.entries(tierInfo).forEach(([key, info]) => {
  console.log(`   ${info.icon} ${info.name}: ${info.requirement} → ${info.reward}`);
});

// Verify totals
console.log('\n✅ Verification:');
const totalSol = merged.reduce((sum, u) => sum + u.amountSol, 0);
const totalMkin = merged.reduce((sum, u) => sum + u.amountMkin, 0);
const totalEmpire = merged.reduce((sum, u) => sum + u.amountEmpire, 0);

console.log(`   Total SOL distributed: ${totalSol.toFixed(6)} SOL`);
console.log(`   Total MKIN distributed: ${totalMkin.toLocaleString()} MKIN`);
console.log(`   Total EMPIRE distributed: ${totalEmpire.toLocaleString()} EMPIRE`);

// Expected pools
const expectedSol = REWARD_TIERS.TIER_3.poolSol + REWARD_TIERS.TIER_2.poolSol + REWARD_TIERS.TIER_1.poolSol;
const expectedMkin = REWARD_TIERS.TIER_2.poolMkin + REWARD_TIERS.TIER_1.poolMkin;
const expectedEmpire = REWARD_TIERS.TIER_1.poolEmpire;

console.log(`\n   Expected SOL: ${expectedSol} SOL (Tier 3: 1.5 + Tier 2: 1.5 + Tier 1: 1.5)`);
console.log(`   Expected MKIN: ${expectedMkin.toLocaleString()} (Tier 2: 300K + Tier 1: 300K)`);
console.log(`   Expected EMPIRE: ${expectedEmpire.toLocaleString()} (Tier 1: 450K)`);

const solDiff = Math.abs(totalSol - expectedSol);
const mkinDiff = Math.abs(totalMkin - expectedMkin);
const empireDiff = Math.abs(totalEmpire - expectedEmpire);

if (solDiff < 0.0001 && mkinDiff < 1 && empireDiff < 1) {
  console.log('\n✅ All totals match expected values!');
} else {
  console.log('\n⚠️  Warning: Totals do not match expected values!');
  console.log(`   SOL diff: ${solDiff.toFixed(6)}`);
  console.log(`   MKIN diff: ${mkinDiff}`);
  console.log(`   EMPIRE diff: ${empireDiff}`);
}

console.log('\n✨ All tests completed!\n');
