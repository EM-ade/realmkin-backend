import axios from 'axios';
import { PublicKey } from '@solana/web3.js';
import { heliusRateLimiter } from '../utils/rateLimiter.js'; // Keep as ../ since this file is in services/ subdirectory
import nftCache from './nftCache.js';

class NFTVerificationService {
  constructor(client = null) {
    this.heliusApiKey = process.env.HELIUS_API_KEY;
    this.contractAddress = process.env.NFT_COLLECTION_ADDRESS;
    this.verifiedCreator = process.env.VERIFIED_CREATOR;
    this.rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;
    this.client = client;
  }

  /**
   * Validate if a string is a valid Solana wallet address
   */
  isValidSolanaAddress(address) {
    try {
      new PublicKey(address);
      return true;
    } catch (error) {
      console.warn(`Address ${address} is invalid: ${error.message}`);
      return false;
    }
  }

  /**
   * Retry helper with exponential backoff
   */
  async retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isRateLimitError =
          error.response?.status === 429 || error.message?.includes('429');

        const isLastAttempt = attempt === maxRetries;

        if (!isRateLimitError || isLastAttempt) {
          throw error;
        }

        const delay = baseDelay * Math.pow(2, attempt);
        const jitter = Math.random() * 500;
        const totalDelay = delay + jitter;

        console.warn(
          `Rate limited by Helius API (attempt ${attempt + 1}/${maxRetries + 1}). ` +
            `Retrying in ${Math.round(totalDelay)}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, totalDelay));
      }
    }
  }

  /**
   * Get all NFTs owned by a wallet address using RPC with pagination (same as old bot)
   */
  async getNFTsByOwner(walletAddress) {
    try {
      if (!this.isValidSolanaAddress(walletAddress)) {
        throw new Error('Invalid Solana wallet address');
      }

      // Check cache first
      const cached = nftCache.get(walletAddress);
      if (cached) {
        return cached;
      }

      let allNFTs = [];
      let page = 1;
      let hasMore = true;
      const limit = 1000;

      while (hasMore) {
        const fetchNFTs = async () => {
          const response = await axios.post(
            this.rpcUrl,
            {
              jsonrpc: '2.0',
              id: 'nft-verification',
              method: 'getAssetsByOwner',
              params: {
                ownerAddress: walletAddress,
                page: page,
                limit: limit,
                displayOptions: {
                  showFungible: false,
                  showNativeBalance: false,
                  showInscription: false,
                },
              },
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          if (response.data.error) {
            throw new Error(response.data.error.message || 'Helius API error');
          }

          return response.data.result || {};
        };

        const result = await this.retryWithBackoff(fetchNFTs);
        const items = result.items || [];

        allNFTs = allNFTs.concat(items);

        console.log(
          `[nft-verification] Fetched page ${page} for wallet ${walletAddress}: ${items.length} items (total: ${allNFTs.length})`
        );

        // Check if there are more pages
        hasMore = items.length === limit;

        if (hasMore) {
          page++;
          // Small delay between pages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      console.log(`[nft-verification] Total ${allNFTs.length} NFTs found for wallet ${walletAddress}`);

      // Cache the results
      nftCache.set(walletAddress, allNFTs);

      return allNFTs;
    } catch (error) {
      console.error('[nft-verification] Error fetching NFTs:', error.message);
      if (error.response?.data) {
        console.error('[nft-verification] Helius API error:', JSON.stringify(error.response.data));
      }
      throw error;
    }
  }

  /**
   * DEPRECATED: Old pagination-based method using RPC
   * Keeping for reference but not used anymore
   */
  async getNFTsByOwnerOld(walletAddress) {
    try {
      if (!this.isValidSolanaAddress(walletAddress)) {
        throw new Error('Invalid Solana wallet address');
      }

      let allNFTs = [];
      let page = 1;
      let hasMore = true;
      const limit = 1000;

      while (hasMore) {
        const fetchNFTs = async () => {
          const response = await axios.post(
            this.rpcUrl,
            {
              jsonrpc: '2.0',
              id: 'nft-verification',
              method: 'getAssetsByOwner',
              params: {
                ownerAddress: walletAddress,
                page: page,
                limit: limit,
                displayOptions: {
                  showFungible: false,
                  showNativeBalance: false,
                  showInscription: false,
                },
              },
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );

          if (response.data.error) {
            throw new Error(response.data.error.message || 'Helius API error');
          }

          return response.data.result || {};
        };

        const result = await this.retryWithBackoff(fetchNFTs);
        const items = result.items || [];

        allNFTs = allNFTs.concat(items);

        console.log(
          `Fetched page ${page} for wallet ${walletAddress}: ${items.length} items (total so far: ${allNFTs.length})`
        );

        // Check if there are more pages
        hasMore = items.length === limit;

        if (hasMore) {
          page++;
          // Add a small delay between pages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      console.log(
        `Fetched total of ${allNFTs.length} NFTs for wallet ${walletAddress} across ${page} page(s)`
      );
      return allNFTs;
    } catch (error) {
      console.error('Error fetching NFTs from Helius:', error.message);
      if (error.response) {
        console.error(
          'Helius API response:',
          error.response.status,
          error.response.data
        );
      }
      throw new Error(`Failed to fetch NFTs: ${error.message}`);
    }
  }

  /**
   * Extract contract identifiers from NFT
   */
  extractContractIdentifiers(nft) {
    const identifiers = new Set();

    if (nft.grouping) {
      for (const group of nft.grouping) {
        if (group?.group_key === 'collection' && group?.group_value) {
          identifiers.add(String(group.group_value).toLowerCase());
        }
      }
    }

    if (nft.collection?.address) {
      identifiers.add(String(nft.collection.address).toLowerCase());
    }

    if (nft.collection?.key) {
      identifiers.add(String(nft.collection.key).toLowerCase());
    }

    if (nft.mint) {
      identifiers.add(String(nft.mint).toLowerCase());
    }

    return identifiers;
  }

  /**
   * Check if NFT matches default config
   */
  matchesDefaultConfig(nft) {
    const hasVerifiedCreator = nft.creators?.some(
      (creator) =>
        this.verifiedCreator &&
        creator.address === this.verifiedCreator &&
        creator.verified
    );

    // Check multiple collection identification methods
    const collectionMatches = {
      groupingMatch: nft.grouping?.some(
        (group) =>
          group.group_key === 'collection' &&
          group.group_value === this.contractAddress
      ),
      collectionAddressMatch: nft.collection?.address === this.contractAddress,
      collectionKeyMatch: nft.collection?.key === this.contractAddress,
      collectionAddressLowerMatch:
        nft.collection?.address?.toLowerCase() ===
        this.contractAddress?.toLowerCase(),
      collectionKeyLowerMatch:
        nft.collection?.key?.toLowerCase() === this.contractAddress?.toLowerCase(),
    };

    const isFromCollection = Object.values(collectionMatches).some(Boolean);
    return Boolean(hasVerifiedCreator || isFromCollection);
  }

  /**
   * Verify NFT ownership for a user
   */
  async verifyNFTOwnership(walletAddress, { contractAddresses, verifiedCreators } = {}) {
    try {
      const allNFTs = await this.getNFTsByOwner(walletAddress);
      console.log(
        `Verifying NFT ownership for ${walletAddress}: ${allNFTs.length} total NFTs fetched`
      );

      const normalizedContracts = (contractAddresses || [])
        .filter(Boolean)
        .map((addr) => addr.toLowerCase());

      const normalizedCreators = (verifiedCreators || [])
        .filter(Boolean)
        .map((addr) => addr.toLowerCase());

      const matchedNFTs = [];
      const byContract = {};

      for (const nft of allNFTs) {
        const identifiers = this.extractContractIdentifiers(nft);
        const creatorMatch =
          normalizedCreators.length > 0
            ? nft.creators?.some(
                (creator) =>
                  normalizedCreators.includes(String(creator.address).toLowerCase()) &&
                  creator.verified
              )
            : false;

        let contractMatch = false;
        let matchedKey = null;

        if (normalizedContracts.length > 0) {
          for (const identifier of identifiers) {
            if (normalizedContracts.includes(identifier)) {
              contractMatch = true;
              matchedKey = identifier;
              break;
            }
          }
        }

        const defaultMatch =
          normalizedContracts.length === 0 &&
          normalizedCreators.length === 0 &&
          this.matchesDefaultConfig(nft);

        if (!(contractMatch || creatorMatch || defaultMatch)) {
          continue;
        }

        matchedNFTs.push(nft);

        const key =
          matchedKey ||
          (defaultMatch && this.contractAddress
            ? this.contractAddress.toLowerCase()
            : null);
        if (key) {
          byContract[key] = (byContract[key] || 0) + 1;
        }
      }

      const preparedNFTs = matchedNFTs.map((nft) => ({
        mint: nft.id,
        name: nft.content?.metadata?.name || 'Unknown NFT',
        image: nft.content?.links?.image || nft.content?.files?.[0]?.uri,
        description: nft.content?.metadata?.description,
        attributes: nft.content?.metadata?.attributes || [],
        collection: nft.collection,
        creators: nft.creators,
      }));

      const verificationResult = {
        isVerified: preparedNFTs.length > 0,
        nftCount: preparedNFTs.length,
        nfts: preparedNFTs,
        walletAddress: walletAddress,
        verifiedAt: new Date(),
        byContract,
      };

      console.log(
        `NFT verification for ${walletAddress}: ${
          verificationResult.isVerified ? 'VERIFIED' : 'NOT VERIFIED'
        } (${verificationResult.nftCount} NFTs)`
      );

      return verificationResult;
    } catch (error) {
      console.error('Error verifying NFT ownership:', error.message);
      throw error;
    }
  }

  /**
   * Get detailed NFT information by mint address
   */
  async getNFTDetails(mintAddress) {
    try {
      if (!this.isValidSolanaAddress(mintAddress)) {
        throw new Error('Invalid mint address');
      }

      const fetchDetails = async () => {
        const response = await axios.post(
          this.rpcUrl,
          {
            jsonrpc: '2.0',
            id: 'nft-details',
            method: 'getAsset',
            params: {
              id: mintAddress,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.data.error) {
          throw new Error(response.data.error.message || 'Helius API error');
        }

        return response.data.result;
      };

      return await this.retryWithBackoff(fetchDetails);
    } catch (error) {
      console.error('Error fetching NFT details:', error.message);
      throw new Error(`Failed to fetch NFT details: ${error.message}`);
    }
  }
}

export default NFTVerificationService;
