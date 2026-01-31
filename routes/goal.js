import express from "express";
import { goalService } from "../services/goalService.js";
import admin from "firebase-admin";

const router = express.Router();

// Firebase auth middleware (same as in staking.js)
async function verifyAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUid = decoded.uid;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/**
 * GET /api/goal
 * Fetch the NFT launch goal
 */
router.get("/", async (req, res) => {
  try {
    const goal = await goalService.getGoal();
    res.json(goal);
  } catch (error) {
    console.error("Error fetching goal:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/goal/status
 * Check if goal is completed (for reward gating)
 */
router.get("/status", async (req, res) => {
  try {
    const isCompleted = await goalService.isGoalCompleted();
    res.json({ isCompleted });
  } catch (error) {
    console.error("Error checking goal status:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/goal
 * Update the goal (admin only)
 */
router.put("/", verifyAuth, async (req, res) => {
  try {
    const { current, target, isCompleted } = req.body;

    // Validate input
    if (typeof current !== "number" || typeof target !== "number") {
      return res
        .status(400)
        .json({ error: "current and target must be numbers" });
    }

    if (typeof isCompleted !== "boolean") {
      return res.status(400).json({ error: "isCompleted must be a boolean" });
    }

    const updatedGoal = await goalService.updateGoal(
      current,
      target,
      isCompleted
    );
    res.json(updatedGoal);
  } catch (error) {
    console.error("Error updating goal:", error);
    res.status(error.code || 500).json({ error: error.message });
  }
});

export default router;
