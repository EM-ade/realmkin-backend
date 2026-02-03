import "dotenv/config";

const WALLET_ADDRESS = "GqcsHDEJPRU6kc1uFyJDUf51MXwppNfSgNnYLQMej7PU";
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

async function main() {
  console.log(`🔍 Debugging NFTs for wallet: ${WALLET_ADDRESS}`);

  if (!HELIUS_API_KEY) {
    console.error("❌ HELIUS_API_KEY is missing in .env");
    process.exit(1);
  }

  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "debug-nft",
        method: "getAssetsByOwner",
        params: {
          ownerAddress: WALLET_ADDRESS,
          page: 1,
          limit: 100,
          displayOptions: {
            showFungible: false,
            showNativeBalance: false,
            showInscription: false,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      console.error("❌ Helius API error:", data.error);
      return;
    }

    const items = data.result?.items || [];
    console.log(`✅ Found ${items.length} NFTs`);

    console.log("\n📋 NFT List:");
    items.forEach((nft, index) => {
      const id = nft.id;
      const name = nft.content?.metadata?.name || "Unknown";
      console.log(`${index + 1}. [${name}] - Mint: ${id}`);
    });
  } catch (error) {
    console.error("❌ Error fetching NFTs:", error);
  }
}

main();
