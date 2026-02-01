/**
 * Force Claim Service
 * Handles weekly force-claiming of pending rewards for all users
 * This runs automatically every Sunday via the scheduler in index.js
 */

import admin from "firebase-admin";
// Removed getFirestore import - using admin.firestore() instead

// Constants for reward calculation
const MILLISECONDS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

class ForceClaimService {
  constructor() {
    this._db = null;
  }

  get db() {
    if (!this._db) {
      this._db = admin.firestore();
    }
    return this._db;
  }

  /**
   * Convert any timestamp to a valid Date object
   */
  convertToValidDate(timestamp, fallbackDate) {
    try {
      if (timestamp instanceof Date) {
        return isNaN(timestamp.getTime()) ? fallbackDate : timestamp;
      }
      
      if (timestamp && typeof timestamp === 'object' && 'toDate' in timestamp && typeof timestamp.toDate === 'function') {
        const date = timestamp.toDate();
        return isNaN(date.getTime()) ? fallbackDate : date;
      }
      
      if (timestamp && (typeof timestamp === 'string' || typeof timestamp === 'number')) {
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? fallbackDate : date;
      }
      
      return fallbackDate;
    } catch (error) {
      console.warn("Error converting timestamp to Date:", error, "Using fallback date:", fallbackDate.toISOString());
      return fallbackDate;
    }
  }

  /**
   * Calculate accumulated rewards for a user based on weeklyRate
   */
  calculateAccumulatedRewards(userData) {
    const now = new Date();
    const weeklyRate = userData.weeklyRate || 0;
    
    // If no weeklyRate, no rewards to accumulate
    if (weeklyRate === 0) {
      return 0;
    }
    
    const lastCalculated = this.convertToValidDate(
      userData.lastCalculated || userData.lastClaimed || userData.createdAt,
      now
    );
    
    const timeSinceLastCalculation = now.getTime() - lastCalculated.getTime();
    const weeksElapsed = timeSinceLastCalculation / MILLISECONDS_PER_WEEK;
    
    const accumulatedReward = weeklyRate * weeksElapsed;
    
    return Math.max(0, accumulatedReward);
  }

  /**
   * Format MKIN amount for display
   */
  formatMKIN(amount) {
    return `₥${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Update lastCalculated timestamp for skipped users
   * Prevents retroactive reward accumulation when users acquire NFTs later
   */
  async updateSkippedUserTimestamp(userId) {
    try {
      const userRef = this.db.collection("userRewards").doc(userId);
      await userRef.update({
        lastCalculated: new Date(),
        updatedAt: new Date()
      });
      console.log(`🕐 Updated lastCalculated for skipped user ${userId}`);
    } catch (error) {
      console.error(`Failed to update timestamp for skipped user ${userId}:`, error);
    }
  }

  /**
   * Save transaction history record (Updated for subcollection structure)
   */
  async saveTransactionHistory({ userId, walletAddress, type, amount, description }) {
    try {
      const txRef = this.db.collection(`transactionHistory/${userId}/transactions`).doc();
      await txRef.set({
        type: 'mining_claim',
        status: 'success',
        amount,
        token: 'MKIN',
        timestamp: admin.firestore.Timestamp.now(),
        metadata: {
          source: 'weekly_claim',
          description,
          walletAddress: walletAddress || "",
        },
      });
    } catch (error) {
      console.error(`Failed to save transaction history for ${userId}:`, error);
    }
  }

  /**
   * Process force-claim for a single user
   */
  async processUserForceClaim(userId, userData) {
    const now = new Date();

    try {
      // Calculate accumulated rewards based on weeklyRate
      const accumulatedRewards = this.calculateAccumulatedRewards(userData);
      const storedPendingRewards = userData.pendingRewards || 0;
      const totalRewardsToClaimBefore = storedPendingRewards + accumulatedRewards;

      const weeklyRate = userData.weeklyRate || 0;

      console.log(
        `📊 User ${userId}: ` +
        `weeklyRate=${weeklyRate.toFixed(2)}, ` +
        `storedPending=${storedPendingRewards.toFixed(2)}, ` +
        `accumulated=${accumulatedRewards.toFixed(2)}, ` +
        `totalToClaim=${totalRewardsToClaimBefore.toFixed(2)}`
      );

      // Skip users with weeklyRate=0 AND no stored pending rewards
      if (weeklyRate === 0 && storedPendingRewards <= 0) {
        return { userId, amount: 0, success: false, reason: "No weeklyRate and no pending rewards" };
      }

      // Skip if total rewards to claim is 0 or negative
      if (totalRewardsToClaimBefore <= 0) {
        return { userId, amount: 0, success: false, reason: "No rewards to claim" };
      }

      let actualClaimAmount = 0;

      await this.db.runTransaction(async (transaction) => {
        const userRewardsRef = this.db.collection("userRewards").doc(userId);
        const userRewardsDoc = await transaction.get(userRewardsRef);

        if (!userRewardsDoc.exists) {
          throw new Error("User rewards not found in transaction");
        }

        const currentUserRewards = userRewardsDoc.data();
        const currentPendingRewards = currentUserRewards?.pendingRewards || 0;
        
        // Re-calculate accumulated rewards within transaction to ensure consistency
        const freshAccumulatedRewards = this.calculateAccumulatedRewards(currentUserRewards);
        
        // Total rewards = stored pending + newly accumulated
        const totalRewardsToClaim = currentPendingRewards + freshAccumulatedRewards;

        if (totalRewardsToClaim <= 0) {
          console.log(`⚠️ User ${userId}: No rewards to claim in transaction`);
          throw new Error("No rewards available");
        }

        actualClaimAmount = Math.floor(totalRewardsToClaim * 100) / 100;

        // Create claim record
        const claimRecordId = `${userId}_${now.getTime()}_${Math.random().toString(36).substr(2, 9)}`;
        const claimRecord = {
          id: claimRecordId,
          userId,
          walletAddress: userData.walletAddress || "",
          amount: actualClaimAmount,
          weeklyRate: userData.weeklyRate || 0,
          claimedAt: now,
          weeksClaimed: 0,
          source: "weekly_claim",
        };

        const claimRef = this.db.collection("claimRecords").doc(claimRecordId);
        transaction.set(claimRef, claimRecord);

        // Update user rewards
        // Reset pendingRewards to 0 and update lastCalculated so future calculations start fresh
        transaction.update(userRewardsRef, {
          totalClaimed: (currentUserRewards?.totalClaimed || 0) + actualClaimAmount,
          totalEarned: (currentUserRewards?.totalEarned || 0) + actualClaimAmount,
          totalRealmkin: (currentUserRewards?.totalRealmkin || 0) + actualClaimAmount,
          pendingRewards: 0, // Reset to 0 since we claimed everything
          lastClaimed: now,
          lastCalculated: now, // Reset calculation timestamp
          updatedAt: now,
        });

        console.log(
          `✅ User ${userId}: Force-claimed ${actualClaimAmount.toFixed(2)} MKIN. New totalRealmkin: ${
            ((currentUserRewards?.totalRealmkin || 0) + actualClaimAmount).toFixed(2)
          }`
        );
      });

      // Save transaction history
      await this.saveTransactionHistory({
        userId,
        walletAddress: userData.walletAddress,
        type: "claim",
        amount: actualClaimAmount,
        description: `Weekly mining rewards: ${this.formatMKIN(actualClaimAmount)}`,
      });

      return {
        userId,
        amount: actualClaimAmount,
        success: true,
      };
    } catch (error) {
      console.error(`❌ Failed to force-claim for user ${userId}:`, error);
      return {
        userId,
        amount: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Run force-claim for all users with pending rewards
   * @param {Object} options - Options for the force claim
   * @param {boolean} options.dryRun - If true, don't actually process claims, just report
   * @returns {Promise<Object>} Result summary
   */
  async runForceClaim(options = {}) {
    const { dryRun = false } = options;
    
    console.log('='.repeat(80));
    console.log(`⚡ Starting ${dryRun ? 'DRY RUN ' : ''}FORCE claim for all users...`);
    console.log('='.repeat(80));
    
    const startTime = Date.now();

    try {
      const userRewardsRef = this.db.collection("userRewards");
      const snapshot = await userRewardsRef.get();

      let totalClaims = 0;
      let totalAmount = 0;
      let skippedCount = 0;
      const results = [];

      const batchSize = 20;
      const docs = snapshot.docs;

      console.log(`📋 Found ${docs.length} users to process`);

      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        console.log(
          `🔄 Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(docs.length / batchSize)}`
        );

        const batchPromises = batch.map(async (docSnap) => {
          const userId = docSnap.id;
          const userData = docSnap.data();
          
          // In dry run mode, just report what would happen
          if (dryRun) {
            const storedPendingRewards = userData.pendingRewards || 0;
            const accumulatedRewards = this.calculateAccumulatedRewards(userData);
            const totalRewards = storedPendingRewards + accumulatedRewards;
            const weeklyRate = userData.weeklyRate || 0;
            
            // Skip users with no weeklyRate and no pending rewards
            if (weeklyRate === 0 && storedPendingRewards <= 0) {
              return { userId, amount: 0, success: false, reason: "No weeklyRate and no pending rewards", dryRun: true };
            }
            
            if (totalRewards > 0) {
              console.log(
                `🧪 [DRY RUN] Would claim ${totalRewards.toFixed(2)} MKIN for user ${userId} ` +
                `(stored: ${storedPendingRewards.toFixed(2)}, accumulated: ${accumulatedRewards.toFixed(2)})`
              );
              return {
                userId,
                amount: totalRewards,
                success: true,
                dryRun: true,
              };
            }
            return { userId, amount: 0, success: false, reason: "No rewards to claim", dryRun: true };
          }
          
          return this.processUserForceClaim(userId, userData);
        });

        const batchResults = await Promise.all(batchPromises);
        const successfulClaims = batchResults.filter((result) => result.success);
        const skipped = batchResults.filter((result) => !result.success);

        totalClaims += successfulClaims.length;
        totalAmount += successfulClaims.reduce((sum, result) => sum + (result.amount || 0), 0);
        skippedCount += skipped.length;

        results.push(...batchResults);

        // Update timestamps for skipped users (only in actual run, not dry-run)
        if (!dryRun && skipped.length > 0) {
          console.log(`🕐 Updating timestamps for ${skipped.length} skipped users...`);
          const timestampUpdates = skipped.map(result => 
            this.updateSkippedUserTimestamp(result.userId)
          );
          await Promise.all(timestampUpdates);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('='.repeat(80));
      console.log(`⚡ ${dryRun ? '[DRY RUN] ' : ''}Force claiming completed!`);
      console.log(`   Duration: ${duration}s`);
      console.log(`   Users processed: ${docs.length}`);
      console.log(`   Successful claims: ${totalClaims}`);
      console.log(`   Skipped (no rewards): ${skippedCount}`);
      console.log(`   Total distributed: ${this.formatMKIN(totalAmount)}`);
      console.log('='.repeat(80) + '\n');

      return {
        success: true,
        dryRun,
        claimsProcessed: totalClaims,
        totalAmountDistributed: totalAmount,
        usersProcessed: docs.length,
        skipped: skippedCount,
        duration: `${duration}s`,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("❌ Force claim failed:", error);
      throw error;
    }
  }

  /**
   * Get a preview of what the force claim would process
   * Useful for testing without making changes
   */
  async getForceClaimPreview() {
    try {
      const userRewardsRef = this.db.collection("userRewards");
      const snapshot = await userRewardsRef.get();

      let usersWithRewards = 0;
      let totalPendingRewards = 0;
      let totalAccumulatedRewards = 0;
      const topUsers = [];

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const storedPending = data.pendingRewards || 0;
        const accumulated = this.calculateAccumulatedRewards(data);
        const totalRewards = storedPending + accumulated;
        const weeklyRate = data.weeklyRate || 0;
        
        // Only count users with weeklyRate > 0 OR stored pending > 0
        if (weeklyRate > 0 || storedPending > 0) {
          if (totalRewards > 0) {
            usersWithRewards++;
            totalPendingRewards += storedPending;
            totalAccumulatedRewards += accumulated;
            topUsers.push({
              userId: doc.id,
              weeklyRate,
              storedPendingRewards: storedPending,
              accumulatedRewards: accumulated,
              totalRewards: totalRewards,
              walletAddress: data.walletAddress ? `${data.walletAddress.slice(0, 8)}...` : 'N/A',
            });
          }
        }
      });

      // Sort by total rewards descending and take top 10
      topUsers.sort((a, b) => b.totalRewards - a.totalRewards);
      const top10 = topUsers.slice(0, 10);

      return {
        totalUsers: snapshot.docs.length,
        usersWithRewards: usersWithRewards,
        totalStoredPendingRewards: totalPendingRewards,
        totalAccumulatedRewards: totalAccumulatedRewards,
        totalRewardsToClaim: totalPendingRewards + totalAccumulatedRewards,
        formattedStoredPending: this.formatMKIN(totalPendingRewards),
        formattedAccumulated: this.formatMKIN(totalAccumulatedRewards),
        formattedTotal: this.formatMKIN(totalPendingRewards + totalAccumulatedRewards),
        top10Users: top10,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Failed to get force claim preview:", error);
      throw error;
    }
  }
}

const forceClaimService = new ForceClaimService();
export default forceClaimService;
