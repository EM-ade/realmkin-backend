# Revenue Distribution Testing Scripts

This directory contains scripts to manually test the revenue distribution system without waiting for the monthly allocation process.

## Scripts Available

### 1. `test-add-manual-allocation.js`
Adds a test allocation for a specific wallet address.

### 2. `test-clear-allocation.js`
Removes test allocations to reset test state.

---

## Quick Start - Test for Wallet `F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU`

### Step 1: Add Test Allocation

```bash
cd gatekeeper/backend-api
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5
```

This will:
- ✅ Create or find user with wallet `F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU`
- ✅ Allocate $5 worth of tokens (0.1 SOL + 100 EMPIRE + 100 MKIN)
- ✅ Mark as test allocation
- ✅ Make eligible for claiming in current month

**Expected Output:**
```
🧪 TEST SCRIPT: Add Manual Allocation
================================================================================
Wallet: F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU
Amount: $5
================================================================================

🔍 Looking for user with wallet: F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU
✅ Found existing user: DiNTSZuqwmhs25YhHepo0BBpzyu1

📅 Distribution ID: 2026-02

💰 Allocation Details:
   NFT Count: 1
   Weight: 100%
   SOL: 0.100000 SOL
   EMPIRE: 100.00 EMPIRE
   MKIN: 100.00 MKIN
   USD Value: $5.00

📝 Writing allocation to Firestore...
✅ Allocation created successfully!

================================================================================
✅ TEST ALLOCATION COMPLETE
================================================================================
User ID: DiNTSZuqwmhs25YhHepo0BBpzyu1
Wallet: F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU
Distribution ID: 2026-02
Allocation Document ID: DiNTSZuqwmhs25YhHepo0BBpzyu1_2026-02
Amount: $5.00

💡 Next Steps:
   1. User can now check eligibility via: GET /api/revenue-distribution/check-eligibility
   2. User can claim via: POST /api/revenue-distribution/claim
   3. User will receive:
      - 0.100000 SOL
      - 100.00 EMPIRE
      - 100.00 MKIN
================================================================================
```

### Step 2: Check Eligibility (Frontend or API)

**Via Frontend:**
1. Go to the account page in the web app
2. Connect wallet `F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU`
3. You should see the revenue distribution card with claimable amount

**Via API (curl):**
```bash
# Get Firebase auth token first, then:
curl -X GET "http://localhost:3000/api/revenue-distribution/check-eligibility" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "eligible": true,
  "allocation": {
    "solShare": 0.1,
    "empireShare": 100,
    "mkinShare": 100,
    "allocatedAmountUsd": 5,
    "distributionId": "2026-02",
    "claimed": false
  },
  "message": "You have an unclaimed allocation for February 2026"
}
```

### Step 3: Test Claim Flow

**Via Frontend:**
1. Click "Claim Rewards" button
2. Pay the fee ($0.10 + token account creation fees)
3. Wait for confirmation
4. You should receive:
   - 0.1 SOL
   - 100 EMPIRE
   - 100 MKIN

**Via API:**
You need to:
1. Send fee payment transaction to gatekeeper
2. Get the transaction signature
3. Call the claim endpoint with the signature

### Step 4: Clean Up (After Testing)

```bash
cd gatekeeper/backend-api
node scripts/test-clear-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU
```

This will:
- ✅ Delete the test allocation
- ✅ Remove test user (if created by script)
- ✅ Reset state for next test

---

## Detailed Usage

### Add Allocation with Custom Amount

```bash
# Allocate $10 worth
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 10

# Allocate $50 worth
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 50
```

### Clear Specific Allocation

```bash
node scripts/test-clear-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU
```

### Clear All Test Allocations

```bash
node scripts/test-clear-allocation.js --all-test
```

This removes ALL test allocations and test users across all wallets.

---

## Testing Different Scenarios

### Scenario 1: First-Time User (No Wallet in System)

```bash
# Script will create a new test user
node scripts/test-add-manual-allocation.js 7xYZ1abc2def3ghi4jkl5mno6pqr7stu8vwx9yzA1BC 5
```

### Scenario 2: Existing User

```bash
# Script will find existing user and add allocation
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5
```

### Scenario 3: Multiple Allocations for Same User

```bash
# Add first allocation
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5

# Try to add second allocation (will warn about existing)
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 10
```

### Scenario 4: Test Claim Then Re-Test

```bash
# Add allocation
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5

# User claims via frontend/API...

# Clear to reset
node scripts/test-clear-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU

# Add new allocation for next test
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5
```

---

## Firestore Structure

### `userRewards` Collection

```javascript
{
  "DiNTSZuqwmhs25YhHepo0BBpzyu1": {
    "walletAddress": "F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU",
    "displayName": "Test User F1p6dNLS",
    "totalRealmkin": 1,
    "createdAt": Timestamp,
    "isTestUser": true  // Added by script
  }
}
```

### `revenue_allocations` Collection

```javascript
{
  "DiNTSZuqwmhs25YhHepo0BBpzyu1_2026-02": {
    "userId": "DiNTSZuqwmhs25YhHepo0BBpzyu1",
    "walletAddress": "F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU",
    "distributionId": "2026-02",
    "nftCount": 1,
    "weight": 100,
    "solShare": 0.1,
    "empireShare": 100,
    "mkinShare": 100,
    "allocatedAmountUsd": 5,
    "eligibleAt": Timestamp,
    "claimed": false,
    "claimedAt": null,
    "claimSignature": null,
    "isTestAllocation": true,  // Marks as test
    "createdByScript": true,   // Added by script
    "scriptRunAt": Timestamp
  }
}
```

---

## Environment Setup

Make sure you have:

1. **Firebase Service Account Key**
   - Set `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env`
   - Or place `serviceAccountKey.json` in `backend-api/` directory

2. **Firebase Admin SDK Access**
   - Read/write permissions on `userRewards` collection
   - Read/write permissions on `revenue_allocations` collection

3. **Node.js 18+**
   - Scripts use ES modules

---

## Troubleshooting

### Error: "Firebase service account not found"

**Solution:**
```bash
# Set environment variable
export FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json

# Or copy key to backend-api directory
cp /path/to/serviceAccountKey.json gatekeeper/backend-api/
```

### Error: "Allocation already exists and has been claimed"

**Solution:**
```bash
# Clear the existing allocation first
node scripts/test-clear-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU

# Then add new allocation
node scripts/test-add-manual-allocation.js F1p6dNLSSTHi4QkUkRVXZw8QurZJKUDcvVBjfF683nU 5
```

### Error: "Invalid Solana wallet address format"

**Solution:**
Make sure the wallet address is a valid base58-encoded Solana public key (32-44 characters).

---

## Safety Notes

⚠️ **Important:**
- These scripts are for **testing only**
- Test allocations are marked with `isTestAllocation: true`
- Test users are marked with `isTestUser: true`
- Always clean up test data after testing
- Don't use these scripts on production without understanding the implications

🔒 **Security:**
- Scripts require Firebase Admin SDK access
- Only run on development/staging environments
- Production allocations should use the official monthly allocation script

---

## Production vs Test Allocations

| Aspect | Test Allocation | Production Allocation |
|--------|----------------|----------------------|
| Created by | Manual script | Automated monthly job |
| Marked as test | ✅ Yes (`isTestAllocation: true`) | ❌ No |
| Amount | Any custom amount | Based on NFT holdings + secondary market activity |
| Eligibility | Immediate | After monthly calculation |
| Cleanup | Manual via script | Never (permanent record) |

---

## Next Steps

After successfully testing with the test allocation:

1. ✅ Verify the claim flow works end-to-end
2. ✅ Check transaction history shows the claim
3. ✅ Verify tokens are received in wallet
4. ✅ Test the fee validation logic
5. ✅ Clean up test data

Then you can confidently run the production monthly allocation!

---

**Created**: 2026-02-02
**Last Updated**: 2026-02-02
