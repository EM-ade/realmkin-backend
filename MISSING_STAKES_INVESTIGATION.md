# Missing Stakes Investigation & Fix Plan

## Issue Report
**User Wallet:** `7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC`
**Reported:** User staked ~2,339,979 MKIN but platform only shows 1,200,891 MKIN
**Missing:** ~1,139,088 MKIN

**User's Transaction History (from Discord):**
| Amount | Date | Signature |
|--------|------|-----------|
| 500,000 MKIN | ~20 days ago | `2vRHfxBK94XZrau...` |
| 700,891 MKIN | ~18 days ago | `5m8Lq73yW67JgGnh...` |
| 1,139,087 MKIN | ~9 days ago | `8R3hbeM5KQUQcR3U...` |

All transactions were made **before March 31st** as advised.

---

## Root Cause Analysis

### System Architecture
The staking system has **two data stores** that should be synchronized:

1. **Current System** (`/api/staking/stake`):
   - Writes to `staking_positions/{firebaseUid}`
   - What the staking page **displays**
   - Requires on-chain transaction verification

2. **Legacy System** (`/api/stake` - Next.js API route):
   - Writes to `users/{uid}/stakes/{stakeId}` subcollection
   - **Not displayed** on staking page
   - No on-chain verification

### Possible Causes

#### Cause A: Legacy Stakes Not Migrated ⭐ MOST LIKELY
User's stakes were recorded via the legacy `/api/stake` endpoint which writes to `users/{uid}/stakes/` instead of `staking_positions/{uid}`. The staking page only reads from `staking_positions`, so legacy stakes don't appear.

**Evidence:**
- User mentioned all stakes done before March 31st
- Legacy endpoint exists in codebase at `realmkin/src/app/api/stake/route.ts`
- No migration has been run to sync legacy stakes

#### Cause B: Wallet Not Registered in Firestore
Backend's `stakingService.stake()` looks up user's wallet from `userRewards/{firebaseUid}.walletAddress`. If the wallet isn't registered, verification fails silently.

#### Cause C: Transaction Verification Failed
Backend verifies on-chain transactions but may have failed due to:
- Fee mismatch (changed from 5% to $10 flat on March 26)
- Timing issues between frontend and backend
- RPC errors during verification

#### Cause D: Duplicate/Firestore Transaction Issue
Stake was partially recorded but Firestore transaction failed midway, leaving inconsistent state.

---

## Fix Plan

### Phase 1: Diagnose ✅ (Scripts Created)

**Scripts created:**
1. `backend-api/scripts/investigate_missing_stakes.js` - Find user and check both collections
2. `backend-api/scripts/migrate_legacy_stakes.js` - Migrate legacy stakes to positions
3. `backend-api/scripts/diagnose_staking_issue.js` - Comprehensive diagnostic tool

**Usage:**
```bash
# Step 1: Run diagnosis
cd backend-api
node scripts/diagnose_staking_issue.js 7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC

# Step 2: If legacy stakes found, migrate them
node scripts/migrate_legacy_stakes.js <firebase_uid> --dry-run  # Preview
node scripts/migrate_legacy_stakes.js <firebase_uid>            # Execute
```

### Phase 2: Fix Data Issues ⏳

**If legacy stakes found:**
```bash
# Run migration for specific user
node scripts/migrate_legacy_stakes.js <firebase_uid>
```

**If no stakes found anywhere:**
1. Get transaction signatures from user
2. Verify on-chain using Solscan
3. Create manual credit script with verified transactions
4. Run credit script to add stakes

### Phase 3: Prevent Future Issues ⏳

#### 3.1 Deprecate Legacy Endpoint
**File:** `realmkin/src/app/api/stake/route.ts`

Add deprecation warning and redirect to backend API:
```typescript
// Add at top of POST handler
console.warn("⚠️ DEPRECATED: /api/stake is deprecated. Use /api/staking/stake instead");
```

#### 3.2 Add Discord Alert for Failed Stakes
**File:** `backend-api/services/stakingService.js`

When stake verification fails, send Discord alert (similar to claim/unstake failures):
```javascript
// In stake() method, after verification failure:
await sendDiscordAlert({
  channel: process.env.STAKING_ALERTS_CHANNEL,
  message: `❌ Stake verification failed for user ${firebaseUid}`,
  data: { amount, txSignature, feeSignature, error }
});
```

#### 3.3 Add Admin Endpoint for Missing Stakes
**File:** `backend-api/routes/staking.js`

Add endpoint to detect and list missing stakes:
```javascript
// GET /api/staking/admin/missing-stakes
router.get("/admin/missing-stakes", verifyAdmin, async (req, res) => {
  // Compare users/{uid}/stakes/ vs staking_positions/{uid}
  // Return list of users with discrepancies
});
```

---

## Files Created

| File | Purpose |
|------|---------|
| `backend-api/scripts/investigate_missing_stakes.js` | Find user, check both collections, report discrepancies |
| `backend-api/scripts/migrate_legacy_stakes.js` | Migrate legacy stakes to staking_positions |
| `backend-api/scripts/diagnose_staking_issue.js` | Comprehensive diagnostic with recommendations |

## Files to Modify

| File | Change |
|------|--------|
| `realmkin/src/app/api/stake/route.ts` | Add deprecation warning |
| `backend-api/services/stakingService.js` | Add Discord alert on verification failure |
| `backend-api/routes/staking.js` | Add admin endpoint for missing stakes |

---

## Next Steps

1. **Run diagnosis** on affected user:
   ```bash
   cd backend-api
   node scripts/diagnose_staking_issue.js 7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC
   ```

2. **Based on diagnosis output:**
   - If legacy stakes found → Run migration script
   - If no stakes found → Manually credit verified transactions
   - If wallet not registered → Register wallet and reprocess

3. **Verify fix:**
   - User's staking page should show correct balance
   - `staking_positions/{uid}.principal_amount` should match blockchain

4. **Implement prevention:**
   - Deprecate legacy endpoint
   - Add Discord alerts
   - Add admin monitoring endpoint

---

## Testing Checklist

- [ ] Diagnosis script runs successfully
- [ ] Migration script works in dry-run mode
- [ ] Migration script commits correctly
- [ ] User's staking page shows correct balance after migration
- [ ] New stakes continue to work correctly
- [ ] Discord alerts trigger on verification failures
- [ ] Admin endpoint lists users with discrepancies

---

## Notes

- **Fee Structure Change:** On March 26, 2026, staking fee changed from 5% to $10 flat
- **User's stakes were before March 31**, so they may have paid old fee structure
- **Tolerance is 100%** in fee verification, so fee mismatch should not cause failures
- **Most likely cause** is legacy stakes in wrong collection not being displayed
