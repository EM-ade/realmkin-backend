import express from "express";
import { stakingService } from "../services/stakingService.js";
import admin from "firebase-admin";

const router = express.Router();

// Middleware: Verify Firebase Auth
async function verifyAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

// GET /api/staking/overview
router.get("/overview", verifyAuth, async (req, res) => {
  try {
    const data = await stakingService.getOverview(req.user.uid);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/staking/calculate-fee (no auth required - just calculation)
router.post("/calculate-fee", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const { calculateStakingFee } = await import("../utils/mkinPrice.js");
    const feeData = await calculateStakingFee(Number(amount), 5);

    res.json(feeData);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/staking/stake
router.post("/stake", verifyAuth, async (req, res) => {
  try {
    const { amount, txSignature, feeSignature } = req.body;
    const result = await stakingService.stake(
      req.user.uid,
      Number(amount),
      txSignature,
      feeSignature
    );
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/staking/claim
router.post("/claim", verifyAuth, async (req, res) => {
  try {
    const { txSignature } = req.body;
    const result = await stakingService.claim(req.user.uid, txSignature);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/staking/unstake
router.post("/unstake", verifyAuth, async (req, res) => {
  try {
    const { amount, txSignature } = req.body;
    const result = await stakingService.unstake(
      req.user.uid,
      Number(amount),
      txSignature
    );
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

export default router;
