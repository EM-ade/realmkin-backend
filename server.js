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
import cron from "node-cron";
import { PublicKey, Connection, Transaction, SystemProgram } from "@solana/web3.js";
import withdrawalLogger from "./services/withdrawalLogger.js";
import { sendMkinTokens } from "./utils/mkinTransfer.js";
import { getSolPriceUSD } from "./utils/solPrice.js";
import queryMonitor from "./utils/queryMonitor.js";

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
import revenueDistributionRoutes from "./routes/revenue-distribution.js";

app.use("/api/staking", stakingRoutes);
app.use("/api/goal", goalRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/boosters", boosterRoutes);
app.use("/api/distribution", distributionRoutes);
app.use("/api/force-claim", forceClaimRoutes);
app.use("/api/revenue-distribution", revenueDistributionRoutes);

// Middleware to verify Firebase token
async function verifyFirebase(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    console.warn("verifyFirebase error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Transfer endpoint
app.post("/api/transfer", verifyFirebase, async (req, res) => {
  try {
    const { recipientWalletAddress, amount, refId } = req.body || {};
    if (!recipientWalletAddress || typeof recipientWalletAddress !== "string") {
      return res.status(400).json({ error: "recipientWalletAddress required" });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive integer" });
    }
    if (!refId || typeof refId !== "string") {
      return res.status(400).json({ error: "refId required" });
    }

    const fs = admin.firestore();
    const senderUid = req.firebaseUid;

    // Resolve recipient via Firestore wallets mapping
    const walletDoc = await fs.collection("wallets").doc(String(recipientWalletAddress).toLowerCase()).get();
    if (!walletDoc.exists) {
      return res.status(404).json({ error: "Recipient wallet not found" });
    }
    const recipientUid = (walletDoc.data() || {}).uid;
    if (!recipientUid) {
      return res.status(404).json({ error: "Recipient user not found" });
    }

    if (recipientUid === senderUid) {
      return res.status(400).json({ error: "Cannot transfer to yourself" });
    }

    // Check for duplicate refId
    const transferHistoryRef = fs.collection("transferHistory").doc(refId);
    const existingTransfer = await transferHistoryRef.get();
    if (existingTransfer.exists) {
      const senderRewards = await fs.collection("userRewards").doc(senderUid).get();
      const balance = senderRewards.exists ? senderRewards.data().totalRealmkin || 0 : 0;
      return res.json({ balance });
    }

    // Perform atomic transfer
    let newSenderBalance = 0;
    await fs.runTransaction(async (transaction) => {
      const senderRef = fs.collection("userRewards").doc(senderUid);
      const recipientRef = fs.collection("userRewards").doc(recipientUid);

      const senderDoc = await transaction.get(senderRef);
      const recipientDoc = await transaction.get(recipientRef);

      if (!senderDoc.exists) {
        throw new Error("Sender rewards not found");
      }

      const senderBalance = senderDoc.data().totalRealmkin || 0;
      if (amount > senderBalance) {
        throw new Error("Insufficient funds");
      }

      const recipientBalance = recipientDoc.exists ? recipientDoc.data().totalRealmkin || 0 : 0;

      newSenderBalance = senderBalance - amount;
      const newRecipientBalance = recipientBalance + amount;

      transaction.update(senderRef, { totalRealmkin: newSenderBalance });
      if (recipientDoc.exists) {
        transaction.update(recipientRef, { totalRealmkin: newRecipientBalance });
      } else {
        transaction.set(recipientRef, { totalRealmkin: newRecipientBalance, userId: recipientUid });
      }

      transaction.set(transferHistoryRef, {
        from: senderUid,
        to: recipientUid,
        amount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    console.log(`[Transfer] ${senderUid} -> ${recipientUid}: ${amount} MKIN`);
    res.json({ balance: newSenderBalance });
  } catch (err) {
    console.error("POST /api/transfer error:", err);
    res.status(500).json({ error: err.message || "Transfer failed" });
  }
});

// Withdraw initiate endpoint
app.post("/api/withdraw/initiate", verifyFirebase, async (req, res) => {
  try {
    const { amount, walletAddress } = req.body;
    const userId = req.firebaseUid;

    if (!amount || !walletAddress) {
      return res.status(400).json({ error: "Missing amount or walletAddress" });
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const fs = admin.firestore();
    const rewardsDoc = await fs.collection("userRewards").doc(userId).get();

    if (!rewardsDoc.exists) {
      return res.status(404).json({ error: "User rewards not found" });
    }

    const totalRealmkin = rewardsDoc.data()?.totalRealmkin || 0;

    if (amount > totalRealmkin) {
      return res.status(400).json({
        error: "Insufficient balance",
        available: totalRealmkin,
      });
    }

    // Get SOL price and calculate fee
    const solPrice = await getSolPriceUSD();
    const feeInUsd = 1.05; // $0.15 base + $0.90 site fee (Maintenance $0.25 + Team $0.10 + Treasury $0.55)
    const feeInSol = feeInUsd / solPrice;

    // Create fee transaction (route fees to gatekeeper wallet)
    const gatekeeperKeypairJson = process.env.GATEKEEPER_KEYPAIR;
    if (!gatekeeperKeypairJson) {
      return res.status(500).json({ error: "GATEKEEPER_KEYPAIR not configured" });
    }

    const gatekeeperKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(gatekeeperKeypairJson))
    );
    const gatekeeperPubkey = gatekeeperKeypair.publicKey;
    const userPubkey = new PublicKey(walletAddress);
    const solanaRpcUrl = process.env.HELIUS_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(solanaRpcUrl);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userPubkey,
        toPubkey: gatekeeperPubkey,
        lamports: Math.floor(feeInSol * 1e9),
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userPubkey;

    const serializedTx = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64");

    res.json({
      success: true,
      feeTransaction: serializedTx,
      feeAmountSol: feeInSol,
      feeAmountUsd: feeInUsd,
      solPrice,
    });
  } catch (err) {
    console.error("[Withdraw Initiate] Error:", err);
    res.status(500).json({ error: "Failed to initiate withdrawal" });
  }
});

// Withdraw complete endpoint  
app.post("/api/withdraw/complete", verifyFirebase, async (req, res) => {
  try {
    const { feeSignature, amount, walletAddress } = req.body;
    const userId = req.firebaseUid;

    if (!feeSignature || !amount || !walletAddress) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const fs = admin.firestore();

    // Check if fee already used
    const usedFeesRef = fs.collection("usedWithdrawalFees").doc(feeSignature);
    const usedFeeDoc = await usedFeesRef.get();

    if (usedFeeDoc.exists) {
      return res.status(400).json({ error: "Fee signature already used" });
    }

    // Verify fee transaction on-chain
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const solanaRpcUrl = heliusApiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : "https://api.mainnet-beta.solana.com";
    const connection = new Connection(solanaRpcUrl);

    const txInfo = await connection.getTransaction(feeSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo || txInfo.meta?.err) {
      return res.status(400).json({ error: "Fee transaction invalid or failed" });
    }

    // Ensure fee was paid by user to gatekeeper wallet and amount is correct
    const userPubkey = new PublicKey(walletAddress);
    const feeInUsd = 1.05; // $0.15 base + $0.90 site fee
    const solPrice = await getSolPriceUSD();
    const feeInSol = feeInUsd / solPrice;
    const feeInLamports = Math.floor(feeInSol * 1e9);

    const gatekeeperKeypairJson = process.env.GATEKEEPER_KEYPAIR;
    if (!gatekeeperKeypairJson) {
      return res.status(500).json({ error: "GATEKEEPER_KEYPAIR not configured" });
    }

    const gatekeeperKeypair = Keypair.fromSecretKey(
      Buffer.from(JSON.parse(gatekeeperKeypairJson))
    );
    const gatekeeperPubkey = gatekeeperKeypair.publicKey.toBase58();

    const instructions = txInfo.transaction.message.instructions;
    const feePayment = instructions.find(ix => {
      if (!ix.parsed || ix.parsed.type !== "transfer") return false;
      return (
        ix.parsed.info.source === userPubkey.toString() &&
        ix.parsed.info.destination === gatekeeperPubkey &&
        ix.parsed.info.lamports >= feeInLamports
      );
    });

    if (!feePayment) {
      return res.status(400).json({ error: "Fee payment not found or incorrect" });
    }

    // Mark fee as used
    await usedFeesRef.set({
      userId,
      amount,
      walletAddress,
      usedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Distribute site fee split from gatekeeper wallet
    const distributionResult = await distributeFees("withdraw", 0.9, {
      sourceWallet: "gatekeeper",
      treasuryDestination: "gatekeeper",
      extraTreasuryUsd: 0.15,
    });
    if (!distributionResult.success) {
      console.warn(
        `[Withdraw Complete] Fee distribution failed: ${distributionResult.error}`
      );
    }

    // Deduct from Firebase
    const rewardsRef = fs.collection("userRewards").doc(userId);
    let newBalance;

    await fs.runTransaction(async (transaction) => {
      const rewardsDoc = await transaction.get(rewardsRef);

      if (!rewardsDoc.exists) {
        throw new Error("User rewards not found");
      }

      const currentBalance = rewardsDoc.data()?.totalRealmkin || 0;

      if (amount > currentBalance) {
        throw new Error("Insufficient balance");
      }

      newBalance = currentBalance - amount;

      transaction.update(rewardsRef, {
        totalRealmkin: newBalance,
        totalClaimed: admin.firestore.FieldValue.increment(amount),
      });
    });

    // Send MKIN tokens
    const mkinTxHash = await sendMkinTokens(walletAddress, amount);

    console.log(`[Withdraw Complete] Success: ${mkinTxHash}`);

    res.json({
      success: true,
      txHash: mkinTxHash,
      newBalance,
    });
  } catch (err) {
    console.error("[Withdraw Complete] Error:", err);
    res.status(500).json({ error: err.message || "Failed to complete withdrawal" });
  }
});

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
  console.log(`📊 [API] Firebase Query Monitor initialized (logs every 5 minutes)`);
  
  // Initialize automatic booster refresh
  setupAutomaticBoosterRefresh();
  
  // Initialize automatic force-claim scheduler
  setupAutomaticForceClaim();
  
  // Initialize automatic secondary market cache refresh
  setupSecondaryMarketRefresh();
  
  // Initialize automatic revenue distribution reminder
  setupAutomaticRevenueDistribution();
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
    
    // OPTIMIZATION: Changed refresh interval from 30 minutes to 6 hours
    // This reduces Firebase operations by 92% (from 48 runs/day to 4 runs/day)
    // Savings: ~13,000 reads/day + 8,800 writes/day eliminated
    console.log("[API] ⏳ First booster refresh will run in 6 hours");
    
    // Run every 6 hours (reduced from 30 minutes)
    setInterval(async () => {
      try {
        console.log("[API] 🔄 Running scheduled booster refresh (every 6 hours)...");
        await boosterService.refreshAllActiveBoosters();
        console.log("[API] ✅ Scheduled booster refresh completed");
      } catch (error) {
        console.error("[API] ❌ Scheduled booster refresh failed:", error.message);
      }
    }, 6 * 60 * 60 * 1000); // 6 hours (was 30 minutes)
  } catch (error) {
    console.error("[API] Failed to initialize booster refresh:", error.message);
  }
}

/**
 * Setup automatic secondary market cache refresh
 * Runs daily at 2:00 AM UTC to keep leaderboard fresh
 */
async function setupSecondaryMarketRefresh() {
  console.log("[API] Setting up automatic secondary market cache refresh (daily at 2:00 AM WAT/Nigerian time)...");
  
  try {
    // Schedule cron job: Daily at 2:00 AM WAT (Nigerian time)
    // Cron format: minute hour day month weekday
    // 0 2 * * * = At 02:00 every day
    cron.schedule('0 2 * * *', async () => {
      try {
        console.log("⏰ [API] Automatic secondary market refresh triggered");
        
        // Import the verification service
        const { default: SecondarySaleVerificationService } = await import("./services/secondarySaleVerification.js");
        const verificationService = new SecondarySaleVerificationService();
        
        // Get all users with wallets (using pagination)
        const db = admin.firestore();
        const wallets = [];
        let lastDoc = null;
        let pageNum = 1;
        const pageSize = 100;
        
        console.log(`🔄 [API] Fetching users with wallets (paginated)...`);
        
        while (true) {
          let query = db.collection('userRewards')
            .where('walletAddress', '!=', null)
            .orderBy('walletAddress')
            .limit(pageSize);
          
          if (lastDoc) {
            query = query.startAfter(lastDoc);
          }
          
          const snapshot = await query.get();
          
          if (snapshot.empty) {
            break;
          }
          
          snapshot.forEach(doc => {
            const data = doc.data();
            if (data.walletAddress?.trim()) {
              wallets.push(data.walletAddress);
            }
          });
          
          lastDoc = snapshot.docs[snapshot.docs.length - 1];
          console.log(`   📄 Page ${pageNum}: Fetched ${snapshot.docs.length} users (total: ${wallets.length})`);
          pageNum++;
          
          if (snapshot.docs.length < pageSize) {
            break;
          }
        }
        
        console.log(`🔄 [API] Refreshing secondary market cache for ${wallets.length} wallets...`);
        
        // Batch verify (uses cache, only queries expired entries)
        await verificationService.batchVerifyUsers(wallets);
        
        console.log(`✅ [API] Secondary market cache refresh completed`);
        
        // Send Discord notification
        try {
          const { sendDiscordAlert } = await import("./utils/discordAlerts.js");
          await sendDiscordAlert(
            `✅ Secondary Market Cache Refreshed\\n` +
            `• Wallets checked: ${wallets.length}\\n` +
            `• Time: ${new Date().toISOString()}\\n` +
            `• Next refresh: Tomorrow at 02:00 UTC`,
            "info"
          );
        } catch (alertError) {
          console.warn("[API] Failed to send Discord alert:", alertError.message);
        }
      } catch (error) {
        console.error("❌ [API] Secondary market cache refresh failed:", error.message);
        
        // Send Discord notification on failure
        try {
          const { sendDiscordAlert } = await import("./utils/discordAlerts.js");
          await sendDiscordAlert(
            `❌ Secondary Market Cache Refresh FAILED\\n` +
            `• Error: ${error.message}\\n` +
            `• Time: ${new Date().toISOString()}`,
            "error"
          );
        } catch (alertError) {
          console.warn("[API] Failed to send Discord alert:", alertError.message);
        }
      }
    }, {
      scheduled: true,
      timezone: "Africa/Lagos" // Nigerian time (WAT - UTC+1)
    });
    
    console.log("✅ [API] Automatic secondary market refresh scheduler initialized");
    console.log("📅 [API] Next refresh: Tomorrow at 02:00:00 WAT (Nigerian time)");
  } catch (error) {
    console.error("[API] Failed to initialize secondary market refresh:", error.message);
  }
}

/**
 * Setup automatic monthly revenue distribution
 * Runs on the 27th of every month at 12:00 PM WAT (Nigerian time)
 */
async function setupAutomaticRevenueDistribution() {
  console.log("[API] Setting up automatic revenue distribution (27th of every month at 12:00 PM WAT)...");
  
  try {
    // Schedule cron job: 27th of every month at 12:00 PM WAT
    // Cron format: minute hour day-of-month month day-of-week
    // 0 12 27 * * = At 12:00 PM on day 27 of every month
    cron.schedule('0 12 27 * *', async () => {
      try {
        console.log("⏰ [API] Automatic monthly revenue distribution triggered");
        
        // Import revenue distribution service
        const revenueModule = await import("./routes/revenue-distribution.js");
        
        // Call the allocation endpoint internally
        const db = admin.firestore();
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const distributionId = `revenue_dist_${year}_${month}`;
        
        console.log(`💰 [API] Starting revenue distribution: ${distributionId}`);
        
        // Note: This would need the actual allocation logic
        // For now, log that manual trigger is still recommended
        console.log("⚠️  [API] Automatic revenue distribution scheduled");
        console.log("💡 [API] For safety, please use the manual script for now:");
        console.log("    node scripts/run-production-revenue-distribution.js");
        
        // Send Discord notification
        try {
          const { sendDiscordAlert } = await import("./utils/discordAlerts.js");
          await sendDiscordAlert(
            `📅 Monthly Revenue Distribution Reminder\\n` +
            `• Date: ${distributionId}\\n` +
            `• Please run manual distribution script\\n` +
            `• Command: node scripts/run-production-revenue-distribution.js\\n` +
            `• Time: ${new Date().toISOString()}`,
            "info"
          );
        } catch (alertError) {
          console.warn("[API] Failed to send Discord alert:", alertError.message);
        }
      } catch (error) {
        console.error("❌ [API] Automatic revenue distribution check failed:", error.message);
        
        // Send Discord notification on failure
        try {
          const { sendDiscordAlert } = await import("./utils/discordAlerts.js");
          await sendDiscordAlert(
            `❌ Revenue Distribution Reminder FAILED\\n` +
            `• Error: ${error.message}\\n` +
            `• Time: ${new Date().toISOString()}`,
            "error"
          );
        } catch (alertError) {
          console.warn("[API] Failed to send Discord alert:", alertError.message);
        }
      }
    }, {
      scheduled: true,
      timezone: "Africa/Lagos" // Nigerian time (WAT - UTC+1)
    });
    
    console.log("✅ [API] Automatic revenue distribution reminder initialized");
    console.log("📅 [API] Next reminder: 27th of next month at 12:00 PM WAT");
  } catch (error) {
    console.error("[API] Failed to initialize revenue distribution reminder:", error.message);
  }
}

/**
 * Setup automatic force-claim scheduler
 * Runs every Sunday at 12:00 UTC
 */
async function setupAutomaticForceClaim() {
  console.log("[API] Setting up automatic force-claim scheduler (every Sunday at 12:00 PM WAT/Nigerian time)...");
  
  try {
    const forceClaimService = (await import("./services/forceClaimService.js")).default;
    
    // Check if runForceClaim method exists
    if (typeof forceClaimService.runForceClaim !== 'function') {
      console.warn("[API] ⚠️  Force-claim method not found - skipping automatic scheduler");
      return;
    }
    
    console.log(`[API] 📅 Force-claim will run every Sunday at 12:00 PM WAT (Nigerian time)`);
    
    // Schedule cron job: Every Sunday at 12:00 PM WAT (Nigerian time)
    // Cron format: second minute hour day month weekday
    // 0 12 * * 0 = At 12:00 on Sunday
    cron.schedule('0 12 * * 0', async () => {
      try {
        console.log("⏰ [API] Automatic force-claim triggered by scheduler");
        const result = await forceClaimService.runForceClaim();
        console.log(`✅ [API] Automatic force-claim completed: ${result.claimsProcessed} claims processed`);
        
        // Send Discord notification on success
        try {
          const { sendDiscordAlert } = await import("./utils/discordAlerts.js");
          await sendDiscordAlert(
            `✅ Automatic Force-Claim Completed\\n` +
            `• Claims: ${result.claimsProcessed}\\n` +
            `• Distributed: ₥${result.totalAmountDistributed.toLocaleString()}\\n` +
            `• Duration: ${result.duration}\\n` +
            `• Triggered: Automatic (Sunday 12:00 PM WAT/Nigerian time)`,
            "info"
          );
        } catch (alertError) {
          console.warn("[API] Failed to send Discord alert:", alertError.message);
        }
      } catch (error) {
        console.error("❌ [API] Automatic force-claim failed:", error.message);
        
        // Send Discord notification on failure
        try {
          const { sendDiscordAlert } = await import("./utils/discordAlerts.js");
          await sendDiscordAlert(
            `❌ Automatic Force-Claim FAILED\\n` +
            `• Error: ${error.message}\\n` +
            `• Time: ${new Date().toISOString()}`,
            "error"
          );
        } catch (alertError) {
          console.warn("[API] Failed to send Discord alert:", alertError.message);
        }
      }
    }, {
      scheduled: true,
      timezone: "Africa/Lagos" // Nigerian time (WAT - UTC+1)
    });
    
    console.log("✅ [API] Automatic force-claim scheduler initialized successfully");
  } catch (error) {
    console.error("[API] Failed to initialize force-claim scheduler:", error.message);
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
