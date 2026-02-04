import dotenv from "dotenv";
import { sendMkinTokens } from "../utils/mkinTransfer.js";

// Load environment variables from .env file
dotenv.config();

/**
 * Manual Robust MKIN Transfer Script
 * This script uses the enhanced mkinTransfer utility with retry logic.
 */
async function runManualTransfer() {
  const recipient = "AmzZqzfwUoT3AKq1CQDXXKDGaiQue14cyWyiBswpY5Ai";
  const amount = 1622;

  console.log(
    `🚀 Starting robust manual transfer of ${amount} MKIN to ${recipient}...`,
  );

  try {
    const txHash = await sendMkinTokens(recipient, amount);
    console.log(`✅ Transfer successful!`);
    console.log(`🔗 Transaction: https://solscan.io/tx/${txHash}`);
  } catch (error) {
    console.error(`❌ Transfer failed after all retries:`, error.message);
    process.exit(1);
  }
}

runManualTransfer();
