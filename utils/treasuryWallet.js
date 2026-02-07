import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

/**
 * Get treasury wallet public key from GATEKEEPER_KEYPAIR env variable
 * @returns {string} Treasury wallet public key
 */
export function getTreasuryWallet() {
  const gatekeeperKeypair = process.env.GATEKEEPER_KEYPAIR;
  
  if (!gatekeeperKeypair) {
    throw new Error("GATEKEEPER_KEYPAIR not found in environment");
  }

  try {
    // Parse the keypair from byte array string format: "[241,193,145,...]"
    const keypairArray = JSON.parse(gatekeeperKeypair);
    
    // Convert to Uint8Array
    const secretKey = new Uint8Array(keypairArray);
    
    // Create keypair from secret key
    const keypair = Keypair.fromSecretKey(secretKey);
    
    // Get public key
    const publicKey = keypair.publicKey.toString();
    
    console.log(`💰 Treasury wallet (from GATEKEEPER_KEYPAIR): ${publicKey}`);
    
    return publicKey;
  } catch (error) {
    console.error("Error parsing GATEKEEPER_KEYPAIR:", error);
    throw new Error("Failed to parse treasury wallet from GATEKEEPER_KEYPAIR");
  }
}

/**
 * Wallet addresses for fee distribution
 */
export const FEE_WALLETS = {
  // Your personal wallet (gets $0.25 from each transaction)
  PERSONAL: "ABjnax7QfDmG6wR2KJoNc3UyiouwTEZ3b5tnTrLLyNSp",
  
  // Treasury wallet (gets $0.65 from each transaction)
  // Dynamically loaded from GATEKEEPER_KEYPAIR
  get TREASURY() {
    return getTreasuryWallet();
  }
};

/**
 * Fee split configuration
 */
export const FEE_SPLIT = {
  SITE_FEE_TOTAL: 0.90, // Total site fee in USD
  PERSONAL_CUT: 0.25,   // Your cut in USD
  TREASURY_CUT: 0.65,   // Treasury cut in USD (0.10 team + 0.55 treasury)
};
