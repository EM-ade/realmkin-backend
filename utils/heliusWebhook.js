import express from 'express';
import bodyParser from 'body-parser';
import { NFT_STAKING_CONFIG } from '../config/nftStaking.js';
import admin from 'firebase-admin';

const router = express.Router();
const db = admin.firestore();

// Verify Helius signature
const verifySignature = (req) => {
  const signature = req.headers['x-helius-signature'];
  if (!signature) return false;
  // Verify using Helius public key (implement actual verification)
  return true; // Stub for demo
};

router.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;
  const nftMint = event.mint;
  const newOwner = event.newOwner;
  const isDelegated = event.isDelegated;

  console.log(`[Helius Webhook] Received event for NFT: ${nftMint}`);

  // Check if NFT is staked
  const stakeDoc = await db.collection('nft_stakes')
    .where('nftMint', '==', nftMint)
    .where('status', '==', 'staked')
    .limit(1)
    .get();

  if (stakeDoc.empty) {
    return res.status(200).send('NFT not staked');
  }

  const stakeRef = stakeDoc.docs[0].ref;
  const stakeData = stakeDoc.docs[0].data();

  // Forfeit if transferred or listed
  if (newOwner !== stakeData.walletAddress || isDelegated) {
    await stakeRef.update({
      status: 'forfeited',
      finalReward: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Helius Webhook] Marked NFT ${nftMint} as forfeited`);
  }

  res.status(200).send('Processed');
});

export default router;