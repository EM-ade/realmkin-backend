import express from "express";
import BoosterService from "../services/boosterService.js";
import admin from "firebase-admin";

const router = express.Router();
const boosterService = new BoosterService();

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

// GET /api/boosters/status - Get current booster status for authenticated user
router.get("/status", verifyAuth, async (req, res) => {
  try {
    const boosters = await boosterService.getUserBoosters(req.user.uid);
    const stackedMultiplier = boosterService.calculateStackedMultiplier(boosters);
    
    res.json({
      success: true,
      data: {
        activeBoosters: boosters,
        stackedMultiplier: stackedMultiplier,
        boosterCount: boosters.length,
        lastUpdated: boosters.length > 0 ? boosters[0].detectedAt : null
      }
    });
  } catch (e) {
    console.error("Error getting booster status:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/boosters/refresh - Manually refresh boosters for authenticated user
router.post("/refresh", verifyAuth, async (req, res) => {
  try {
    console.log(`🔄 Manual booster refresh requested by user ${req.user.uid}`);
    
    const boosters = await boosterService.refreshUserBoosters(req.user.uid);
    const stackedMultiplier = boosterService.calculateStackedMultiplier(boosters);
    
    res.json({
      success: true,
      data: {
        activeBoosters: boosters,
        stackedMultiplier: stackedMultiplier,
        boosterCount: boosters.length,
        message: "Boosters refreshed successfully"
      }
    });
  } catch (e) {
    console.error("Error refreshing boosters:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/boosters/categories - Get all available booster categories
router.get("/categories", async (req, res) => {
  try {
    const categories = boosterService.getBoosterCategories();
    
    res.json({
      success: true,
      data: {
        categories: categories,
        totalCategories: categories.length
      }
    });
  } catch (e) {
    console.error("Error getting booster categories:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/boosters/refresh-all - Admin endpoint to refresh all active boosters
router.post("/refresh-all", verifyAuth, async (req, res) => {
  try {
    // Check if user is admin (you may need to implement admin check logic)
    const userDoc = await admin.firestore().collection('users').doc(req.user.uid).get();
    const isAdmin = userDoc.exists ? userDoc.data().admin : false;
    
    if (!isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    console.log(`🔄 Admin requested full booster refresh`);
    
    // Start async refresh (don't wait for completion)
    boosterService.refreshAllActiveBoosters().catch(error => {
      console.error("Error in admin booster refresh:", error);
    });
    
    res.json({
      success: true,
      message: "Booster refresh started for all active stakers"
    });
  } catch (e) {
    console.error("Error in admin booster refresh:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/boosters/with-metadata - Get boosters with full NFT metadata including images
router.get("/with-metadata", verifyAuth, async (req, res) => {
  try {
    console.log(`🖼️ Fetching boosters with metadata for user ${req.user.uid}`);
    
    const result = await boosterService.getBoostersWithMetadata(req.user.uid);
    
    res.json({
      success: true,
      data: {
        activeBoosters: result.boosters,
        stackedMultiplier: result.stackedMultiplier,
        nftDetails: result.nftDetails,
        boosterCount: result.boosters.length,
        lastUpdated: result.boosters.length > 0 ? result.boosters[0].detectedAt : null
      }
    });
  } catch (e) {
    console.error("Error getting boosters with metadata:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/boosters/history - Get booster change history for authenticated user
router.get("/history", verifyAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;
    
    const historySnapshot = await admin.firestore()
      .collection('booster_history')
      .where('user_id', '==', req.user.uid)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .offset(offset)
      .get();
    
    const history = historySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp.toDate()
    }));
    
    res.json({
      success: true,
      data: {
        history: history,
        count: history.length,
        limit: limit,
        offset: offset
      }
    });
  } catch (e) {
    console.error("Error getting booster history:", e);
    res.status(500).json({ error: e.message });
  }
});

export default router;