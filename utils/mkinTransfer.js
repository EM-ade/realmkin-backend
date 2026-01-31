/**
 * MKIN Token Transfer Utility
 * Handles sending MKIN tokens from the hot wallet to users
 */

import { Connection, PublicKey, Transaction, Keypair, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';

/**
 * Send MKIN tokens to a user's wallet
 * @param {string} recipientWalletAddress - Destination wallet address
 * @param {number} amount - Amount of MKIN to send (in whole tokens, not lamports)
 * @returns {Promise<string>} Transaction hash
 */
/**
 * Send MKIN tokens to a user's wallet
 * @param {string} recipientWalletAddress - Destination wallet address
 * @param {number} amount - Amount of MKIN to send (in whole tokens, not lamports)
 * @returns {Promise<string>} Transaction hash
 */
async function sendMkinTokens(recipientWalletAddress, amount) {
  const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const mkinTokenMint = process.env.MKIN_TOKEN_MINT;
  const gatekeeperKeypairJson = process.env.GATEKEEPER_KEYPAIR;

  if (!mkinTokenMint || !gatekeeperKeypairJson) {
    throw new Error('Missing MKIN_TOKEN_MINT or GATEKEEPER_KEYPAIR environment variables');
  }

  console.log('[MKIN Transfer] Sending ' + amount + ' MKIN to ' + recipientWalletAddress);

  // Create connection with better settings to prevent timeouts
  const connection = new Connection(solanaRpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000, // 60 seconds timeout
  });
  const gatekeeperKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(gatekeeperKeypairJson))
  );
  const mkinMint = new PublicKey(mkinTokenMint);
  const recipientPubkey = new PublicKey(recipientWalletAddress);

  // Get token accounts
  const fromTokenAccount = await getAssociatedTokenAddress(
    mkinMint,
    gatekeeperKeypair.publicKey
  );

  const toTokenAccount = await getAssociatedTokenAddress(
    mkinMint,
    recipientPubkey,
    false // allowOwnerOffCurve
  );

  console.log('[MKIN Transfer] From: ' + fromTokenAccount.toBase58());
  console.log('[MKIN Transfer] To: ' + toTokenAccount.toBase58());

  // Create transaction
  const transaction = new Transaction();
  transaction.feePayer = gatekeeperKeypair.publicKey;

  // Check if recipient token account exists, create if not
  let recipientAccountExists = true;
  try {
    const accountInfo = await getAccount(connection, toTokenAccount);
    console.log('[MKIN Transfer] Recipient token account exists with balance: ' +
      (parseInt(accountInfo.amount) / Math.pow(10, 9)));
  } catch (error) {
    recipientAccountExists = false;
    console.log('[MKIN Transfer] Recipient token account does not exist - will create it');
    console.log('[MKIN Transfer] Account creation will cost ~0.00203928 SOL (paid by hot wallet)');

    // Add instruction to create recipient's token account
    transaction.add(
      createAssociatedTokenAccountInstruction(
        gatekeeperKeypair.publicKey, // payer (gatekeeper pays for account creation)
        toTokenAccount,              // token account address
        recipientPubkey,             // owner of the new account
        mkinMint                     // mint
      )
    );
  }

  // MKIN has 9 decimals (adjust if different)
  const decimals = 9;
  const amountInSmallestUnit = amount * Math.pow(10, decimals);
  console.log('[MKIN Transfer] Amount (raw): ' + amountInSmallestUnit);

  // Check hot wallet balance BEFORE attempting transfer
  try {
    const senderAccount = await getAccount(connection, fromTokenAccount);
    const availableBalance = Number(senderAccount.amount) / Math.pow(10, decimals);
    console.log(`[MKIN Transfer] Hot wallet balance: ${availableBalance} MKIN`);
    
    if (Number(senderAccount.amount) < amountInSmallestUnit) {
      throw new Error(
        `Insufficient MKIN balance in hot wallet. ` +
        `Required: ${amount} MKIN, Available: ${availableBalance} MKIN`
      );
    }
  } catch (balanceError) {
    if (balanceError.message.includes('Insufficient MKIN balance')) {
      throw balanceError;
    }
    console.error(`[MKIN Transfer] Failed to check hot wallet balance: ${balanceError.message}`);
    throw new Error(`Hot wallet token account error: ${balanceError.message}`);
  }

  // Check SOL balance for fees
  try {
    const solBalance = await connection.getBalance(gatekeeperKeypair.publicKey);
    const solBalanceInSol = solBalance / 1e9;
    console.log(`[MKIN Transfer] Hot wallet SOL balance: ${solBalanceInSol.toFixed(6)} SOL`);
    
    // Need at least 0.01 SOL for fees (0.00203928 for account creation + transaction fees)
    const minRequired = recipientAccountExists ? 0.001 : 0.005;
    if (solBalanceInSol < minRequired) {
      throw new Error(
        `Insufficient SOL balance in hot wallet for transaction fees. ` +
        `Required: ~${minRequired} SOL, Available: ${solBalanceInSol.toFixed(6)} SOL`
      );
    }
  } catch (solBalanceError) {
    if (solBalanceError.message.includes('Insufficient SOL balance')) {
      throw solBalanceError;
    }
    console.error(`[MKIN Transfer] Failed to check SOL balance: ${solBalanceError.message}`);
  }

  // Add transfer instruction
  transaction.add(
    createTransferCheckedInstruction(
      fromTokenAccount,
      mkinMint,
      toTokenAccount,
      gatekeeperKeypair.publicKey,
      amountInSmallestUnit,
      decimals
    )
  );

  // Get recent blockhash (CRITICAL: prevents "Blockhash not found" errors)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;
  transaction.lastValidBlockHeight = lastValidBlockHeight;

  console.log('[MKIN Transfer] Blockhash: ' + blockhash);
  console.log('[MKIN Transfer] Last valid block height: ' + lastValidBlockHeight);

  // Sign transaction
  transaction.sign(gatekeeperKeypair);
  const rawTransaction = transaction.serialize();
  
  let txHash;
  try {
    txHash = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    console.log('[MKIN Transfer] Transaction sent: ' + txHash);
  } catch (sendError) {
    console.error('[MKIN Transfer] Failed to send transaction:', sendError);
    
    // Enhanced error message for simulation failures
    if (sendError.message && sendError.message.includes('Simulation failed')) {
      // Try to extract the actual error from logs
      const logs = sendError.logs || [];
      console.error('[MKIN Transfer] Transaction simulation logs:', logs);
      
      throw new Error(
        `Transaction simulation failed. This usually means: ` +
        `1) Insufficient MKIN in hot wallet, ` +
        `2) Insufficient SOL for fees, or ` +
        `3) Token account is frozen/closed. ` +
        `Check logs above for details.`
      );
    }
    
    throw sendError;
  }

  // Confirm transaction with robust error handling
  try {
    const confirmation = await connection.confirmTransaction({
      signature: txHash,
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
    }, 'confirmed');

    if (confirmation.value.err) {
      throw new Error('Transaction failed: ' + JSON.stringify(confirmation.value.err));
    }

    console.log('[MKIN Transfer] Success! TX: ' + txHash);
    return txHash;
  } catch (error) {
    console.warn('[MKIN Transfer] Confirmation timed out or failed, checking status manually...');

    // Check if it actually landed despite the error
    try {
      const status = await connection.getSignatureStatus(txHash);
      if (status && status.value && status.value.confirmationStatus &&
        (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized')) {

        if (status.value.err) {
          throw new Error('Transaction failed on-chain: ' + JSON.stringify(status.value.err));
        }

        console.log('[MKIN Transfer] Transaction actually succeeded despite confirmation error! TX: ' + txHash);
        return txHash;
      }
    } catch (statusError) {
      console.warn('[MKIN Transfer] Could not verify status manually: ' + statusError.message);
    }

    // If we're here, it likely really failed or we can't verify it.
    // Re-throw the original error to trigger the refund logic in the caller.
    throw error;
  }
}

/**
 * Check hot wallet MKIN balance
 * @returns {Promise<number>} Available MKIN balance
 */
async function getHotWalletBalance() {
  const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const mkinTokenMint = process.env.MKIN_TOKEN_MINT;
  const gatekeeperKeypairJson = process.env.GATEKEEPER_KEYPAIR;

  if (!mkinTokenMint || !gatekeeperKeypairJson) {
    throw new Error('Missing MKIN_TOKEN_MINT or GATEKEEPER_KEYPAIR environment variables');
  }

  const connection = new Connection(solanaRpcUrl, 'confirmed');
  const gatekeeperKeypair = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(gatekeeperKeypairJson))
  );
  const mkinMint = new PublicKey(mkinTokenMint);

  const tokenAccount = await getAssociatedTokenAddress(
    mkinMint,
    gatekeeperKeypair.publicKey
  );

  const balance = await connection.getTokenAccountBalance(tokenAccount);
  const availableMkin = parseInt(balance.value.amount) / Math.pow(10, balance.value.decimals);

  return availableMkin;
}

export { sendMkinTokens, getHotWalletBalance };
