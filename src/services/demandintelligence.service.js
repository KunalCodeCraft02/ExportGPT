import askGroq from "./groq.service.js";
import logger from "../utils/logger.js";

// ─── Static demand intelligence database ─────────────────────────────────────
// In production, replace/augment with real trade API (e.g. UN Comtrade, APEDA)
const DEMAND_DATA = {
  onion: {
    topBuyers: [
      { country: "Malaysia",     avgPrice: "$280–320/MT",  season: "Year-round",   notes: "Prefers red variety" },
      { country: "Sri Lanka",    avgPrice: "$250–300/MT",  season: "Year-round",   notes: "Large & small red" },
      { country: "Bangladesh",   avgPrice: "$220–280/MT",  season: "Oct–Mar",      notes: "High volume demand" },
      { country: "UAE",          avgPrice: "$300–350/MT",  season: "Year-round",   notes: "Premium grades preferred" },
      { country: "Singapore",    avgPrice: "$310–360/MT",  season: "Year-round",   notes: "Strict quality standards" },
    ],
    peakExportMonths: "November to April",
    certifications: ["APEDA registration", "Phytosanitary certificate", "Certificate of Origin"],
    packagingRequirement: "25–50 kg mesh bags or jute bags",
  },
  turmeric: {
    topBuyers: [
      { country: "USA",          avgPrice: "$1,200–1,500/MT", season: "Year-round",  notes: "Organic preferred; FDA compliance needed" },
      { country: "UAE",          avgPrice: "$900–1,100/MT",   season: "Year-round",  notes: "Finger & bulb variety" },
      { country: "UK",           avgPrice: "$1,100–1,400/MT", season: "Year-round",  notes: "EU-standard residue limits" },
      { country: "Japan",        avgPrice: "$1,300–1,600/MT", season: "Year-round",  notes: "High curcumin content required" },
      { country: "Germany",      avgPrice: "$1,200–1,500/MT", season: "Year-round",  notes: "EU organic certification a plus" },
    ],
    peakExportMonths: "February to May",
    certifications: ["APEDA", "Organic certificate (if applicable)", "Phytosanitary cert", "Spices Board registration"],
    packagingRequirement: "25–50 kg PP bags, moisture-proof",
  },
  mango: {
    topBuyers: [
      { country: "UAE",          avgPrice: "$800–1,200/MT",   season: "Apr–Jun",     notes: "Alphonso & Kesar preferred" },
      { country: "UK",           avgPrice: "$1,000–1,500/MT", season: "Apr–Jun",     notes: "Requires cold chain" },
      { country: "USA",          avgPrice: "$1,200–1,800/MT", season: "May–Jul",     notes: "USDA irradiation required" },
      { country: "Qatar",        avgPrice: "$900–1,100/MT",   season: "Apr–Jun",     notes: "Premium Alphonso demand" },
      { country: "Netherlands",  avgPrice: "$950–1,300/MT",   season: "Apr–Jun",     notes: "EU entry point for Europe" },
    ],
    peakExportMonths: "April to June",
    certifications: ["APEDA", "Global GAP (preferred)", "Phytosanitary cert", "FSSAI"],
    packagingRequirement: "Corrugated cartons 2–5 kg, individual fruit wrapping",
  },
  rice: {
    topBuyers: [
      { country: "Iran",         avgPrice: "$450–520/MT",     season: "Year-round",  notes: "Basmati high demand" },
      { country: "Saudi Arabia", avgPrice: "$480–550/MT",     season: "Year-round",  notes: "Traditional basmati buyer" },
      { country: "USA",          avgPrice: "$600–750/MT",     season: "Year-round",  notes: "Premium basmati" },
      { country: "UAE",          avgPrice: "$500–580/MT",     season: "Year-round",  notes: "Large re-export hub" },
      { country: "UK",           avgPrice: "$580–650/MT",     season: "Year-round",  notes: "South Asian diaspora demand" },
    ],
    peakExportMonths: "October to March",
    certifications: ["APEDA", "GI tag (for Basmati)", "Phytosanitary cert", "Certificate of Origin"],
    packagingRequirement: "1–50 kg PP/HDPE bags",
  },
  soybean: {
    topBuyers: [
      { country: "China",        avgPrice: "$380–430/MT",     season: "Oct–Jan",     notes: "Largest global importer" },
      { country: "Bangladesh",   avgPrice: "$350–400/MT",     season: "Year-round",  notes: "Soybean meal demand" },
      { country: "Vietnam",      avgPrice: "$360–410/MT",     season: "Oct–Feb",     notes: "Feed industry use" },
      { country: "Japan",        avgPrice: "$420–480/MT",     season: "Year-round",  notes: "Food-grade soybean" },
    ],
    peakExportMonths: "October to February",
    certifications: ["APEDA", "Phytosanitary cert", "Non-GMO certificate"],
    packagingRequirement: "50 kg PP bags or bulk containers",
  },
  wheat: {
    topBuyers: [
      { country: "Bangladesh",   avgPrice: "$280–320/MT",     season: "Mar–Jun",     notes: "Durum and bread wheat" },
      { country: "Sri Lanka",    avgPrice: "$290–330/MT",     season: "Mar–Jun",     notes: "Milling quality preferred" },
      { country: "UAE",          avgPrice: "$310–360/MT",     season: "Year-round",  notes: "Re-export hub" },
      { country: "Yemen",        avgPrice: "$270–310/MT",     season: "Mar–Jun",     notes: "Aid and commercial" },
    ],
    peakExportMonths: "March to June",
    certifications: ["APEDA", "Phytosanitary cert", "Fumigation certificate"],
    packagingRequirement: "50 kg PP bags or bulk",
  },
  cotton: {
    topBuyers: [
      { country: "China",        avgPrice: "$1,600–1,800/MT", season: "Sep–Dec",     notes: "Major textile hub" },
      { country: "Bangladesh",   avgPrice: "$1,500–1,700/MT", season: "Year-round",  notes: "Garment industry" },
      { country: "Vietnam",      avgPrice: "$1,550–1,750/MT", season: "Year-round",  notes: "Fast-growing textile sector" },
      { country: "Indonesia",    avgPrice: "$1,480–1,680/MT", season: "Sep–Feb",     notes: "Textile and apparel" },
    ],
    peakExportMonths: "September to December",
    certifications: ["Textiles Committee certificate", "Phytosanitary cert", "Better Cotton Initiative (optional)"],
    packagingRequirement: "Compressed bales, standard export baling",
  },
  groundnut: {
    topBuyers: [
      { country: "Indonesia",    avgPrice: "$900–1,050/MT",   season: "Feb–May",     notes: "Food processing industry" },
      { country: "Vietnam",      avgPrice: "$880–1,020/MT",   season: "Year-round",  notes: "Roasted and raw" },
      { country: "Philippines",  avgPrice: "$920–1,060/MT",   season: "Year-round",  notes: "Snack food industry" },
      { country: "China",        avgPrice: "$950–1,100/MT",   season: "Year-round",  notes: "Peanut oil extraction" },
    ],
    peakExportMonths: "February to May",
    certifications: ["APEDA", "Aflatoxin test certificate", "Phytosanitary cert"],
    packagingRequirement: "50 kg PP bags, moisture-controlled",
  },
  pomegranate: {
    topBuyers: [
      { country: "Netherlands",  avgPrice: "$1,200–1,500/MT", season: "Sep–Jan",     notes: "EU distribution hub" },
      { country: "UAE",          avgPrice: "$1,100–1,400/MT", season: "Sep–Feb",     notes: "Premium Bhagwa variety" },
      { country: "UK",           avgPrice: "$1,300–1,600/MT", season: "Oct–Jan",     notes: "Supermarket chains" },
      { country: "Russia",       avgPrice: "$900–1,100/MT",   season: "Oct–Jan",     notes: "Large volume" },
    ],
    peakExportMonths: "September to January",
    certifications: ["APEDA", "Global GAP (preferred)", "Phytosanitary cert"],
    packagingRequirement: "2–5 kg corrugated cartons, individual wrapping",
  },
};

// ─── Export trend keywords for AI context ─────────────────────────────────────
const TREND_CONTEXT = {
  onion:       "India is the world's 2nd largest onion exporter. Export demand peaks Oct–Apr. Key buyers: Malaysia, Sri Lanka, Bangladesh, UAE.",
  turmeric:    "India accounts for ~80% of global turmeric production. Organic turmeric commands 30–40% premium. Key buyers: USA, EU, Middle East.",
  mango:       "India exports 50,000+ MT of mangoes annually. Alphonso is the most premium variety. USA requires USDA irradiation treatment.",
  rice:        "India is the world's largest rice exporter. Basmati GI tag adds value. Key markets: Iran, Saudi Arabia, UAE, USA.",
  soybean:     "Indian soybean exports growing due to non-GMO certification. China is largest buyer.",
  wheat:       "India resumes/pauses wheat exports based on domestic prices — check current policy before committing to contracts.",
  cotton:      "India is 2nd largest cotton producer. Quality consistency is key for repeat orders.",
  groundnut:   "Aflatoxin contamination is the #1 rejection reason — test every lot before export.",
  pomegranate: "Bhagwa variety from Maharashtra and Karnataka is internationally preferred.",
};

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Returns structured demand intelligence for a product.
 */
export function getProductDemandData(product) {
  const key = normalizeProductKey(product);
  return DEMAND_DATA[key] || null;
}

/**
 * Formats demand intelligence into a WhatsApp message.
 */
export function formatDemandIntelligence(product, data) {
  if (!data) {
    return (
      `❌ No demand data available for *${product}* yet.\n\n` +
      "Try: *onion*, *turmeric*, *mango*, *rice*, *soybean*, *wheat*, *cotton*, *groundnut*, *pomegranate*\n\n" +
      "Or type *DEMAND <your product>* and our AI will try to help."
    );
  }

  const buyerLines = data.topBuyers
    .map((b, i) => `${i + 1}. *${b.country}* — ${b.avgPrice}\n   📝 ${b.notes}`)
    .join("\n\n");

  const certs = data.certifications.join(", ");

  return (
    `🌍 *Global Demand Intelligence — ${capitalize(product)}*\n\n` +
    `🏆 *Top Buying Countries & Prices:*\n\n${buyerLines}\n\n` +
    `📅 *Peak Export Season:* ${data.peakExportMonths}\n\n` +
    `📦 *Packaging Required:* ${data.packagingRequirement}\n\n` +
    `📋 *Certifications Needed:* ${certs}\n\n` +
    `💡 Type *CAN I EXPORT ${product.toUpperCase()} TO <country>* for AI guidance.`
  );
}

/**
 * AI-powered export assistant — can I export X to Y?
 */
export async function getExportAssistantReply(question) {
  const normalizedQ = String(question || "").toLowerCase();

  // Enrich prompt with context if we have data for the product
  let contextBlock = "";
  for (const [key, trend] of Object.entries(TREND_CONTEXT)) {
    if (normalizedQ.includes(key)) {
      contextBlock = `\n\nContext about ${key}: ${trend}`;
      break;
    }
  }

  const prompt =
    `You are an Indian agricultural export expert assistant on a WhatsApp B2B marketplace. ` +
    `Answer the following export question concisely in plain text with emojis. ` +
    `Cover: legality/permissions, required certifications, packaging, typical price range, key tips. ` +
    `Keep answer under 300 words. If unsure about a regulation, say so clearly.` +
    contextBlock +
    `\n\nQuestion: ${question}`;

  try {
    const reply = await askGroq(prompt);
    return `🤖 *AI Export Assistant*\n\n${reply}\n\n_For official regulations, consult APEDA or DGFT._`;
  } catch (err) {
    logger.error(`Export assistant error: ${err.message}`);
    return "⚠️ AI assistant is temporarily unavailable. Please try again shortly.";
  }
}

/**
 * AI-powered export trend analysis
 */
export async function getExportTrendAnalysis(product) {
  const key = normalizeProductKey(product);
  const context = TREND_CONTEXT[key] || "";
  const data = DEMAND_DATA[key];

  const peakInfo = data ? `Peak season: ${data.peakExportMonths}.` : "";
  const buyerInfo = data
    ? `Top buyers: ${data.topBuyers.map((b) => b.country).join(", ")}.`
    : "";

  const prompt =
    `You are an agricultural trade analyst. Give a concise trend analysis for exporting *${product}* from India. ` +
    `Cover: current demand trends, price outlook, seasonal patterns, competing countries, opportunities. ` +
    `Keep it under 250 words. Use plain text with emojis.` +
    (context ? `\n\nContext: ${context} ${peakInfo} ${buyerInfo}` : "");

  try {
    const reply = await askGroq(prompt);
    return `📈 *Export Trend — ${capitalize(product)}*\n\n${reply}\n\n_Source: AI analysis based on trade data_`;
  } catch (err) {
    logger.error(`Trend analysis error: ${err.message}`);
    return "⚠️ Trend analysis is temporarily unavailable. Please try again shortly.";
  }
}

/**
 * Packaging guidance for a specific product
 */
export async function getPackagingGuidance(product, targetCountry = null) {
  const key = normalizeProductKey(product);
  const data = DEMAND_DATA[key];
  const packagingHint = data ? `Standard packaging: ${data.packagingRequirement}.` : "";
  const countryNote = targetCountry ? ` for export to ${targetCountry}` : "";

  const prompt =
    `You are an Indian agricultural export packaging expert. Give detailed packaging guidance for *${product}*${countryNote}. ` +
    `Cover: material, size/weight, labeling requirements, cold chain if applicable, common mistakes that cause rejection. ` +
    `Keep it under 250 words. Use plain text with emojis.` +
    (packagingHint ? `\n\nNote: ${packagingHint}` : "");

  try {
    const reply = await askGroq(prompt);
    return `📦 *Packaging Guidance — ${capitalize(product)}*\n\n${reply}\n\n_Proper packaging prevents 30–40% of export rejections._`;
  } catch (err) {
    logger.error(`Packaging guidance error: ${err.message}`);
    return "⚠️ Packaging guidance is temporarily unavailable. Please try again.";
  }
}

/**
 * Escrow / payment protection guidance
 */
export function getEscrowGuidance() {
  return (
    "🔐 *Payment Protection — How It Works*\n\n" +
    "ExportConnect recommends using escrow for safe transactions:\n\n" +
    "*Step 1 — Agreement*\n" +
    "Both farmer and exporter agree on price, quantity, and delivery terms.\n\n" +
    "*Step 2 — Escrow Funding*\n" +
    "Exporter deposits payment into a secure escrow account (not released to farmer yet).\n\n" +
    "*Step 3 — Delivery*\n" +
    "Farmer ships the product. Exporter confirms receipt and quality.\n\n" +
    "*Step 4 — Release*\n" +
    "Escrow releases payment to farmer automatically after confirmation.\n\n" +
    "*Step 5 — Dispute*\n" +
    "If there's a dispute, ExportConnect mediates and holds funds until resolved.\n\n" +
    "✅ *Benefits:* No advance payment risk for farmers. No quality fraud risk for exporters.\n\n" +
    "📞 To set up escrow for your deal, contact: *support@exportconnect.in*\n\n" +
    "💡 Type *ESCROW REQUEST* to request escrow protection for your current deal."
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function normalizeProductKey(product) {
  const aliases = {
    soyabin: "soybean", soybin: "soybean", soyabean: "soybean", soya: "soybean",
    kanda: "onion", pyaj: "onion", pyaz: "onion",
    tamatar: "tomato",
    batata: "potato",
    anar: "pomegranate",
  };
  const key = String(product || "").toLowerCase().trim();
  return aliases[key] || key;
}

function capitalize(str) {
  return String(str || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default {
  getProductDemandData,
  formatDemandIntelligence,
  getExportAssistantReply,
  getExportTrendAnalysis,
  getPackagingGuidance,
  getEscrowGuidance,
};