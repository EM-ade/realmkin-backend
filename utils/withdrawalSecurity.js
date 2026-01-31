/**
 * Withdrawal Security Utilities
 * Handles fee verification, replay prevention, and security checks
 */

import { PublicKey } from '@solana/web3.js';

/**
 * Verify that a fee transaction actually sent SOL to the treasury
 * @param {Object} txInfo - Transaction info from getTransaction
 * @param {string} expectedTreasuryAddress - Expected treasury wallet address
 * @param {string} expectedUserAddress - Expected user wallet address
 * @param {number} expectedFeeLamports - Expected fee amount in lamports
 * @returns {Object} { valid: boolean, error?: string, actualFee?: number }
 */
function verifyFeeTransaction(txInfo, expectedTreasuryAddress, expectedUserAddress, expectedFeeLamports) {
  try {
    if (!txInfo || txInfo.meta?.err) {
      return { valid: false, error: 'Transaction failed or not found' };
    }

    const treasuryPubkey = new PublicKey(expectedTreasuryAddress);
    const userPubkey = new PublicKey(expectedUserAddress);

    // Get account keys
    const accountKeys = txInfo.transaction.message.getAccountKeys();
    
    // Find treasury and user indices
    const treasuryIndex = accountKeys.staticAccountKeys.findIndex(
      key => key.equals(treasuryPubkey)
    );
    const userIndex = accountKeys.staticAccountKeys.findIndex(
      key => key.equals(userPubkey)
    );

    if (treasuryIndex === -1) {
      return { valid: false, error: 'Treasury wallet not found in transaction' };
    }

    if (userIndex === -1) {
      return { valid: false, error: 'User wallet not found in transaction' };
    }

    // Check balance changes
    const preBalances = txInfo.meta.preBalances;
    const postBalances = txInfo.meta.postBalances;

    if (!preBalances || !postBalances) {
      return { valid: false, error: 'Cannot verify transaction balances' };
    }

    const treasuryBalanceIncrease = postBalances[treasuryIndex] - preBalances[treasuryIndex];
    const userBalanceDecrease = preBalances[userIndex] - postBalances[userIndex];

    // Treasury must have received SOL
    if (treasuryBalanceIncrease <= 0) {
      return { valid: false, error: 'Treasury did not receive SOL' };
    }

    // Verify the amount is reasonable (within 20% of expected due to price fluctuations)
    const minFeeLamports = Math.floor(expectedFeeLamports * 0.8);
    const maxFeeLamports = Math.floor(expectedFeeLamports * 1.2);

    if (treasuryBalanceIncrease < minFeeLamports) {
      return { 
        valid: false, 
        error: 'Fee amount too low. Paid: ' + treasuryBalanceIncrease + ' lamports, Required: ~' + expectedFeeLamports + ' lamports',
        actualFee: treasuryBalanceIncrease
      };
    }

    if (treasuryBalanceIncrease > maxFeeLamports) {
      console.warn('[Fee Verification] Fee higher than expected (user overpaid): ' + treasuryBalanceIncrease + ' vs ' + expectedFeeLamports);
    }

    console.log('[Fee Verification] Valid! Treasury received: ' + treasuryBalanceIncrease + ' lamports');

    return { 
      valid: true, 
      actualFee: treasuryBalanceIncrease 
    };

  } catch (err) {
    console.error('[Fee Verification] Error:', err);
    return { valid: false, error: 'Failed to verify transaction: ' + err.message };
  }
}

/**
 * Check if a fee signature has already been used
 * @param {Object} firestore - Firestore instance
 * @param {string} feeSignature - Transaction signature
 * @returns {Promise<boolean>} True if already used
 */
async function isFeeSignatureUsed(firestore, feeSignature) {
  const usedFeesRef = firestore.collection('usedWithdrawalFees').doc(feeSignature);
  const doc = await usedFeesRef.get();
  return doc.exists;
}

/**
 * Mark a fee signature as used
 * @param {Object} firestore - Firestore instance
 * @param {string} feeSignature - Transaction signature
 * @param {Object} metadata - Additional data to store
 * @returns {Promise<void>}
 */
async function markFeeSignatureAsUsed(firestore, feeSignature, metadata) {
  const usedFeesRef = firestore.collection('usedWithdrawalFees').doc(feeSignature);
  await usedFeesRef.set({
    ...metadata,
    usedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Check if withdrawal request has expired
 * @param {number} createdAtMillis - When the withdrawal was initiated
 * @param {number} expiryWindowMs - How long the request is valid (default 90 seconds)
 * @returns {boolean} True if expired
 */
function isWithdrawalExpired(createdAtMillis, expiryWindowMs = 90000) {
  const now = Date.now();
  return (now - createdAtMillis) > expiryWindowMs;
}

export {
  verifyFeeTransaction,
  isFeeSignatureUsed,
  markFeeSignatureAsUsed,
  isWithdrawalExpired,
};
