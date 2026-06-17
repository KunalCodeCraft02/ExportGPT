import sendMessage from "../services/whatsapp.service.js";
import askGroq from "../services/groq.service.js";
import {
  getWelcomeMessage,
  getHelpMessage,
  parseRoleChoice,
  startRegistration,
  resumeRegistration,
  handleRegistrationInput,
} from "../services/registration.service.js";
import {
  getState,
  updateState,
  isRegistrationStep,
  ROLES,
  STEPS,
  buildPageState,
} from "../services/conversation.service.js";
import {
  extractProduct,
  formatExporterResults,
  formatFarmerResults,
  searchExporters,
  searchFarmers,
  storeMarketplacePage,
} from "../services/matching.service.js";

// ─── Webhook verification (GET) ───────────────────────────────────────────────
export function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }
  return res.status(403).json({ error: "Forbidden" });
}

// ─── Incoming message handler (POST) ─────────────────────────────────────────
export async function handleWebhook(req, res) {
  // Always respond 200 immediately so Meta doesn't retry
  res.status(200).json({ status: "ok" });

  let phone;
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Ignore status updates (delivered, read receipts)
    if (value?.statuses) return;

    const message = value?.messages?.[0];
    if (!message) return;

    // Scope phone here so catch block can also access it
    phone = message.from;
    const text = (message.text?.body || "").trim();

    if (!phone || !text) return;

    console.log(`[webhook] Phone: ${phone} | Text: "${text}"`);

    await routeMessage(phone, text);
  } catch (err) {
    console.error(`[webhook] Error: ${err.message}`);
    if (phone) {
      await sendMessage(phone, "⚠️ Something went wrong. Please try again or type *HELP*.");
    }
  }
}

// ─── Main routing logic ───────────────────────────────────────────────────────
async function routeMessage(phone, text) {
  const normalized = text.trim().toUpperCase();
  const state = await getState(phone);

  // ── 1. Brand-new user — no state at all ──────────────────────────────────
  if (!state) {
    await updateState(phone, { currentStep: STEPS.ROLE_SELECTION, role: null, tempData: {} });
    return sendMessage(phone, getWelcomeMessage());
  }

  const { currentStep, role, tempData } = state;

  // ── 2. HELP command — always works ───────────────────────────────────────
  if (normalized === "HELP") {
    return sendMessage(phone, getHelpMessage());
  }

  // ── 3. REGISTER command — restart registration ────────────────────────────
  if (normalized === "REGISTER") {
    if (role) {
      const reply = await resumeRegistration(phone, role, tempData || {});
      return sendMessage(phone, reply);
    }
    // No role yet — ask who they are
    await updateState(phone, { currentStep: STEPS.ROLE_SELECTION, role: null, tempData: {} });
    return sendMessage(phone, getWelcomeMessage());
  }

  // ── 4. Role selection step ────────────────────────────────────────────────
  if (currentStep === STEPS.ROLE_SELECTION) {
    const chosenRole = parseRoleChoice(text);
    if (!chosenRole) {
      return sendMessage(
        phone,
        "Please reply with:\n\n1️⃣ *1* — Farmer / Seller\n2️⃣ *2* — Exporter"
      );
    }
    const reply = await startRegistration(phone, chosenRole);
    return sendMessage(phone, reply);
  }

  // ── 5. Mid-registration — collect answers ─────────────────────────────────
  if (isRegistrationStep(currentStep)) {
    const reply = await handleRegistrationInput(phone, role, text, state);
    return sendMessage(phone, reply);
  }

  // ── 6. Registered user — marketplace commands ─────────────────────────────

  // MORE — next page of last search
  if (normalized === "MORE") {
    return handleMore(phone, state);
  }

  // FIND FARMERS / FARMERS / FARMER
  if (
    normalized.startsWith("FIND FARMER") ||
    normalized === "FARMERS" ||
    normalized === "FARMER"
  ) {
    return handleFarmerSearch(phone, text, state);
  }

  // EXPORTERS / FIND EXPORTERS / I WANT TO EXPORT / SHOW EXPORTERS / FIND BUYER
  if (
    normalized === "EXPORTERS" ||
    normalized === "EXPORTER" ||
    normalized.startsWith("FIND EXPORTER") ||
    normalized.startsWith("SHOW EXPORTER") ||
    normalized.startsWith("I WANT TO EXPORT") ||
    normalized.startsWith("FIND BUYER")
  ) {
    return handleExporterSearch(phone, text, state);
  }

  // ── 7. Fallback — ask Groq AI ─────────────────────────────────────────────
  const aiReply = await askGroq(text);
  return sendMessage(phone, aiReply);
}

// ─── Search handlers ──────────────────────────────────────────────────────────

async function handleExporterSearch(phone, text, state) {
  const product = extractProduct(text) || (state.tempData?.products?.[0] ?? null);
  const result = await searchExporters({ product, page: 1 });
  const formatted = await formatExporterResults(result);

  await storeMarketplacePage(phone, buildPageState({
    searchType: "exporters",
    product,
    page: 1,
    sourceRole: state.role,
  }));

  return sendMessage(phone, formatted);
}

async function handleFarmerSearch(phone, text, state) {
  const product = extractProduct(text) || (state.tempData?.products?.[0] ?? null);
  const result = await searchFarmers({ product, page: 1 });
  const formatted = await formatFarmerResults(result);

  await storeMarketplacePage(phone, buildPageState({
    searchType: "farmers",
    product,
    page: 1,
    sourceRole: state.role,
  }));

  return sendMessage(phone, formatted);
}

async function handleMore(phone, state) {
  if (!state.tempData?.searchType) {
    return sendMessage(phone, "No previous search found. Try *EXPORTERS* or *FIND FARMERS* first.");
  }

  const { searchType, product, page } = state.tempData;
  const nextPage = (page || 1) + 1;

  if (searchType === "exporters") {
    const result = await searchExporters({ product, page: nextPage });
    const formatted = await formatExporterResults(result);

    await storeMarketplacePage(phone, buildPageState({
      searchType: "exporters",
      product,
      page: nextPage,
      sourceRole: state.role,
    }));

    return sendMessage(phone, formatted);
  }

  if (searchType === "farmers") {
    const result = await searchFarmers({ product, page: nextPage });
    const formatted = await formatFarmerResults(result);

    await storeMarketplacePage(phone, buildPageState({
      searchType: "farmers",
      product,
      page: nextPage,
      sourceRole: state.role,
    }));

    return sendMessage(phone, formatted);
  }
}