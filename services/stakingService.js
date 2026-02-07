import admin from "firebase-admin";
import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
// Removed getFirestore import - using admin.firestore() instead
import bs58 from "bs58";
import BoosterService from "./boosterService.js";

// Configuration Constants
const STAKING_POOL_ID = "staking_global"; // Doc ID in 'config' collection or root 'staking_pool' collection
const POOL_COLLECTION = "staking_pool"; // Or put in 'config'
const POSITIONS_COLLECTION = "staking_positions";
const TRANSACTIONS_COLLECTION = "staking_transactions";
const USER_REWARDS_COLLECTION = "userRewards";

// Error Classes
class StakingError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.name = "StakingError";
    this.code = code;
  }
}

class StakingService {
  constructor() {
    // Lazy init db
    this._db = null;
    this._boosterService = null; // Lazy init BoosterService

    // Use environment-configured network settings
    this._networkInitialized = this._initializeNetwork();
  }

  async _initializeNetwork() {
    // Import environment configuration
    const { default: environmentConfig } =
      await import("../config/environment.js");
    const networkConfig = environmentConfig.networkConfig;

    // Use environment-configured RPC URL
    this.connection = new Connection(networkConfig.rpcUrl, "confirmed");
    this.tokenMint = new PublicKey(networkConfig.tokenMint);
    this.isDevnet = networkConfig.isDevnet;
    this.cluster = networkConfig.cluster;
    this.network = networkConfig.cluster;
    console.log(`✅ StakingService initialized with network: ${this.network}`);
  }

  async _ensureInitialized() {
    if (this._networkInitialized) {
      await this._networkInitialized;
    }
  }

  get db() {
    if (!this._db) {
      this._db = admin.firestore();
    }
    return this._db;
  }

  get boosterService() {
    if (!this._boosterService) {
      this._boosterService = new BoosterService();
    }
    return this._boosterService;
  }

  /**
   * Helper: Get Global Pool Data
   */
  async getPoolData(t = null) {
    const poolRef = this.db.collection(POOL_COLLECTION).doc(STAKING_POOL_ID);
    const doc = t ? await t.get(poolRef) : await poolRef.get();

    if (!doc.exists) {
      // Initialize if not exists (Lazy Init)
      const initialData = {
        total_staked: 0,
        reward_pool_sol: 0,
        acc_reward_per_share: 0, // 1e18 precision stored as string or floating point?
        // JS Numbers have 53 bits. For 1e18 precision, we need BigInt or careful handling.
        // We will store as number for simplicity but beware precision drift.
        // Better: Store as string (BigInt representation)
        last_reward_time: admin.firestore.Timestamp.now(),
        updated_at: admin.firestore.Timestamp.now(),
      };
      if (!t) await poolRef.set(initialData);
      return initialData;
    }
    return doc.data();
  }

  /**
   * Helper: Update Pool State with 10% Flat ROI Logic
   * Calculates rewards based on: (totalStaked * 10% * tokenPrice * timeDiff) / SECONDS_IN_YEAR
   * This ensures users earn 10% of their staked token value per year, paid in SOL.
   *
   * @deprecated Use _calculateNewPoolStateSync() inside Firestore transactions
   */
  async _calculateNewPoolState(poolData) {
    const now = admin.firestore.Timestamp.now();
    const lastTime = poolData.last_reward_time || now;
    const timeDiffSeconds = now.seconds - lastTime.seconds;

    if (timeDiffSeconds <= 0) {
      return { ...poolData, last_reward_time: now };
    }

    if (poolData.total_staked === 0) {
      return { ...poolData, last_reward_time: now, updated_at: now };
    }

    // NEW: 10% Flat ROI Logic
    // Reward = (Staked Tokens * 10% * Token/SOL Price * Time) / Year
    const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
    const ROI_PERCENT = 0.1; // 10% per year

    // Fetch current MKIN/SOL price
    const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
    const tokenPriceSol = await getMkinPriceSOL();

    console.log(
      `💰 Pool update: ${poolData.total_staked.toLocaleString()} MKIN staked, price: ${tokenPriceSol.toFixed(
        6,
      )} SOL/MKIN`,
    );

    // Calculate rewards to emit for this time period
    const rewardsToEmit =
      (poolData.total_staked * ROI_PERCENT * tokenPriceSol * timeDiffSeconds) /
      SECONDS_IN_YEAR;

    console.log(
      `⏱️ Time elapsed: ${timeDiffSeconds}s, rewards to emit: ${rewardsToEmit.toFixed(
        9,
      )} SOL`,
    );

    return {
      ...poolData,
      last_reward_time: now,
      updated_at: now,
    };
  }

  /**
   * Helper: Update Pool State SYNCHRONOUSLY (for use inside Firestore transactions)
   * This method does NOT make any async calls, which is critical for Firestore transaction reliability.
   * Price data must be pre-fetched before calling this method.
   *
   * @param {Object} poolData - Current pool state
   * @param {number} tokenPriceSol - Pre-fetched MKIN/SOL price
   * @param {Timestamp} now - Pre-created Firestore timestamp
   * @returns {Object} Updated pool state
   */
  _calculateNewPoolStateSync(poolData, tokenPriceSol, now) {
    const lastTime = poolData.last_reward_time || now;
    const timeDiffSeconds = now.seconds - lastTime.seconds;

    if (timeDiffSeconds <= 0) {
      return { ...poolData, last_reward_time: now };
    }

    if (poolData.total_staked === 0) {
      return { ...poolData, last_reward_time: now, updated_at: now };
    }

    // 10% Flat ROI Logic
    // Reward = (Staked Tokens * 10% * Token/SOL Price * Time) / Year
    const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
    const ROI_PERCENT = 0.1; // 10% per year

    console.log(
      `💰 Pool update (sync): ${poolData.total_staked.toLocaleString()} MKIN staked, price: ${tokenPriceSol.toFixed(
        6,
      )} SOL/MKIN`,
    );

    // Calculate rewards to emit for this time period
    const rewardsToEmit =
      (poolData.total_staked * ROI_PERCENT * tokenPriceSol * timeDiffSeconds) /
      SECONDS_IN_YEAR;

    console.log(
      `⏱️ Time elapsed: ${timeDiffSeconds}s, rewards to emit: ${rewardsToEmit.toFixed(
        9,
      )} SOL`,
    );

    return {
      ...poolData,
      last_reward_time: now,
      updated_at: now,
    };
  }

  /**
   * GET /overview
   * Simplified: Fixed 10% ROI with reward gating based on goal completion
   */
  async getOverview(firebaseUid) {
    // Import fee wallets for config
    const { FEE_WALLETS, FEE_SPLIT } = await import("../utils/treasuryWallet.js");
    
    // Check if goal is completed (for reward gating)
    const { goalService } = await import("./goalService.js");
    const isGoalCompleted = await goalService.isGoalCompleted();

    // Boosters are now detected separately via /api/boosters/refresh endpoint
    // to avoid excessive reads on every overview call.
    // This change reduces Firebase reads by ~100 per overview call.

    // OPTIMIZATION: Removed automatic booster detection on overview calls
    // This was causing excessive Firebase reads (3 reads + 2 writes per user per page load)
    // Users can manually refresh boosters via: POST /api/boosters/refresh
    // Savings: ~150 reads/day + 100 writes/day eliminated

    // Note: Boosters are still detected:
    // 1. Via periodic refresh job (every 6 hours)
    // 2. Via manual refresh button in UI
    // 3. Via admin endpoint: POST /api/boosters/refresh-all

    const pool = await this.getPoolData();

    let userPos = null;
    let pending = 0;
    let mkinBalance = 0;

    if (firebaseUid) {
      const posRef = this.db.collection(POSITIONS_COLLECTION).doc(firebaseUid);
      const rewardRef = this.db
        .collection(USER_REWARDS_COLLECTION)
        .doc(firebaseUid);

      const [posDoc, rewardDoc] = await Promise.all([
        posRef.get(),
        rewardRef.get(),
      ]);

      if (posDoc.exists) {
        userPos = posDoc.data();

        // Calculate pending with 10% FLAT ROI (token-value-based)
        // Checkpoint-based calculation (Fixes "Instant Rewards" bug)
        // REWARD GATING: Only calculate rewards if goal is completed
        if (
          userPos?.updated_at &&
          userPos.principal_amount > 0 &&
          isGoalCompleted
        ) {
          // Use the _calculatePendingRewards method which uses locked token price
          // This ensures pending rewards are consistent with the display mining rate
          // and don't fluctuate with current token price changes
          const boosterMultiplier =
            this.boosterService.calculateStackedMultiplier(
              userPos.active_boosters || [],
            );

          pending = this._calculatePendingRewards(userPos, boosterMultiplier);

          console.log(`⛏️ Pending rewards calculated using locked token price`);
          console.log(
            `   Principal: ${userPos.principal_amount.toLocaleString()} MKIN`,
          );
          console.log(`   Total Pending: ${pending.toFixed(9)} SOL`);
        } else {
          pending = 0;
        }
      }

      if (rewardDoc.exists) {
        mkinBalance = rewardDoc.data().totalRealmkin || 0;
      }
    }

    // Calculate user's mining rate (10% ROI based on token value)
    // REWARD GATING: Only show mining rate if goal is completed
    const SECONDS_IN_YEAR = 365 * 24 * 60 * 60;
    const ROI_PERCENT = 0.1; // 10% per year
    const FIXED_APR = 10; // Display as 10% APR

    let baseMiningRate = 0;
    let totalMiningRate = 0;
    let displayMiningRate = 0; // Stable rate based on locked price at stake time

    if (userPos?.principal_amount > 0 && isGoalCompleted) {
      // Fetch current MKIN/SOL price
      const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
      const tokenPriceSol = await getMkinPriceSOL();

      // Base rate = (principal * 10% * price) / seconds_in_year
      baseMiningRate =
        (userPos.principal_amount * ROI_PERCENT * tokenPriceSol) /
        SECONDS_IN_YEAR;

      // Apply booster multiplier using new BoosterService
      const boosterMultiplier = this.boosterService.calculateStackedMultiplier(
        userPos.active_boosters || [],
      );
      totalMiningRate = baseMiningRate * boosterMultiplier;

      // Calculate display rate using locked token price (stable for UI)
      // This prevents visual fluctuations while actual rewards use current price
      const lockedPrice = userPos.locked_token_price_sol || tokenPriceSol;
      const lockedBaseMiningRate =
        (userPos.principal_amount * ROI_PERCENT * lockedPrice) /
        SECONDS_IN_YEAR;
      displayMiningRate = lockedBaseMiningRate * boosterMultiplier;

      console.log(`⛏️ User mining rate (10% ROI):`);
      console.log(
        `   Principal: ${userPos.principal_amount.toLocaleString()} MKIN`,
      );
      console.log(
        `   Current Token Price: ${tokenPriceSol.toFixed(6)} SOL/MKIN`,
      );
      console.log(`   Locked Token Price: ${lockedPrice.toFixed(6)} SOL/MKIN`);
      console.log(`   Base (actual): ${baseMiningRate.toFixed(12)} SOL/s`);
      console.log(
        `   Base (display): ${lockedBaseMiningRate.toFixed(12)} SOL/s`,
      );
      console.log(`   Booster: ${boosterMultiplier}x`);
      console.log(`   Total (actual): ${totalMiningRate.toFixed(12)} SOL/s`);
      console.log(`   Total (display): ${displayMiningRate.toFixed(12)} SOL/s`);
    }

    // Use boosters from stored position data
    const activeBoosters = userPos?.active_boosters || [];

    return {
      pool: {
        totalStaked: pool.total_staked,
        rewardPool: pool.reward_pool_sol,
        apr: FIXED_APR, // Fixed 10% APR
      },
      user: {
        principal: userPos?.principal_amount || 0,
        pendingRewards: pending,
        baseMiningRate: baseMiningRate, // Base SOL/s without boosters (actual, current price)
        totalMiningRate: totalMiningRate, // Total SOL/s with boosters (actual, current price)
        displayMiningRate: displayMiningRate, // Stable rate for UI (locked price at stake time)
        lockedTokenPriceSol: userPos?.locked_token_price_sol || null, // Token price locked at stake time
        activeBoosters: activeBoosters,
        boosterMultiplier:
          this.boosterService.calculateStackedMultiplier(activeBoosters),
        stakeStartTime: userPos?.stake_start_time?.toMillis() || null,
        lastStakeTime: userPos?.last_stake_time?.toMillis() || null,
        totalClaimedSol: userPos?.total_claimed_sol || 0,
        mkinBalance,
      },
      config: {
        stakingWalletAddress: process.env.STAKING_WALLET_ADDRESS,
        treasuryWallet: FEE_WALLETS.TREASURY,
        personalWallet: FEE_WALLETS.PERSONAL,
        feeSplit: FEE_SPLIT,
        roiPercent: ROI_PERCENT,
        fixedApr: FIXED_APR,
        isRewardsPaused: !isGoalCompleted, // Rewards are paused until goal is completed
      },
      timestamp: Date.now(),
    };
  }

  /**
   * STAKE
   * User sends MKIN tokens to vault + pays 5% entry fee + $0.90 site fee in SOL
   * Fee goes to reward pool to grow APR for everyone
   */
  async stake(firebaseUid, amount, txSignature, feeSignature) {
    const operationId = `STAKE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logPrefix = `[${operationId}]`;

    console.log(`\n${"=".repeat(80)}`);
    console.log(`${logPrefix} 🚀 STAKE OPERATION STARTED`);
    console.log(`${"=".repeat(80)}`);
    console.log(`${logPrefix} Timestamp: ${new Date().toISOString()}`);
    console.log(`${logPrefix} User ID: ${firebaseUid}`);
    console.log(`${logPrefix} Amount: ${amount} MKIN`);
    console.log(`${logPrefix} Token TX Signature: ${txSignature}`);
    console.log(`${logPrefix} Fee TX Signature: ${feeSignature}`);
    console.log(`${logPrefix} Network: ${this.network || "initializing..."}`);

    if (amount <= 0) {
      console.error(
        `${logPrefix} ❌ VALIDATION ERROR: Invalid amount (${amount})`,
      );
      throw new StakingError("Invalid amount");
    }
    if (!txSignature) {
      console.error(
        `${logPrefix} ❌ VALIDATION ERROR: Missing token transaction signature`,
      );
      throw new StakingError("Token transaction signature required");
    }
    if (!feeSignature) {
      console.error(
        `${logPrefix} ❌ VALIDATION ERROR: Missing fee transaction signature`,
      );
      throw new StakingError("Fee transaction signature required");
    }

    console.log(`${logPrefix} ✅ Input validation passed`);

    // Get user's wallet address from Firestore
    console.log(`${logPrefix} 📖 Fetching user wallet from Firestore...`);
    const userRewardDoc = await this.db
      .collection(USER_REWARDS_COLLECTION)
      .doc(firebaseUid)
      .get();
    if (!userRewardDoc.exists) {
      console.error(
        `${logPrefix} ❌ USER NOT FOUND: No document in ${USER_REWARDS_COLLECTION} for ${firebaseUid}`,
      );
      throw new StakingError("User not found");
    }

    const userWallet = userRewardDoc.data().walletAddress;
    if (!userWallet) {
      console.error(
        `${logPrefix} ❌ NO WALLET: User ${firebaseUid} has no walletAddress field`,
      );
      throw new StakingError("User wallet address not found");
    }
    console.log(`${logPrefix} ✅ User wallet found: ${userWallet}`);

    // 1. Calculate 5% entry fee + $0.80 site fee in SOL
    console.log(`${logPrefix} 💰 Step 1: Calculating 5% entry fee + $0.80 site fee...`);
    const { calculateStakingFee } = await import("../utils/mkinPrice.js");
    const feeData = await calculateStakingFee(amount, 5);
    
    // Add $0.90 site fee (Maintenance $0.25 + Team $0.10 + Treasury $0.55)
    const { getFeeInSol } = await import("../utils/solPrice.js");
    const siteFeeData = await getFeeInSol(0.90); // $0.90 USD
    const totalFeeInSol = feeData.feeInSol + siteFeeData.solAmount;
    
    console.log(`${logPrefix} Fee Calculation Results:`);
    console.log(
      `${logPrefix}   - 5% fee in SOL: ${feeData.feeInSol.toFixed(9)} SOL`,
    );
    console.log(
      `${logPrefix}   - Site fee ($0.80): ${siteFeeData.solAmount.toFixed(9)} SOL`,
    );
    console.log(
      `${logPrefix}   - Total fee in SOL: ${totalFeeInSol.toFixed(9)} SOL`,
    );
    console.log(
      `${logPrefix}   - Fee in MKIN value: ${feeData.feeInMkin} MKIN`,
    );
    console.log(`${logPrefix}   - Fee percent: ${feeData.feePercent}%`);
    console.log(`${logPrefix}   - MKIN price (USD): $${feeData.mkinPriceUsd}`);
    console.log(`${logPrefix}   - SOL price (USD): $${feeData.solPriceUsd}`);

    // 2. Verify fee payment (5% + $0.80 in SOL)
    // Allow 100% tolerance for rounding/timing differences between frontend and backend
    console.log(`${logPrefix} 🔍 Step 2: Verifying fee payment...`);
    const tolerance = 1.0; // 100% (VERY LAX)
    const minFee = totalFeeInSol * (1 - tolerance);
    const maxFee = totalFeeInSol * (1 + tolerance);

    console.log(`${logPrefix} Fee Verification Parameters:`);
    console.log(
      `${logPrefix}   - Expected: ${totalFeeInSol.toFixed(9)} SOL`,
    );
    console.log(`${logPrefix}   - Tolerance: ${tolerance * 100}%`);
    console.log(`${logPrefix}   - Min acceptable: ${minFee.toFixed(9)} SOL`);
    console.log(`${logPrefix}   - Max acceptable: ${maxFee.toFixed(9)} SOL`);
    console.log(`${logPrefix}   - Fee signature: ${feeSignature}`);

    const isValidFee = await this._verifySolTransfer(
      feeSignature,
      minFee,
      maxFee,
    );
    if (!isValidFee) {
      console.error(`${logPrefix} ❌ FEE VERIFICATION FAILED!`);
      console.error(`${logPrefix}   - Signature: ${feeSignature}`);
      console.error(
        `${logPrefix}   - Expected range: ${minFee.toFixed(9)} - ${maxFee.toFixed(9)} SOL`,
      );
      throw new StakingError("Invalid staking fee payment");
    }
    console.log(
      `${logPrefix} ✅ Fee payment verified: ${feeData.feeInSol.toFixed(9)} SOL`,
    );

    // 3. Verify token transfer to vault
    console.log(`${logPrefix} 🔍 Step 3: Verifying token transfer to vault...`);
    console.log(`${logPrefix}   - Token TX signature: ${txSignature}`);
    console.log(`${logPrefix}   - Expected amount: ${amount} MKIN`);
    console.log(`${logPrefix}   - From wallet: ${userWallet}`);

    const isValidTransfer = await this._verifyTokenTransfer(
      txSignature,
      amount,
      userWallet,
    );
    if (!isValidTransfer) {
      console.error(`${logPrefix} ❌ TOKEN TRANSFER VERIFICATION FAILED!`);
      console.error(`${logPrefix}   - Signature: ${txSignature}`);
      console.error(`${logPrefix}   - Amount: ${amount} MKIN`);
      console.error(`${logPrefix}   - User wallet: ${userWallet}`);
      throw new StakingError("Invalid or insufficient token transfer");
    }
    console.log(`${logPrefix} ✅ Token transfer verified: ${amount} MKIN`);

    // 4. Check for duplicate transaction
    console.log(
      `${logPrefix} 🔍 Step 4: Checking for duplicate transaction...`,
    );
    const existingTx = await this.db
      .collection(TRANSACTIONS_COLLECTION)
      .where("signature", "==", txSignature)
      .limit(1)
      .get();

    if (!existingTx.empty) {
      console.error(`${logPrefix} ❌ DUPLICATE TRANSACTION DETECTED!`);
      console.error(`${logPrefix}   - Signature: ${txSignature}`);
      console.error(
        `${logPrefix}   - Existing doc ID: ${existingTx.docs[0].id}`,
      );
      throw new StakingError("Transaction already processed");
    }
    console.log(`${logPrefix} ✅ No duplicate found`);

    // 5. Pre-fetch price data BEFORE the transaction (critical fix!)
    // This avoids async operations inside Firestore transaction which can cause
    // transaction timeouts and silent failures
    console.log(`${logPrefix} 📊 Step 5: Pre-fetching price data...`);
    const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
    const tokenPriceSol = await getMkinPriceSOL();
    const now = admin.firestore.Timestamp.now();
    console.log(
      `${logPrefix} ✅ Price data fetched: ${tokenPriceSol.toFixed(9)} SOL/MKIN`,
    );

    // 6. Update staking position in Firestore (atomic transaction)
    console.log(`${logPrefix} 📝 Step 6: Starting Firestore transaction...`);
    console.log(`${logPrefix}   - Pool collection: ${POOL_COLLECTION}`);
    console.log(`${logPrefix}   - Pool doc ID: ${STAKING_POOL_ID}`);
    console.log(
      `${logPrefix}   - Position collection: ${POSITIONS_COLLECTION}`,
    );
    console.log(`${logPrefix}   - Position doc ID: ${firebaseUid}`);

    try {
      await this.db.runTransaction(async (t) => {
        const poolRef = this.db
          .collection(POOL_COLLECTION)
          .doc(STAKING_POOL_ID);
        const posRef = this.db
          .collection(POSITIONS_COLLECTION)
          .doc(firebaseUid);

        console.log(`${logPrefix}   📖 Reading pool and position documents...`);
        const [poolDoc, posDoc] = await Promise.all([
          t.get(poolRef),
          t.get(posRef),
        ]);

        console.log(`${logPrefix}   - Pool doc exists: ${poolDoc.exists}`);
        console.log(`${logPrefix}   - Position doc exists: ${posDoc.exists}`);

        // Initialize Pool if needed
        let poolData = poolDoc.exists
          ? poolDoc.data()
          : {
              total_staked: 0,
              reward_pool_sol: 0,
              acc_reward_per_share: 0,
              last_reward_time: now,
            };

        console.log(
          `${logPrefix}   - Pool total_staked (before): ${poolData.total_staked || 0} MKIN`,
        );
        console.log(
          `${logPrefix}   - Pool reward_pool_sol: ${poolData.reward_pool_sol || 0} SOL`,
        );

        // Update Pool State using pre-fetched price (no async calls here!)
        poolData = this._calculateNewPoolStateSync(
          poolData,
          tokenPriceSol,
          now,
        );

        // Get/Init User Position
        let posData = posDoc.exists
          ? posDoc.data()
          : {
              user_id: firebaseUid,
              principal_amount: 0,
              pending_rewards: 0,
              total_accrued_sol: 0,
              total_claimed_sol: 0,
            };

        const previousPrincipal = posData.principal_amount || 0;
        console.log(
          `${logPrefix}   - User principal (before): ${previousPrincipal} MKIN`,
        );
        console.log(
          `${logPrefix}   - User pending_rewards: ${posData.pending_rewards || 0} SOL`,
        );
        console.log(
          `${logPrefix}   - User total_claimed_sol: ${posData.total_claimed_sol || 0} SOL`,
        );

        // NOTE: We no longer use MasterChef-style acc_reward_per_share/reward_debt
        // Rewards are calculated purely based on: (principal * 10% * price * time) / year

        // 🚀 ADD ENTRY FEE TO REWARD POOL (Self-Sustaining Pool Growth!)
        const previousRewardPool = poolData.reward_pool_sol || 0;
        poolData.reward_pool_sol = previousRewardPool + feeData.feeInSol;
        console.log(`${logPrefix}   💰 Entry fee added to reward pool:`);
        console.log(
          `${logPrefix}     - Fee: ${feeData.feeInSol.toFixed(9)} SOL`,
        );
        console.log(
          `${logPrefix}     - Pool before: ${previousRewardPool.toFixed(9)} SOL`,
        );
        console.log(
          `${logPrefix}     - Pool after: ${poolData.reward_pool_sol.toFixed(9)} SOL`,
        );

        // Update Principal (FULL amount, no deduction)
        posData.principal_amount = previousPrincipal + amount; // Full stake amount!

        // Track stake start time (for client-side reward calculation)
        if (!posData.stake_start_time) {
          posData.stake_start_time = now;
          console.log(
            `${logPrefix}   ⏰ First stake - setting stake_start_time`,
          );
        }
        posData.last_stake_time = now;

        // Store locked token price at stake time for stable display rate
        // This prevents visual fluctuations in mining rate due to token price changes
        // Use weighted average when user adds more stake at a different price
        const existingLockedPrice = posData.locked_token_price_sol || 0;
        if (previousPrincipal > 0 && existingLockedPrice > 0) {
          // Weighted average: (oldPrice * oldPrincipal + newPrice * newAmount) / totalPrincipal
          posData.locked_token_price_sol =
            (existingLockedPrice * previousPrincipal + tokenPriceSol * amount) /
            posData.principal_amount;
          console.log(
            `${logPrefix}   📊 Updated locked token price (weighted avg):`,
          );
          console.log(
            `${logPrefix}     - Previous locked price: ${existingLockedPrice.toFixed(9)} SOL/MKIN`,
          );
          console.log(
            `${logPrefix}     - Current price: ${tokenPriceSol.toFixed(9)} SOL/MKIN`,
          );
          console.log(
            `${logPrefix}     - New locked price: ${posData.locked_token_price_sol.toFixed(9)} SOL/MKIN`,
          );
        } else {
          // First stake - lock in current price
          posData.locked_token_price_sol = tokenPriceSol;
          console.log(
            `${logPrefix}   📊 Set initial locked token price: ${posData.locked_token_price_sol.toFixed(9)} SOL/MKIN`,
          );
        }

        // Update Pool Totals (FULL amount)
        const previousPoolTotal = poolData.total_staked || 0;
        poolData.total_staked = previousPoolTotal + amount;

        // Track total entry fees paid by user
        posData.total_entry_fees_sol =
          (posData.total_entry_fees_sol || 0) + feeData.feeInSol;
        posData.total_entry_fees_mkin_value =
          (posData.total_entry_fees_mkin_value || 0) + feeData.feeInMkin;

        console.log(`${logPrefix}   📊 Position Update Summary:`);
        console.log(
          `${logPrefix}     - Principal: ${previousPrincipal} → ${posData.principal_amount} MKIN (+${amount})`,
        );
        console.log(
          `${logPrefix}     - Total entry fees: ${posData.total_entry_fees_sol.toFixed(9)} SOL`,
        );
        console.log(`${logPrefix}   📊 Pool Update Summary:`);
        console.log(
          `${logPrefix}     - Total staked: ${previousPoolTotal} → ${poolData.total_staked} MKIN (+${amount})`,
        );

        // Writes - all three writes happen atomically
        console.log(`${logPrefix}   ✍️ Writing pool data...`);
        t.set(poolRef, poolData);

        console.log(`${logPrefix}   ✍️ Writing position data...`);
        const positionToWrite = {
          ...posData,
          updated_at: now,
        };
        console.log(
          `${logPrefix}   Position data to write:`,
          JSON.stringify({
            user_id: positionToWrite.user_id,
            principal_amount: positionToWrite.principal_amount,
            pending_rewards: positionToWrite.pending_rewards,
            total_entry_fees_sol: positionToWrite.total_entry_fees_sol,
          }),
        );
        t.set(posRef, positionToWrite);

        // Log transaction
        console.log(`${logPrefix}   ✍️ Writing transaction record...`);
        const txRef = this.db.collection(TRANSACTIONS_COLLECTION).doc();
        const txData = {
          user_id: firebaseUid,
          type: "STAKE",
          amount_mkin: amount,
          signature: txSignature,
          fee_tx: feeSignature,
          fee_amount_sol: feeData.feeInSol,
          fee_amount_mkin_value: feeData.feeInMkin,
          fee_percent: feeData.feePercent,
          mkin_price_usd: feeData.mkinPriceUsd,
          sol_price_usd: feeData.solPriceUsd,
          timestamp: now,
        };
        console.log(
          `${logPrefix}   Transaction record:`,
          JSON.stringify({
            type: txData.type,
            amount_mkin: txData.amount_mkin,
            fee_amount_sol: txData.fee_amount_sol,
          }),
        );
        t.set(txRef, txData);

        console.log(`${logPrefix}   ✅ All writes queued for atomic commit`);
      });

      console.log(
        `${logPrefix} ✅ Firestore transaction committed successfully!`,
      );
    } catch (transactionError) {
      console.error(`${logPrefix} ❌ FIRESTORE TRANSACTION FAILED!`);
      console.error(`${logPrefix}   - Error name: ${transactionError.name}`);
      console.error(
        `${logPrefix}   - Error message: ${transactionError.message}`,
      );
      console.error(`${logPrefix}   - Error stack: ${transactionError.stack}`);
      throw new StakingError(
        `Failed to update staking position: ${transactionError.message}`,
      );
    }

    console.log(`${logPrefix} 🎉 STAKE OPERATION COMPLETED SUCCESSFULLY`);
    console.log(`${logPrefix}   - User: ${firebaseUid}`);
    console.log(`${logPrefix}   - Amount: ${amount} MKIN`);
    console.log(`${"=".repeat(80)}\n`);

    // OPTIMIZATION: Removed automatic booster refresh after stake
    // This was causing 3 reads + 2 writes + Helius API call on every stake
    // Savings: ~60 reads/day + 40 writes/day eliminated

    // Boosters are still refreshed via:
    // 1. Periodic job (every 6 hours)
    // 2. Manual refresh: POST /api/boosters/refresh
    console.log(
      `${logPrefix} ℹ️ Boosters will be detected in next periodic refresh (every 6 hours)`,
    );

    const result = {
      success: true,
      amount,
      timestamp: new Date().toISOString(),
      txSignature,
      operationId, // Include operation ID for tracking
    };

    console.log(`${logPrefix} 📤 Returning result:`, JSON.stringify(result));
    return result;
  }

  /**
   * CLAIM
   * Claims pending rewards. Requires $2.90 USD fee ($2.00 + $0.90 site fee, dynamic).
   */
  async claim(firebaseUid, txSignature) {
    const operationId = `CLAIM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logPrefix = `[${operationId}]`;

    try {
      if (!txSignature) {
        console.error(`${logPrefix} ❌ Missing transaction signature`);
        throw new StakingError("Transaction signature required for fee");
      }

      console.log(
        `${logPrefix} 🚀 Starting claim operation for user ${firebaseUid}`,
      );

      // 1. Check if user has rewards to claim FIRST (before taking any fee!)
      console.log(
        `${logPrefix} 🔍 Step 1: Checking if user has rewards to claim...`,
      );
      const posRef = this.db.collection(POSITIONS_COLLECTION).doc(firebaseUid);
      const posDoc = await posRef.get();
      if (!posDoc.exists) {
        throw new StakingError(
          "No staking position found. Please stake tokens first.",
        );
      }

      const posData = posDoc.data();

      // Get user's booster multiplier for accurate calculation
      let boosterMultiplier = posData.booster_multiplier || 1.0;

      // Calculate pending rewards in REAL-TIME (matches frontend calculation)
      const pendingRewards = this._calculatePendingRewards(
        posData,
        boosterMultiplier,
      );

      if (pendingRewards <= 0) {
        console.error(`${logPrefix} ❌ User has no rewards to claim`);
        throw new StakingError(
          "You have no rewards to claim yet. Rewards accrue over time based on your staked amount.",
        );
      }

      console.log(
        `${logPrefix} ✅ User has ${pendingRewards.toFixed(6)} SOL to claim`,
      );

      // 2. Check for duplicate claim transaction
      console.log(
        `${logPrefix} 🔍 Step 2: Checking for duplicate claim transaction...`,
      );
      const existingTx = await this.db
        .collection(TRANSACTIONS_COLLECTION)
        .where("fee_tx", "==", txSignature)
        .where("type", "==", "CLAIM")
        .limit(1)
        .get();

      if (!existingTx.empty) {
        console.error(`❌ DUPLICATE CLAIM DETECTED!`);
        console.error(`   - Fee signature: ${txSignature}`);
        console.error(`   - Existing doc ID: ${existingTx.docs[0].id}`);
        console.error(`   - User: ${firebaseUid}`);
        throw new StakingError("Claim transaction already processed");
      }
      console.log(`${logPrefix} ✅ No duplicate claim found`);

      // 3. Calculate dynamic fee based on current SOL price
      // $2.90 total ($2.00 base + $0.90 site fee)
      console.log(`${logPrefix} 🔍 Step 3: Calculating claim fee...`);
      const { getFeeInSol } = await import("../utils/solPrice.js");
      const {
        solAmount: feeAmount,
        usdAmount,
        solPrice,
      } = await getFeeInSol(2.90); // $2.90 USD ($2.00 + $0.90 site fee)
      
      console.log(
        `${logPrefix} 💵 Claim fee: $${usdAmount} = ${feeAmount.toFixed(
          4,
        )} SOL (SOL price: $${solPrice})`,
      );

      // 4. Verify fee payment
      console.log(`${logPrefix} 🔍 Step 4: Verifying fee payment...`);
      const tolerance = 0.5; // 50% tolerance
      const minFee = feeAmount * (1 - tolerance);
      const maxFee = feeAmount * (1 + tolerance);

      const isValidFee = await this._verifySolTransfer(
        txSignature,
        minFee,
        maxFee,
      );

      if (!isValidFee) {
        throw new StakingError(
          `Invalid fee payment. Expected ~${feeAmount.toFixed(
            4,
          )} SOL ($${usdAmount})`,
        );
      }

      console.log(`${logPrefix} ✅ Fee payment verified`);
      
      // 5. Distribute site fee ($0.90) to treasury and personal wallets
      console.log(`${logPrefix} 💸 Step 5: Distributing site fee ($0.90)...`);
      const { distributeFees } = await import("../utils/feeDistribution.js");
      const distributionResult = await distributeFees('claim', 0.90, {
        treasuryDestination: "gatekeeper",
      }); // Distribute $0.90 site fee
      
      if (distributionResult.success) {
        console.log(`${logPrefix} ✅ Fee distributed successfully`);
        console.log(`${logPrefix}    Treasury: ${distributionResult.treasuryAmount.toFixed(6)} SOL`);
        console.log(`${logPrefix}    Personal: ${distributionResult.personalAmount.toFixed(6)} SOL`);
      } else {
        console.warn(`${logPrefix} ⚠️ Fee distribution failed: ${distributionResult.error}`);
      }

      // 6. Check treasury SOL balance BEFORE processing claim (using real-time calculated rewards)
      console.log(`${logPrefix} 🔍 Step 5: Checking treasury SOL balance...`);
      const treasuryKeypair = Keypair.fromSecretKey(
        bs58.decode(process.env.STAKING_PRIVATE_KEY),
      );
      const treasuryBalance = await this.connection.getBalance(
        treasuryKeypair.publicKey,
      );
      const treasuryBalanceSol = treasuryBalance / 1e9;

      console.log(
        `${logPrefix} 💰 Treasury balance: ${treasuryBalanceSol.toFixed(6)} SOL`,
      );
      console.log(
        `${logPrefix} 💰 Will send: ${pendingRewards.toFixed(6)} SOL (real-time calculated)`,
      );
      console.log(`${logPrefix} 💰 Gas fee estimate: ~0.000005 SOL`);

      const minRequiredSol = pendingRewards + 0.00001; // reward + gas buffer
      if (treasuryBalanceSol < minRequiredSol) {
        console.error(`❌ INSUFFICIENT TREASURY BALANCE!`);
        console.error(`   Treasury: ${treasuryBalanceSol.toFixed(6)} SOL`);
        console.error(`   Required: ${minRequiredSol.toFixed(6)} SOL`);
        console.error(
          `   Shortfall: ${(minRequiredSol - treasuryBalanceSol).toFixed(6)} SOL`,
        );
        throw new StakingError(
          `Service temporarily unavailable. Please try again later or contact support.`,
        );
      }
      console.log(
        `${logPrefix} ✅ Treasury has sufficient SOL (${treasuryBalanceSol.toFixed(6)} SOL)`,
      );

      // 6. Pre-fetch price data BEFORE the transaction (critical fix!)
      console.log(
        `${logPrefix} 📊 Step 6: Pre-fetching price data before Firestore transaction...`,
      );
      const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
      const tokenPriceSol = await getMkinPriceSOL();
      const now = admin.firestore.Timestamp.now();
      console.log(
        `✅ Price data fetched: ${tokenPriceSol.toFixed(6)} SOL/MKIN`,
      );

      let rewardAmount = 0;

      // 7. Update in Firestore (atomic transaction)
      console.log(`📝 Starting Firestore transaction...`);

      try {
        await this.db.runTransaction(async (t) => {
          const poolRef = this.db
            .collection(POOL_COLLECTION)
            .doc(STAKING_POOL_ID);
          const posRef = this.db
            .collection(POSITIONS_COLLECTION)
            .doc(firebaseUid);

          console.log(`   Reading pool and position documents...`);
          const [poolDoc, posDoc] = await Promise.all([
            t.get(poolRef),
            t.get(posRef),
          ]);
          if (!posDoc.exists)
            throw new StakingError("No staking position found");

          let poolData = poolDoc.data();
          let posData = posDoc.data();

          console.log(
            `   Current position: ${posData.principal_amount || 0} MKIN, pending: ${posData.pending_rewards || 0} SOL`,
          );

          // Update Pool using pre-fetched price (no async calls here!)
          poolData = this._calculateNewPoolStateSync(
            poolData,
            tokenPriceSol,
            now,
          );

          // 🚀 ADD FEE TO REWARD POOL (Self-Sustaining Pool)
          poolData.reward_pool_sol =
            (poolData.reward_pool_sol || 0) + feeAmount;
          console.log(
            `💰 Added ${feeAmount.toFixed(
              4,
            )} SOL fee to reward pool. New pool: ${poolData.reward_pool_sol.toFixed(
              4,
            )} SOL`,
          );

          // Use the real-time calculated pending rewards (already validated above)
          // We calculated this BEFORE the transaction to ensure it's valid
          rewardAmount = pendingRewards;

          console.log(
            `   Using real-time calculated reward: ${rewardAmount.toFixed(9)} SOL`,
          );
          console.log(
            `   (Database pending_rewards was: ${posData.pending_rewards || 0} SOL - outdated)`,
          );

          // Reset User pending rewards
          const previousPending = posData.pending_rewards || 0;
          posData.pending_rewards = 0;
          posData.total_claimed_sol =
            (posData.total_claimed_sol || 0) + rewardAmount;
          posData.total_accrued_sol =
            (posData.total_accrued_sol || 0) + rewardAmount;

          console.log(
            `   Claiming ${rewardAmount.toFixed(9)} SOL (was ${previousPending.toFixed(9)} pending)`,
          );

          // Writes - all writes happen atomically
          console.log(`   Writing pool data...`);
          t.set(poolRef, poolData);

          console.log(`   Writing position data...`);
          t.set(posRef, {
            ...posData,
            updated_at: now,
          });

          console.log(`   Writing transaction record...`);
          const txRef = this.db.collection(TRANSACTIONS_COLLECTION).doc();
          t.set(txRef, {
            user_id: firebaseUid,
            type: "CLAIM",
            amount_sol: rewardAmount,
            fee_tx: txSignature,
            fee_amount_sol: feeAmount,
            fee_amount_usd: usdAmount,
            timestamp: now,
          });

          console.log(`   ✅ All writes queued for atomic commit`);
        });

        console.log(`✅ Firestore transaction committed successfully!`);
      } catch (transactionError) {
        console.error(`❌ Firestore transaction failed:`, transactionError);
        throw new StakingError(
          `Failed to update claim position: ${transactionError.message}`,
        );
      }

      // 6. Send SOL to User (Using Treasury Private Key)
      // NOTE: This must be done AFTER the DB transaction commits to avoid sending funds if DB fails.
      // If this fails, we log to a failed_payouts collection for manual recovery.

      let payoutSignature = null;
      try {
        payoutSignature = await this._sendSolFromTreasury(
          firebaseUid,
          rewardAmount,
        );
        console.log(
          `✅ Claim payout successful! Signature: ${payoutSignature}`,
        );

        // Update the transaction record with payout signature
        const txSnapshot = await this.db
          .collection(TRANSACTIONS_COLLECTION)
          .where("user_id", "==", firebaseUid)
          .where("type", "==", "CLAIM")
          .where("fee_tx", "==", txSignature)
          .orderBy("timestamp", "desc")
          .limit(1)
          .get();

        if (!txSnapshot.empty) {
          await txSnapshot.docs[0].ref.update({
            payout_signature: payoutSignature,
            status: "COMPLETED",
          });
        }
      } catch (e) {
        console.error(
          `${logPrefix} ❌ CRITICAL: Payout failed but DB already updated!`,
        );
        console.error(`${logPrefix}    Error: ${e.message}`);
        console.error(`${logPrefix}    Stack: ${e.stack}`);

        // Log failed payout for manual recovery
        try {
          await this.db.collection("failed_payouts").add({
            user_id: firebaseUid,
            type: "CLAIM",
            amount_sol: rewardAmount,
            fee_tx: txSignature,
            fee_amount_sol: feeAmount,
            fee_amount_usd: usdAmount,
            error_message: e.message,
            error_stack: e.stack,
            timestamp: admin.firestore.Timestamp.now(),
            status: "PENDING_RECOVERY",
            recovery_attempts: 0,
          });
          console.log(
            `${logPrefix} 📝 Logged to failed_payouts collection for manual recovery`,
          );
        } catch (logError) {
          console.error(
            `${logPrefix} ❌ Failed to log to failed_payouts:`,
            logError,
          );
        }

        // Send Discord alert about failed payout
        try {
          const { sendDiscordAlert } =
            await import("../utils/discordAlerts.js");
          await sendDiscordAlert({
            type: "error",
            title: "🚨 CRITICAL: Claim Payout Failed",
            userId: firebaseUid,
            amount: `${rewardAmount.toFixed(6)} SOL`,
            feeTx: txSignature,
            error: e.message,
            message: `User paid fee but payout failed. REQUIRES MANUAL RECOVERY!\n\nRun: \`node scripts/tmp_rovodev_recover-failed-claim.js ${firebaseUid} --execute\``,
          });
        } catch (alertError) {
          console.error(
            `${logPrefix} ⚠️  Failed to send Discord alert:`,
            alertError.message,
          );
        }

        throw new StakingError(
          "Payout failed. Please contact support. Your claim will be manually processed.",
        );
      }

      console.log(
        `${logPrefix} 🎉 Claim operation completed successfully for user ${firebaseUid}`,
      );

      return {
        success: true,
        amount: rewardAmount,
        payoutSignature,
        feeSignature: txSignature,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error(`${logPrefix} ❌ CLAIM OPERATION FAILED!`);
      console.error(`${logPrefix}   - User: ${firebaseUid}`);
      console.error(`${logPrefix}   - Error type: ${error.name}`);
      console.error(`${logPrefix}   - Error message: ${error.message}`);
      console.error(`${logPrefix}   - Stack trace:`, error.stack);

      // Re-throw the error so it gets sent to the client
      throw error;
    }
  }

  /**
   * UNSTAKE
   * Debits Position Principal, Sends tokens from vault back to user.
   * Requires $2.90 USD fee ($2.00 + $0.90 site fee, dynamic).
   */
  async unstake(firebaseUid, amount, txSignature) {
    const operationId = `UNSTAKE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const logPrefix = `[${operationId}]`;

    // Ensure network is initialized before proceeding
    await this._ensureInitialized();

    if (amount <= 0) throw new StakingError("Invalid amount");
    if (!txSignature)
      throw new StakingError("Transaction signature required for fee");

    console.log(
      `${logPrefix} 🚀 Starting unstake operation for user ${firebaseUid}: ${amount} MKIN`,
    );

    // 1. Check for duplicate unstake transaction FIRST (before any processing)
    console.log(`🔍 Step 1: Checking for duplicate unstake transaction...`);
    const existingTx = await this.db
      .collection(TRANSACTIONS_COLLECTION)
      .where("fee_tx", "==", txSignature)
      .where("type", "==", "UNSTAKE")
      .limit(1)
      .get();

    if (!existingTx.empty) {
      console.error(`❌ DUPLICATE UNSTAKE DETECTED!`);
      console.error(`   - Fee transaction signature: ${txSignature}`);
      console.error(`   - Existing doc ID: ${existingTx.docs[0].id}`);
      console.error(`   - User: ${firebaseUid}`);
      throw new StakingError("Unstake transaction already processed");
    }
    console.log(`✅ No duplicate unstake found`);

    // 2. Get user's wallet address
    const userRewardDoc = await this.db
      .collection(USER_REWARDS_COLLECTION)
      .doc(firebaseUid)
      .get();
    if (!userRewardDoc.exists) throw new StakingError("User not found");

    let userWallet = userRewardDoc.data().walletAddress;

    // Fallback: if walletAddress not in userRewards, check users collection
    if (!userWallet) {
      console.log(
        `⚠️  walletAddress not in userRewards, checking users collection...`,
      );
      const userDoc = await this.db.collection("users").doc(firebaseUid).get();
      if (userDoc.exists) {
        userWallet = userDoc.data().walletAddress;
        if (userWallet) {
          console.log(
            `✅ Found walletAddress in users collection: ${userWallet}`,
          );
        }
      }
    }

    if (!userWallet) {
      throw new StakingError(
        "User wallet address not found in userRewards or users collection",
      );
    }

    // 1. Calculate dynamic fee based on current SOL price
    // $2.90 total ($2.00 base + $0.90 site fee)
    const { getFeeInSol } = await import("../utils/solPrice.js");
    const {
      solAmount: feeAmount,
      usdAmount,
      solPrice,
    } = await getFeeInSol(2.90); // $2.90 USD ($2.00 + $0.90 site fee)

    console.log(
      `💵 Unstake fee: $${usdAmount} = ${feeAmount.toFixed(
        4,
      )} SOL (SOL price: $${solPrice})`,
    );

    // 2. Verify SOL Fee payment (with 50% tolerance for price volatility - matches claim)
    const tolerance = 0.5; // 50% tolerance (LAX)
    const minFee = feeAmount * (1 - tolerance);
    const maxFee = feeAmount * (1 + tolerance);
    console.log(
      `   Expected fee: ~${feeAmount.toFixed(4)} SOL ($${usdAmount})`,
    );
    console.log(
      `   Acceptable range: ${minFee.toFixed(4)} - ${maxFee.toFixed(4)} SOL (±20%)`,
    );

    console.log(`🔍 Step 2: Verifying SOL fee transaction...`);
    console.log(`   Transaction signature: ${txSignature}`);
    console.log(`   Min acceptable: ${minFee.toFixed(9)} SOL`);
    console.log(`   Max acceptable: ${maxFee.toFixed(9)} SOL`);

    let isValidFee = false;
    try {
      isValidFee = await this._verifySolTransfer(txSignature, minFee, maxFee);
    } catch (verifyError) {
      console.error(`❌ ERROR during fee verification:`);
      console.error(`   Error type: ${verifyError.name}`);
      console.error(`   Error message: ${verifyError.message}`);
      console.error(`   Error stack: ${verifyError.stack}`);
      throw new StakingError(
        "Unable to verify your fee payment. Please wait a moment and try again. If the issue persists, contact support.",
      );
    }

    if (!isValidFee) {
      console.error(
        `❌ Fee verification returned false for transaction: ${txSignature}`,
      );
      throw new StakingError(
        "Unable to verify your fee payment. Please wait a moment and try again. If the issue persists, contact support.",
      );
    }
    console.log(`✅ Fee transaction verified`);
    
    // 3. Distribute site fee ($0.90) to treasury and personal wallets
    console.log(`💸 Step 3: Distributing site fee ($0.90)...`);
    const { distributeFees } = await import("../utils/feeDistribution.js");
    const distributionResult = await distributeFees('unstake', 0.90, {
      treasuryDestination: "gatekeeper",
    });
    
    if (distributionResult.success) {
      console.log(`✅ Fee distributed successfully`);
      console.log(`   Treasury: ${distributionResult.treasuryAmount.toFixed(6)} SOL`);
      console.log(`   Personal: ${distributionResult.personalAmount.toFixed(6)} SOL`);
    } else {
      console.warn(`⚠️ Fee distribution failed: ${distributionResult.error}`);
    }

    // 4. Check vault MKIN balance BEFORE accepting fee
    console.log(`🔍 Step 4: Checking vault MKIN balance...`);
    const vaultAddress = new PublicKey(process.env.STAKING_WALLET_ADDRESS);
    const vaultATA = await getAssociatedTokenAddress(
      this.tokenMint,
      vaultAddress,
    );

    try {
      const vaultAccount = await getAccount(this.connection, vaultATA);
      const vaultBalance = Number(vaultAccount.amount) / 1e9;

      console.log(
        `💰 Vault MKIN balance: ${vaultBalance.toLocaleString()} MKIN`,
      );
      console.log(`💰 Need to send: ${amount.toLocaleString()} MKIN`);

      if (vaultBalance < amount) {
        console.error(`❌ INSUFFICIENT VAULT MKIN BALANCE!`);
        console.error(`   Vault: ${vaultBalance.toLocaleString()} MKIN`);
        console.error(`   Required: ${amount.toLocaleString()} MKIN`);
        console.error(
          `   Shortfall: ${(amount - vaultBalance).toLocaleString()} MKIN`,
        );
        throw new StakingError(
          `Service temporarily unavailable. Please try again later or contact support.`,
        );
      }
      console.log(`✅ Vault has sufficient MKIN`);
    } catch (error) {
      if (error instanceof StakingError) throw error;
      console.error(`❌ Failed to check vault balance: ${error.message}`);
      throw new StakingError(
        `Service temporarily unavailable. Please try again later or contact support.`,
      );
    }

    // 4. Check vault SOL balance for transaction fees
    console.log(`🔍 Step 4: Checking vault SOL balance...`);
    const vaultSolBalance = await this.connection.getBalance(vaultAddress);
    const vaultSolBalanceSol = vaultSolBalance / 1e9;
    console.log(`💰 Vault SOL balance: ${vaultSolBalanceSol.toFixed(6)} SOL`);

    // Import Discord alerts
    const { sendVaultCriticalAlert, sendVaultWarningAlert } =
      await import("../utils/discordAlerts.js");

    // Critical threshold check
    const CRITICAL_THRESHOLD = 0.01; // 0.01 SOL
    const WARNING_THRESHOLD = 0.05; // 0.05 SOL
    const GAS_PER_TX = 0.000005; // ~5000 lamports per transaction
    const MIN_REQUIRED = GAS_PER_TX + 0.001; // Gas + small buffer

    if (vaultSolBalanceSol < CRITICAL_THRESHOLD) {
      console.error(`❌ INSUFFICIENT VAULT SOL FOR GAS!`);
      console.error(`   Vault SOL: ${vaultSolBalanceSol.toFixed(6)} SOL`);
      console.error(`   Required: ${MIN_REQUIRED.toFixed(6)} SOL minimum`);
      console.error(`   🚨 CRITICAL: Sending admin alert...`);

      // Send critical Discord alert (non-blocking)
      sendVaultCriticalAlert(vaultSolBalanceSol).catch((err) => {
        console.error("Failed to send Discord alert:", err.message);
      });

      throw new StakingError(
        `Service temporarily unavailable due to system maintenance. Please try again in a few minutes or contact support.`,
      );
    } else if (vaultSolBalanceSol < WARNING_THRESHOLD) {
      console.warn(
        `⚠️  WARNING: Vault SOL getting low: ${vaultSolBalanceSol.toFixed(6)} SOL`,
      );
      console.warn(`   Sending warning alert to admins...`);

      // Send warning Discord alert (non-blocking)
      sendVaultWarningAlert(vaultSolBalanceSol).catch((err) => {
        console.error("Failed to send Discord alert:", err.message);
      });
    }

    console.log(`✅ Vault has sufficient SOL for gas fees`);

    // 5. Pre-fetch price data BEFORE the transaction (critical fix!)
    console.log(
      `📊 Step 5: Pre-fetching price data before Firestore transaction...`,
    );
    const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
    const tokenPriceSol = await getMkinPriceSOL();
    const now = admin.firestore.Timestamp.now();
    console.log(`✅ Price data fetched: ${tokenPriceSol.toFixed(6)} SOL/MKIN`);

    // 6. Update in Firestore (atomic transaction)
    console.log(`📝 Step 6: Starting Firestore transaction...`);

    try {
      await this.db.runTransaction(async (t) => {
        const poolRef = this.db
          .collection(POOL_COLLECTION)
          .doc(STAKING_POOL_ID);
        const posRef = this.db
          .collection(POSITIONS_COLLECTION)
          .doc(firebaseUid);

        console.log(`   Reading pool and position documents...`);
        const [poolDoc, posDoc] = await Promise.all([
          t.get(poolRef),
          t.get(posRef),
        ]);

        if (!posDoc.exists) throw new StakingError("No staking position found");
        let posData = posDoc.data();

        console.log(
          `   Current position: ${posData.principal_amount || 0} MKIN`,
        );

        if (posData.principal_amount < amount) {
          throw new StakingError("Insufficient staked amount");
        }

        let poolData = poolDoc.exists
          ? poolDoc.data()
          : {
              total_staked: 0,
              reward_pool_sol: 0,
              acc_reward_per_share: 0,
              last_reward_time: now,
            };

        // 1. Update Pool using pre-fetched price (no async calls here!)
        poolData = this._calculateNewPoolStateSync(
          poolData,
          tokenPriceSol,
          now,
        );

        // 🚀 ADD FEE TO REWARD POOL (Self-Sustaining Pool)
        poolData.reward_pool_sol = (poolData.reward_pool_sol || 0) + feeAmount;
        console.log(
          `💰 Added ${feeAmount.toFixed(
            4,
          )} SOL fee to reward pool. New pool: ${poolData.reward_pool_sol.toFixed(
            4,
          )} SOL`,
        );

        // 2. Harvest Pending Rewards (checkpoint them, don't pay out)
        // The pending rewards will remain and can be claimed later
        // No need to update reward_debt since we're not using MasterChef logic

        // 3. Update Principal
        const previousPrincipal = posData.principal_amount;
        posData.principal_amount -= amount;

        // 3.5. Proportionally reduce entry fees when unstaking (for accurate future reward calculations)
        if (posData.total_entry_fees_sol && previousPrincipal > 0) {
          const unstakeRatio = amount / previousPrincipal;
          const oldEntryFees = posData.total_entry_fees_sol || 0;
          const feesToDeduct = oldEntryFees * unstakeRatio;
          posData.total_entry_fees_sol = Math.max(
            0,
            oldEntryFees - feesToDeduct,
          );
          console.log(
            `   Proportionally reduced entry fees: ${oldEntryFees.toFixed(6)} → ${posData.total_entry_fees_sol.toFixed(6)} SOL (${(unstakeRatio * 100).toFixed(2)}% unstaked)`,
          );
        }

        // 4. Update Pool Total
        poolData.total_staked = (poolData.total_staked || 0) - amount;
        if (poolData.total_staked < 0) poolData.total_staked = 0;

        console.log(
          `   New position: ${posData.principal_amount} MKIN (was ${previousPrincipal})`,
        );
        console.log(`   New pool total: ${poolData.total_staked} MKIN`);

        // Writes - all writes happen atomically
        console.log(`   Writing pool data...`);
        t.set(poolRef, poolData);

        console.log(`   Writing position data...`);
        t.set(posRef, {
          ...posData,
          updated_at: now,
        });

        console.log(`   Writing transaction record...`);
        const txRef = this.db.collection(TRANSACTIONS_COLLECTION).doc();
        t.set(txRef, {
          user_id: firebaseUid,
          type: "UNSTAKE",
          amount_mkin: amount,
          fee_tx: txSignature,
          fee_amount_sol: feeAmount,
          fee_amount_usd: usdAmount,
          timestamp: now,
        });

        console.log(`   ✅ All writes queued for atomic commit`);
      });

      console.log(`✅ Firestore transaction committed successfully!`);
    } catch (transactionError) {
      console.error(`❌ Firestore transaction failed:`, transactionError);
      throw new StakingError(
        `Failed to update unstake position: ${transactionError.message}`,
      );
    }

    // 5. Send tokens from vault to user
    let tokenSignature = null;
    try {
      tokenSignature = await this._sendTokensFromVault(userWallet, amount);
      console.log(
        `✅ Unstake token transfer successful! Signature: ${tokenSignature}`,
      );

      // Update the transaction record with token signature
      const txSnapshot = await this.db
        .collection(TRANSACTIONS_COLLECTION)
        .where("user_id", "==", firebaseUid)
        .where("type", "==", "UNSTAKE")
        .where("fee_tx", "==", txSignature)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();

      if (!txSnapshot.empty) {
        await txSnapshot.docs[0].ref.update({
          token_tx: tokenSignature,
          status: "COMPLETED",
        });
      }
    } catch (e) {
      console.error(
        `${logPrefix} ❌ CRITICAL: Token transfer failed but DB already updated!`,
      );
      console.error(`${logPrefix}    Error: ${e.message}`);
      console.error(`${logPrefix}    Stack: ${e.stack}`);

      // Log failed payout for manual recovery
      try {
        await this.db.collection("failed_payouts").add({
          user_id: firebaseUid,
          type: "UNSTAKE",
          amount_mkin: amount,
          fee_tx: txSignature,
          fee_amount_sol: feeAmount,
          fee_amount_usd: usdAmount,
          user_wallet: userWallet,
          error_message: e.message,
          error_stack: e.stack,
          timestamp: admin.firestore.Timestamp.now(),
          status: "PENDING_RECOVERY",
          recovery_attempts: 0,
        });
        console.log(
          `${logPrefix} 📝 Logged to failed_payouts collection for manual recovery`,
        );
      } catch (logError) {
        console.error(
          `${logPrefix} ❌ Failed to log to failed_payouts:`,
          logError,
        );
      }

      // Send Discord alert about failed payout
      try {
        const { sendDiscordAlert } = await import("../utils/discordAlerts.js");
        await sendDiscordAlert({
          type: "error",
          title: "🚨 CRITICAL: Unstake Token Transfer Failed",
          userId: firebaseUid,
          amount: `${amount.toLocaleString()} MKIN`,
          feeTx: txSignature,
          error: e.message,
          message: `User paid fee but token transfer failed. REQUIRES MANUAL RECOVERY!\n\nRun: \`node scripts/recover-failed-unstake.js ${firebaseUid} --execute\``,
        });
      } catch (alertError) {
        console.error(
          `${logPrefix} ⚠️  Failed to send Discord alert:`,
          alertError.message,
        );
      }

      throw new StakingError(
        "Token transfer failed. Please contact support. Your unstake will be manually processed.",
      );
    }

    console.log(
      `🎉 Unstake operation completed successfully for user ${firebaseUid}`,
    );

    return {
      success: true,
      tokenSignature,
      feeSignature: txSignature,
      amount,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Helper: Verify SPL Token Transfer to Vault
   * Checks that user sent MKIN tokens to the vault
   *
   * IMPORTANT: This method handles floating-point precision issues that can occur
   * when converting between display units (MKIN) and raw units (9 decimals).
   * We use a small tolerance (0.01%) to account for rounding differences between
   * frontend BigInt(Math.floor(amount * 1e9)) and backend Number calculations.
   */
  async _verifyTokenTransfer(signature, expectedAmount, userWallet) {
    try {
      console.log(`🔍 Verifying token transfer:`);
      console.log(`   Signature: ${signature}`);
      console.log(`   Expected Amount: ${expectedAmount} MKIN`);

      // Use BigInt for precise raw amount calculation to avoid floating-point issues
      // Frontend uses: BigInt(Math.floor(amount * 1e9))
      // We need to match that behavior
      const expectedRawAmountFloat = expectedAmount * 1e9;
      const expectedRawAmountFloor = Math.floor(expectedRawAmountFloat);

      // Allow 0.01% tolerance for floating-point precision differences
      // This handles cases like 464622.733129623 * 1e9 where JS floating point
      // might produce slightly different results between frontend and backend
      const tolerance = 0.0001; // 0.01%
      const minAcceptableAmount = Math.floor(
        expectedRawAmountFloor * (1 - tolerance),
      );

      console.log(`   Expected Raw Amount (float): ${expectedRawAmountFloat}`);
      console.log(`   Expected Raw Amount (floor): ${expectedRawAmountFloor}`);
      console.log(
        `   Min Acceptable Amount (with ${tolerance * 100}% tolerance): ${minAcceptableAmount}`,
      );
      console.log(`   User Wallet: ${userWallet}`);

      const tx = await this.connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        console.error(
          "❌ Transaction not found - signature may be invalid or not yet confirmed",
        );
        console.error(`   Signature: ${signature}`);
        return false;
      }

      if (!tx.meta) {
        console.error(
          "❌ Transaction has no metadata - may still be processing",
        );
        console.error(`   Signature: ${signature}`);
        console.error(`   Slot: ${tx.slot}`);
        return false;
      }

      if (tx.meta.err) {
        console.error("❌ Transaction failed on-chain:");
        console.error(`   Error: ${JSON.stringify(tx.meta.err)}`);
        console.error(`   Signature: ${signature}`);
        return false;
      }

      console.log(`✅ Transaction found and succeeded on-chain`);
      console.log(`   Slot: ${tx.slot}`);
      console.log(
        `   Block Time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "N/A"}`,
      );

      // Use network configuration for token mint
      const tokenMint = this.tokenMint;
      const vaultAddress = new PublicKey(process.env.STAKING_WALLET_ADDRESS);

      console.log(`📋 Token Mint: ${tokenMint.toBase58()}`);
      console.log(`🏦 Vault Address: ${vaultAddress.toBase58()}`);

      // Get expected ATAs
      const userATA = await getAssociatedTokenAddress(
        tokenMint,
        new PublicKey(userWallet),
      );
      const vaultATA = await getAssociatedTokenAddress(tokenMint, vaultAddress);

      console.log(`👤 User ATA: ${userATA.toBase58()}`);
      console.log(`🏦 Vault ATA: ${vaultATA.toBase58()}`);

      // Parse instructions to find token transfer
      const instructions = tx.transaction.message.instructions;
      console.log(
        `📝 Found ${instructions.length} instructions in transaction`,
      );

      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        console.log(
          `  Instruction ${i}: program=${ix.program}, type=${ix.parsed?.type}`,
        );

        // Check for SPL Token transfer instruction
        if (ix.program === "spl-token" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info;
          const actualRawAmount = BigInt(info.amount);
          const actualDisplayAmount = Number(actualRawAmount) / 1e9;

          console.log(`    Transfer details:`);
          console.log(`      Source: ${info.source}`);
          console.log(`      Destination: ${info.destination}`);
          console.log(`      Amount (raw): ${info.amount}`);
          console.log(`      Amount (display): ${actualDisplayAmount} MKIN`);
          console.log(`      Authority: ${info.authority}`);

          // Verify: destination = vaultATA, amount >= expected (with tolerance)
          // NOTE: We don't verify source ATA because users can have multiple token accounts
          // Instead, we verify the authority (signer) matches the user's wallet
          const authorityMatches = info.authority === userWallet;
          const destMatches = info.destination === vaultATA.toBase58();

          // Use BigInt comparison for precision, but allow for small tolerance
          const amountMatches = Number(actualRawAmount) >= minAcceptableAmount;

          // Calculate difference for logging
          const amountDifference =
            Number(actualRawAmount) - expectedRawAmountFloor;
          const percentDifference =
            (amountDifference / expectedRawAmountFloor) * 100;

          console.log(`    Verification:`);
          console.log(
            `      Source ATA: ${info.source} (not validated - users can have multiple token accounts)`,
          );
          console.log(
            `      Authority matches: ${authorityMatches} (expected: ${userWallet})`,
          );
          console.log(
            `      Dest matches: ${destMatches} (expected: ${vaultATA.toBase58()})`,
          );
          console.log(`      Amount matches: ${amountMatches}`);
          console.log(
            `        Actual: ${info.amount} raw (${actualDisplayAmount} MKIN)`,
          );
          console.log(
            `        Expected: ${expectedRawAmountFloor} raw (${expectedAmount} MKIN)`,
          );
          console.log(`        Min Acceptable: ${minAcceptableAmount} raw`);
          console.log(
            `        Difference: ${amountDifference} raw (${percentDifference.toFixed(6)}%)`,
          );

          if (authorityMatches && destMatches && amountMatches) {
            console.log(
              `✅ Valid token transfer verified: ${info.amount} raw tokens (${actualDisplayAmount} MKIN) from ${userWallet}`,
            );
            return true;
          } else {
            // Log specific failure reasons
            if (!authorityMatches) {
              console.error(
                `❌ Authority mismatch: got ${info.authority}, expected ${userWallet}`,
              );
            }
            if (!destMatches) {
              console.error(
                `❌ Destination ATA mismatch: got ${info.destination}, expected ${vaultATA.toBase58()}`,
              );
            }
            if (!amountMatches) {
              console.error(
                `❌ Amount too low: got ${info.amount}, need at least ${minAcceptableAmount}`,
              );
              console.error(`   This could indicate:`);
              console.error(`   - User sent less than requested amount`);
              console.error(
                `   - Floating-point precision issue (difference: ${percentDifference.toFixed(6)}%)`,
              );
            }
          }
        }
      }

      console.error("❌ No valid token transfer found in transaction");
      console.error(`   Expected source ATA: ${userATA.toBase58()}`);
      console.error(`   Expected destination ATA: ${vaultATA.toBase58()}`);
      console.error(
        `   Expected amount: ${expectedAmount} MKIN (${expectedRawAmountFloor} raw)`,
      );
      console.error(`   Min acceptable: ${minAcceptableAmount} raw`);
      console.error(`   Total instructions checked: ${instructions.length}`);

      // Log all token-related instructions for debugging
      const tokenInstructions = instructions.filter(
        (ix) => ix.program === "spl-token",
      );
      if (tokenInstructions.length > 0) {
        console.error(`   Token instructions found but didn't match:`);
        tokenInstructions.forEach((ix, idx) => {
          console.error(
            `     [${idx}] Type: ${ix.parsed?.type}, Info: ${JSON.stringify(ix.parsed?.info)}`,
          );
        });
      } else {
        console.error(`   No spl-token instructions found in transaction`);
      }

      return false;
    } catch (e) {
      console.error("❌ Token transfer verification error:");
      console.error(`   Error message: ${e.message}`);
      console.error(`   Error stack: ${e.stack}`);
      console.error(`   Signature: ${signature}`);
      console.error(`   Expected amount: ${expectedAmount} MKIN`);
      console.error(`   User wallet: ${userWallet}`);
      return false;
    }
  }

  /**
   * Helper: Send Tokens from Vault to User
   * Used during unstaking to return tokens
   */
  async _sendTokensFromVault(userWallet, amount) {
    try {
      const vaultPrivateKey = process.env.STAKING_PRIVATE_KEY;
      if (!vaultPrivateKey) throw new Error("STAKING_PRIVATE_KEY not set");

      // Use network configuration for token mint
      const tokenMint = this.tokenMint;

      // Decode vault keypair
      const vaultKeypair = Keypair.fromSecretKey(bs58.decode(vaultPrivateKey));
      const userPubkey = new PublicKey(userWallet);

      // Get ATAs
      const vaultATA = await getAssociatedTokenAddress(
        tokenMint,
        vaultKeypair.publicKey,
      );
      const userATA = await getAssociatedTokenAddress(tokenMint, userPubkey);

      // Check if user's ATA exists, create if needed
      let needsCreateATA = false;
      try {
        await getAccount(this.connection, userATA);
        console.log(`   ✅ User ATA exists: ${userATA.toBase58()}`);
      } catch (e) {
        if (e.name === "TokenAccountNotFoundError") {
          console.log(
            `   ⚠️ User ATA does not exist, will create: ${userATA.toBase58()}`,
          );
          needsCreateATA = true;
        } else {
          throw e;
        }
      }

      // Build transaction
      const transaction = new Transaction();

      // Add create ATA instruction if needed (vault pays for rent)
      if (needsCreateATA) {
        const createATAIx = createAssociatedTokenAccountInstruction(
          vaultKeypair.publicKey, // payer
          userATA, // ata address
          userPubkey, // owner
          tokenMint, // mint
        );
        transaction.add(createATAIx);
        console.log(`   📝 Added instruction to create user ATA`);
      }

      // Create transfer instruction
      const transferIx = createTransferInstruction(
        vaultATA,
        userATA,
        vaultKeypair.publicKey,
        amount * 1e9, // Convert to raw amount (9 decimals)
      );
      transaction.add(transferIx);

      // Set blockhash and fee payer
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = vaultKeypair.publicKey;

      // Sign transaction
      transaction.sign(vaultKeypair);
      const rawTransaction = transaction.serialize();

      // Robust Send with Persistent Retry Loop
      // Mirrors logic from mkinTransfer.js to handle network drops
      let signature;
      try {
        signature = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          maxRetries: 3,
        });
        console.log(`   🚀 Sent tokens, initial signature: ${signature}`);
      } catch (sendError) {
        console.error(`   ❌ Failed initial send: ${sendError.message}`);
        throw sendError;
      }

      console.log(`   ⏳ Waiting for confirmation (persistent retry mode)...`);
      const startTime = Date.now();
      const timeout = 90000; // 90 seconds timeout
      let confirmed = false;

      while (Date.now() - startTime < timeout) {
        const status = await this.connection.getSignatureStatus(signature);

        if (status && status.value) {
          if (
            status.value.confirmationStatus === "confirmed" ||
            status.value.confirmationStatus === "finalized"
          ) {
            if (status.value.err) {
              throw new Error(
                "Transaction failed on-chain: " +
                  JSON.stringify(status.value.err),
              );
            }
            console.log(
              `   ✅ Success! Confirmed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
            );
            confirmed = true;
            break;
          }
        }

        // Re-send raw transaction every 2s to ensure propagation
        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          await this.connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 0,
          });
        } catch (e) {
          // Ignore "already processed" errors
        }
      }

      if (!confirmed) {
        throw new Error(
          "Transaction confirmation timed out. It may still land later.",
        );
      }

      console.log(
        `✅ Sent ${amount} MKIN to ${userWallet}${needsCreateATA ? " (created ATA)" : ""}, signature: ${signature}`,
      );
      return signature;
    } catch (e) {
      console.error("Failed to send tokens from vault:", e);
      throw new Error(`Token transfer failed: ${e.message}`);
    }
  }

  /**
   * Helper: Verify SOL transfer (for fee payments)
   * Now accepts min/max range for tolerance
   */
  async _verifySolTransfer(
    signature,
    minAmountSol,
    maxAmountSol,
    retryCount = 0,
  ) {
    const maxRetries = 3;
    console.log(
      `🔍 [Fee Verification] Starting verification for transaction: ${signature}`,
    );
    console.log(
      `   Expected amount range: ${minAmountSol.toFixed(4)} - ${maxAmountSol.toFixed(4)} SOL`,
    );

    try {
      console.log(
        `   Fetching transaction from RPC (attempt ${retryCount + 1}/${maxRetries + 1})...`,
      );

      // Try multiple commitment levels for better reliability
      let tx = await this.connection.getParsedTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      // If not found with "confirmed", try "finalized"
      if (!tx && retryCount === 0) {
        console.log(`   Not found with "confirmed", trying "finalized"...`);
        tx = await this.connection.getParsedTransaction(signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
      }

      if (!tx) {
        // If transaction not found and we have retries left, wait and retry
        if (retryCount < maxRetries) {
          const delay = 2000 * (retryCount + 1); // 2s, 4s, 6s
          console.log(
            `   Transaction not found yet, waiting ${delay}ms before retry...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this._verifySolTransfer(
            signature,
            minAmountSol,
            maxAmountSol,
            retryCount + 1,
          );
        }

        console.error(
          `❌ Transaction not found after ${maxRetries + 1} attempts: ${signature}`,
        );
        console.error(`   Possible reasons:`);
        console.error(`   1. Wrong transaction signature provided`);
        console.error(`   2. Transaction is too old (pruned from RPC)`);
        console.error(`   3. RPC node issues (try again in a moment)`);
        return false;
      }

      if (!tx.meta) {
        console.error(`❌ Transaction found but has no metadata: ${signature}`);
        console.error(`   This usually means the transaction failed on-chain`);
        console.error(
          `   Check transaction on Solscan: https://solscan.io/tx/${signature}`,
        );
        return false;
      }

      console.log(`✅ Transaction found and confirmed (slot: ${tx.slot})`);

      const stakingAddr = process.env.STAKING_WALLET_ADDRESS;
      if (!stakingAddr)
        throw new Error("STAKING_WALLET_ADDRESS not configured");

      // Look for SystemProgram.transfer to stakingAddr
      const instructions = tx.transaction.message.instructions;
      console.log(`📋 Transaction has ${instructions.length} instructions`);

      for (let i = 0; i < instructions.length; i++) {
        const ix = instructions[i];
        console.log(
          `  Instruction ${i}: program=${ix.program}, type=${ix.parsed?.type}`,
        );

        if (ix.program === "system" && ix.parsed?.type === "transfer") {
          const info = ix.parsed.info;
          const lamports = info.lamports;
          const solAmount = lamports / 1e9;

          console.log(`    Transfer found:`);
          console.log(`      From: ${info.source}`);
          console.log(`      To: ${info.destination}`);
          console.log(
            `      Amount: ${solAmount.toFixed(9)} SOL (${lamports} lamports)`,
          );
          console.log(
            `      Expected range: ${minAmountSol.toFixed(
              9,
            )} - ${maxAmountSol.toFixed(9)} SOL`,
          );

          if (info.destination === stakingAddr) {
            // Use maxAmountSol if no minAmountSol provided (backward compatibility)
            // CRITICAL FIX: Use explicit undefined check to handle 0 as a valid value
            const min =
              minAmountSol !== undefined ? minAmountSol : maxAmountSol;
            const max =
              maxAmountSol !== undefined ? maxAmountSol : minAmountSol;

            if (solAmount >= min && solAmount <= max) {
              console.log(`✅ Fee payment verified!`);
              return true;
            } else {
              console.error(
                `❌ Amount out of range: ${solAmount} not in [${min}, ${max}]`,
              );
            }
          } else {
            console.log(`    ❌ Wrong destination (expected: ${stakingAddr})`);
          }
        }
      }

      console.error("❌ No valid fee transfer found in transaction");
      return false;
    } catch (e) {
      console.error("Fee verification error:", e);
      return false;
    }
  }

  /**
   * Calculate pending rewards for a user in real-time
   * Uses locked token price to ensure stable rewards that don't fluctuate
   * @param {Object} positionData - User's staking position from Firebase
   * @param {number} boosterMultiplier - Combined booster multiplier (default 1.0)
   * @returns {number} - Pending rewards in SOL
   */
  _calculatePendingRewards(positionData, boosterMultiplier = 1.0) {
    const principalAmountMKIN = positionData.principal_amount || 0;

    if (principalAmountMKIN <= 0) {
      return 0;
    }

    // Get stake start time (in seconds)
    const stakeStartTime =
      positionData.stake_start_time?._seconds ||
      positionData.stake_start_time?.seconds ||
      Math.floor(Date.now() / 1000);

    // Calculate time staked (in seconds)
    const currentTime = Math.floor(Date.now() / 1000);
    const secondsStaked = currentTime - stakeStartTime;

    if (secondsStaked <= 0) {
      return 0;
    }

    // Get the locked token price - this is the key to stable rewards
    // Priority: 1) locked_token_price_sol (from backfill), 2) calculate from entry fee, 3) fallback to 0
    let tokenPriceSol = positionData.locked_token_price_sol || 0;
    let priceSource = "locked_token_price_sol";

    // If no locked price, try to calculate from entry fee
    if (tokenPriceSol <= 0) {
      const entryFeeSOL = positionData.total_entry_fees_sol || 0;
      const ENTRY_FEE_RATE = 0.05; // 5% entry fee

      if (entryFeeSOL > 0) {
        const stakeValueSOL = entryFeeSOL / ENTRY_FEE_RATE;
        tokenPriceSol = stakeValueSOL / principalAmountMKIN;
        priceSource = "entry_fee_calculation";
      }
    }

    // If still no price, we can't calculate rewards
    if (tokenPriceSol <= 0) {
      console.log(
        `⚠️  No locked token price or entry fee data found - cannot calculate rewards`,
      );
      return 0;
    }

    // Annual return rate (10% APY)
    const ANNUAL_RATE = 0.1;
    const SECONDS_PER_YEAR = 365 * 24 * 60 * 60; // 31,536,000 (match frontend exactly)

    // Calculate base rewards (matches frontend formula exactly):
    // baseRewards = (stakedAmount * 0.1 * tokenPriceSol * durationSeconds) / SECONDS_IN_YEAR
    const baseRewards =
      (principalAmountMKIN * ANNUAL_RATE * tokenPriceSol * secondsStaked) /
      SECONDS_PER_YEAR;

    // Apply booster multiplier
    const totalRewards = baseRewards * boosterMultiplier;

    // Subtract already claimed rewards
    const totalClaimedSol = positionData.total_claimed_sol || 0;
    const pendingRewards = Math.max(0, totalRewards - totalClaimedSol);

    console.log(`📊 Reward Calculation (using locked price for stability):`);
    console.log(`   Principal: ${principalAmountMKIN.toLocaleString()} MKIN`);
    console.log(
      `   Token price (${priceSource}): ${tokenPriceSol.toFixed(10)} SOL/MKIN`,
    );
    console.log(
      `   Seconds staked: ${secondsStaked.toLocaleString()} (${(secondsStaked / 86400).toFixed(2)} days)`,
    );
    console.log(`   Annual rate: ${ANNUAL_RATE * 100}% ROI`);
    console.log(`   Base rewards: ${baseRewards.toFixed(9)} SOL`);
    console.log(`   Booster: ${boosterMultiplier}x`);
    console.log(`   Total rewards: ${totalRewards.toFixed(9)} SOL`);
    console.log(`   Already claimed: ${totalClaimedSol.toFixed(9)} SOL`);
    console.log(`   Pending: ${pendingRewards.toFixed(9)} SOL`);

    return pendingRewards;
  }

  /**
   * Helper: Send SOL from Treasury to User
   */
  async _sendSolFromTreasury(firebaseUid, amountSol) {
    try {
      const stakingKey = process.env.STAKING_PRIVATE_KEY;
      if (!stakingKey) throw new Error("STAKING_PRIVATE_KEY not set");

      // Get User Wallet from userRewards
      const rewardDoc = await this.db
        .collection(USER_REWARDS_COLLECTION)
        .doc(firebaseUid)
        .get();
      if (!rewardDoc.exists) throw new Error("User wallet not found");

      let userWalletAddr = rewardDoc.data().walletAddress;

      // Fallback: if walletAddress not in userRewards, check users collection
      if (!userWalletAddr) {
        console.log(
          `⚠️  walletAddress not in userRewards, checking users collection for claim payout...`,
        );
        const userDoc = await this.db
          .collection("users")
          .doc(firebaseUid)
          .get();
        if (userDoc.exists) {
          userWalletAddr = userDoc.data().walletAddress;
          if (userWalletAddr) {
            console.log(
              `✅ Found walletAddress in users collection: ${userWalletAddr}`,
            );
          }
        }
      }

      if (!userWalletAddr)
        throw new Error(
          "User has no wallet address linked in userRewards or users collection",
        );

      // Create keypair from private key
      const vaultKeypair = Keypair.fromSecretKey(bs58.decode(stakingKey));

      // Create SOL transfer transaction
      const { Transaction, SystemProgram } = await import("@solana/web3.js");
      const userPubkey = new PublicKey(userWalletAddr);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: vaultKeypair.publicKey,
          toPubkey: userPubkey,
          lamports: Math.floor(amountSol * 1e9), // Convert SOL to lamports
        }),
      );

      // Get latest blockhash
      const { blockhash } = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = vaultKeypair.publicKey;

      // Sign transaction
      transaction.sign(vaultKeypair);
      const rawTransaction = transaction.serialize();

      // Robust Send with Persistent Retry Loop
      let signature;
      try {
        signature = await this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          maxRetries: 3,
        });
        console.log(`   🚀 Sent SOL, initial signature: ${signature}`);
      } catch (sendError) {
        console.error(`   ❌ Failed initial send: ${sendError.message}`);
        throw sendError;
      }

      console.log(`   ⏳ Waiting for confirmation (persistent retry mode)...`);
      const startTime = Date.now();
      const timeout = 90000; // 90s
      let confirmed = false;

      while (Date.now() - startTime < timeout) {
        const status = await this.connection.getSignatureStatus(signature);

        if (status && status.value) {
          if (
            status.value.confirmationStatus === "confirmed" ||
            status.value.confirmationStatus === "finalized"
          ) {
            if (status.value.err) {
              throw new Error(
                "Transaction failed on-chain: " +
                  JSON.stringify(status.value.err),
              );
            }
            console.log(
              `   ✅ Success! Confirmed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
            );
            confirmed = true;
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          await this.connection.sendRawTransaction(rawTransaction, {
            skipPreflight: true,
            maxRetries: 0,
          });
        } catch (e) {}
      }

      if (!confirmed) {
        throw new Error(
          "Transaction confirmation timed out. It may still land later.",
        );
      }

      console.log(
        `✅ Sent ${amountSol} SOL to ${userWalletAddr}, signature: ${signature}`,
      );
      return signature;
    } catch (e) {
      console.error("Failed to send SOL from treasury:", e);
      throw new Error(`SOL transfer failed: ${e.message}`);
    }
  }

  /**
   * Helper: Calculate Booster Multiplier
   * DEPRECATED: Now using BoosterService.calculateStackedMultiplier()
   * This method is kept for backward compatibility but should not be used
   *
   * @param {Array} activeBoosters - Array of booster objects with type field
   * @returns {number} Total multiplier (1.0 = no boost)
   * @deprecated Use BoosterService.calculateStackedMultiplier() instead
   */
  _getBoosterMultiplier(activeBoosters = []) {
    console.warn(
      "⚠️ _getBoosterMultiplier() is deprecated. Use BoosterService.calculateStackedMultiplier() instead.",
    );
    return this.boosterService.calculateStackedMultiplier(activeBoosters);
  }
}

export const stakingService = new StakingService();
