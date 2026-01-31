/**
 * Withdrawal Transaction Logger
 * Logs all withdrawal attempts for auditing and manual intervention
 */

import sql from '../db.js'; // Keep as ../ since this file is in services/ subdirectory

class WithdrawalLogger {
  /**
   * Log initiation of a withdrawal
   * @returns {number} - Transaction log ID
   */
  async logInitiate(userId, walletAddress, amount, feeDetails, ipAddress = null, userAgent = null) {
    try {
      const result = await sql`
        INSERT INTO withdrawal_transactions (
          user_id, wallet_address, amount_mkin, 
          fee_amount_sol, fee_amount_usd, sol_price_usd,
          status, ip_address, user_agent
        ) VALUES (
          ${userId}, ${walletAddress}, ${amount}, 
          ${feeDetails.feeAmountSol}, ${feeDetails.feeAmountUsd}, ${feeDetails.solPrice},
          'initiated', ${ipAddress}, ${userAgent}
        )
        RETURNING id
      `;

      const logId = result[0].id;
      console.log(`[WithdrawalLogger] Initiated: ID ${logId}, User: ${userId}, Amount: ${amount} MKIN`);
      return logId;
    } catch (error) {
      console.error('[WithdrawalLogger] Error logging initiation:', error);
      return null;
    }
  }

  /**
   * Update log when fee is verified
   */
  async logFeeVerified(logId, feeSignature, balanceBefore, balanceAfter) {
    try {
      await sql`
        UPDATE withdrawal_transactions 
        SET status = 'fee_verified', 
            fee_tx_signature = ${feeSignature},
            fee_verified_at = NOW(),
            balance_before = ${balanceBefore},
            balance_after = ${balanceAfter},
            balance_deducted = TRUE
        WHERE id = ${logId}
      `;

      console.log(`[WithdrawalLogger] Fee verified: ID ${logId}, TX: ${feeSignature}`);
    } catch (error) {
      console.error('[WithdrawalLogger] Error logging fee verification:', error);
    }
  }

  /**
   * Update log when withdrawal completes successfully
   */
  async logCompleted(logId, mkinSignature) {
    try {
      await sql`
        UPDATE withdrawal_transactions 
        SET status = 'completed',
            mkin_tx_signature = ${mkinSignature},
            completed_at = NOW()
        WHERE id = ${logId}
      `;

      console.log(`[WithdrawalLogger] Completed: ID ${logId}, MKIN TX: ${mkinSignature}`);
    } catch (error) {
      console.error('[WithdrawalLogger] Error logging completion:', error);
    }
  }

  /**
   * Update log when withdrawal fails
   */
  async logFailed(logId, errorMessage, errorCode = null, retryCount = 0) {
    try {
      await sql`
        UPDATE withdrawal_transactions 
        SET status = 'failed',
            error_message = ${errorMessage},
            error_code = ${errorCode},
            retry_count = ${retryCount},
            failed_at = NOW()
        WHERE id = ${logId}
      `;

      console.error(`[WithdrawalLogger] Failed: ID ${logId}, Error: ${errorMessage}`);
    } catch (error) {
      console.error('[WithdrawalLogger] Error logging failure:', error);
    }
  }

  /**
   * Mark withdrawal as refunded after manual intervention
   */
  async logRefunded(logId, notes = null) {
    try {
      await sql`
        UPDATE withdrawal_transactions 
        SET status = 'refunded',
            balance_refunded = TRUE,
            refunded_at = NOW(),
            notes = ${notes}
        WHERE id = ${logId}
      `;

      console.log(`[WithdrawalLogger] Refunded: ID ${logId}, Notes: ${notes}`);
    } catch (error) {
      console.error('[WithdrawalLogger] Error logging refund:', error);
    }
  }

  /**
   * Get all pending refunds (failed withdrawals with deducted balance)
   */
  async getPendingRefunds() {
    try {
      const result = await sql`SELECT * FROM pending_refunds`;
      return result;
    } catch (error) {
      console.error('[WithdrawalLogger] Error getting pending refunds:', error);
      return [];
    }
  }

  /**
   * Get withdrawal history for a user
   */
  async getUserHistory(userId, limit = 50) {
    try {
      const result = await sql`
        SELECT * FROM withdrawal_transactions 
        WHERE user_id = ${userId} 
        ORDER BY initiated_at DESC 
        LIMIT ${limit}
      `;
      return result;
    } catch (error) {
      console.error('[WithdrawalLogger] Error getting user history:', error);
      return [];
    }
  }

  /**
   * Get daily withdrawal statistics
   */
  async getStats(days = 30) {
    try {
      const result = await sql`
        SELECT * FROM withdrawal_stats 
        WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY date DESC
      `;
      return result;
    } catch (error) {
      console.error('[WithdrawalLogger] Error getting stats:', error);
      return [];
    }
  }

  /**
   * Find a withdrawal by fee transaction signature
   */
  async findByFeeSignature(feeSignature) {
    try {
      const result = await sql`
        SELECT * FROM withdrawal_transactions 
        WHERE fee_tx_signature = ${feeSignature}
      `;
      return result[0] || null;
    } catch (error) {
      console.error('[WithdrawalLogger] Error finding by fee signature:', error);
      return null;
    }
  }

  /**
   * Update retry count
   */
  async incrementRetry(logId) {
    try {
      await sql`
        UPDATE withdrawal_transactions 
        SET retry_count = retry_count + 1 
        WHERE id = ${logId}
      `;
    } catch (error) {
      console.error('[WithdrawalLogger] Error incrementing retry:', error);
    }
  }
}

// Export singleton instance
const withdrawalLogger = new WithdrawalLogger();
export default withdrawalLogger;
