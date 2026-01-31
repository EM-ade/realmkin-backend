import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

// Configuration Constants
const GOAL_COLLECTION = "goal";
const GOAL_DOC_ID = "nft_launch_goal";

class GoalError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.name = "GoalError";
    this.code = code;
  }
}

class GoalService {
  constructor() {
    this._db = null;
  }

  get db() {
    if (!this._db) {
      this._db = getFirestore();
    }
    return this._db;
  }

  /**
   * Get the NFT launch goal
   */
  async getGoal() {
    try {
      const goalRef = this.db.collection(GOAL_COLLECTION).doc(GOAL_DOC_ID);
      const doc = await goalRef.get();

      if (!doc.exists) {
        // Initialize goal if it doesn't exist
        const initialGoal = {
          id: GOAL_DOC_ID,
          title: "Mint 100 NFTs",
          description: "Complete this goal to activate staking rewards",
          current: 0,
          target: 100,
          isCompleted: false,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        };
        await goalRef.set(initialGoal);
        return initialGoal;
      }

      return {
        id: doc.id,
        ...doc.data(),
      };
    } catch (error) {
      console.error("Error fetching goal:", error);
      throw new GoalError("Failed to fetch goal");
    }
  }

  /**
   * Update the goal progress
   * @param {number} current - Current progress
   * @param {number} target - Target value
   * @param {boolean} isCompleted - Whether goal is completed
   */
  async updateGoal(current, target, isCompleted) {
    try {
      if (current < 0 || target <= 0) {
        throw new GoalError(
          "Invalid values: current must be >= 0 and target must be > 0"
        );
      }

      if (current > target) {
        throw new GoalError("Current progress cannot exceed target");
      }

      const goalRef = this.db.collection(GOAL_COLLECTION).doc(GOAL_DOC_ID);
      const updateData = {
        current,
        target,
        isCompleted,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // If marking as completed, add completedAt timestamp
      if (isCompleted) {
        const doc = await goalRef.get();
        const existingData = doc.data();

        // Only set completedAt if it wasn't already completed
        if (!existingData?.isCompleted) {
          updateData.completedAt = admin.firestore.Timestamp.now();
          console.log(`🎯 Goal completed! NFT sales: ${current}/${target}`);
        }
      }

      await goalRef.update(updateData);

      console.log(
        `✅ Goal updated: ${current}/${target} (${
          isCompleted ? "Completed" : "In Progress"
        })`
      );

      return await this.getGoal();
    } catch (error) {
      console.error("Error updating goal:", error);
      if (error instanceof GoalError) {
        throw error;
      }
      throw new GoalError("Failed to update goal");
    }
  }

  /**
   * Check if the goal is completed (for reward gating)
   */
  async isGoalCompleted() {
    try {
      const goal = await this.getGoal();
      return goal.isCompleted === true;
    } catch (error) {
      console.error("Error checking goal completion:", error);
      // Default to false if there's an error (fail-safe: keep rewards paused)
      return false;
    }
  }
}

export const goalService = new GoalService();
