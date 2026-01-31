/**
 * Force Claim Service
 * Handles weekly force-claiming of pending rewards for all users
 * This runs automatically every Sunday via the scheduler in index.js
 */

import admin from "firebase-admin";
// Removed getFirestore import - using admin.firestore() instead

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
   * Format MKIN amount for display
   */
  formatMKIN(amount) {
    return `₥${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Save transaction history record
   */
  async saveTransactionHistory({ userId, walletAddress, type, amount, description }) {
    try {
      const txRef = this.db.collection("transactionHistory").doc();
      await txRef.set({
        userId,
        walletAddress: walletAddress || "",
        type,
        amount,
        description,
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
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
      const storedPendingRewards = userData.pendingRewards || 0;

      console.log(
        `📊 User ${userId}: pendingRewards=${storedPendingRewards.toFixed(2)}, weeklyRate=${userData.weeklyRate || 0}, totalRealmkin=${userData.totalRealmkin || 0}`
      );

      if (storedPendingRewards <= 0) {
        return { userId, amount: 0, success: false, reason: "No pending rewards" };
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

        if (currentPendingRewards <= 0) {
          console.log(`⚠️ User ${userId}: Pending rewards became 0 during transaction`);
          throw new Error("No pending rewards available");
        }

        actualClaimAmount = Math.floor(currentPendingRewards * 100) / 100;

        // Create claim record
        const claimRecordId = `${userId}_${now.getTime()}_${Math.random().toString(36).substr(2, 9)}`;
        const claimRecord = {
          id: claimRecordId,
          userId,
          walletAddress: userData.walletAddress || "",
          amount: actualClaimAmount,
          nftCount: userData.totalNFTs || 0,
          claimedAt: now,
          weeksClaimed: 0, // Force claim doesn't wait for weeks
          source: "weekly_auto_claim",
        };

        const claimRef = this.db.collection("claimRecords").doc(claimRecordId);
        transaction.set(claimRef, claimRecord);

        // Update user rewards
        transaction.update(userRewardsRef, {
          totalClaimed: (currentUserRewards?.totalClaimed || 0) + actualClaimAmount,
          totalEarned: (currentUserRewards?.totalEarned || 0) + actualClaimAmount,
          totalRealmkin: (currentUserRewards?.totalRealmkin || 0) + actualClaimAmount,
          pendingRewards: 0,
          lastClaimed: now,
          lastCalculated: now,
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
        description: `Force-claimed ${this.formatMKIN(actualClaimAmount)} (weekly auto-claim)`,
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
            const pendingRewards = userData.pendingRewards || 0;
            if (pendingRewards > 0) {
              console.log(`🧪 [DRY RUN] Would claim ${pendingRewards.toFixed(2)} MKIN for user ${userId}`);
              return {
                userId,
                amount: pendingRewards,
                success: true,
                dryRun: true,
              };
            }
            return { userId, amount: 0, success: false, reason: "No pending rewards", dryRun: true };
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
      const topUsers = [];

      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        const pending = data.pendingRewards || 0;
        
        if (pending > 0) {
          usersWithRewards++;
          totalPendingRewards += pending;
          topUsers.push({
            userId: doc.id,
            pendingRewards: pending,
            walletAddress: data.walletAddress ? `${data.walletAddress.slice(0, 8)}...` : 'N/A',
          });
        }
      });

      // Sort by pending rewards descending and take top 10
      topUsers.sort((a, b) => b.pendingRewards - a.pendingRewards);
      const top10 = topUsers.slice(0, 10);

      return {
        totalUsers: snapshot.docs.length,
        usersWithPendingRewards: usersWithRewards,
        totalPendingRewards,
        formattedTotal: this.formatMKIN(totalPendingRewards),
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
