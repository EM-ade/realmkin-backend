/**
 * SOL Price Fetching Utility - IMPROVED
 * Fetches current SOL/USD price with:
 * - Multiple fallback providers (Jupiter, Binance, CoinGecko, Pyth)
 * - Timeout handling (5 seconds per request)
 * - Retry logic with exponential backoff
 * - HTTP status validation
 * - Price sanity checks
 */

let cachedPrice = { value: 0, timestamp: 0 };
const CACHE_DURATION = 60000; // 1 minute
const REQUEST_TIMEOUT = 5000; // 5 seconds
const DEFAULT_FALLBACK_PRICE = 140;

/**
 * Fetch with timeout - prevents hanging requests
 */
async function fetchWithTimeout(url, timeout = REQUEST_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out after ' + timeout + 'ms');
    }
    throw error;
  }
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = 2, label = 'request') {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        const delay = Math.pow(2, i) * 500; // 500ms, 1s, 2s
        console.warn(`[SOL Price] ${label} attempt ${i + 1} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * Validate price is reasonable
 */
function isValidPrice(price) {
  return typeof price === 'number' &&
    !isNaN(price) &&
    isFinite(price) &&
    price > 0 &&
    price < 10000; // SOL unlikely to be > $10,000
}

/**
 * Price provider configurations
 */
const priceProviders = [
  {
    name: 'Jupiter',
    fetch: async () => {
      const response = await fetchWithTimeout('https://price.jup.ag/v4/price?ids=SOL');
      const data = await response.json();
      return data.data?.SOL?.price;
    }
  },
  {
    name: 'Binance',
    fetch: async () => {
      const response = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
      const data = await response.json();
      return parseFloat(data.price);
    }
  },
  {
    name: 'CoinGecko',
    fetch: async () => {
      const response = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json();
      return data.solana?.usd;
    }
  },
  {
    name: 'Pyth',
    fetch: async () => {
      // Pyth Network Hermes API - SOL/USD price feed
      const response = await fetchWithTimeout('https://hermes.pyth.network/api/latest_price_feeds?ids[]=0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d');
      const data = await response.json();
      if (data[0]?.price?.price && data[0]?.price?.expo) {
        // Pyth returns price with exponent
        const price = parseFloat(data[0].price.price) * Math.pow(10, data[0].price.expo);
        return price;
      }
      return null;
    }
  }
];

/**
 * Fetches current SOL/USD price with caching and multiple fallbacks
 * @returns {Promise<number>} SOL price in USD
 */
async function getSolPriceUSD() {
  const now = Date.now();

  // Return cached price if fresh
  if (now - cachedPrice.timestamp < CACHE_DURATION && cachedPrice.value > 0) {
    console.log('[SOL Price] Using cached price: $' + cachedPrice.value.toFixed(2));
    return cachedPrice.value;
  }

  const failedProviders = [];

  // Try each provider in order with retry logic
  for (const provider of priceProviders) {
    try {
      const price = await withRetry(provider.fetch, 1, provider.name);

      if (isValidPrice(price)) {
        cachedPrice = { value: price, timestamp: now };
        console.log(`[SOL Price] Fetched from ${provider.name}: $${price.toFixed(2)}`);
        return price;
      } else {
        console.warn(`[SOL Price] ${provider.name} returned invalid price:`, price);
        failedProviders.push({ name: provider.name, error: 'Invalid price: ' + price });
      }
    } catch (err) {
      console.warn(`[SOL Price] ${provider.name} failed:`, err.message);
      failedProviders.push({ name: provider.name, error: err.message });
    }
  }

  // All providers failed - use fallback
  const fallbackPrice = cachedPrice.value > 0 ? cachedPrice.value : DEFAULT_FALLBACK_PRICE;
  console.error('[SOL Price] ALL PROVIDERS FAILED! Using fallback: $' + fallbackPrice.toFixed(2));
  console.error('[SOL Price] Failed providers:', JSON.stringify(failedProviders));

  return fallbackPrice;
}

/**
 * Calculate SOL amount needed for a USD target
 * @param {number} usdAmount - Target amount in USD (e.g., 2.0 for $2)
 * @returns {Promise<number>} - SOL amount needed
 */
async function calculateSolForUSD(usdAmount) {
  const solPrice = await getSolPriceUSD();
  const solAmount = usdAmount / solPrice;
  
  console.log(`💵 $${usdAmount} USD = ${solAmount.toFixed(4)} SOL (at $${solPrice}/SOL)`);
  
  return solAmount;
}

/**
 * Get fee amount in SOL for a given USD target
 * @param {number} usdAmount - Target fee in USD (default: 2.0)
 * @returns {Promise<Object>} - { solAmount, usdAmount, solPrice }
 */
async function getFeeInSol(usdAmount = 2.0) {
  const solPrice = await getSolPriceUSD();
  const solAmount = usdAmount / solPrice;
  
  return {
    solAmount,
    usdAmount,
    solPrice,
  };
}

export { getSolPriceUSD, calculateSolForUSD, getFeeInSol };
