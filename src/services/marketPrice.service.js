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

export async function fetchCommodityPrice(rawCommodity, { state } = {}) {
  const apiKey = process.env.AGMARKNET_API_KEY;
  if (!apiKey) {
    logger.error("AGMARKNET_API_KEY is not set — cannot fetch market prices.");
    return { error: "config", commodity: rawCommodity };
  }

  const commodity = resolveCommodityName(rawCommodity);

  try {
    const params = {
      "api-key": apiKey,
      format: "json",
      limit: 10,
      "filters[commodity]": commodity,
    };

    if (state) params["filters[state]"] = state;

    logger.info(`Fetching Agmarknet price for commodity: ${commodity}${state ? `, state: ${state}` : ""}`);

    const response = await axios.get(AGMARKNET_API_URL, {
      params,
      timeout: 10000,
    });

    const records = response.data?.records || [];
    logger.info(`Agmarknet returned ${records.length} records for ${commodity}`);
    return { records, commodity };
  } catch (error) {
    const status = error.response?.status;
    const apiError = error.response?.data?.error || error.response?.data || {};
    const isInvalidKey =
      status === 401 ||
      status === 403 ||
      apiError["Error Message"]?.toLowerCase().includes("unauthorized") ||
      apiError["Status Code"] === 401;

    if (isInvalidKey) {
      logger.error("Agmarknet API key is invalid or unauthorized — check AGMARKNET_API_KEY.");
      return { error: "config", commodity };
    }

    logger.error(`Agmarknet API error [${status || "unknown"}]: ${error.message}`);
    return { error: "request_failed", commodity };
  }
}

export function formatPriceResults(commodity, records) {
  if (!records || records.length === 0) {
    return (
      `❌ No market price data found for *${commodity}* right now.\n\n` +
      "Today's mandi data may not be uploaded yet.\n\n" +
      "💡 Try common spellings:\n" +
      "• *onion*, *tomato*, *potato*\n" +
      "• *wheat*, *rice*, *maize*\n" +
      "• *soyabean*, *groundnut*, *mustard*\n" +
      "• *turmeric*, *chilli*, *garlic*"
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
    `_Source: Agmarknet, Ministry of Agriculture & Farmers Welfare, Govt. of India_\n\n` +
    `📊 Type *PRICE <product>* to check another product.`
  );
}

export default {
  extractCommodityFromText,
  fetchCommodityPrice,
  formatPriceResults,
};