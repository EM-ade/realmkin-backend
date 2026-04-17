import express from "express";
import nftStakingService from "../services/nftStakingService.js";
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

// Middleware: Get wallet address from user
async function getWalletAddress(req, res, next) {
  try {
    const db = admin.firestore();
    const userRewardDoc = await db.collection("userRewards").doc(req.user.uid).get();
    
    if (!userRewardDoc.exists || !userRewardDoc.data().walletAddress) {
      return res.status(400).json({ error: "Wallet address not found" });
    }
    
    req.walletAddress = userRewardDoc.data().walletAddress;
    next();
  } catch (e) {
    console.error("Error getting wallet address:", e);
    res.status(500).json({ error: "Failed to get wallet address" });
  }
}

// GET /api/nft-staking/pool - Get pool stats
router.get("/pool", async (req, res) => {
  try {
    const stats = await nftStakingService.getPoolStats();
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/nft-staking/me - Get user's staking stats
router.get("/me", verifyAuth, getWalletAddress, async (req, res) => {
  try {
    const stats = await nftStakingService.getStakingStats(req.walletAddress);
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/nft-staking/wallet - Get available NFTs in user's wallet
router.get("/wallet", verifyAuth, getWalletAddress, async (req, res) => {
  try {
    const nfts = await nftStakingService.getAvailableNfts(req.walletAddress);
    res.json({ nfts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/nft-staking/stake - Stake NFTs
router.post("/stake", verifyAuth, getWalletAddress, async (req, res) => {
  try {
    const { nftMints, feeSignature } = req.body;
    
    if (!nftMints || !Array.isArray(nftMints) || nftMints.length === 0) {
      return res.status(400).json({ error: "No NFTs provided" });
    }
    
    // Fee signature is optional for testing
    const finalFeeSignature = feeSignature || "fee_disabled_for_testing";
    
    const result = await nftStakingService.stakeNfts(
      req.walletAddress,
      nftMints,
      finalFeeSignature
    );
    
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/nft-staking/unstake - Unstake NFT
router.post("/unstake", verifyAuth, getWalletAddress, async (req, res) => {
  try {
    const { nftMint } = req.body;
    
    if (!nftMint) {
      return res.status(400).json({ error: "NFT mint address required" });
    }
    
    const result = await nftStakingService.unstakeNft(req.walletAddress, nftMint);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/nft-staking/claim - Claim rewards
router.post("/claim", verifyAuth, getWalletAddress, async (req, res) => {
  try {
    const result = await nftStakingService.claimRewards(req.walletAddress);
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

// POST /api/nft-staking/calculate-fee - Calculate staking fee
router.post("/calculate-fee", async (req, res) => {
  try {
    const { nftCount } = req.body;
    const count = Math.max(1, nftCount || 1);
    
    const { default: nftStakingConfig } = await import("../config/nftStaking.js");
    const totalFeeUsd = count * nftStakingConfig.NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT;
    
    const { getFeeInSol } = await import("../utils/solPrice.js");
    const feeData = await getFeeInSol(totalFeeUsd);
    
    res.json({
      feeInSol: feeData.solAmount,
      totalFeeUsd,
      feePerNft: nftStakingConfig.NFT_STAKING_CONFIG.STAKE_FEE_PER_NFT,
      nftCount: count,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
export { router as nftStakingRouter };