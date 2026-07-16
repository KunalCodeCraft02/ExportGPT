import axios from "axios";
import logger from "../utils/logger.js";

const AGMARKNET_RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
const AGMARKNET_API_URL = `https://api.data.gov.in/resource/${AGMARKNET_RESOURCE_ID}`;

const PRICE_COMMAND_WORDS = [
  "price", "prices", "rate", "rates", "market",
  "daily", "today", "check", "mandi", "find", "show",
];

const COMMODITY_ALIASES = {
  soyabin: "Soyabean",
  soybin: "Soyabean",
  soybean: "Soyabean",
  soyabean: "Soyabean",
  soya: "Soyabean",
  onion: "Onion",
  kanda: "Onion",
  kande: "Onion",
  pyaj: "Onion",
  pyaaj: "Onion",
  pyaz: "Onion",
  pyaaz: "Onion",
  durdu: "Onion",
  potato: "Potato",
  batata: "Potato",
  tomato: "Tomato",
  tamatar: "Tomato",
  wheat: "Wheat",
  rice: "Rice",
  cotton: "Cotton",
  maize: "Maize",
  groundnut: "Groundnut",
  turmeric: "Turmeric",
  garlic: "Garlic",
  ginger: "Ginger",
  chilli: "Chilli",
  sugarcane: "Sugarcane",
  jowar: "Jowar",
  bajra: "Bajra",
  gram: "Gram",
  tur: "Tur",
  urad: "Urad",
  moong: "Moong",
  lentil: "Lentil",
  mustard: "Mustard",
  sunflower: "Sunflower",
  banana: "Banana",
  mango: "Mango",
  orange: "Orange",
  pomegranate: "Pomegranate",
  grapes: "Grapes",
  cauliflower: "Cauliflower",
  cabbage: "Cabbage",
  brinjal: "Brinjal",
  ladyfinger: "Bhindi(Ladies Finger)",
  bhindi: "Bhindi(Ladies Finger)",
  okra: "Bhindi(Ladies Finger)",
};

// ── Price cache for fallback when API is down ─────────────────────────────────
const priceCache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function getCachedPrice(commodity, state) {
  const key = `${commodity}:${state || "all"}`;
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.records;
  }
  return null;
}

function setCachedPrice(commodity, state, records) {
  const key = `${commodity}:${state || "all"}`;
  priceCache.set(key, { records, timestamp: Date.now() });
}

// ── Retry configuration ──────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const BASE_TIMEOUT = 30000; // 30 seconds

function isRetryableError(error) {
  const code = error.code;
  const status = error.response?.status;

  // Retry on timeout, network errors, and rate limits
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND") {
    return true;
  }
  if (status === 429 || status >= 500) {
    return true;
  }
  return false;
}

function getRetryDelay(attempt) {
  // Exponential backoff: 2s, 4s, 8s
  return Math.min(2000 * Math.pow(2, attempt - 1), 10000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractCommodityFromText(text) {
  const normalized = String(text || "").toLowerCase().trim();
  const words = normalized
    .split(/\s+/)
    .filter((w) => w && !PRICE_COMMAND_WORDS.includes(w));

  if (words.length === 0) return null;

  const joined = words.join(" ");

  // Direct alias match (multi-word or single)
  if (COMMODITY_ALIASES[joined]) return joined;

  // Single word alias match
  for (const word of words) {
    if (COMMODITY_ALIASES[word]) return word;
  }

  // Return whatever's left if something was typed after the command word
  return joined || null;
}

function resolveCommodityName(rawCommodity) {
  const key = String(rawCommodity || "").trim().toLowerCase();
  if (COMMODITY_ALIASES[key]) return COMMODITY_ALIASES[key];
  // Title-case fallback
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Core API call with retry logic ───────────────────────────────────────────
async function callAgmarknetApi(params) {
  const apiKey = process.env.AGMARKNET_API_KEY;
  if (!apiKey) {
    logger.error("AGMARKNET_API_KEY is not set — cannot fetch market prices.");
    throw new Error("AGMARKNET_API_KEY is not set");
  }

  const fullParams = { "api-key": apiKey, format: "json", limit: 10, ...params };
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const timeout = BASE_TIMEOUT + (attempt - 1) * 5000; // 30s, 35s, 40s

      logger.info(`Agmarknet API call attempt ${attempt}/${MAX_RETRIES} (timeout: ${timeout}ms)`);
      logger.info(`Request URL: ${AGMARKNET_API_URL}`);
      logger.info(`Query params: ${JSON.stringify({ ...fullParams, "api-key": "***" })}`);

      const startTime = Date.now();
      const response = await axios.get(AGMARKNET_API_URL, {
        params: fullParams,
        timeout,
      });
      const elapsed = Date.now() - startTime;

      logger.info(`Agmarknet API responded in ${elapsed}ms with status ${response.status}`);
      logger.info(`Response keys: ${Object.keys(response.data || {}).join(", ")}`);

      const records = response.data?.records || [];
      logger.info(`Agmarknet returned ${records.length} records`);

      if (records.length > 0) {
        logger.info(`First record: ${JSON.stringify(records[0]).substring(0, 200)}`);
      }

      return { records, responseTime: elapsed };
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const errorCode = error.code;
      const responseData = error.response?.data;

      // Log detailed error info
      logger.error(`Agmarknet API attempt ${attempt}/${MAX_RETRIES} failed:`);
      logger.error(`  Error code: ${errorCode || "none"}`);
      logger.error(`  Error name: ${error.name || "none"}`);
      logger.error(`  HTTP status: ${status || "none"}`);
      logger.error(`  Message: ${error.message}`);
      if (responseData) {
        logger.error(`  Response data: ${JSON.stringify(responseData).substring(0, 500)}`);
      }
      if (error.response?.headers) {
        logger.error(`  Response headers: ${JSON.stringify(error.response.headers)}`);
      }

      // Don't retry on auth errors
      if (status === 401 || status === 403) {
        logger.error("Agmarknet API key is invalid or unauthorized — check AGMARKNET_API_KEY.");
        throw new Error("API_KEY_INVALID");
      }

      // Don't retry on 400 (bad request)
      if (status === 400) {
        logger.error("Agmarknet API returned 400 Bad Request — check query parameters.");
        throw new Error("BAD_REQUEST");
      }

      // Retry on retryable errors
      if (attempt < MAX_RETRIES && isRetryableError(error)) {
        const waitMs = getRetryDelay(attempt);
        logger.warn(`Retrying in ${waitMs}ms...`);
        await delay(waitMs);
        continue;
      }

      // Non-retryable or max retries exceeded
      break;
    }
  }

  throw lastError;
}

// ── Public function: fetch commodity price with fallback ──────────────────────
export async function fetchCommodityPrice(rawCommodity, { state } = {}) {
  const commodity = resolveCommodityName(rawCommodity);

  try {
    const params = { "filters[commodity]": commodity };
    if (state) params["filters[state]"] = state;

    logger.info(`Fetching Agmarknet price for commodity: ${commodity}${state ? `, state: ${state}` : ""}`);

    const { records } = await callAgmarknetApi(params);

    // Cache successful results
    if (records.length > 0) {
      setCachedPrice(commodity, state, records);
    }

    return { records, commodity };
  } catch (error) {
    logger.error(`Agmarknet API failed for ${commodity}: ${error.message}`);

    // Try fallback: national data (without state filter)
    if (state) {
      try {
        logger.info(`Trying fallback: national data for ${commodity} (without state filter)`);
        const { records } = await callAgmarknetApi({ "filters[commodity]": commodity });
        if (records.length > 0) {
          setCachedPrice(commodity, null, records);
          return { records, commodity };
        }
      } catch (fallbackError) {
        logger.error(`Fallback (national) also failed for ${commodity}: ${fallbackError.message}`);
      }
    }

    // Try fallback: cached prices
    const cachedRecords = getCachedPrice(commodity, state) || getCachedPrice(commodity, null);
    if (cachedRecords && cachedRecords.length > 0) {
      logger.info(`Using cached price data for ${commodity} (${cachedRecords.length} records)`);
      return { records: cachedRecords, commodity, fromCache: true };
    }

    // All attempts failed
    if (error.message === "API_KEY_INVALID") {
      return { error: "config", commodity };
    }
    if (error.message === "BAD_REQUEST") {
      return { error: "request_failed", commodity };
    }

    return { error: "request_failed", commodity };
  }
}

// ── Diagnostic function for debugging API issues ─────────────────────────────
export async function diagnoseApiHealth() {
  const apiKey = process.env.AGMARKNET_API_KEY;
  const results = {
    apiKeyPresent: !!apiKey,
    endpoint: AGMARKNET_API_URL,
    timestamp: new Date().toISOString(),
    tests: [],
  };

  if (!apiKey) {
    results.error = "AGMARKNET_API_KEY is not set";
    return results;
  }

  // Test 1: Basic connectivity
  try {
    const startTime = Date.now();
    const response = await axios.get(AGMARKNET_API_URL, {
      params: { "api-key": apiKey, format: "json", limit: 1 },
      timeout: 30000,
    });
    const elapsed = Date.now() - startTime;

    results.tests.push({
      name: "Basic connectivity",
      status: "pass",
      responseTime: elapsed,
      httpStatus: response.status,
      recordsFound: (response.data?.records || []).length,
      sampleRecord: response.data?.records?.[0] || null,
    });
  } catch (error) {
    results.tests.push({
      name: "Basic connectivity",
      status: "fail",
      error: error.message,
      errorCode: error.code,
      httpStatus: error.response?.status,
      responseData: error.response?.data,
    });
  }

  // Test 2: Commodity filter
  try {
    const startTime = Date.now();
    const response = await axios.get(AGMARKNET_API_URL, {
      params: { "api-key": apiKey, format: "json", limit: 5, "filters[commodity]": "Onion" },
      timeout: 30000,
    });
    const elapsed = Date.now() - startTime;

    results.tests.push({
      name: "Commodity filter (Onion)",
      status: "pass",
      responseTime: elapsed,
      httpStatus: response.status,
      recordsFound: (response.data?.records || []).length,
    });
  } catch (error) {
    results.tests.push({
      name: "Commodity filter (Onion)",
      status: "fail",
      error: error.message,
      errorCode: error.code,
      httpStatus: error.response?.status,
    });
  }

  return results;
}

export function formatPriceResults(commodity, records, fromCache = false) {
  const cacheNote = fromCache ? "\n\n_Note: Showing cached data (API temporarily unavailable)_" : "";

  if (!records || records.length === 0) {
    return (
      `❌ No market price data found for *${commodity}* right now.\n\n` +
      "Today's mandi data may not be uploaded yet.\n\n" +
      "💡 Try common spellings:\n" +
      "• *onion*, *tomato*, *potato*\n" +
      "• *wheat*, *rice*, *maize*\n" +
      "• *soyabean*, *groundnut*, *mustard*\n" +
      "• *turmeric*, *chilli*, *garlic*" +
      cacheNote
    );
  }

  const cards = records
    .slice(0, 8)
    .map(
      (r) =>
        `📍 *${r.market || "—"}*, ${r.district || "—"}, ${r.state || "—"}\n` +
        `🧺 Variety: ${r.variety || "—"}\n` +
        `💰 Min ₹${r.min_price || "—"} | Max ₹${r.max_price || "—"} | Modal ₹${r.modal_price || "—"} per quintal\n` +
        `📅 ${r.arrival_date || "—"}`
    )
    .join("\n\n");

  return (
    `🌾 *Market Price — ${commodity}*\n\n` +
    `${cards}\n\n` +
    `_Source: Agmarknet, Ministry of Agriculture & Farmers Welfare, Govt. of India_${cacheNote}\n\n` +
    `📊 Type *PRICE <product>* to check another product.`
  );
}

export default {
  extractCommodityFromText,
  fetchCommodityPrice,
  formatPriceResults,
  diagnoseApiHealth,
};
