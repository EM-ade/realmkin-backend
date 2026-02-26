# Revenue Share Formula - February 2026

## Overview

Starting February 2026, Realmkin implements a **multi-tier reward structure** to incentivize:
1. **Holding** - Long-term holders get 35% of royalty pool
2. **Secondary Market Activity** - Active buyers climb the leaderboard
3. **Top Performers** - Top buyers get exclusive EMPIRE and MKIN rewards

---

## Reward Tiers

### 🏰 Holder Share (35% Royalty Pool)

**Eligibility:** Hold 1+ Realmkin NFTs (listed or unlisted)

**Distribution:** Proportional to total NFT holdings

**Reward Pool:** 35% of monthly royalty revenue

**Example:**
```
Total royalty pool: $1,000 USD
Holder share: $350 (35%)
Your holdings: 10 NFTs
Total eligible NFTs: 1,000
Your share: (10/1000) × $350 = $3.50 USD ≈ 0.025 SOL
```

---

### 🔱 Tier 3: Special Perks

**Eligibility:** Mint 12+ Realmkin NFTs

**Reward Pool:** 1.5 SOL

**Distribution:** Based on secondary market purchase count

**Example:**
```
Your secondary purchases: 15
Total purchases by eligible users: 150
Your share: (15/150) × 1.5 SOL = 0.15 SOL
```

---

### ⚔️ Tier 2: Top 5

**Eligibility:** Top 5 on secondary market leaderboard

**Reward Pool:**
- 300,000 $MKIN
- 1.5 SOL (shared pool)

**Rank Distribution:**
| Rank | MKIN | SOL |
|------|------|-----|
| 1st | 150,000 (50%) | 0.75 |
| 2nd | 90,000 (30%) | 0.45 |
| 3rd | 45,000 (15%) | 0.225 |
| 4th | 9,000 (3%) | 0.045 |
| 5th | 6,000 (2%) | 0.03 |

---

### 👑 Tier 1: Top 3

**Eligibility:** Top 3 on secondary market leaderboard

**Reward Pool:**
- 450,000 $EMPIRE
- 300,000 $MKIN
- 1.5 SOL (shared pool)

**Rank Distribution:**
| Rank | EMPIRE | MKIN | SOL |
|------|--------|------|-----|
| 1st | 270,000 (60%) | 180,000 (60%) | 0.90 |
| 2nd | 135,000 (30%) | 90,000 (30%) | 0.45 |
| 3rd | 45,000 (10%) | 30,000 (10%) | 0.15 |

---

## Distribution Schedule

**When:** Last day of every month at 23:00 UTC

**Claim Period:** 30 days from distribution date

**Example:**
```
Distribution date: February 28, 2026 23:00 UTC
Claim deadline: March 30, 2026 23:00 UTC
```

---

## Leaderboard Calculation

**Ranking Criteria:** Monthly secondary market purchases (not total holdings)

**Reset:** First day of each month

**Data Source:** Magic Eden buyNow transactions via holder_stats API

**Update Frequency:** Real-time (cached for 5 minutes)

**API Endpoint:** `GET /api/leaderboard/secondary-market`

---

## How to Maximize Rewards

1. **Hold More NFTs** → Higher holder share (35% royalty pool)
2. **Mint 12+ NFTs** → Unlock Tier 3 (1.5 SOL pool)
3. **Buy from Secondary Market** → Climb leaderboard
4. **Reach Top 5** → Unlock Tier 2 (300K MKIN + SOL)
5. **Reach Top 3** → Unlock Tier 1 (450K EMPIRE + 300K MKIN + SOL)

**Note:** Users can receive rewards from **multiple tiers simultaneously**!

---

## API Endpoints

### Check Eligibility
```bash
GET /api/revenue-distribution/check-eligibility
Authorization: Bearer {firebaseToken}
```

### Response Example
```json
{
  "success": true,
  "eligible": true,
  "distributionId": "revenue_dist_2026_02",
  "distributionMonth": "February 2026",
  "userTiers": ["HOLDER_SHARE", "TIER_3", "TIER_2"],
  "amountSol": 1.85,
  "amountEmpire": 135000,
  "amountMkin": 270000,
  "tierBreakdown": {
    "holderShare": {
      "sol": 0.35,
      "empire": 0,
      "mkin": 0
    },
    "tier3": {
      "sol": 0.15,
      "empire": 0,
      "mkin": 0
    },
    "tier2": {
      "sol": 0.45,
      "empire": 0,
      "mkin": 90000
    },
    "tier1": {
      "sol": 0.90,
      "empire": 135000,
      "mkin": 180000
    }
  },
  "claimFeeUsd": 1.00,
  "expiresAt": "2026-03-30T23:00:00.000Z"
}
```

### Secondary Market Leaderboard
```bash
GET /api/leaderboard/secondary-market?limit=10
```

### Top 3 Secondary Buyers
```bash
GET /api/leaderboard/secondary-market/top3
```

---

## Environment Variables

Add to your `.env` file:

```bash
# Revenue Distribution Configuration
REVENUE_DISTRIBUTION_ROYALTY_POOL_USD=1000  # Total monthly royalty pool
REVENUE_DISTRIBUTION_DAY=last               # 'last' or day number (1-31)

# Existing variables (still used)
REVENUE_DISTRIBUTION_AMOUNT_USD=5.00        # Legacy compatibility
REVENUE_DISTRIBUTION_MIN_NFTS=1
REVENUE_DISTRIBUTION_CLAIM_FEE_USD=1.00
REVENUE_DISTRIBUTION_EXPIRY_DAYS=30
REVENUE_DISTRIBUTION_SECRET_TOKEN=your-secret-token
```

---

## Testing

### Run Test Script
```bash
cd backend-api
node scripts/test-revenue-share-formula.js
```

**Expected Output:**
```
🧪 Testing Revenue Share Formula - February 2026

🏰 Testing Holder Share (35% royalty pool)...
   Results: 5 users

🔱 Testing Tier 3 (Special Perks - 12+ NFTs)...
   Eligible users: 2

⚔️  Testing Tier 2 (Top 5)...
   Results: 5 users

👑 Testing Tier 1 (Top 3)...
   Results: 3 users

✅ Verification:
   Total MKIN distributed: 600,000 MKIN
   Total EMPIRE distributed: 450,000 EMPIRE
   ✨ All tests completed!
```

---

## Implementation Details

### Backend Files
- `utils/rewardTierCalculator.js` - Multi-tier calculation logic
- `utils/distributionScheduler.js` - End-of-month scheduling
- `routes/revenue-distribution.js` - Updated allocation logic
- `routes/leaderboard.js` - Secondary market endpoints

### Frontend Files
- `components/account/RevenueDistributionCard.tsx` - Tier display
- `app/account/page.tsx` - Account page integration

### Key Functions
```javascript
// Calculate holder share (35% royalty)
calculateHolderShare(holders, totalRoyaltyPool)

// Calculate Tier 3 (12+ NFTs)
calculateTier3Rewards(eligibleUsers, secondaryPurchaseMap)

// Calculate Tier 1 & Tier 2 (rank-based)
calculateRankBasedRewards(leaderboard, 'TIER_1' | 'TIER_2')

// Merge multiple tiers per user
mergeUserAllocations(allTierAllocations)
```

---

## FAQ

**Q: Can I be in multiple tiers?**  
A: Yes! A user can receive rewards from all 4 tiers simultaneously.

**Q: Do listed NFTs count for Holder Share?**  
A: Yes, both listed and unlisted NFTs count toward your holdings.

**Q: How often does the leaderboard reset?**  
A: Monthly, on the first day of each month at 00:00 UTC.

**Q: What happens if I don't claim?**  
A: Unclaimed rewards expire after 30 days and return to the treasury.

**Q: How is the leaderboard calculated?**  
A: Based on monthly secondary market purchases (Magic Eden buyNow transactions), not total holdings.

**Q: What if I mint 12+ but don't buy from secondary market?**  
A: You qualify for Tier 3, but your share depends on your secondary market purchases. If you have 0 purchases, the Tier 3 pool is distributed equally among eligible users with no purchase data.

---

## Migration Notes

### From Legacy System (Pre-February 2026)

**Old Formula:**
- Single pool: 0.16 SOL + 22,500 EMPIRE + 100,000 MKIN
- Distributed to all holders (1+ NFT) proportionally

**New Formula:**
- Multi-tier structure with separate pools
- Leaderboard-based rewards for active buyers
- Higher total rewards for engaged users

**Backward Compatibility:**
- Legacy fields maintained in Firestore
- Old claims still accessible via history endpoint
- `allocatedAmountUsd` field kept for compatibility

---

## Support Resources

- **Test Script**: `backend-api/scripts/test-revenue-share-formula.js`
- **Calculator**: `backend-api/utils/rewardTierCalculator.js`
- **Scheduler**: `backend-api/utils/distributionScheduler.js`

---

**Last Updated:** February 22, 2026  
**Version:** 2.0 (Multi-Tier)
