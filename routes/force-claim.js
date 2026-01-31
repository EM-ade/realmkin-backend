/**
 * Force Claim API Routes
 * Provides endpoints for manual triggering and status checking of force-claims
 */

import express from "express";
import forceClaimService from "../services/forceClaimService.js";

const router = express.Router();

/**
 * POST /api/force-claim/trigger
 * Manually trigger a force-claim for all users
 * Requires CRON_SECRET_TOKEN authorization
 */
router.post("/trigger", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CRON_SECRET_TOKEN;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    console.warn("⚠️ Unauthorized force-claim trigger attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    console.log("⚡ Manual force-claim triggered via API");
    const result = await forceClaimService.runForceClaim();
    
    // Send Discord notification on success
    try {
      const { sendDiscordAlert } = await import("../utils/discordAlerts.js");
      await sendDiscordAlert(
        `✅ Manual Force-Claim Completed\n` +
        `• Claims: ${result.claimsProcessed}\n` +
        `• Distributed: ₥${result.totalAmountDistributed.toLocaleString()}\n` +
        `• Duration: ${result.duration}`,
        "info"
      );
    } catch (alertError) {
      console.warn("Failed to send Discord alert:", alertError.message);
    }
    
    res.json(result);
  } catch (error) {
    console.error("Force-claim failed:", error);
    
    // Send Discord notification on failure
    try {
      const { sendDiscordAlert } = await import("../utils/discordAlerts.js");
      await sendDiscordAlert(
        `❌ Manual Force-Claim FAILED\n` +
        `• Error: ${error.message}`,
        "error"
      );
    } catch (alertError) {
      console.warn("Failed to send Discord alert:", alertError.message);
    }
    
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/force-claim/dry-run
 * Run a dry-run of the force-claim (no actual changes)
 * Requires CRON_SECRET_TOKEN authorization
 */
router.post("/dry-run", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CRON_SECRET_TOKEN;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    console.warn("⚠️ Unauthorized force-claim dry-run attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    console.log("🧪 Force-claim DRY RUN triggered via API");
    const result = await forceClaimService.runForceClaim({ dryRun: true });
    res.json(result);
  } catch (error) {
    console.error("Force-claim dry-run failed:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/force-claim/preview
 * Get a preview of what the force-claim would process
 * Requires CRON_SECRET_TOKEN authorization
 */
router.get("/preview", async (req, res) => {
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.CRON_SECRET_TOKEN;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    console.warn("⚠️ Unauthorized force-claim preview attempt");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const preview = await forceClaimService.getForceClaimPreview();
    res.json(preview);
  } catch (error) {
    console.error("Force-claim preview failed:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/force-claim/status
 * Health check endpoint (no auth required)
 */
router.get("/status", (req, res) => {
  const now = new Date();
  const currentDay = now.getUTCDay();
  const daysUntilSunday = (7 - currentDay) % 7 || 7;
  
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(nextSunday.getUTCDate() + (currentDay === 0 ? 0 : daysUntilSunday));
  nextSunday.setUTCHours(12, 0, 0, 0);
  
  // If it's Sunday but past noon, next run is next week
  if (currentDay === 0 && now.getUTCHours() >= 12) {
    nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  }

  res.json({
    status: "ok",
    message: "Force-claim service is running",
    schedule: "Every Sunday at 12:00 UTC",
    currentTimeUTC: now.toISOString(),
    nextScheduledRun: nextSunday.toISOString(),
    timeUntilNextRun: formatTimeUntil(nextSunday - now),
    endpoints: {
      trigger: "POST /api/force-claim/trigger (requires auth)",
      dryRun: "POST /api/force-claim/dry-run (requires auth)",
      preview: "GET /api/force-claim/preview (requires auth)",
      status: "GET /api/force-claim/status (public)",
    },
  });
});

/**
 * Format milliseconds into human-readable time
 */
function formatTimeUntil(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else {
    return `${minutes}m`;
  }
}

export default router;
