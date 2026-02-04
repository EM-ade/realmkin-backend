import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { sendMkinTokens } from "../utils/mkinTransfer.js";
import bs58 from "bs58";
import "dotenv/config";

async function runTest() {
  const recipient = process.argv[2];
  const amount = 0.1; // Small test amount

  if (!recipient) {
    console.error(
      "Usage: node scripts/verify_robust_transfer.js <recipient_wallet_address>",
    );
    process.exit(1);
  }

  console.log(`🧪 Starting Robust Transfer Verification`);
  console.log(`   Recipient: ${recipient}`);
  console.log(`   Amount: ${amount} MKIN`);
  console.log(`   Mode: Real Transaction (Mainnet)`);
  console.log("----------------------------------------");

  try {
    const signature = await sendMkinTokens(recipient, amount);

    console.log("\n✅ Test Passed!");
    console.log(`   Transaction Signature: ${signature}`);
    console.log(`   Explorer: https://solscan.io/tx/${signature}`);
    console.log(
      "\nThis confirms the new logic builds, signs, and submits transactions correctly.",
    );
    console.log(
      "If the network was congested, you would have seen 'Re-sending...' logs.",
    );
  } catch (error) {
    console.error("\n❌ Test Failed:", error.message);
  }
}

runTest();
