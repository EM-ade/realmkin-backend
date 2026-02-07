/**
 * Test script for fee distribution flows
 * Tests all fee types: stake, claim, unstake, revenue, withdraw
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { distributeFees } from "../utils/feeDistribution.js";
import { getSolPriceUSD } from "../utils/solPrice.js";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.HELIUS_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Test wallet addresses (from environment)
const STAKING_WALLET = process.env.STAKING_WALLET_ADDRESS;
const GATEKEEPER_KEYPAIR = process.env.GATEKEEPER_KEYPAIR;
const PERSONAL_WALLET = process.env.FEE_PERSONAL_WALLET || "ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp";

async function getWalletBalance(address) {
  try {
    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error(`Error getting balance for ${address}:`, error.message);
    return 0;
  }
}

async function logBalances(label) {
  console.log(`\n📊 ${label} Balances:`);
  
  if (STAKING_WALLET) {
    const stakingBalance = await getWalletBalance(STAKING_WALLET);
    console.log(`   Staking wallet: ${stakingBalance.toFixed(6)} SOL`);
  }
  
  if (GATEKEEPER_KEYPAIR) {
    try {
      const gatekeeperKeypairArray = JSON.parse(GATEKEEPER_KEYPAIR);
      const { Keypair } = await import("@solana/web3.js");
      const gatekeeperKeypair = Keypair.fromSecretKey(new Uint8Array(gatekeeperKeypairArray));
      const gatekeeperAddress = gatekeeperKeypair.publicKey.toString();
      const gatekeeperBalance = await getWalletBalance(gatekeeperAddress);
      console.log(`   Gatekeeper wallet: ${gatekeeperBalance.toFixed(6)} SOL`);
    } catch (error) {
      console.log(`   Gatekeeper wallet: (error reading keypair)`);
    }
  }
  
  const personalBalance = await getWalletBalance(PERSONAL_WALLET);
  console.log(`   Personal wallet: ${personalBalance.toFixed(6)} SOL\n`);
}

async function testStakingClaim() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Staking Claim Fee Distribution");
  console.log("=".repeat(60));
  console.log("Fee: $2.90 total ($2.00 base + $0.90 site fee)");
  console.log("Expected: Staking → $0.65 to Gatekeeper, $0.25 to Personal");
  
  await logBalances("BEFORE");
  
  try {
    const result = await distributeFees("claim", 0.90, {
      treasuryDestination: "gatekeeper",
    });
    
    if (result.success) {
      console.log("✅ Distribution successful!");
      console.log(`   Signature: ${result.signature}`);
      console.log(`   Treasury sent: ${result.treasuryAmount?.toFixed(6)} SOL`);
      console.log(`   Personal sent: ${result.personalAmount?.toFixed(6)} SOL`);
    } else {
      console.log("❌ Distribution failed:", result.error);
    }
  } catch (error) {
    console.log("❌ Test failed:", error.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for tx confirmation
  await logBalances("AFTER");
}

async function testUnstake() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Unstaking Fee Distribution");
  console.log("=".repeat(60));
  console.log("Fee: $2.90 total ($2.00 base + $0.90 site fee)");
  console.log("Expected: Staking → $0.65 to Gatekeeper, $0.25 to Personal");
  
  await logBalances("BEFORE");
  
  try {
    const result = await distributeFees("unstake", 0.90, {
      treasuryDestination: "gatekeeper",
    });
    
    if (result.success) {
      console.log("✅ Distribution successful!");
      console.log(`   Signature: ${result.signature}`);
      console.log(`   Treasury sent: ${result.treasuryAmount?.toFixed(6)} SOL`);
      console.log(`   Personal sent: ${result.personalAmount?.toFixed(6)} SOL`);
    } else {
      console.log("❌ Distribution failed:", result.error);
    }
  } catch (error) {
    console.log("❌ Test failed:", error.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await logBalances("AFTER");
}

async function testRevenueClaim() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: Revenue Distribution Claim");
  console.log("=".repeat(60));
  console.log("Fee: $1.00 total ($0.10 base + $0.90 site fee)");
  console.log("Expected: Gatekeeper retains $0.75, sends $0.25 to Personal");
  console.log("(No treasury transfer - optimized)");
  
  await logBalances("BEFORE");
  
  try {
    const result = await distributeFees("revenue", 0.90, {
      sourceWallet: "gatekeeper",
      treasuryDestination: "gatekeeper",
      extraTreasuryUsd: 0.10,
    });
    
    if (result.success) {
      console.log("✅ Distribution successful!");
      console.log(`   Signature: ${result.signature}`);
      console.log(`   Treasury amount: ${result.treasuryAmount?.toFixed(6)} SOL (retained)`);
      console.log(`   Personal sent: ${result.personalAmount?.toFixed(6)} SOL`);
    } else {
      console.log("❌ Distribution failed:", result.error);
    }
  } catch (error) {
    console.log("❌ Test failed:", error.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await logBalances("AFTER");
}

async function testWithdrawal() {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Withdrawal Fee Distribution");
  console.log("=".repeat(60));
  console.log("Fee: $1.05 total ($0.15 base + $0.90 site fee)");
  console.log("Expected: Gatekeeper retains $0.80, sends $0.25 to Personal");
  console.log("(No treasury transfer - optimized)");
  
  await logBalances("BEFORE");
  
  try {
    const result = await distributeFees("withdraw", 0.90, {
      sourceWallet: "gatekeeper",
      treasuryDestination: "gatekeeper",
      extraTreasuryUsd: 0.15,
    });
    
    if (result.success) {
      console.log("✅ Distribution successful!");
      console.log(`   Signature: ${result.signature}`);
      console.log(`   Treasury amount: ${result.treasuryAmount?.toFixed(6)} SOL (retained)`);
      console.log(`   Personal sent: ${result.personalAmount?.toFixed(6)} SOL`);
    } else {
      console.log("❌ Distribution failed:", result.error);
    }
  } catch (error) {
    console.log("❌ Test failed:", error.message);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  await logBalances("AFTER");
}

async function runTests() {
  console.log("\n🧪 Fee Distribution Test Suite");
  console.log("=".repeat(60));
  
  const solPrice = await getSolPriceUSD();
  console.log(`Current SOL Price: $${solPrice.toFixed(2)}`);
  console.log(`Personal Wallet: ${PERSONAL_WALLET}`);
  
  // Check environment
  if (!GATEKEEPER_KEYPAIR) {
    console.error("\n❌ GATEKEEPER_KEYPAIR not set in environment");
    process.exit(1);
  }
  
  if (!STAKING_WALLET) {
    console.warn("\n⚠️  STAKING_WALLET_ADDRESS not set - staking tests will use default");
  }
  
  // Run tests
  await testStakingClaim();
  await testUnstake();
  await testRevenueClaim();
  await testWithdrawal();
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ All tests completed!");
  console.log("=".repeat(60));
}

// Run tests
runTests().catch(error => {
  console.error("\n❌ Test suite failed:", error);
  process.exit(1);
});
