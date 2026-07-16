import { sendLocalizedMessage } from "../services/whatsapp.service.js";
import askGroq, { askGroqWithContext } from "../services/groq.service.js";
import path from "path";
import { fileURLToPath } from "url";
import BuyerLead from "../models/BuyerLead.js";
import Buyer from "../models/Buyer.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import User from "../models/User.js";
import {
  getWelcomeMessage,
  getHelpMessage,
  parseRoleChoice,
  parseLanguageChoice,
  getLanguagePrompt,
  startRegistration,
  resumeRegistration,
  handleRegistrationInput,
  parseRegistrationIntent,
  startRoleRegistration,
  getStatusMessage,
} from "../services/registration.service.js";
import {
  getState,
  updateState,
  isRegistrationStep,
  isProductRegistrationStep,
  ROLES,
  STEPS,
} from "../services/conversation.service.js";
import {
  extractProduct,
  formatExporterResults,
  formatFarmerResults,
  formatBuyerResults,
  searchExporters,
  searchFarmers,
  searchBuyers,
  storeMarketplacePage,
} from "../services/matching.service.js";
import {
  extractCommodityFromText,
  fetchCommodityPrice,
  formatPriceResults,
} from "../services/marketPrice.service.js";
import {
  startProductRegistration,
  handleProductRegistrationInput,
  handleProductImageStep,
  handleProductImageMessage,
  handleProductImageSkip,
  searchProducts,
  formatProductResults,
  formatProductDetail,
  PRODUCT_REGISTRATION_STEPS,
  PRODUCT_CATEGORY_MAP,
} from "../services/product.service.js";
import { analyzeMessage, buildContext, updateContext } from "../nlp/pipeline.js";
import {
  saveUserMessage,
  saveAssistantMessage,
  getConversationHistory,
  buildGroqMessages,
  summarizeContext,
} from "../services/chatMemory.service.js";
import { getLanguageInstruction } from "../services/groq.service.js";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Webhook verification (GET) ───────────────────────────────────────────────
export function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "Forbidden" });
}

// ─── Incoming message handler (POST) ─────────────────────────────────────────
export async function handleWebhook(req, res) {
  res.status(200).json({ status: "ok" });

  let phone;
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (value?.statuses) return;

    const message = value?.messages?.[0];
    if (!message) return;

    phone = message.from;

    if (message.type === "image") {
      const mediaId = message.image?.id;
      if (!mediaId) return;
      const imageUrl = await getMediaUrl(mediaId);
      if (!imageUrl) return;
      return handleImageMessage(phone, imageUrl);
    }

    const text = (message.text?.body || "").trim();

    if (!phone || !text) return;

    console.log(`[webhook] Phone: ${phone} | Text: "${text}"`);

    await routeMessage(phone, text);
  } catch (err) {
    console.error(`[webhook] Error: ${err.message}`);
    if (phone) {
      await sendLocalizedMessage(
        phone,
        "⚠️ Something went wrong. Please try again or type *HELP*."
      );
    }
  }
}

// ─── Main routing logic ───────────────────────────────────────────────────────
async function routeMessage(phone, text) {
  const normalized = text.trim().toUpperCase();
  const state = await getState(phone);

  // ── First-time users: no conversation state ──────────────────────────────
  if (!state) {
    const existingProfile = await findExistingProfile(phone);
    if (existingProfile) {
      await updateState(phone, {
        currentStep: STEPS.READY,
        role: existingProfile.role,
        tempData: { preferredLanguage: existingProfile.preferredLanguage || "english" },
      });

      if (existingProfile.status === "pending") {
        const statusMsg = getStatusMessage(existingProfile.role, "pending");
        return sendLocalizedMessage(phone, statusMsg);
      }
      if (existingProfile.status === "rejected") {
        const statusMsg = getStatusMessage(existingProfile.role, "rejected", existingProfile.rejectionReason);
        return sendLocalizedMessage(phone, statusMsg);
      }

      return sendLocalizedMessage(
        phone,
        `Welcome back, *${existingProfile.name}*! 👋\n\n` +
        `You're registered as a *${existingProfile.roleLabel}*.\n\n` +
        `Type *HELP* to see available commands.`
      );
    }

    await updateState(phone, {
      currentStep: STEPS.ROLE_SELECTION,
      role: null,
      tempData: {},
    });
    return sendLocalizedMessage(phone, getWelcomeMessage());
  }

  const { currentStep, role, tempData } = state;

  // ── Run NLP pipeline (language + intent + entities) ──────────────────────
  const userProfile = role ? await findExistingProfile(phone) : null;
  const context = buildContext(state, userProfile);
  const analysis = analyzeMessage(text, context, tempData.recentLanguages || []);
  const { intent, language, entities } = analysis;

  // Save user message to chat history
  await saveUserMessage(phone, text, analysis);

  // ── Global commands (available at any step) ──────────────────────────────
  if (normalized === "HELP" || intent === "help") {
    const reply = getHelpMessage();
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  if (normalized === "REGISTER" || intent === "register") {
    if (role) {
      const existingProfile = await findExistingProfile(phone);
      if (existingProfile && existingProfile.status === "rejected") {
        const reply = await startRoleRegistration(phone, role, state);
        return sendLocalizedMessage(phone, reply);
      }
      if (existingProfile && existingProfile.status === "pending") {
        const statusMsg = getStatusMessage(role, "pending");
        return sendLocalizedMessage(phone, statusMsg);
      }
      const reply = await resumeRegistration(phone, role, tempData || {});
      return sendLocalizedMessage(phone, reply);
    }
    await updateState(phone, {
      currentStep: STEPS.ROLE_SELECTION,
      role: null,
      tempData: {},
    });
    return sendLocalizedMessage(phone, getWelcomeMessage());
  }

  // Natural language registration intent (e.g., "I want to register as farmer")
  const registrationIntent = parseRegistrationIntent(text);
  if (registrationIntent) {
    const existingProfile = await findExistingProfile(phone);
    if (existingProfile && existingProfile.role === registrationIntent) {
      if (existingProfile.status === "rejected") {
        const reply = await startRoleRegistration(phone, registrationIntent, state);
        return sendLocalizedMessage(phone, reply);
      }
      if (existingProfile.status === "pending") {
        const statusMsg = getStatusMessage(registrationIntent, "pending");
        return sendLocalizedMessage(phone, statusMsg);
      }
    }
    const reply = await startRoleRegistration(phone, registrationIntent, state);
    return sendLocalizedMessage(phone, reply);
  }

  // ── Step-based routing (registration flows, multi-step processes) ────────
  // These MUST be preserved exactly — they are stateful flows.

  if (currentStep === STEPS.ROLE_SELECTION) {
    const chosenRole = parseRoleChoice(text);
    if (!chosenRole) {
      return sendLocalizedMessage(
        phone,
        "Please reply with:\n\n1️⃣ *1* — Farmer / Seller\n2️⃣ *2* — Exporter"
      );
    }
    await updateState(phone, {
      role: chosenRole,
      currentStep: STEPS.WAITING_FOR_LANGUAGE_SELECTION,
      tempData: { registrationTempData: {}, preferredLanguage: null },
    });
    return sendLocalizedMessage(phone, getLanguagePrompt());
  }

  if (currentStep === STEPS.WAITING_FOR_LANGUAGE_SELECTION) {
    return handleLanguageSelection(phone, role, text, tempData || {});
  }

  if (currentStep === STEPS.WAITING_FOR_LEAD_MESSAGE) {
    return handleLeadMessage(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_EXPORTER_RESPONSE) {
    return handleExporterResponse(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_PRICE_PRODUCT) {
    return handlePriceProductReply(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_PRODUCT_IMAGE) {
    if (normalized === "SKIP") {
      const reply = await handleProductImageSkip(phone, state);
      return sendLocalizedMessage(phone, reply);
    }
    return sendLocalizedMessage(
      phone,
      "📸 Please send a photo, or type *SKIP* to continue without one."
    );
  }

  if (isProductRegistrationStep(currentStep)) {
    const reply = await handleProductRegistrationInput(phone, text, state);
    return sendLocalizedMessage(phone, reply);
  }

  if (isRegistrationStep(currentStep)) {
    const reply = await handleRegistrationInput(phone, role, text, state);
    return sendLocalizedMessage(phone, reply);
  }

  // ── Registered user — intent-based routing ───────────────────────────────
  // Check verification status before allowing marketplace access
  if (role && currentStep === STEPS.READY) {
    const existingProfile = await findExistingProfile(phone);
    if (existingProfile && existingProfile.status === "pending") {
      const statusMsg = getStatusMessage(role, "pending");
      return sendLocalizedMessage(phone, statusMsg);
    }
    if (existingProfile && existingProfile.status === "rejected") {
      const statusMsg = getStatusMessage(role, "rejected", existingProfile.rejectionReason);
      return sendLocalizedMessage(phone, statusMsg);
    }
  }

  // ── Number shortcuts (reply "1" or "2" in context) ──────────────────────
  if (normalized === "1" && state.tempData?.searchType === "exporters") {
    return handleSendRequest(phone, state);
  }
  if (normalized === "2" && state.tempData?.searchType === "exporters") {
    return handleNextExporter(phone, state);
  }
  if (normalized === "MORE") {
    return handleMore(phone, state);
  }

  // ── Intent-based routing ─────────────────────────────────────────────────
  // Update context with NLP analysis
  const updatedTempData = updateContext(tempData, analysis);

  switch (intent) {
    case "greeting":
      return handleGreetingIntent(phone, role, language, state);

    case "market_price":
      return handlePriceIntent(phone, text, entities, language, state);

    case "farmer_search":
      return handleFarmerSearchIntent(phone, text, entities, state);

    case "exporter_search":
      return handleExporterSearchIntent(phone, text, entities, state);

    case "buyer_search":
      return handleBuyerSearchIntent(phone, text, entities, state);

    case "product_search":
      return handleProductSearchIntent(phone, text, state);

    case "demand_intelligence":
      return handleDemandIntent(phone, text, entities, language, state);

    case "register":
      return handleRegisterIntent(phone, role, state);

    case "trend":
      return handleTrendIntent(phone, text, entities, language, state);

    case "weather":
    case "crop_recommendation":
    case "government_scheme":
    case "logistics":
    case "payment":
    case "quality":
    case "packaging":
      return handleAIIntent(phone, text, intent, language, state);

    case "complaint":
    case "feedback":
      return handleAIIntent(phone, text, intent, language, state);

    case "goodbye":
      return handleGoodbyeIntent(phone, language, state);

    case "more":
      return handleMore(phone, state);

    case "skip":
      // If in a step that supports skip, let it fall through
      break;

    case "option_1":
    case "option_2":
    case "option_3":
      // Let number-based routing handle these
      break;

    case "unknown":
    default:
      // ── Fallback: use Groq AI with conversation history ──────────────────
      return handleAIFallback(phone, text, language, state, updatedTempData);
  }

  // ── Keyword fallback (backward compatibility) ────────────────────────────
  // If NLP didn't match but keyword patterns do, still route correctly.

  if (normalized === "ADD PRODUCT") {
    return handleAddProduct(phone, state);
  }
  if (normalized === "SHOW PRODUCTS" || normalized.startsWith("SHOW ")) {
    return handleShowProducts(phone, text, state);
  }
  if (normalized.startsWith("VIEW ")) {
    return handleViewProduct(phone, text, state);
  }
  if (/^(PRICE|PRICES?|RATE|RATES?|MANDI|MARKET\s*PRICE|DAILY\s*PRICE|CHECK\s*PRICE|MANDI\s*PRICE|MANDI\s*RATE)/.test(normalized)) {
    return handlePriceCommand(phone, text, state);
  }
  if (/^(FARMERS?|FIND\s*FARMER)/.test(normalized)) {
    return handleFarmerSearch(phone, text, state);
  }
  if (/^(BUYERS?|FIND\s*BUYER|SHOW\s*BUYER)/.test(normalized)) {
    return handleBuyerSearch(phone, text, state);
  }
  if (/^(EXPORTERS?|FIND\s*EXPORTER|SHOW\s*EXPORTER|I\s*WANT\s*TO\s*EXPORT)/.test(normalized)) {
    return handleExporterSearch(phone, text, state);
  }

  // ── Final fallback: Groq AI ──────────────────────────────────────────────
  return handleAIFallback(phone, text, language, state, updatedTempData);
}

// ─── Language selection ───────────────────────────────────────────────────────
async function handleLanguageSelection(phone, role, text, tempData = {}) {
  const preferredLanguage = parseLanguageChoice(text);
  if (!preferredLanguage) {
    return sendLocalizedMessage(
      phone,
      "Please choose your preferred language:\n\n1️⃣ English\n2️⃣ हिन्दी — Hindi\n3️⃣ मराठी — Marathi"
    );
  }

  const registrationTempData = {
    ...(tempData.registrationTempData || {}),
    preferredLanguage,
  };

  await updateState(phone, {
    role,
    currentStep: STEPS.READY,
    tempData: {
      ...tempData,
      registrationTempData,
      preferredLanguage,
    },
  });

  const reply = await startRegistration(phone, role, registrationTempData);
  return sendLocalizedMessage(phone, reply);
}

// ─── Send Request (farmer → exporter) ────────────────────────────────────────
async function handleSendRequest(phone, state) {
  const exporters = state.tempData?.exporters || [];
  const exporterIndex = Number(state.tempData?.currentExporterIndex || 0);
  const exporter = exporters[exporterIndex];

  if (!exporter) {
    return sendLocalizedMessage(
      phone,
      "No exporter is selected. Please search again, e.g. *FIND EXPORTERS onion*."
    );
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_LEAD_MESSAGE,
    tempData: {
      ...state.tempData,
      selectedExporterId: exporter._id,
      selectedExporter: exporter,
      currentExporterIndex: exporterIndex,
    },
  });

  return sendLocalizedMessage(
    phone,
    `✉️ Type your message for *${exporter.companyName}*.\n\nDescribe your product, quantity, and any other details you'd like to share.`
  );
}

// ─── Lead message (farmer types their pitch) ─────────────────────────────────
async function handleLeadMessage(phone, text, state) {
  const farmer = await Farmer.findOne({ phone }).lean();
  const exporterId = state.tempData?.selectedExporterId;
  const exporter = await Exporter.findById(exporterId).lean();

  if (!farmer) {
    return sendLocalizedMessage(
      phone,
      "Please complete farmer registration before sending a request."
    );
  }
  if (!exporter) {
    return sendLocalizedMessage(
      phone,
      "This exporter is no longer available. Please search again."
    );
  }

  const message = String(text || "").trim();
  if (!message) {
    return sendLocalizedMessage(phone, "Please type your message for the exporter.");
  }

  const lead = await BuyerLead.create({
    farmerId: farmer._id,
    exporterId: exporter._id,
    product: state.tempData?.product || null,
    message,
    status: "pending",
  });

  await updateState(phone, {
    currentStep: STEPS.READY,
    tempData: {
      ...(state.tempData || {}),
      selectedExporterId: null,
      selectedExporter: null,
    },
  });

  await notifyExporterOfLead(lead, farmer, exporter, state.tempData?.product);

  return sendLocalizedMessage(
    phone,
    `✅ Your request has been sent to *${exporter.companyName}*.\n\nWe will notify you when they respond.`
  );
}

// ─── Exporter response (accept / reject) ─────────────────────────────────────
async function handleExporterResponse(phone, text, state) {
  const leadId = state.tempData?.leadId;
  const action = String(text || "").trim().toLowerCase();

  const normalizedAction =
    action.startsWith("1") || action.startsWith("accept")
      ? "accept"
      : action.startsWith("2") || action.startsWith("reject")
      ? "reject"
      : null;

  if (!normalizedAction) {
    return sendLocalizedMessage(phone, "Please reply with:\n\n1 Accept\n2 Reject");
  }

  const lead = await BuyerLead.findById(leadId)
    .populate("farmerId")
    .populate("exporterId")
    .lean();

  if (!lead) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(
      phone,
      "This request has expired. Please ask the farmer to send a new request."
    );
  }

  const status = normalizedAction === "accept" ? "accepted" : "rejected";
  await BuyerLead.findByIdAndUpdate(leadId, { status });
  await updateState(phone, { currentStep: STEPS.READY, tempData: {} });

  if (status === "accepted") {
    await sendLocalizedMessage(
      lead.farmerId.phone,
      `✅ *${lead.exporterId.companyName}* accepted your request!\n\n` +
        `📞 Phone: ${lead.exporterId.phone || "Not listed"}\n` +
        `📧 Email: ${lead.exporterId.email || "Not listed"}`
    );
    return sendLocalizedMessage(
      phone,
      "✅ Accepted. The farmer has been notified with your contact details."
    );
  }

  await sendLocalizedMessage(
    lead.farmerId.phone,
    `❌ *${lead.exporterId.companyName}* rejected your request.\n\nYou can search for another exporter.`
  );
  return sendLocalizedMessage(phone, "❌ Rejected. The farmer has been notified.");
}

// ─── Next exporter (reply "2") ────────────────────────────────────────────────
async function handleNextExporter(phone, state) {
  const exporters = state.tempData?.exporters || [];
  const currentIndex = Number(state.tempData?.currentExporterIndex || 0);
  const nextIndex = currentIndex + 1;

  if (nextIndex >= exporters.length) {
    return handleMore(phone, state);
  }

  await updateState(phone, {
    currentStep: STEPS.MARKETPLACE_PAGE,
    tempData: {
      ...state.tempData,
      currentExporterIndex: nextIndex,
    },
  });

  const nextExporter = exporters[nextIndex];
  const formatted = await formatExporterResults({
    total: exporters.length,
    page: state.tempData.page || 1,
    limit: exporters.length,
    hasNextPage: false,
    results: [nextExporter],
  });
  return sendLocalizedMessage(phone, formatted);
}

// ─── Notify exporter of new lead ──────────────────────────────────────────────
async function notifyExporterOfLead(lead, farmer, exporter, product) {
  const location = [farmer.village, farmer.district, farmer.state, farmer.country]
    .filter(Boolean)
    .join(", ");

  const message =
    "🔔 New Farmer Request\n\n" +
    "Farmer:\n" +
    `${farmer.name}\n\n` +
    "Location:\n" +
    `${location || "Not listed"}\n\n` +
    "Product:\n" +
    `${product || (Array.isArray(farmer.products) ? farmer.products.join(", ") : "Not listed")}\n\n` +
    "Message:\n" +
    `${lead.message}\n\n` +
    "Reply:\n" +
    "1 Accept\n" +
    "2 Reject";

  // Preserve any existing exporter state so we don't wipe mid-browse context
  const exporterState = await getState(exporter.phone);

  await updateState(exporter.phone, {
    role: ROLES.EXPORTER,
    currentStep: STEPS.WAITING_FOR_EXPORTER_RESPONSE,
    tempData: {
      ...(exporterState?.tempData || {}),
      leadId: lead._id,
      farmerPhone: farmer.phone,
    },
  });

  return sendLocalizedMessage(exporter.phone, message);
}

// ─── Daily market price handlers ──────────────────────────────────────────────
async function handlePriceCommand(phone, text, state) {
  const commodity = extractCommodityFromText(text);

  if (!commodity) {
    // No product typed yet — ask for it
    await updateState(phone, {
      role: state.role,
      currentStep: STEPS.WAITING_FOR_PRICE_PRODUCT,
      tempData: state.tempData || {},
    });
    return sendLocalizedMessage(
      phone,
      "🌾 Which product's price would you like to check?\n\n" +
        "Examples: *onion*, *soyabean*, *wheat*, *tomato*, *potato*, *turmeric*"
    );
  }

  return sendPriceForCommodity(phone, commodity, state);
}

async function handlePriceProductReply(phone, text, state) {
  const commodity = String(text || "").trim();
  if (!commodity) {
    return sendLocalizedMessage(
      phone,
      "Please type a product name, e.g. *onion* or *soyabean*."
    );
  }
  return sendPriceForCommodity(phone, commodity, state);
}

async function sendPriceForCommodity(phone, rawCommodity, state) {
  // Try state-specific prices first (more relevant for the user)
  const farmer = await Farmer.findOne({ phone }).select("state").lean();

  let { records, commodity, error, fromCache } = await fetchCommodityPrice(rawCommodity, {
    state: farmer?.state,
  });

  // Fall back to national data if nothing found for user's state
  if (!error && (!records || records.length === 0) && farmer?.state) {
    ({ records, commodity, error, fromCache } = await fetchCommodityPrice(rawCommodity));
  }

  // Reset step back to READY
  await updateState(phone, {
    role: state.role,
    currentStep: STEPS.READY,
    tempData: state.tempData || {},
  });

  if (error === "config") {
    return sendLocalizedMessage(
      phone,
      "⚠️ Market price lookup is not configured yet. Please contact support."
    );
  }
  if (error) {
    return sendLocalizedMessage(
      phone,
      "⚠️ Could not fetch market prices right now. Please try again shortly."
    );
  }

  return sendLocalizedMessage(phone, formatPriceResults(commodity, records, fromCache));
}

// ─── Search handlers ──────────────────────────────────────────────────────────
async function handleExporterSearch(phone, text, state) {
  const product =
    extractProduct(text) ||
    state.tempData?.registrationTempData?.products?.[0] ||
    state.tempData?.products?.[0] ||
    null;

  const result = await searchExporters({ product, page: 1 });
  const formatted = await formatExporterResults(result);

  await storeMarketplacePage(phone, "exporters", product, 1, state.role, result.results);

  return sendLocalizedMessage(phone, formatted);
}

async function handleFarmerSearch(phone, text, state) {
  const product =
    extractProduct(text) ||
    state.tempData?.registrationTempData?.products?.[0] ||
    state.tempData?.products?.[0] ||
    null;

  const result = await searchFarmers({ product, page: 1 });
  const formatted = await formatFarmerResults(result);

  await storeMarketplacePage(phone, "farmers", product, 1, state.role);

  return sendLocalizedMessage(phone, formatted);
}

async function handleBuyerSearch(phone, text, state) {
  const product =
    extractProduct(text) ||
    state.tempData?.registrationTempData?.products?.[0] ||
    state.tempData?.products?.[0] ||
    null;

  const result = await searchBuyers({ product, page: 1 });
  const formatted = await formatBuyerResults(result);

  await storeMarketplacePage(phone, "buyers", product, 1, state.role);

  return sendLocalizedMessage(phone, formatted);
}

async function handleMore(phone, state) {
  if (!state.tempData?.searchType) {
    return sendLocalizedMessage(
      phone,
      "No previous search found. Try *EXPORTERS* or *FIND FARMERS* first."
    );
  }

  const { searchType, page } = state.tempData;
  const product =
    state.tempData.product ||
    state.tempData.registrationTempData?.products?.[0] ||
    state.tempData.products?.[0] ||
    null;
  const nextPage = (page || 1) + 1;

  if (searchType === "exporters") {
    const result = await searchExporters({ product, page: nextPage });
    const formatted = await formatExporterResults(result);
    await storeMarketplacePage(phone, "exporters", product, nextPage, state.role, result.results);
    return sendLocalizedMessage(phone, formatted);
  }

  if (searchType === "farmers") {
    const result = await searchFarmers({ product, page: nextPage });
    const formatted = await formatFarmerResults(result);
    await storeMarketplacePage(phone, "farmers", product, nextPage, state.role);
    return sendLocalizedMessage(phone, formatted);
  }

  if (searchType === "buyers") {
    const result = await searchBuyers({ product, page: nextPage });
    const formatted = await formatBuyerResults(result);
    await storeMarketplacePage(phone, "buyers", product, nextPage, state.role);
    return sendLocalizedMessage(phone, formatted);
  }

  if (searchType === "products") {
    const result = await searchProducts({ product, page: nextPage });
    const formatted = formatProductResults(result);
    await updateState(phone, {
      currentStep: STEPS.MARKETPLACE_PAGE,
      tempData: {
        ...(state.tempData || {}),
        searchType: "products",
        product,
        page: nextPage,
        products: result.results,
      },
    });
    return sendLocalizedMessage(phone, formatted);
  }
}

// ─── Product marketplace handlers ────────────────────────────────────────────
async function handleAddProduct(phone, state) {
  if (!state.role) {
    return sendLocalizedMessage(
      phone,
      "Please complete your registration first before adding products.\n\nType *REGISTER* to get started."
    );
  }
  const reply = await startProductRegistration(phone, state);
  return sendLocalizedMessage(phone, reply);
}

async function handleShowProducts(phone, text, state) {
  const searchTerm = (text || "").trim().replace(/^SHOW\s+/i, "").trim() || null;
  const result = await searchProducts({ product: searchTerm, page: 1 });
  const formatted = formatProductResults(result);

  await updateState(phone, {
    currentStep: STEPS.MARKETPLACE_PAGE,
    tempData: {
      ...(state.tempData || {}),
      searchType: "products",
      product: null,
      page: 1,
      products: result.results,
    },
  });

  return sendLocalizedMessage(phone, formatted);
}

async function handleShowProductSearch(phone, text, state) {
  const searchTerm = text.trim().replace(/^SHOW\s+/i, "").trim();
  if (!searchTerm) {
    return handleShowProducts(phone, state);
  }

  const result = await searchProducts({ product: searchTerm, page: 1 });
  const formatted = formatProductResults(result);

  await updateState(phone, {
    currentStep: STEPS.MARKETPLACE_PAGE,
    tempData: {
      ...(state.tempData || {}),
      searchType: "products",
      product: searchTerm,
      page: 1,
      products: result.results,
    },
  });

  return sendLocalizedMessage(phone, formatted);
}

async function handleViewProduct(phone, text, state) {
  const number = parseInt(text.trim().replace(/^VIEW\s+/i, ""), 10);
  if (isNaN(number) || number < 1) {
    return sendLocalizedMessage(phone, "Please type *VIEW 1* or *VIEW 2* to see product details.");
  }

  const products = state.tempData?.products || [];
  const product = products[number - 1];

  if (!product) {
    return sendLocalizedMessage(
      phone,
      "Product not found. Please search again with *SHOW PRODUCTS*."
    );
  }

  const formatted = await formatProductDetail(product);
  return sendLocalizedMessage(phone, formatted);
}

async function handleImageMessage(phone, imageUrl) {
  const state = await getState(phone);
  if (!state) return;

  if (state.currentStep === STEPS.WAITING_FOR_PRODUCT_IMAGE) {
    const reply = await handleProductImageMessage(phone, imageUrl, state);
    return sendLocalizedMessage(phone, reply);
  }
}

async function getMediaUrl(mediaId) {
  try {
    const metaResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        },
        params: { fields: "url, mime_type" },
      }
    );

    const temporaryUrl = metaResponse.data?.url;
    if (!temporaryUrl) return null;

    const imageResponse = await axios.get(temporaryUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      },
    });

    const mime = imageResponse.headers["content-type"] || "image/jpeg";
    const ext = mime.includes("png") ? ".png" : ".jpg";
    const filename = `${mediaId}${ext}`;
    const filePath = path.join(__dirname, "..", "..", "uploads", "products", filename);

    const fs = await import("fs");
    fs.writeFileSync(filePath, Buffer.from(imageResponse.data));

    return `/uploads/products/${filename}`;
  } catch (error) {
    console.error(`[webhook] getMediaUrl failed: ${error.message}`);
    return null;
  }
}

// ─── Detect returning users by phone number ──────────────────────────────────
async function findExistingProfile(phone) {
  const [farmer, exporter, buyer] = await Promise.all([
    Farmer.findOne({ phone }).lean(),
    Exporter.findOne({ phone }).lean(),
    Buyer.findOne({ phone }).lean(),
  ]);

  if (farmer) {
    return {
      role: ROLES.FARMER,
      roleLabel: "Farmer / Seller",
      name: farmer.name,
      preferredLanguage: farmer.preferredLanguage,
      status: farmer.verificationStatus || "pending",
      rejectionReason: farmer.rejectionReason,
    };
  }

  if (exporter) {
    return {
      role: ROLES.EXPORTER,
      roleLabel: "Exporter",
      name: exporter.name,
      preferredLanguage: exporter.preferredLanguage,
      status: exporter.verificationStatus || "pending",
      rejectionReason: exporter.rejectionReason,
    };
  }

  if (buyer) {
    return {
      role: ROLES.BUYER,
      roleLabel: "Buyer",
      name: buyer.name,
      preferredLanguage: buyer.preferredLanguage,
      status: buyer.verificationStatus || "pending",
      rejectionReason: buyer.rejectionReason,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Intent-based handlers (NLP pipeline) ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleGreetingIntent(phone, role, language, state) {
  const greetings = {
    english: role
      ? `Hello! 👋 How can I help you today?\n\nType *HELP* to see available commands.`
      : `Hello! 👋 Welcome to *ExportConnect* — B2B Agriculture Marketplace!\n\nI connect farmers/sellers directly with exporters and buyers.\n\nPlease tell me who you are:\n\n1️⃣ *Farmer / Seller*\n2️⃣ *Exporter*\n3️⃣ *Buyer*\n\nReply with *1*, *2*, or *3* 👇`,
    hindi: role
      ? `नमस्ते! 👋 आज मैं आपकी कैसे मदद कर सकता हूँ?\n\nसभी कमांड देखने के लिए *HELP* टाइप करें।`
      : `नमस्ते! 👋 *ExportConnect* में आपका स्वागत है!\n\nमैं किसानों/विक्रेताओं को निर्यातकों और खरीददारों से जोड़ता हूँ।\n\nकृपया बताएं आप कौन हैं:\n\n1️⃣ *किसान / विक्रेता*\n2️⃣ *निर्यातक*\n3️⃣ *खरीददार*\n\n*1*, *2*, या *3* टाइप करें 👇`,
    marathi: role
      ? `नमस्कार! 👆 आज मी तुम्हाला कशी मदत करू शकतो?\n\nसर्व कमांड पाहण्यासाठी *HELP* टाइप करा.`
      : `नमस्कार! 👋 *ExportConnect* मध्ये आपले स्वागत आहे!\n\nमी शेतकऱ्यांना/विक्रेत्यांना निर्यातदार आणि खरेदीदारांशी जोडतो.\n\nकृपया सांगा तुम्ही कोण आहात:\n\n1️⃣ *शेतकरी / विक्रेता*\n2️⃣ *निर्यातदार*\n3️⃣ *खरेदीदार*\n\n*1*, *2*, किंवा *3* टाइप करा 👇`,
    hinglish: role
      ? `Hello! 👋 Aaj main aapki kaise help kar sakta hoon?\n\nSaare commands dekhne ke liye *HELP* type karein.`
      : `Hello! 👋 *ExportConnect* mein aapka swagat hai!\n\nMain farmers/sellers ko exporters aur buyers se jodta hoon.\n\nPlease bataiye aap kaun hain:\n\n1️⃣ *Farmer / Seller*\n2️⃣ *Exporter*\n3️⃣ *Buyer*\n\n*1*, *2*, ya *3* type karein 👇`,
  };

  const reply = greetings[language] || greetings.english;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handlePriceIntent(phone, text, entities, language, state) {
  // Use NLP-extracted commodity, or fall back to text extraction
  const commodity = entities.commodity || extractCommodityFromText(text);
  if (!commodity) {
    // Ask which product
    await updateState(phone, {
      role: state.role,
      currentStep: STEPS.WAITING_FOR_PRICE_PRODUCT,
      tempData: state.tempData || {},
    });
    const askMsg = {
      english: "🌾 Which product's price would you like to check?\n\nExamples: *onion*, *soyabean*, *wheat*, *tomato*, *potato*, *turmeric*",
      hindi: "🌾 आप किस प्रोडक्ट का भाव जानना चाहेंगे?\n\nउदाहरण: *onion*, *soyabean*, *wheat*, *tomato*, *potato*, *turmeric*",
      hinglish: "🌾 Aap kis product ka price jaanna chahte hain?\n\nExamples: *onion*, *soyabean*, *wheat*, *tomato*, *potato*, *turmeric*",
      marathi: "🌾 तुम्हाला कोणत्या उत्पादनाचा भाव जाणून घ्यायचा आहे?\n\nउदाहरणे: *onion*, *soyabean*, *wheat*, *tomato*, *potato*, *turmeric*",
    };
    const reply = askMsg[language] || askMsg.english;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }
  return sendPriceForCommodity(phone, commodity, state);
}

async function handleFarmerSearchIntent(phone, text, entities, state) {
  const product = entities.commodity || extractProduct(text);
  const result = await searchFarmers({ product, page: 1 });
  const formatted = await formatFarmerResults(result);
  await storeMarketplacePage(phone, "farmers", product, 1, state.role);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

async function handleBuyerSearchIntent(phone, text, entities, state) {
  const product = entities.commodity || extractProduct(text);
  const result = await searchBuyers({ product, page: 1 });
  const formatted = await formatBuyerResults(result);
  await storeMarketplacePage(phone, "buyers", product, 1, state.role);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

async function handleExporterSearchIntent(phone, text, entities, state) {
  const product = entities.commodity || extractProduct(text);
  const result = await searchExporters({ product, page: 1 });
  const formatted = await formatExporterResults(result);
  await storeMarketplacePage(phone, "exporters", product, 1, state.role, result.results);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

async function handleProductSearchIntent(phone, text, state) {
  const searchTerm = text.trim().replace(/^(show|search|find|browse)\s*/i, "").trim();
  const result = await searchProducts({ product: searchTerm || null, page: 1 });
  const formatted = formatProductResults(result);
  await updateState(phone, {
    currentStep: STEPS.MARKETPLACE_PAGE,
    tempData: { ...(state.tempData || {}), searchType: "products", product: searchTerm, page: 1, products: result.results },
  });
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

async function handleDemandIntent(phone, text, entities, language, state) {
  // Route to the demand intelligence module
  const { getProductDemandData, formatDemandIntelligence, getExportAssistantReply } = await import("../services/demandintelligence.service.js");
  const commodity = entities.commodity || extractCommodityFromText(text);

  // Check if it's an export question (e.g., "Can I export mango to Dubai")
  if (text.toLowerCase().includes("can i export") || text.toLowerCase().includes("export guide") || text.toLowerCase().includes("export document")) {
    const reply = await getExportAssistantReply(text);
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  // Check if it's a demand query
  if (commodity) {
    const data = getProductDemandData(commodity);
    const reply = formatDemandIntelligence(commodity, data);
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  // General export question — use AI
  const reply = await getExportAssistantReply(text);
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleRegisterIntent(phone, role, state) {
  if (role) {
    const existingProfile = await findExistingProfile(phone);
    if (existingProfile && existingProfile.status === "rejected") {
      const reply = await startRoleRegistration(phone, role, state);
      return sendLocalizedMessage(phone, reply);
    }
    if (existingProfile && existingProfile.status === "pending") {
      const statusMsg = getStatusMessage(role, "pending");
      return sendLocalizedMessage(phone, statusMsg);
    }
    const reply = await resumeRegistration(phone, role, state.tempData || {});
    return sendLocalizedMessage(phone, reply);
  }
  await updateState(phone, {
    currentStep: STEPS.ROLE_SELECTION,
    role: null,
    tempData: {},
  });
  return sendLocalizedMessage(phone, getWelcomeMessage());
}

async function handleTrendIntent(phone, text, entities, language, state) {
  const { getExportTrendAnalysis } = await import("../services/demandintelligence.service.js");
  const commodity = entities.commodity || extractCommodityFromText(text);
  const product = commodity || "agricultural products";
  const reply = await getExportTrendAnalysis(product);
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleAIIntent(phone, text, intent, language, state) {
  // Use Groq with context for specific topic intents
  const history = await getConversationHistory(phone, 10);
  const reply = await askGroqWithContext(text, {
    history,
    language,
  });
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleGoodbyeIntent(phone, language, state) {
  const goodbyes = {
    english: "Goodbye! 👋 Thank you for using ExportConnect. Have a great day! Type *HELP* anytime to come back.",
    hindi: "अलविदा! 👋 ExportConnect इस्तेमाल करने के लिए धन्यवाद। आपका दिन शुभ हो! वापस आने के लिए कभी भी *HELP* टाइप करें।",
    hinglish: "Alvida! 👋 ExportConnect use karne ke liye dhanyavaad. Aapka din shubh ho! Wapas aane ke liye kabhi bhi *HELP* type karein.",
    marathi: "निरोप! 👋 ExportConnect वापरल्याबद्दल धन्यवाद. तुम्हाला चांगला दिवस जाऊ द्या! परत येण्यासाठी कधीही *HELP* टाइप करा.",
  };
  const reply = goodbyes[language] || goodbyes.english;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleAIFallback(phone, text, language, state, updatedTempData) {
  // Update context in state
  await updateState(phone, {
    role: state.role,
    currentStep: state.currentStep,
    tempData: updatedTempData,
  });

  // Use Groq with conversation history for natural responses
  const history = await getConversationHistory(phone, 10);
  const reply = await askGroqWithContext(text, {
    history,
    language,
  });
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}