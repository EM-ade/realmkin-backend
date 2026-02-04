import admin from "firebase-admin";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend-api root
dotenv.config({ path: path.join(__dirname, "../.env") });

// Initialize Firebase
const serviceAccountPath = path.join(
  __dirname,
  "../../gatekeeper/serviceAccountKey.json",
);
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// Setup Solana Connection
const connection = new Connection(
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com",
  "confirmed",
);

async function main() {
  const recipientAddr = "C9FtYnGW6MHSBqWLfoQnQtmsS9Mb2mAwbdmEKbvRfTuZ"; // Kristovvvvv
  const amountSol = 0.436038;
  const amountLamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  console.log(`🚀 Starting manual SOL transfer...`);
  console.log(`   Recipient: ${recipientAddr}`);
  console.log(`   Amount: ${amountSol} SOL (${amountLamports} lamports)`);

  // Load Treasury Keypair
  const privateKey = process.env.STAKING_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("STAKING_PRIVATE_KEY is not set in environment variables");
  }
  const treasuryKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log(`   Sender: ${treasuryKeypair.publicKey.toBase58()}`);

  // Create Transaction
  const transaction = new Transaction();

  // Add Priority Fee
  transaction.add(
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 50000, // 50k priority fee
    }),
  );

  // Add Transfer Instruction
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: treasuryKeypair.publicKey,
      toPubkey: new PublicKey(recipientAddr),
      lamports: amountLamports,
    }),
  );

  console.log("🔄 Sending transaction...");
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [treasuryKeypair],
      { commitment: "confirmed" },
    );
    console.log(`✅ Transaction successful!`);
    console.log(`   Signature: ${signature}`);
    console.log(`   Explorer: https://solscan.io/tx/${signature}`);
  } catch (error) {
    console.error("❌ Transaction failed:", error);
  }
}

main().catch(console.error);
