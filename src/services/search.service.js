import Exporter from "../models/Exporter.js";
import Farmer from "../models/Farmer.js";

const PAGE_SIZE = 10;

const COMMAND_WORDS = [
  "find",
  "farmers",
  "farmer",
  "exporters",
  "exporter",
  "buyers",
  "buyer",
  "show",
  "want",
  "export",
  "to",
  "i",
  "for",
  "selling",
  "products",
];

const STOP_WORDS = [
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "in",
  "is",
  "it",
  "my",
  "need",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
];

export function extractProduct(message, fallbackProducts = []) {
  const normalized = normalizeText(message);
  const words = normalized
    .replace(/\b(farmers?|exporters?|buyers?|show|find|want|export|selling|products?)\b/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.includes(word) && !COMMAND_WORDS.includes(word));

  if (words.length > 0) return words.join(" ");
  if (Array.isArray(fallbackProducts) && fallbackProducts.length > 0) return fallbackProducts.join(", ");
  return null;
}

export async function searchExporters({ product, page = 1, limit = PAGE_SIZE } = {}) {
  const query = buildProductQuery(product, ["products", "companyName", "name"], buildApprovedQuery());
  const total = await Exporter.countDocuments(query);
  const exporters = await Exporter.find(query)
    .sort({ verified: -1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    total,
    page,
    limit,
    hasNextPage: page * limit < total,
    results: exporters,
  };
}

export async function searchFarmers({ product, page = 1, limit = PAGE_SIZE } = {}) {
  const query = buildProductQuery(product, ["products", "name", "district", "state"], buildApprovedQuery());
  const total = await Farmer.countDocuments(query);
  const farmers = await Farmer.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    total,
    page,
    limit,
    hasNextPage: page * limit < total,
    results: farmers,
  };
}

export function formatExporterResults(searchResult) {
  const { total, page, limit, hasNextPage, results } = searchResult;
  if (!results.length) {
    return "❌ No exporters found.\n\nTry another product or complete exporter registration to grow the marketplace.";
  }

  const cards = results.map((exporter, index) => formatExporterCard(exporter, index + 1)).join("\n\n");
  const pagination = hasNextPage ? `\n\n📄 Page ${page} of results. Type *MORE* for the next ${limit}.` : "";

  return `🏢 *Exporters Found* (${total})\n\n${cards}${pagination}`;
}

export function formatFarmerResults(searchResult) {
  const { total, page, limit, hasNextPage, results } = searchResult;
  if (!results.length) {
    return "❌ No farmers found.\n\nTry another product or complete farmer/seller registration to grow the marketplace.";
  }

  const cards = results.map((farmer, index) => formatFarmerCard(farmer, index + 1)).join("\n\n");
  const pagination = hasNextPage ? `\n\n📄 Page ${page} of results. Type *MORE* for the next ${limit}.` : "";

  return `🧑‍🌾 *Farmers / Sellers Found* (${total})\n\n${cards}${pagination}`;
}

function buildProductQuery(product, fields, baseQuery = {}) {
  if (!product) return baseQuery;

  const regex = new RegExp(escapeRegex(product), "i");
  return {
    ...baseQuery,
    $or: fields.map((field) => ({ [field]: { $regex: regex } })),
  };
}

function buildApprovedQuery() {
  return { $or: [{ verified: true }, { verificationStatus: "approved" }] };
}

function formatExporterCard(exporter, index) {
  const products = formatList(exporter.products);
  const countries = formatList(exporter.exportCountries);
  const contact = [
    exporter.phone ? `☎ ${exporter.phone}` : null,
    exporter.email ? `📧 ${exporter.email}` : null,
    exporter.website ? `🌐 ${exporter.website}` : null,
  ].filter(Boolean).join("\n") || "📋 Contact not listed";

  return `*${index}. ${exporter.companyName}*\n` +
    `🌍 ${countries || exporter.country || "—"}\n` +
    `📦 ${products || "—"}\n` +
    `🏭 Capacity: ${exporter.capacity || "—"}\n` +
    `${contact}`;
}

function formatFarmerCard(farmer, index) {
  const location = [farmer.village, farmer.district, farmer.state, farmer.country].filter(Boolean).join(", ");

  return `*${index}. ${farmer.name}*\n` +
    `📍 ${location || "—"}\n` +
    `📦 ${formatList(farmer.products) || "—"}\n` +
    `📦 Quantity: ${farmer.quantity || "—"}\n` +
    `💰 Expected price: ${farmer.expectedPrice || "—"}\n` +
    `📅 Harvest: ${farmer.harvestDate || "—"}\n` +
    `📦 Packaging: ${farmer.packagingType || "—"}\n` +
    `☎ ${farmer.phone || "—"}\n` +
    `📧 ${farmer.email || "—"}`;
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) return "";
  return values.join(", ");
}

function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default {
  extractProduct,
  searchExporters,
  searchFarmers,
  formatExporterResults,
  formatFarmerResults,
};
