import { sendLocalizedMessage } from "../services/whatsapp.service.js";
import askGroq from "../services/groq.service.js";
import path from "path";
import { fileURLToPath } from "url";
import BuyerLead from "../models/BuyerLead.js";
import Buyer from "../models/Buyer.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
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
  searchExporters,
  searchFarmers,
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

  if (!state) {
    const existingProfile = await findExistingProfile(phone);
    if (existingProfile) {
      await updateState(phone, {
        currentStep: STEPS.READY,
        role: existingProfile.role,
        tempData: { preferredLanguage: existingProfile.preferredLanguage || "english" },
      });

      // Handle pending status
      if (existingProfile.status === "pending") {
        const statusMsg = getStatusMessage(existingProfile.role, "pending");
        return sendLocalizedMessage(phone, statusMsg);
      }

      // Handle rejected status
      if (existingProfile.status === "rejected") {
        const statusMsg = getStatusMessage(existingProfile.role, "rejected", existingProfile.rejectionReason);
        return sendLocalizedMessage(phone, statusMsg);
      }

      // Approved — normal welcome back
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

  // ── Global commands (available at any step) ──────────────────────────────
  if (normalized === "HELP") {
    return sendLocalizedMessage(phone, getHelpMessage());
  }

  if (normalized === "REGISTER") {
    if (role) {
      // Check if the user's profile is rejected — allow re-registration
      const existingProfile = await findExistingProfile(phone);
      if (existingProfile && existingProfile.status === "rejected") {
        const reply = await startRoleRegistration(phone, role, state);
        return sendLocalizedMessage(phone, reply);
      }
      // Check if pending — show status message
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

  const registrationIntent = parseRegistrationIntent(text);
  if (registrationIntent) {
    // Check if user already has a profile with this role
    const existingProfile = await findExistingProfile(phone);
    if (existingProfile && existingProfile.role === registrationIntent) {
      if (existingProfile.status === "rejected") {
        // Allow re-registration for rejected profiles
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

  // ── Step-based routing ───────────────────────────────────────────────────
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

  // ── Product registration steps ──────────────────────────────────────────────
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

  // ── Registered user — marketplace & command routing ───────────────────────

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

  // Send Request (reply "1" when viewing exporters)
  if (normalized === "1" && state.tempData?.searchType === "exporters") {
    return handleSendRequest(phone, state);
  }

  // Next exporter (reply "2" when viewing exporters)
  if (normalized === "2" && state.tempData?.searchType === "exporters") {
    return handleNextExporter(phone, state);
  }

  // Pagination
  if (normalized === "MORE") {
    return handleMore(phone, state);
  }

  // ── Product marketplace commands ────────────────────────────────────────────
  if (normalized === "ADD PRODUCT") {
    return handleAddProduct(phone, state);
  }

  if (normalized === "SHOW PRODUCTS") {
    return handleShowProducts(phone, state);
  }

  if (normalized.startsWith("SHOW ")) {
    return handleShowProductSearch(phone, text, state);
  }

  if (normalized.startsWith("VIEW ")) {
    return handleViewProduct(phone, text, state);
  }

  // ── Daily market price commands ──────────────────────────────────────────
  if (
    normalized === "PRICE" ||
    normalized === "PRICES" ||
    normalized === "RATE" ||
    normalized === "RATES" ||
    normalized === "MANDI" ||
    normalized.startsWith("PRICE ") ||
    normalized.startsWith("PRICES ") ||
    normalized.startsWith("RATE ") ||
    normalized.startsWith("MARKET PRICE") ||
    normalized.startsWith("DAILY PRICE") ||
    normalized.startsWith("MARKET RATE") ||
    normalized.startsWith("CHECK PRICE") ||
    normalized.startsWith("MANDI PRICE") ||
    normalized.startsWith("MANDI RATE")
  ) {
    return handlePriceCommand(phone, text, state);
  }

  // ── Farmer search ────────────────────────────────────────────────────────
  if (
    normalized === "FARMERS" ||
    normalized === "FARMER" ||
    normalized.startsWith("FIND FARMER")
  ) {
    return handleFarmerSearch(phone, text, state);
  }

  // ── Exporter search ──────────────────────────────────────────────────────
  if (
    normalized === "EXPORTERS" ||
    normalized === "EXPORTER" ||
    normalized.startsWith("FIND EXPORTER") ||
    normalized.startsWith("SHOW EXPORTER") ||
    normalized.startsWith("I WANT TO EXPORT") ||
    normalized.startsWith("FIND BUYER") ||
    normalized.startsWith("BUYERS")
  ) {
    return handleExporterSearch(phone, text, state);
  }

  // ── Fallback to AI ───────────────────────────────────────────────────────
  const aiReply = await askGroq(text);
  return sendLocalizedMessage(phone, aiReply);
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

async function handleShowProducts(phone, state) {
  const result = await searchProducts({ product: null, page: 1 });
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