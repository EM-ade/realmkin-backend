// Backend API Service - Express HTTP Server Only
// No Discord functionality - handles REST API endpoints for frontend

// Load environment variables first
import "dotenv/config";

// Import environment configuration
import environmentConfig from "./config/environment.js";

// Validate required environment variables
try {
  environmentConfig.validateRequiredEnvVars();
  console.log("✅ [API] Environment configuration validated successfully");
} catch (error) {
  console.error("❌ [API] Environment validation failed:", error.message);
  process.exit(1);
}

// Log environment info
const envInfo = environmentConfig.getEnvironmentInfo();
console.log(`🌍 [API] Environment: ${envInfo.nodeEnv} (${envInfo.isDevelopment ? 'Development' : 'Production'})`);
console.log("[API] DATABASE_URL:", process.env.DATABASE_URL ? "Set" : "NOT SET");

import express from "express";
import admin from "firebase-admin";
import sql from "./db.js";
import cors from "cors";
import { PublicKey } from "@solana/web3.js";
import withdrawalLogger from "./services/withdrawalLogger.js";

// Initialize Firebase Admin
console.log("[API] Initializing Firebase Admin...");
let firebaseInitialized = false;

// Try service account JSON first (preferred for production)
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    
    // Fix private key formatting - replace literal \n with actual newlines
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("✅ [API] Firebase Admin initialized with service account JSON");
    firebaseInitialized = true;
  } catch (e) {
    console.error("❌ [API] Failed to initialize Firebase with service account JSON:", e.message);
  }
}

// Fallback to GOOGLE_APPLICATION_CREDENTIALS
if (!firebaseInitialized && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log("✅ [API] Firebase Admin initialized with application default credentials");
    firebaseInitialized = true;
  } catch (e) {
    console.error("❌ [API] Failed to initialize Firebase with default credentials:", e.message);
  }
}

if (!firebaseInitialized) {
  console.error("❌ [API] Firebase Admin initialization failed - no valid credentials found");
  process.exit(1);
}

// Initialize Express app
const app = express();
app.use(express.json());

// CORS - Support multiple origins
const allowedOriginsEnv = process.env.ALLOWED_ORIGIN || "*";
const allowedOrigins =
  allowedOriginsEnv === "*"
    ? "*"
    : allowedOriginsEnv
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Allow all origins if configured with '*'
      if (allowedOrigins === "*") return callback(null, true);

      // Check if origin is in the allowed list
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Health check
app.get("/health", (_req, res) => {
  res.json({ 
    ok: true, 
    service: "backend-api",
    timestamp: new Date().toISOString(),
    environment: envInfo.nodeEnv
  });
});

// Import and mount routes
import stakingRoutes from "./routes/staking.js";
import goalRoutes from "./routes/goal.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import boosterRoutes from "./routes/boosters.js";
import distributionRoutes from "./routes/one-time-distribution.js";
import forceClaimRoutes from "./routes/force-claim.js";

app.use("/api/staking", stakingRoutes);
app.use("/api/goal", goalRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/boosters", boosterRoutes);
app.use("/api/distribution", distributionRoutes);
app.use("/api/force-claim", forceClaimRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("[API] Error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start HTTP server
const apiConfig = environmentConfig.apiConfig;
const PORT = process.env.PORT || apiConfig.port || 3001;
const HOST = apiConfig.host || "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`🚀 [API] HTTP Server listening on ${HOST}:${PORT}`);
  console.log(`📊 [API] Environment: ${envInfo.nodeEnv}`);
  console.log(`🔧 [API] Feature flags:`, environmentConfig.featureFlags);
  
  // Initialize automatic booster refresh
  setupAutomaticBoosterRefresh();
});

// Automatic Booster Refresh
async function setupAutomaticBoosterRefresh() {
  console.log("[API] Setting up automatic booster refresh (every 30 minutes)...");
  
  try {
    const BoosterServiceClass = (await import("./services/boosterService.js")).default;
    const boosterService = new BoosterServiceClass();
    
    // Check if refreshAllActiveBoosters method exists
    if (typeof boosterService.refreshAllActiveBoosters !== 'function') {
      console.warn("[API] ⚠️  Booster refresh method not found - skipping automatic refresh");
      return;
    }
    
    // REMOVED: Initial startup refresh to prevent API rate limiting spike
    // Boosters will be refreshed on the first scheduled run (30 minutes after startup)
    console.log("[API] ⏳ First booster refresh will run in 30 minutes (startup refresh disabled to avoid rate limiting)");
    
    // Run every 30 minutes
    setInterval(async () => {
      try {
        console.log("[API] Running scheduled booster refresh...");
        await boosterService.refreshAllActiveBoosters();
        console.log("[API] ✅ Scheduled booster refresh completed");
      } catch (error) {
        console.error("[API] Scheduled booster refresh failed:", error.message);
      }
    }, 30 * 60 * 1000); // 30 minutes
  } catch (error) {
    console.error("[API] Failed to initialize booster refresh:", error.message);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[API] SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[API] SIGINT received, shutting down gracefully...');
  process.exit(0);
});

console.log("✅ [API] Backend API service initialized successfully");
