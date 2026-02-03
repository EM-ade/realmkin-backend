import "dotenv/config";
import NFTVerificationService from "../services/nftVerification.js";

const WALLET_ADDRESS = "GqcsHDEJPRU6kc1uFyJDUf51MXwppNfSgNnYLQMej7PU";

async function main() {
  console.log(`🔍 Debugging NFTs for wallet: ${WALLET_ADDRESS}`);

  if (!process.env.HELIUS_API_KEY) {
    console.error("❌ HELIUS_API_KEY is missing in .env");
    process.exit(1);
  }

  const nftService = new NFTVerificationService();

  try {
    const nfts = await nftService.getNFTsByOwner(WALLET_ADDRESS);
    console.log(`✅ Found ${nfts.length} NFTs`);

    console.log("\n📋 NFT List:");
    nfts.forEach((nft, index) => {
      const id = nft.id || nft.mint;
      const name = nft.content?.metadata?.name || "Unknown";
      console.log(`${index + 1}. [${name}] - Mint: ${id}`);
    });
  } catch (error) {
    console.error("❌ Error fetching NFTs:", error);
  }
}

main();
