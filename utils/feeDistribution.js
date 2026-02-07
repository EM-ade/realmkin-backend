import { Connection, PublicKey, Transaction, SystemProgram, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { FEE_WALLETS, FEE_SPLIT } from "./treasuryWallet.js";
import { getFeeInSol } from "./solPrice.js";

/**
 * Distribute collected fees to treasury and personal wallets
 * Called after backend receives fee payment from user
 * 
 * @param {string} feeType - Type of fee ('claim', 'unstake', 'stake')
 * @param {number} totalFeeUsd - Total fee amount in USD (e.g., 2.90)
 * @param {Object} [options]
 * @param {"staking"|"gatekeeper"} [options.sourceWallet="staking"] - Wallet holding collected fees
 * @param {"treasury"|"gatekeeper"} [options.treasuryDestination="treasury"] - Destination for treasury cut
 * @param {number} [options.extraTreasuryUsd=0] - Extra USD to add to treasury transfer (e.g., base fee)
 * @returns {Promise<Object>} Distribution result
 */
export async function distributeFees(feeType, totalFeeUsd, options = {}) {
  try {
    const {
      sourceWallet = "staking",
      treasuryDestination = "treasury",
      extraTreasuryUsd = 0,
    } = options;
    console.log(`💸 Distributing ${feeType} fee: $${totalFeeUsd}`);
    console.log(`   Source wallet: ${sourceWallet}`);
    console.log(`   Treasury destination: ${treasuryDestination}`);
    if (extraTreasuryUsd > 0) {
      console.log(`   Extra treasury amount: $${extraTreasuryUsd}`);
    }

    let sourceKeypair;
    if (sourceWallet === "gatekeeper") {
      const gatekeeperKeypair = process.env.GATEKEEPER_KEYPAIR;
      if (!gatekeeperKeypair) {
        throw new Error("GATEKEEPER_KEYPAIR not found in environment");
      }

      const keypairArray = JSON.parse(gatekeeperKeypair);
      sourceKeypair = Keypair.fromSecretKey(new Uint8Array(keypairArray));
    } else {
      const stakingPrivateKey = process.env.STAKING_PRIVATE_KEY;
      if (!stakingPrivateKey) {
        throw new Error("STAKING_PRIVATE_KEY not found in environment");
      }

      sourceKeypair = Keypair.fromSecretKey(bs58.decode(stakingPrivateKey));
    }

    console.log(`   From wallet: ${sourceKeypair.publicKey.toString()}`);
    
    // Get destination wallets
    let treasuryWallet;
    if (treasuryDestination === "gatekeeper") {
      // Load gatekeeper public key (may differ from source)
      const gatekeeperKeypairJson = process.env.GATEKEEPER_KEYPAIR;
      if (!gatekeeperKeypairJson) {
        throw new Error("GATEKEEPER_KEYPAIR not found in environment");
      }
      const gatekeeperKeypairArray = JSON.parse(gatekeeperKeypairJson);
      const gatekeeperKeypair = Keypair.fromSecretKey(new Uint8Array(gatekeeperKeypairArray));
      treasuryWallet = gatekeeperKeypair.publicKey.toString();
    } else {
      treasuryWallet = FEE_WALLETS.TREASURY;
    }
    const personalWallet = FEE_WALLETS.PERSONAL;

    console.log(`   Treasury: ${treasuryWallet}`);
    console.log(`   Personal: ${personalWallet}`);
    
    // Calculate distribution amounts in SOL
    const treasuryCutUsd = FEE_SPLIT.TREASURY_CUT + extraTreasuryUsd;
    const { solAmount: treasuryAmount } = await getFeeInSol(treasuryCutUsd); // $0.65 + base fee
    const { solAmount: personalAmount } = await getFeeInSol(FEE_SPLIT.PERSONAL_CUT); // $0.25

    console.log(
      `   Treasury amount: ${treasuryAmount.toFixed(9)} SOL ($${treasuryCutUsd})`
    );
    console.log(`   Personal amount: ${personalAmount.toFixed(9)} SOL ($${FEE_SPLIT.PERSONAL_CUT})`);

    // Check if treasury transfer is needed (skip if source === destination)
    const skipTreasuryTransfer =
      sourceWallet === "gatekeeper" && treasuryDestination === "gatekeeper";

    if (skipTreasuryTransfer) {
      console.log(
        `   ⚡ Treasury amount retained in source wallet (no transfer needed)`
      );
    }

    // Connect to Solana
    const rpcUrl = process.env.HELIUS_MAINNET_RPC_URL || process.env.SOLANA_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    // Create transaction with transfers
    const transaction = new Transaction();

    // Transfer treasury cut (only if source !== destination)
    if (!skipTreasuryTransfer) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: sourceKeypair.publicKey,
          toPubkey: new PublicKey(treasuryWallet),
          lamports: Math.floor(treasuryAmount * 1e9), // Convert SOL to lamports
        })
      );
    }

    // Transfer $0.25 to personal wallet
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: sourceKeypair.publicKey,
        toPubkey: new PublicKey(personalWallet),
        lamports: Math.floor(personalAmount * 1e9), // Convert SOL to lamports
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = sourceKeypair.publicKey;

    // Sign and send transaction
    transaction.sign(sourceKeypair);
    const signature = await connection.sendRawTransaction(transaction.serialize());
    
    // Confirm transaction
    await connection.confirmTransaction(signature, "confirmed");
    
    console.log(`   ✅ Fee distribution successful!`);
    console.log(`   Signature: ${signature}`);
    
    return {
      success: true,
      signature,
      treasuryAmount,
      personalAmount,
      treasuryWallet,
      personalWallet,
    };
    
  } catch (error) {
    console.error(`   ❌ Fee distribution failed:`, error.message);
    // Don't throw - fee distribution failure shouldn't block the main operation
    return {
      success: false,
      error: error.message,
    };
  }
}
