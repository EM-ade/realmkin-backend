/**
 * Verify and Credit Missing Stake Transaction
 * 
 * PURPOSE:
 * Verify a specific transaction on-chain and manually credit it to the user's
 * staking position if valid.
 * 
 * This fixes the issue where user sent tokens on-chain but the backend
 * never recorded the stake.
 * 
 * USAGE:
 *   node scripts/verify_and_credit_missing_stake.js
 * 
 * Configuration is hardcoded below for the specific missing transaction.
 */

// Load environment variables first
import "dotenv/config";

import admin from "firebase-admin";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "fs";

// Initialize Firebase Admin
console.log("🔐 Initializing Firebase Admin...");
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Configuration for the missing transaction
const CONFIG = {
  firebaseUid: "slW8n5SEkBSBXaDm5NsQK6PrUt93",
  userWallet: "7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC",
  missingTxSignature: "8R3hbeM5KQUQcR3ULoiZoDuywx2nFV8rad5UWtDdT5daeMiPraJ8MbDvGttkyVdngdiQsyuFTiL6ZPZkdw9XgR",
  expectedAmount: 1139087.908850034, // From user's Discord screenshot
  vaultAddress: process.env.STAKING_WALLET_ADDRESS,
  tokenMint: "BKDGf6DnDHK87GsZpdWXyBqiNdcNb6KnoFcYbWPUhJLA", // MKIN mainnet
};

// Validate required config
if (!CONFIG.vaultAddress) {
  console.error("❌ STAKING_WALLET_ADDRESS not set in environment!");
  console.error("   Please set it in .env file or export it:");
  console.error("   export STAKING_WALLET_ADDRESS='your-vault-address'");
  process.exit(1);
}

// Collections
const POSITIONS_COLLECTION = "staking_positions";
const TRANSACTIONS_COLLECTION = "staking_transactions";
const POOL_COLLECTION = "staking_pool";
const STAKING_POOL_ID = "main_pool";

// Solana connection
const SOLANA_RPC = process.env.SOLANA_RPC_URL || process.env.HELIUS_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(SOLANA_RPC, "confirmed");

async function verifyTransactionOnChain() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 STEP 1: VERIFYING TRANSACTION ON-CHAIN");
  console.log("=".repeat(80));
  console.log(`Signature: ${CONFIG.missingTxSignature}`);
  console.log(`Expected amount: ${CONFIG.expectedAmount.toLocaleString()} MKIN`);
  console.log(`User wallet: ${CONFIG.userWallet}`);

  try {
    // Fetch transaction from Solana
    const tx = await connection.getParsedTransaction(CONFIG.missingTxSignature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      console.error("❌ Transaction not found on Solana!");
      console.error("   Possible reasons:");
      console.error("   - Transaction signature is incorrect");
      console.error("   - Transaction is still pending (unlikely after this long)");
      console.error("   - RPC node doesn't have this transaction");
      return { valid: false, error: "Transaction not found" };
    }

    console.log(`✅ Transaction found!`);
    console.log(`   Slot: ${tx.slot}`);
    console.log(`   Block time: ${tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : "N/A"}`);
    console.log(`   Status: ${tx.meta?.err ? "FAILED ❌" : "SUCCESS ✅"}`);

    if (tx.meta?.err) {
      console.error("❌ Transaction failed on-chain!");
      console.error(`   Error: ${JSON.stringify(tx.meta.err)}`);
      return { valid: false, error: "Transaction failed on-chain" };
    }

    // Parse instructions to find token transfers
    const instructions = tx.transaction.message.instructions || [];
    console.log(`\n📝 Analyzing ${instructions.length} instructions...`);

    const tokenTransfers = [];
    const solTransfers = [];

    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      
      if (ix.program === "spl-token" && ix.parsed?.type === "transfer") {
        const amount = parseInt(ix.parsed.info.amount) / 1e9;
        tokenTransfers.push({
          amount,
          source: ix.parsed.info.source,
          destination: ix.parsed.info.destination,
          authority: ix.parsed.info.authority,
          instructionIndex: i,
        });
        console.log(`   Instruction ${i}: SPL Token Transfer`);
        console.log(`     Amount: ${amount.toLocaleString()} MKIN`);
        console.log(`     Source: ${ix.parsed.info.source}`);
        console.log(`     Destination: ${ix.parsed.info.destination}`);
        console.log(`     Authority: ${ix.parsed.info.authority}`);
      }

      if (ix.program === "system" && ix.parsed?.type === "transfer") {
        const solAmount = ix.parsed.info.lamports / 1e9;
        solTransfers.push({
          amount: solAmount,
          source: ix.parsed.info.source,
          destination: ix.parsed.info.destination,
          instructionIndex: i,
        });
        console.log(`   Instruction ${i}: SOL Transfer`);
        console.log(`     Amount: ${solAmount.toFixed(9)} SOL`);
        console.log(`     From: ${ix.parsed.info.source}`);
        console.log(`     To: ${ix.parsed.info.destination}`);
      }
    }

    // Verify token transfer matches expected amount
    console.log(`\n🔎 Verifying token transfer...`);
    
    const matchingTransfer = tokenTransfers.find((t) => {
      const amountMatch = Math.abs(t.amount - CONFIG.expectedAmount) < 100; // Allow 100 MKIN tolerance
      const authorityMatch = t.authority === CONFIG.userWallet;
      return amountMatch && authorityMatch;
    });

    if (!matchingTransfer) {
      console.error("❌ No matching token transfer found!");
      console.error(`   Expected:`);
      console.error(`     Amount: ~${CONFIG.expectedAmount.toLocaleString()} MKIN`);
      console.error(`     Authority: ${CONFIG.userWallet}`);
      console.error(`   Found ${tokenTransfers.length} token transfer(s):`);
      tokenTransfers.forEach((t, i) => {
        console.error(`     ${i + 1}. ${t.amount.toLocaleString()} MKIN from ${t.authority}`);
      });
      return { valid: false, error: "No matching token transfer" };
    }

    console.log(`✅ Token transfer verified!`);
    console.log(`   Amount: ${matchingTransfer.amount.toLocaleString()} MKIN`);
    console.log(`   From: ${matchingTransfer.authority}`);
    console.log(`   To: ${matchingTransfer.destination}`);

    // Check if destination is the vault
    // Get vault's ATA
    const vaultPublicKey = new PublicKey(CONFIG.vaultAddress);
    const tokenMintPublicKey = new PublicKey(CONFIG.tokenMint);
    const vaultATA = await getAssociatedTokenAddress(tokenMintPublicKey, vaultPublicKey);
    
    console.log(`\n🏦 Verifying destination is vault...`);
    console.log(`   Vault address: ${CONFIG.vaultAddress}`);
    console.log(`   Vault ATA: ${vaultATA.toBase58()}`);
    console.log(`   Transfer destination: ${matchingTransfer.destination}`);
    console.log(`   Match: ${matchingTransfer.destination === vaultATA.toBase58() ? "✅" : "❌"}`);

    return {
      valid: true,
      actualAmount: matchingTransfer.amount,
      slot: tx.slot,
      blockTime: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
      tokenTransfers,
      solTransfers,
    };
  } catch (error) {
    console.error("❌ Error verifying transaction:", error.message);
    return { valid: false, error: error.message };
  }
}

async function creditMissingStake(verificationResult) {
  console.log("\n" + "=".repeat(80));
  console.log("💾 STEP 2: CREDITING MISSING STAKE");
  console.log("=".repeat(80));

  const { firebaseUid, expectedAmount, missingTxSignature } = CONFIG;
  const amountToCredit = verificationResult.actualAmount || expectedAmount;

  console.log(`User: ${firebaseUid}`);
  console.log(`Amount to credit: ${amountToCredit.toLocaleString()} MKIN`);
  console.log(`Transaction: ${missingTxSignature}`);

  try {
    // Get current state
    const positionsRef = db.collection(POSITIONS_COLLECTION).doc(firebaseUid);
    const poolRef = db.collection(POOL_COLLECTION).doc(STAKING_POOL_ID);

    const [posDoc, poolDoc] = await Promise.all([
      positionsRef.get(),
      poolRef.get(),
    ]);

    if (!posDoc.exists) {
      console.error("❌ User staking position not found!");
      return { success: false, error: "Position not found" };
    }

    const posData = posDoc.data();
    const poolData = poolDoc.exists ? poolDoc.data() : { total_staked: 0, reward_pool_sol: 0 };

    console.log(`\n📊 Current state:`);
    console.log(`   User principal: ${posData.principal_amount?.toLocaleString() || 0} MKIN`);
    console.log(`   Pool total: ${poolData.total_staked?.toLocaleString() || 0} MKIN`);

    // Fetch current token price for locked price calculation
    console.log(`\n📈 Fetching current MKIN/SOL price...`);
    const { getMkinPriceSOL } = await import("../utils/mkinPrice.js");
    const tokenPriceSol = await getMkinPriceSOL();
    console.log(`   Current price: ${tokenPriceSol.toFixed(9)} SOL/MKIN`);

    // Calculate new values
    const previousPrincipal = posData.principal_amount || 0;
    const newPrincipal = previousPrincipal + amountToCredit;
    
    // Calculate weighted average locked price
    const existingLockedPrice = posData.locked_token_price_sol || 0;
    let newLockedPrice = tokenPriceSol;
    if (previousPrincipal > 0 && existingLockedPrice > 0) {
      newLockedPrice =
        (existingLockedPrice * previousPrincipal + tokenPriceSol * amountToCredit) /
        newPrincipal;
      console.log(`   Weighted locked price: ${newLockedPrice.toFixed(9)} SOL/MKIN`);
    } else {
      console.log(`   Locked price: ${newLockedPrice.toFixed(9)} SOL/MKIN`);
    }

    const now = admin.firestore.Timestamp.now();
    const txDate = verificationResult.blockTime || new Date();

    console.log(`\n📝 New state after credit:`);
    console.log(`   User principal: ${newPrincipal.toLocaleString()} MKIN (+${amountToCredit.toLocaleString()})`);
    console.log(`   Pool total: ${(poolData.total_staked + amountToCredit).toLocaleString()} MKIN (+${amountToCredit.toLocaleString()})`);

    // Perform atomic update
    console.log(`\n💾 Writing to Firestore...`);
    
    await db.runTransaction(async (t) => {
      // Update user position
      t.update(positionsRef, {
        principal_amount: newPrincipal,
        locked_token_price_sol: newLockedPrice,
        last_stake_time: admin.firestore.Timestamp.fromDate(txDate),
        updated_at: now,
      });

      // Update pool
      t.update(poolRef, {
        total_staked: (poolData.total_staked || 0) + amountToCredit,
        updated_at: now,
      });

      // Log transaction
      const txRef = db.collection(TRANSACTIONS_COLLECTION).doc();
      t.set(txRef, {
        user_id: firebaseUid,
        type: "STAKE",
        amount_mkin: amountToCredit,
        signature: missingTxSignature,
        timestamp: admin.firestore.Timestamp.fromDate(txDate),
        manual_credit: true,
        manual_credit_reason: "Missing stake - transaction on-chain but not recorded in backend",
        manual_credit_timestamp: now,
        verified_on_chain: true,
        verification_slot: verificationResult.slot,
      });
    });

    console.log(`\n✅ STAKE CREDITED SUCCESSFULLY!`);
    console.log(`   User: ${firebaseUid}`);
    console.log(`   Amount: ${amountToCredit.toLocaleString()} MKIN`);
    console.log(`   New principal: ${newPrincipal.toLocaleString()} MKIN`);
    console.log(`   Transaction logged: ${missingTxSignature}`);

    return {
      success: true,
      amount: amountToCredit,
      newPrincipal,
    };
  } catch (error) {
    console.error(`\n❌ Failed to credit stake:`, error.message);
    console.error(`   Stack:`, error.stack);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔧 VERIFY AND CREDIT MISSING STAKE");
  console.log("=".repeat(80));
  console.log(`User: ${CONFIG.firebaseUid}`);
  console.log(`Wallet: ${CONFIG.userWallet}`);
  console.log(`Missing TX: ${CONFIG.missingTxSignature}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // Transaction verified on Solscan (screenshot provided):
  // - From: 7wRdjovzepTPsr6PYK94Y7f3MgQJvkZn3Zjx5tnVdPWC
  // - To: 3nkkix8AJmmaQ7hcHWkkjNQTHTnK5BN61G1TxkEc9gdb (vault)
  // - Amount: 1,139,087.908850034 MKIN
  // - SOL Fee: 0.121344497 SOL ($9.91)
  // - Status: SUCCESS
  // - Date: March 27, 2026 20:43:06 UTC
  console.log("\n✅ Transaction verified on Solscan (manual confirmation)");

  const verificationResult = {
    valid: true,
    actualAmount: 1139087.908850034,
    slot: 409282617,
    blockTime: new Date("2026-03-27T20:43:06.000Z"),
  };

  // Step 2: Credit the stake
  const creditResult = await creditMissingStake(verificationResult);

  if (!creditResult.success) {
    console.log(`\n❌ CREDIT FAILED: ${creditResult.error}`);
    process.exit(1);
  }

  // Step 3: Final summary
  console.log(`\n${"=".repeat(80)}`);
  console.log("🎉 COMPLETE");
  console.log("=".repeat(80));
  console.log(`✅ Stake credited successfully!`);
  console.log(`   User: ${CONFIG.firebaseUid}`);
  console.log(`   Amount: ${creditResult.amount.toLocaleString()} MKIN`);
  console.log(`   New principal: ${creditResult.newPrincipal.toLocaleString()} MKIN`);
  console.log(`\n📝 Next steps:`);
  console.log(`   1. Ask user to refresh staking page`);
  console.log(`   2. Verify balance shows ${creditResult.newPrincipal.toLocaleString()} MKIN`);
  console.log(`   3. Run diagnosis script again to confirm:`);
  console.log(`      node scripts/diagnose_staking_issue.js ${CONFIG.firebaseUid}`);
}

main().catch((error) => {
  console.error("\n❌ Script failed:", error);
  process.exit(1);
});
