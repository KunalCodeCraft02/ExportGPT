import Exporter from "../models/Exporter.js";
import Farmer from "../models/Farmer.js";
import Buyer from "../models/Buyer.js";
import { updateState } from "./conversation.service.js";

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

export async function searchBuyers({ product, page = 1, limit = PAGE_SIZE } = {}) {
  // Buyer model uses "productsNeeded" (array), not "products"
  const query = buildProductQuery(product, ["productsNeeded", "companyName", "name"], buildApprovedQuery());
  const total = await Buyer.countDocuments(query);
  const buyers = await Buyer.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    total,
    page,
    limit,
    hasNextPage: page * limit < total,
    results: buyers,
  };
}

export async function formatExporterResults(searchResult) {
  const { total, page, limit, hasNextPage, results } = searchResult;
  if (!results.length) {
    return "❌ No exporters found.\n\nTry another product or complete exporter registration to grow the marketplace.";
  }

  const cards = results.map((exporter, index) => formatExporterCard(exporter, index + 1)).join("\n\n");
  const actionPrompt = results[0]
    ? `\n\nReply:\n1 -> Send Request to *${results[0].companyName}*\n2 -> Next exporter\nMORE -> More results`
    : "";
  const pagination = hasNextPage ? `\n\n📄 Page ${page} of results. Type *MORE* for the next ${limit}.` : "";

  return `🏢 *Exporters Found* (${total})\n\n${cards}${actionPrompt}${pagination}`;
}

export async function formatFarmerResults(searchResult) {
  const { total, page, limit, hasNextPage, results } = searchResult;
  if (!results.length) {
    return "❌ No farmers found.\n\nTry another product or complete farmer/seller registration to grow the marketplace.";
  }

  const cards = results.map((farmer, index) => formatFarmerCard(farmer, index + 1)).join("\n\n");
  const pagination = hasNextPage ? `\n\n📄 Page ${page} of results. Type *MORE* for the next ${limit}.` : "";

  return `🧑‍🌾 *Farmers / Sellers Found* (${total})\n\n${cards}${pagination}`;
}

export async function formatBuyerResults(searchResult) {
  const { total, page, limit, hasNextPage, results } = searchResult;
  if (!results.length) {
    return (
      "❌ No verified buyers found for this product.\n\n" +
      "Try:\n" +
      "• Another product\n" +
      "• Type *HELP* to see available commands\n" +
      "• Buyers may register later — check back soon"
    );
  }

  const cards = results.map((buyer, index) => formatBuyerCard(buyer, index + 1)).join("\n\n");
  const pagination = hasNextPage ? `\n\n📄 Page ${page} of results. Type *MORE* for the next ${limit}.` : "";

  return `🛒 *Buyers Found* (${total})\n\n${cards}${pagination}`;
}

export async function storeMarketplacePage(phone, searchType, product, page = 1, sourceRole = null, results = []) {
  const pageState = typeof searchType === "object" ? searchType : {
    searchType,
    product: product || null,
    page,
    sourceRole,
  };

  await updateState(phone, {
    currentStep: "marketplace_page",
    tempData: {
      ...pageState,
      exporters: pageState.searchType === "exporters" ? results : undefined,
      currentExporterIndex: 0,
    },
  });
}

export async function formatMoreResults(phone, state) {
  const pageState = state?.tempData || {};
  const searchType = pageState.searchType;
  const product = pageState.product;
  const nextPage = Number(pageState.page || 1) + 1;

  if (!searchType) {
    return "Type a search first, for example *FIND FARMERS onion* or *EXPORTERS onion*.";
  }

  if (searchType === "exporters") {
    const result = await searchExporters({ product, page: nextPage });
    await storeMarketplacePage(phone, searchType, product, nextPage, pageState.sourceRole, result.results);
    return formatExporterResults(result);
  }

  if (searchType === "farmers") {
    const result = await searchFarmers({ product, page: nextPage });
    await storeMarketplacePage(phone, searchType, product, nextPage, pageState.sourceRole);
    return formatFarmerResults(result);
  }

  return "Could not continue this search. Please search again.";
}

export function getProductsForRole(role, tempData = {}) {
  if (!role || !Array.isArray(tempData.products)) return [];
  return tempData.products;
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

function formatBuyerCard(buyer, index) {
  const location = [buyer.city, buyer.state, buyer.country].filter(Boolean).join(", ");
  const products = formatList(buyer.productsNeeded);
  const contact = [
    buyer.phone ? `☎ ${buyer.phone}` : null,
    buyer.email ? `📧 ${buyer.email}` : null,
  ].filter(Boolean).join("\n") || "📋 Contact not listed";

  return `*${index}. ${buyer.companyName || buyer.name}*\n` +
    `📍 ${location || "—"}\n` +
    `📦 Interested in: ${products || "—"}\n` +
    `📊 Quantity: ${buyer.quantityRequired || "—"}\n` +
    `💰 Target price: ${buyer.targetPrice || "—"}\n` +
    `📅 Delivery: ${buyer.deliveryTimeline || "—"}\n` +
    `💳 Payment: ${buyer.paymentTerms || "—"}\n` +
    `${contact}`;
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

// ─── AI Match Scoring ────────────────────────────────────────────────────────

export async function findMatchesForProduct(product) {
  const commodity = product.productName || product.products?.[0] || "";
  const location = [product.state, product.country].filter(Boolean);
  const certifications = product.certifications || [];

  const [buyers, exporters] = await Promise.all([
    Buyer.find(buildApprovedQuery())
      .where("productsNeeded").in(new RegExp(String(commodity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
      .lean(),
    Exporter.find(buildApprovedQuery())
      .where("products").in(new RegExp(String(commodity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))
      .lean(),
  ]);

  const buyerMatches = buyers.map((b) => ({
    match: b,
    type: "Buyer",
    score: calculateMatchScore(product, b, "Buyer"),
  }));

  const exporterMatches = exporters.map((e) => ({
    match: e,
    type: "Exporter",
    score: calculateMatchScore(product, e, "Exporter"),
  }));

  return [...buyerMatches, ...exporterMatches]
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 10);
}

export async function findMatchesForRequirement(requirement) {
  const commodity = requirement.commodity || "";
  const regex = new RegExp(String(commodity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const farmers = await Farmer.find({
    ...buildApprovedQuery(),
    products: regex,
  }).lean();

  return farmers
    .map((f) => ({
      match: f,
      type: "Farmer",
      score: calculateRequirementMatchScore(requirement, f),
    }))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, 10);
}

export function calculateMatchScore(product, buyer, buyerType) {
  let total = 0;

  const productCommodity = (product.productName || "").toLowerCase();
  const buyerProducts = buyerType === "Buyer"
    ? (buyer.productsNeeded || []).map((p) => p.toLowerCase())
    : (buyer.products || []).map((p) => p.toLowerCase());

  const commodityMatch = buyerProducts.some((p) =>
    p.includes(productCommodity) || productCommodity.includes(p)
  );
  if (commodityMatch) total += 25;

  const productState = (product.state || "").toLowerCase();
  const buyerState = (buyer.state || "").toLowerCase();
  const productCountry = (product.country || "").toLowerCase();
  const buyerCountry = (buyer.country || "").toLowerCase();

  if (productState && buyerState && productState === buyerState) {
    total += 20;
  } else if (productCountry && buyerCountry && productCountry === buyerCountry) {
    total += 10;
  }

  if (buyer.verified || buyer.verificationStatus === "approved") {
    total += 10;
  }

  if (buyer.overallRating > 0) {
    total += Math.min(Math.round((buyer.overallRating / 5) * 10), 10);
  }

  if (buyer.totalDeals > 0) {
    total += 5;
  }

  return {
    total: Math.min(total, 100),
    commodity: commodityMatch,
    location: productState === buyerState ? "same_state" : productCountry === buyerCountry ? "same_country" : "different",
    verified: buyer.verified || buyer.verificationStatus === "approved",
    rating: buyer.overallRating || 0,
  };
}

export function calculateRequirementMatchScore(requirement, farmer) {
  let total = 0;

  const reqCommodity = (requirement.commodity || "").toLowerCase();
  const farmerProducts = (farmer.products || []).map((p) => p.toLowerCase());

  const commodityMatch = farmerProducts.some((p) =>
    p.includes(reqCommodity) || reqCommodity.includes(p)
  );
  if (commodityMatch) total += 25;

  if (farmer.verified || farmer.verificationStatus === "approved") {
    total += 10;
  }

  if (farmer.overallRating > 0) {
    total += Math.min(Math.round((farmer.overallRating / 5) * 10), 10);
  }

  if (farmer.totalDeals > 0) {
    total += 5;
  }

  return {
    total: Math.min(total, 100),
    commodity: commodityMatch,
    verified: farmer.verified || farmer.verificationStatus === "approved",
    rating: farmer.overallRating || 0,
  };
}

export function formatMatchResults(matches) {
  if (!matches.length) {
    return "❌ No matching buyers/exporters found for this product.";
  }

  const cards = matches.map((m, i) => formatMatchCard(m, i + 1)).join("\n\n");
  return `🔍 *AI Matches Found* (${matches.length})\n\n${cards}\n\nReply *SELECT <number>* to send a proposal.`;
}

export function formatMatchCard(match, index) {
  const score = match.score;
  const stars = score.total >= 80 ? "★★★★★" : score.total >= 60 ? "★★★★☆" : score.total >= 40 ? "★★★☆☆" : "★★☆☆☆";
  const entity = match.match;
  const name = entity.companyName || entity.name || "Unknown";
  const location = [entity.state, entity.country].filter(Boolean).join(", ");

  return (
    `*${index}. ${name}* ${match.type}\n` +
    `${stars} ${score.total}% match\n` +
    `📍 ${location || "—"}\n` +
    (entity.products?.length ? `📦 ${(entity.productsNeeded || entity.products || []).join(", ")}\n` : "") +
    (score.verified ? "✅ Verified\n" : "") +
    (score.rating > 0 ? `⭐ Rating: ${score.rating}/5\n` : "")
  );
}
