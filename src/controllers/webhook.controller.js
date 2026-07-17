import { sendLocalizedMessage } from "../services/whatsapp.service.js";
import askGroq, { askGroqWithContext } from "../services/groq.service.js";
import { uploadImage } from "../services/cloudinary.service.js";
import BuyerLead from "../models/BuyerLead.js";
import Buyer from "../models/Buyer.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import Product from "../models/Product.js";
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
  startProductRegistration,
  handleProductRegistrationInput,
  handleProductImageStep,
  handleProductImageMessage,
  handleProductImageSkip,
  searchProducts,
  formatProductResults,
  formatProductDetail,
  deleteProduct,
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
import { isAllowed } from "../utils/rateLimiter.js";
import axios from "axios";

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

    // Rate limit check
    if (!isAllowed(phone)) {
      logger.warn(`Rate limit exceeded for ${phone}`);
      return sendLocalizedMessage(phone, "⚠️ You're sending too many messages. Please wait a moment and try again.");
    }

    if (message.type === "image") {
      const mediaId = message.image?.id;
      if (!mediaId) return;
      const mediaResult = await getMediaUrl(mediaId);
      if (!mediaResult) return;
      return handleImageMessage(phone, mediaResult);
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

  if (currentStep === STEPS.WAITING_FOR_MATCH_SELECTION) {
    return handleMatchSelectionStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_PROPOSAL_MESSAGE) {
    return handleProposalMessageStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_COUNTER_OFFER) {
    return handleCounterOfferStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_INFO_REQUEST) {
    return handleInfoRequestStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_REQUIREMENT_COMMODITY) {
    return handleRequirementCommodityStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_REQUIREMENT_QUANTITY) {
    return handleRequirementQuantityStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_REQUIREMENT_PRICE) {
    return handleRequirementPriceStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_REQUIREMENT_DATE) {
    return handleRequirementDateStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_REQUIREMENT_LOCATION) {
    return handleRequirementLocationStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_REQUIREMENT_NOTES) {
    return handleRequirementNotesStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_RATING_STARS) {
    return handleRatingStarsStep(phone, text, state);
  }

  if (currentStep === STEPS.WAITING_FOR_RATING_REVIEW) {
    return handleRatingReviewStep(phone, text, state);
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

    case "farmer_search":
      return handleFarmerSearchIntent(phone, text, entities, state);

    case "exporter_search":
      return handleExporterSearchIntent(phone, text, entities, state);

    case "buyer_search":
      return handleBuyerSearchIntent(phone, text, entities, state);

    case "product_search":
      return handleProductSearchIntent(phone, text, state);

    case "product_create":
      return handleProductCreateIntent(phone, text, state);

    case "my_products":
      return handleMyProductsIntent(phone, state);

    case "update_profile":
      return handleUpdateProfileIntent(phone, role, state);

    case "product_edit":
      return handleProductEditIntent(phone, text, state);

    case "product_delete":
      return handleProductDeleteIntent(phone, text, state);

    case "product_pause":
      return handleProductPauseIntent(phone, text, state);

    case "product_resume":
      return handleProductResumeIntent(phone, text, state);

    case "mark_sold":
      return handleMarkSoldIntent(phone, text, state);

    case "send_proposal":
      return handleSendProposalIntent(phone, text, state);

    case "view_proposals":
      return handleViewProposalsIntent(phone, text, state);

    case "accept_proposal":
      return handleAcceptProposalIntent(phone, text, state);

    case "reject_proposal":
      return handleRejectProposalIntent(phone, text, state);

    case "counter_offer":
      return handleCounterOfferIntent(phone, text, state);

    case "request_info":
      return handleRequestInfoIntent(phone, text, state);

    case "create_requirement":
      return handleCreateRequirementIntent(phone, text, state);

    case "view_requirements":
      return handleViewRequirementsIntent(phone, text, state);

    case "view_deals":
      return handleViewDealsIntent(phone, text, state);

    case "update_deal":
      return handleUpdateDealIntent(phone, text, state);

    case "deal_timeline":
      return handleDealTimelineIntent(phone, text, state);

    case "rate_deal":
      return handleRateDealIntent(phone, text, state);

    case "view_ratings":
      return handleViewRatingsIntent(phone, text, state);

    case "trade_score":
      return handleTradeScoreIntent(phone, text, state);

    case "view_matches":
      return handleViewMatchesIntent(phone, text, state);

    case "select_match":
      return handleSelectMatchIntent(phone, text, state);

    case "packaging_guide":
      return handlePackagingGuideIntent(phone, text, state);

    case "notifications":
      return handleNotificationsIntent(phone, text, state);

    case "register":
      return handleRegisterIntent(phone, role, state);

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

async function handleImageMessage(phone, mediaResult) {
  const state = await getState(phone);
  if (!state) return;

  if (state.currentStep === STEPS.WAITING_FOR_PRODUCT_IMAGE) {
    const reply = await handleProductImageMessage(phone, mediaResult, state);
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

    const buffer = Buffer.from(imageResponse.data);
    const { secure_url, public_id } = await uploadImage(buffer, mediaId);

    return { url: secure_url, publicId: public_id };
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

async function handleProductCreateIntent(phone, text, state) {
  // Check if user is registered as farmer or exporter
  if (!state.role) {
    const reply = (
      "⚠️ You need to register first before adding products.\n\n" +
      "Type *REGISTER* to get started."
    );
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  // Check verification status
  const existingProfile = await findExistingProfile(phone);
  if (existingProfile && existingProfile.status === "pending") {
    const reply = (
      "⏳ Your profile is under review.\n\n" +
      "You can add products once your profile is approved."
    );
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }
  if (existingProfile && existingProfile.status === "rejected") {
    const reply = (
      "❌ Your profile was not approved.\n\n" +
      "Please update your registration first."
    );
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  // Start product registration flow
  const reply = await startProductRegistration(phone, state);
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Step-based Conversation Handlers ───────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleMatchSelectionStep(phone, text, state) {
  const match = text.match(/(\d+)/);
  if (!match) {
    const reply = "Please reply with a number to select.";
    return sendLocalizedMessage(phone, reply);
  }

  const proposalProducts = state.tempData?.proposalProducts;
  if (proposalProducts) {
    const { findMatchesForProduct, formatMatchResults } = await import("../services/matching.service.js");
    const productIndex = parseInt(match[1]) - 1;
    const productId = proposalProducts[productIndex];

    if (!productId) {
      const reply = "❌ Product not found.";
      return sendLocalizedMessage(phone, reply);
    }

    const product = await Product.findById(productId).lean();
    const matches = await findMatchesForProduct(product);
    const formatted = formatMatchResults(matches);

    await updateState(phone, {
      currentStep: STEPS.WAITING_FOR_MATCH_SELECTION,
      tempData: {
        ...(state.tempData || {}),
        proposalProductId: productId,
        matches: matches.map((m) => ({ id: m.match._id, type: m.type, name: m.match.companyName || m.match.name })),
      },
    });

    return sendLocalizedMessage(phone, formatted);
  }

  const matches = state.tempData?.matches || [];
  const matchIndex = parseInt(match[1]) - 1;
  const selected = matches[matchIndex];

  if (!selected) {
    const reply = "❌ Match not found. Type *MATCHES* to see options.";
    return sendLocalizedMessage(phone, reply);
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_PROPOSAL_MESSAGE,
    tempData: {
      ...(state.tempData || {}),
      selectedMatchId: selected.id,
      selectedMatchType: selected.type,
      selectedMatchName: selected.name,
    },
  });

  const reply = `✉️ Type your proposal message for *${selected.name}*.\n\nInclude: quantity, quality, delivery availability.`;
  return sendLocalizedMessage(phone, reply);
}

async function handleProposalMessageStep(phone, text, state) {
  const { createProposal } = await import("../services/proposal.service.js");

  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    return sendLocalizedMessage(phone, reply);
  }

  const productId = state.tempData?.proposalProductId;
  const receiverId = state.tempData?.selectedMatchId;
  const receiverType = state.tempData?.selectedMatchType;

  if (!productId || !receiverId) {
    const reply = "❌ Something went wrong. Type *MATCHES* to start again.";
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, reply);
  }

  try {
    await createProposal({
      senderId: owner._id,
      senderType: ownerType,
      receiverId,
      receiverType,
      productId,
      data: { message: text },
    });

    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    const reply = `✅ *Proposal sent!* 📋\n\nThe buyer/exporter will be notified.\n\nType *PROPOSALS* to track your proposals.`;
    return sendLocalizedMessage(phone, reply);
  } catch (err) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    const reply = `❌ ${err.message}`;
    return sendLocalizedMessage(phone, reply);
  }
}

async function handleCounterOfferStep(phone, text, state) {
  const { respondToProposal, getProposalsForUser } = await import("../services/proposal.service.js");

  const userId = state.tempData?.counterOfferUserId;
  if (!userId) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❌ Session expired. Type *PROPOSALS* to start again.");
  }

  const result = await getProposalsForUser(userId, { direction: "received", status: "submitted" });
  if (!result.proposals.length) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❌ No pending proposals to counter.");
  }

  const proposal = result.proposals[0];
  const priceMatch = text.match(/₹?\s*(\d+(?:\.\d+)?)/);

  try {
    await respondToProposal(proposal._id, "counter_offer", {
      userId,
      counterPrice: priceMatch ? `₹${priceMatch[1]}` : text,
      counterMessage: text,
    });

    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "💰 Counter offer sent!");
  } catch (err) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, `❌ ${err.message}`);
  }
}

async function handleInfoRequestStep(phone, text, state) {
  const { respondToProposal, getProposalsForUser } = await import("../services/proposal.service.js");

  const userId = state.tempData?.infoRequestUserId;
  if (!userId) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❌ Session expired. Type *PROPOSALS* to start again.");
  }

  const result = await getProposalsForUser(userId, { direction: "received", status: "submitted" });
  if (!result.proposals.length) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❌ No pending proposals.");
  }

  const proposal = result.proposals[0];

  try {
    await respondToProposal(proposal._id, "info_request", {
      userId,
      infoRequestMessage: text,
    });

    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❓ Info request sent!");
  } catch (err) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, `❌ ${err.message}`);
  }
}

async function handleRequirementCommodityStep(phone, text, state) {
  const tempData = { ...(state.tempData || {}), requirementData: { ...(state.tempData?.requirementData || {}), commodity: text.trim() } };
  await updateState(phone, { currentStep: STEPS.WAITING_FOR_REQUIREMENT_QUANTITY, tempData });
  return sendLocalizedMessage(phone, "📊 How much quantity do you need?\n\nExample: *10 tonnes*, *500 kg*");
}

async function handleRequirementQuantityStep(phone, text, state) {
  const tempData = { ...(state.tempData || {}), requirementData: { ...(state.tempData?.requirementData || {}), quantity: text.trim() } };
  await updateState(phone, { currentStep: STEPS.WAITING_FOR_REQUIREMENT_PRICE, tempData });
  return sendLocalizedMessage(phone, "💰 What's your expected price?\n\nExample: *₹15/kg* or *negotiable*");
}

async function handleRequirementPriceStep(phone, text, state) {
  const tempData = { ...(state.tempData || {}), requirementData: { ...(state.tempData?.requirementData || {}), expectedPrice: text.trim() } };
  await updateState(phone, { currentStep: STEPS.WAITING_FOR_REQUIREMENT_DATE, tempData });
  return sendLocalizedMessage(phone, "📅 When do you need delivery?\n\nExample: *August 2026*, *within 30 days*, *ASAP*");
}

async function handleRequirementDateStep(phone, text, state) {
  const tempData = { ...(state.tempData || {}), requirementData: { ...(state.tempData?.requirementData || {}), requiredDate: text.trim() } };
  await updateState(phone, { currentStep: STEPS.WAITING_FOR_REQUIREMENT_LOCATION, tempData });
  return sendLocalizedMessage(phone, "📍 Where should it be delivered?\n\nExample: *Mumbai*, *Delhi*, *Nashik*");
}

async function handleRequirementLocationStep(phone, text, state) {
  const tempData = { ...(state.tempData || {}), requirementData: { ...(state.tempData?.requirementData || {}), deliveryLocation: text.trim() } };
  await updateState(phone, { currentStep: STEPS.WAITING_FOR_REQUIREMENT_NOTES, tempData });
  return sendLocalizedMessage(phone, "📝 Any additional notes?\n\nType your notes or *SKIP* to finish.");
}

async function handleRequirementNotesStep(phone, text, state) {
  const { createRequirement } = await import("../services/requirement.service.js");
  const rd = state.tempData?.requirementData || {};

  const ownerType = state.role === "buyer" ? "Buyer" : "Exporter";
  const owner = await Buyer.findOne({ phone }).lean() || await Exporter.findOne({ phone }).lean();

  if (!owner) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❌ Profile not found.");
  }

  try {
    await createRequirement({
      creatorId: owner._id,
      creatorType: ownerType,
      commodity: rd.commodity,
      quantity: rd.quantity,
      expectedPrice: rd.expectedPrice,
      requiredDate: rd.requiredDate,
      deliveryLocation: rd.deliveryLocation,
      notes: text.toUpperCase() === "SKIP" ? "" : text,
    });

    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, `✅ *Requirement posted!*\n\n📋 ${rd.commodity} — ${rd.quantity || "—"}\n\nSellers will be matched automatically.\n\nType *REQUIREMENTS* to view your requirements.`);
  } catch (err) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, `❌ ${err.message}`);
  }
}

async function handleRatingStarsStep(phone, text, state) {
  const starMatch = text.match(/([1-5])/);
  const starCount = starMatch ? parseInt(starMatch[1]) : (text.match(/★/g) || []).length;

  if (!starCount || starCount < 1 || starCount > 5) {
    return sendLocalizedMessage(phone, "Please reply with 1-5 stars (e.g., *4* or *★★★★*).");
  }

  const tempData = { ...(state.tempData || {}), ratingStars: starCount };
  await updateState(phone, { currentStep: STEPS.WAITING_FOR_RATING_REVIEW, tempData });
  return sendLocalizedMessage(phone, `⭐ ${starCount} stars selected.\n\nWrite a review (or type *SKIP*).`);
}

async function handleRatingReviewStep(phone, text, state) {
  const { submitRating } = await import("../services/rating.service.js");

  const dealId = state.tempData?.ratingDealId;
  const userId = state.tempData?.ratingUserId;
  const userType = state.tempData?.ratingUserType;
  const stars = state.tempData?.ratingStars;

  if (!dealId || !userId) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, "❌ Session expired.");
  }

  try {
    await submitRating(dealId, userId, userType, {
      stars,
      review: text.toUpperCase() === "SKIP" ? "" : text,
    });

    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, `✅ *Rating submitted!*\n\n⭐ ${stars} stars\nThank you for your feedback!`);
  } catch (err) {
    await updateState(phone, { currentStep: STEPS.READY, tempData: {} });
    return sendLocalizedMessage(phone, `❌ ${err.message}`);
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Seller Dashboard Handlers ───────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function getOwnerForProduct(phone, ownerType) {
  if (ownerType === "Farmer") {
    return Farmer.findOne({ phone }).lean();
  }
  return Exporter.findOne({ phone }).lean();
}

async function handleMyProductsIntent(phone, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first to manage products.\n\nType *REGISTER* to get started.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);

  if (!owner) {
    const reply = "❌ Your profile not found. Please register again.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id })
    .sort({ createdAt: -1 })
    .lean();

  if (!products.length) {
    const reply = (
      "📦 *My Products*\n\n" +
      "You haven't listed any products yet.\n\n" +
      "Type *ADD PRODUCT* to list your first product."
    );
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const statusEmoji = { pending: "⏳", approved: "✅", rejected: "❌", paused: "⏸️", sold: "💰" };
  const cards = products.map((p, i) => (
    `*${i + 1}. ${p.productName}*\n` +
    `💰 ${p.price || "—"}\n` +
    `📊 ${p.quantity || "—"}\n` +
    `${statusEmoji[p.status] || "❓"} Status: ${p.status}\n` +
    `Reply *EDIT ${i + 1}* to edit, *DELETE ${i + 1}* to remove`
  )).join("\n\n");

  const reply = (
    `📦 *My Products* (${products.length})\n\n` +
    cards + "\n\n" +
    "Commands:\n" +
    "• *ADD PRODUCT* — Add new product\n" +
    "• *EDIT <number>* — Edit product\n" +
    "• *DELETE <number>* — Remove product"
  );
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleUpdateProfileIntent(phone, role, state) {
  if (!role) {
    const reply = "⚠️ You don't have a profile yet.\n\nType *REGISTER* to create one.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const reply = await resumeRegistration(phone, role, state.tempData || {});
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleProductEditIntent(phone, text, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(?:edit|update|change|modify)\s*(?:product)?\s*(\d+)/i);
  if (!match) {
    const reply = "Please specify which product to edit.\n\nExample: *EDIT 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const productIndex = parseInt(match[1]) - 1;
  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id }).sort({ createdAt: -1 }).lean();
  const product = products[productIndex];

  if (!product) {
    const reply = `❌ Product #${match[1]} not found. You have ${products.length} products.`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  // Start edit flow - ask what to change
  await updateState(phone, {
    currentStep: "waiting_for_product_edit_field",
    tempData: { ...(state.tempData || {}), editingProductId: product._id.toString() },
  });

  const reply = (
    `📝 *Editing: ${product.productName}*\n\n` +
    `Current details:\n` +
    `💰 Price: ${product.price || "—"}\n` +
    `📊 Quantity: ${product.quantity || "—"}\n` +
    `📝 Description: ${product.description || "—"}\n\n` +
    `What would you like to change?\n` +
    `Reply: *price*, *quantity*, *description*, or *CANCEL*`
  );
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleProductDeleteIntent(phone, text, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(?:delete|remove|cancel)\s*(?:product|listing)?\s*(\d+)/i);
  if (!match) {
    const reply = "Please specify which product to delete.\n\nExample: *DELETE 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const productIndex = parseInt(match[1]) - 1;
  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id }).sort({ createdAt: -1 }).lean();
  const product = products[productIndex];

  if (!product) {
    const reply = `❌ Product #${match[1]} not found.`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await deleteProduct(product._id);
  const reply = `✅ *${product.productName}* has been deleted.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleProductPauseIntent(phone, text, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(?:pause|hide|deactivate)\s*(?:product|listing)?\s*(\d+)/i);
  if (!match) {
    const reply = "Please specify which product to pause.\n\nExample: *PAUSE 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const productIndex = parseInt(match[1]) - 1;
  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id }).sort({ createdAt: -1 }).lean();
  const product = products[productIndex];

  if (!product) {
    const reply = `❌ Product #${match[1]} not found.`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await Product.findByIdAndUpdate(product._id, { status: "paused" });
  const reply = `⏸️ *${product.productName}* has been paused and is no longer visible in the marketplace.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleProductResumeIntent(phone, text, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(?:resume|show|activate|reactivate)\s*(?:product|listing)?\s*(\d+)/i);
  if (!match) {
    const reply = "Please specify which product to resume.\n\nExample: *RESUME 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const productIndex = parseInt(match[1]) - 1;
  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id }).sort({ createdAt: -1 }).lean();
  const product = products[productIndex];

  if (!product) {
    const reply = `❌ Product #${match[1]} not found.`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await Product.findByIdAndUpdate(product._id, { status: "approved" });
  const reply = `✅ *${product.productName}* is now active and visible in the marketplace.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleMarkSoldIntent(phone, text, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(?:mark|set)\s*sold\s*(?:product|listing)?\s*(\d+)|(\d+)\s*(?:sold|bech)/i);
  if (!match) {
    const reply = "Please specify which product is sold.\n\nExample: *SOLD 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const productIndex = parseInt(match[1] || match[2]) - 1;
  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id }).sort({ createdAt: -1 }).lean();
  const product = products[productIndex];

  if (!product) {
    const reply = `❌ Product #${match[1] || match[2]} not found.`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await Product.findByIdAndUpdate(product._id, { status: "sold" });
  const reply = `💰 *${product.productName}* marked as sold. Congratulations on the sale!`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Proposal Handlers ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSendProposalIntent(phone, text, state) {
  if (!state.role) {
    const reply = "⚠️ Please register first.\n\nType *REGISTER* to get started.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const { findMatchesForProduct, formatMatchResults } = await import("../services/matching.service.js");

  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found. Please register first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id, status: "approved" }).sort({ createdAt: -1 }).lean();
  if (!products.length) {
    const reply = "📦 You have no approved products.\n\nType *ADD PRODUCT* to list one first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  if (products.length === 1) {
    const matches = await findMatchesForProduct(products[0]);
    const formatted = formatMatchResults(matches);

    await updateState(phone, {
      currentStep: STEPS.WAITING_FOR_MATCH_SELECTION,
      tempData: {
        ...(state.tempData || {}),
        proposalProductId: products[0]._id.toString(),
        matches: matches.map((m) => ({ id: m.match._id, type: m.type, name: m.match.companyName || m.match.name })),
      },
    });

    await saveAssistantMessage(phone, formatted);
    return sendLocalizedMessage(phone, formatted);
  }

  const productList = products.map((p, i) => `*${i + 1}. ${p.productName}* — ${p.quantity || "—"}`).join("\n");
  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_MATCH_SELECTION,
    tempData: { ...(state.tempData || {}), proposalProducts: products.map((p) => p._id.toString()) },
  });

  const reply = `📦 *Select Product to Send Proposal:*\n\n${productList}\n\nReply with product number.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleViewProposalsIntent(phone, text, state) {
  const { getProposalsForUser, formatProposalCard } = await import("../services/proposal.service.js");
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const direction = text.toLowerCase().includes("sent") ? "sent" : text.toLowerCase().includes("received") ? "received" : "all";
  const result = await getProposalsForUser(owner._id, { direction });

  if (!result.proposals.length) {
    const reply = "📋 No proposals found.\n\nType *SEND PROPOSAL* to send one.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const cards = result.proposals.map((p, i) => formatProposalCard(p, i + 1)).join("\n\n");
  const reply = `📋 *Your Proposals* (${result.total})\n\n${cards}`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleAcceptProposalIntent(phone, text, state) {
  const { respondToProposal } = await import("../services/proposal.service.js");
  const { createDeal } = await import("../services/deal.service.js");

  const match = text.match(/(?:accept|approve)\s*(?:proposal)?\s*(\d+)|(\d+)/i);
  if (!match) {
    const reply = "Please specify which proposal.\n\nExample: *ACCEPT 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const { getProposalsForUser } = await import("../services/proposal.service.js");
  const result = await getProposalsForUser(owner._id, { direction: "received" });
  const proposalIndex = parseInt(match[1] || match[2]) - 1;
  const proposal = result.proposals[proposalIndex];

  if (!proposal) {
    const reply = "❌ Proposal not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await respondToProposal(proposal._id, "accept", { userId: owner._id });
  await createDeal(proposal._id);

  const reply = `✅ Proposal accepted! Deal created.\n\nType *DEALS* to track your deal.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleRejectProposalIntent(phone, text, state) {
  const { respondToProposal, getProposalsForUser } = await import("../services/proposal.service.js");

  const match = text.match(/(?:reject|decline)\s*(?:proposal)?\s*(\d+)|(\d+)/i);
  if (!match) {
    const reply = "Please specify which proposal.\n\nExample: *REJECT 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getProposalsForUser(owner._id, { direction: "received" });
  const proposalIndex = parseInt(match[1] || match[2]) - 1;
  const proposal = result.proposals[proposalIndex];

  if (!proposal) {
    const reply = "❌ Proposal not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await respondToProposal(proposal._id, "reject", { userId: owner._id });

  const reply = "❌ Proposal rejected.";
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleCounterOfferIntent(phone, text, state) {
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_COUNTER_OFFER,
    tempData: { ...(state.tempData || {}), counterOfferUserId: owner._id.toString(), counterOfferUserType: ownerType },
  });

  const reply = "💰 Type your counter offer price and message.\n\nExample: *₹18/kg, can you do this price?*";
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleRequestInfoIntent(phone, text, state) {
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_INFO_REQUEST,
    tempData: { ...(state.tempData || {}), infoRequestUserId: owner._id.toString() },
  });

  const reply = "❓ What information do you need?\n\nType your question.";
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Requirement Handlers ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleCreateRequirementIntent(phone, text, state) {
  if (!state.role || (state.role !== "buyer" && state.role !== "exporter")) {
    const reply = "⚠️ Only Buyers and Exporters can post requirements.\n\nType *REGISTER* to sign up as a Buyer or Exporter.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_REQUIREMENT_COMMODITY,
    tempData: { ...(state.tempData || {}), requirementData: {} },
  });

  const reply = "📋 *Post Requirement*\n\nWhat product do you need?\n\nExample: *Onion*, *Rice*, *Turmeric*";
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleViewRequirementsIntent(phone, text, state) {
  const { getRequirementsForUser, formatRequirementResults } = await import("../services/requirement.service.js");
  const ownerType = state.role === "buyer" ? "Buyer" : "Exporter";
  const owner = await Buyer.findOne({ phone }).lean() || await Exporter.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getRequirementsForUser(owner._id, {});
  const formatted = formatRequirementResults(result);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Deal Handlers ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleViewDealsIntent(phone, text, state) {
  const { getDealsForUser, formatDealCard } = await import("../services/deal.service.js");
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getDealsForUser(owner._id, {});

  if (!result.deals.length) {
    const reply = "📋 No active deals.\n\nDeals are created when proposals are accepted.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const cards = result.deals.map((d, i) => formatDealCard(d, i + 1)).join("\n\n");
  const reply = `📋 *Your Deals* (${result.total})\n\n${cards}\n\nReply *DEAL <number>* for timeline.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleUpdateDealIntent(phone, text, state) {
  const { getDealsForUser, updateDealStatus } = await import("../services/deal.service.js");

  const match = text.match(/(?:update|change|mark)\s*(?:deal)?\s*(\d+)|deal\s*(\d+)/i);
  if (!match) {
    const reply = "Please specify which deal and status.\n\nExample: *UPDATE DEAL 1 delivered*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getDealsForUser(owner._id, {});
  const dealIndex = parseInt(match[1] || match[2]) - 1;
  const deal = result.deals[dealIndex];

  if (!deal) {
    const reply = "❌ Deal not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const statusMatch = text.match(/\b(delivered|completed|cancelled|packaging|in_transit|pickup_scheduled)\b/i);
  if (!statusMatch) {
    const reply = "What status? Options: *packaging*, *pickup_scheduled*, *in_transit*, *delivered*, *completed*, *cancelled*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  try {
    await updateDealStatus(deal._id, statusMatch[1].toLowerCase(), owner._id);
    const reply = `✅ Deal #${deal._id.toString().slice(-6).toUpperCase()} updated to *${statusMatch[1]}*.`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  } catch (err) {
    const reply = `❌ ${err.message}`;
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }
}

async function handleDealTimelineIntent(phone, text, state) {
  const { getDealsForUser, getDealById, formatDealDetail } = await import("../services/deal.service.js");

  const match = text.match(/(\d+)/);
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getDealsForUser(owner._id, {});
  const dealIndex = match ? parseInt(match[1]) - 1 : 0;
  const deal = result.deals[dealIndex];

  if (!deal) {
    const reply = "❌ Deal not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const fullDeal = await getDealById(deal._id);
  const formatted = formatDealDetail(fullDeal);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Rating Handlers ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleRateDealIntent(phone, text, state) {
  const { getDealsForUser, canRate } = await import("../services/rating.service.js");

  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const { getDealsForUser: getDeals } = await import("../services/deal.service.js");
  const result = await getDeals(owner._id, { status: "completed" });

  if (!result.deals.length) {
    const reply = "⭐ No completed deals to rate yet.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(\d+)/);
  const dealIndex = match ? parseInt(match[1]) - 1 : 0;
  const deal = result.deals[dealIndex];

  if (!deal) {
    const reply = "❌ Deal not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const canRateDeal = await canRate(deal._id, owner._id);
  if (!canRateDeal) {
    const reply = "⭐ You have already rated this deal.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_RATING_STARS,
    tempData: { ...(state.tempData || {}), ratingDealId: deal._id.toString(), ratingUserId: owner._id.toString(), ratingUserType: ownerType },
  });

  const reply = `⭐ Rate your experience with this deal.\n\nReply with 1-5 stars (e.g., *4* or *★★★★*).`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

async function handleViewRatingsIntent(phone, text, state) {
  const { getRatingsForUser, formatRatingCard } = await import("../services/rating.service.js");
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getRatingsForUser(owner._id, {});
  if (!result.ratings.length) {
    const reply = "⭐ No ratings yet.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const cards = result.ratings.map((r, i) => formatRatingCard(r, i + 1)).join("\n\n");
  const reply = `⭐ *Your Ratings* (${result.total})\n\n${cards}`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Trade Score Handler ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleTradeScoreIntent(phone, text, state) {
  const { calculateTradeScore, formatTradeScore } = await import("../services/tradeScore.service.js");
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const ts = await calculateTradeScore(owner._id, ownerType);
  const formatted = formatTradeScore(ts);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Match Handlers ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handleViewMatchesIntent(phone, text, state) {
  const { findMatchesForProduct, formatMatchResults } = await import("../services/matching.service.js");

  const ownerType = state.role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const products = await Product.find({ ownerId: owner._id, status: "approved" }).sort({ createdAt: -1 }).lean();
  if (!products.length) {
    const reply = "📦 No approved products to match.\n\nType *ADD PRODUCT* first.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const match = text.match(/(\d+)/);
  const productIndex = match ? parseInt(match[1]) - 1 : 0;
  const product = products[productIndex];

  if (!product) {
    const reply = "❌ Product not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const matches = await findMatchesForProduct(product);
  const formatted = formatMatchResults(matches);

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_MATCH_SELECTION,
    tempData: {
      ...(state.tempData || {}),
      proposalProductId: product._id.toString(),
      matches: matches.map((m) => ({ id: m.match._id, type: m.type, name: m.match.companyName || m.match.name })),
    },
  });

  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

async function handleSelectMatchIntent(phone, text, state) {
  const match = text.match(/(\d+)/);
  if (!match) {
    const reply = "Please specify which match.\n\nExample: *SELECT 1*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const matches = state.tempData?.matches || [];
  const matchIndex = parseInt(match[1]) - 1;
  const selected = matches[matchIndex];

  if (!selected) {
    const reply = "❌ Match not found. Type *MATCHES* to see options.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_PROPOSAL_MESSAGE,
    tempData: {
      ...(state.tempData || {}),
      selectedMatchId: selected.id,
      selectedMatchType: selected.type,
      selectedMatchName: selected.name,
    },
  });

  const reply = `✉️ Type your proposal message for *${selected.name}*.\n\nInclude: quantity, quality, delivery availability, and any other details.`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Packaging & Notification Handlers ──────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePackagingGuideIntent(phone, text, state) {
  const { getPackagingGuide, formatPackagingGuide } = await import("../services/packaging.service.js");

  const commodity = text.replace(/^(packaging|pack\s*guide|packing)/i, "").trim().toLowerCase();
  if (!commodity) {
    const reply = "📦 Which product do you need packaging guidance for?\n\nExample: *PACKAGING turmeric* or *PACKAGING rice*";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const guide = await getPackagingGuide(commodity);
  const formatted = formatPackagingGuide(guide);
  await saveAssistantMessage(phone, formatted);
  return sendLocalizedMessage(phone, formatted);
}

async function handleNotificationsIntent(phone, text, state) {
  const { getNotificationsForUser, formatNotificationCard } = await import("../services/notification.service.js");
  const ownerType = state.role === "farmer" ? "Farmer" : state.role === "exporter" ? "Exporter" : "Buyer";
  const owner = await getOwnerForProduct(phone, ownerType) || await Buyer.findOne({ phone }).lean();
  if (!owner) {
    const reply = "❌ Profile not found.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const result = await getNotificationsForUser(owner._id, {});
  if (!result.notifications.length) {
    const reply = "🔔 No notifications yet.";
    await saveAssistantMessage(phone, reply);
    return sendLocalizedMessage(phone, reply);
  }

  const cards = result.notifications.map((n, i) => formatNotificationCard(n, i + 1)).join("\n\n");
  const reply = `🔔 *Notifications* (${result.total})\n\n${cards}`;
  await saveAssistantMessage(phone, reply);
  return sendLocalizedMessage(phone, reply);
}