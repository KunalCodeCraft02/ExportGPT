import User from "../models/User.js";
import Exporter from "../models/Exporter.js";
import Farmer from "../models/Farmer.js";
import Buyer from "../models/Buyer.js";
import { ROLES, STEPS, updateState } from "./conversation.service.js";
import { normalizeLanguage } from "./language.service.js";
import { invalidatePreferredLanguage } from "./whatsapp.service.js";

// ─── Exporter registration steps ─────────────────────────────────────────────
export const EXPORTER_STEPS = [
  { key: "name",            label: "Full Name (First and Last name at minimum)" },
  { key: "email",           label: "Email Address" },
  { key: "phone",           label: "WhatsApp / Phone Number (10 digits, with country code e.g. 919876543210)" },
  { key: "companyName",     label: "Company Name" },
  { key: "iecNumber",       label: "IEC (Import Export Code) — 10-character alphanumeric code issued by DGFT" },
  { key: "products",        label: "Products you buy from farmers (e.g. onion, soybean, wheat — separate by comma)" },
  { key: "exportCountries", label: "Countries you export to (e.g. UAE, USA, UK — separate by comma)" },
  { key: "capacity",        label: "Monthly buying capacity (e.g. 10 tonnes, 5000 kg)" },
  { key: "city",            label: "City" },
  { key: "state",           label: "State" },
  { key: "country",         label: "Country" },
];

// ─── Farmer / Seller registration steps ──────────────────────────────────────
export const FARMER_STEPS = [
  { key: "name",          label: "Full Name (First and Last name at minimum)" },
  { key: "email",         label: "Email Address" },
  { key: "phone",         label: "WhatsApp / Phone Number (10 digits, with country code e.g. 919876543210)" },
  { key: "products",      label: "Products you grow / want to sell (e.g. onion, soybean, wheat — separate by comma)" },
  { key: "quantity",      label: "Quantity available for sale (e.g. 500 kg, 2 tonnes)" },
  { key: "expectedPrice", label: "Expected price per unit (e.g. ₹20/kg or 20 per kg)" },
  { key: "harvestDate",   label: "Expected harvest / available date (e.g. July 2026)" },
  { key: "packagingType", label: "Packaging type (e.g. gunny bags, cartons, loose)" },
  { key: "village",       label: "Village / Town name" },
  { key: "district",      label: "District" },
  { key: "state",         label: "State" },
  { key: "country",       label: "Country" },
];

// ─── Buyer registration steps ─────────────────────────────────────────────────
export const BUYER_STEPS = [
  { key: "name",             label: "Full Name (First and Last name at minimum)" },
  { key: "email",            label: "Email Address" },
  { key: "phone",            label: "WhatsApp / Phone Number (10 digits, with country code e.g. 919876543210)" },
  { key: "companyName",      label: "Company / Business Name (or your name if individual buyer)" },
  { key: "productsNeeded",   label: "Products you want to buy (e.g. onion, soybean, wheat — separate by comma)" },
  { key: "quantityRequired", label: "Quantity required (e.g. 5 tonnes, 1000 kg per month)" },
  { key: "targetPrice",      label: "Target price per unit (e.g. ₹18/kg, negotiable)" },
  { key: "deliveryTimeline", label: "When do you need delivery? (e.g. August 2026, within 30 days)" },
  { key: "paymentTerms",     label: "Preferred payment terms (e.g. advance, 50% advance, LC, 30 days credit)" },
  { key: "city",             label: "City" },
  { key: "country",          label: "Country" },
];

export const ROLE_LABELS = {
  [ROLES.FARMER]: "Farmer / Seller",
  [ROLES.EXPORTER]: "Exporter",
  [ROLES.BUYER]: "Buyer",
};

const REGISTRATION_INTENTS = {
  [ROLES.FARMER]: [
    "farmer registration", "register as farmer", "register farmer",
    "farmer register", "farmer profile", "seller registration",
    "register as seller", "mi farmer ahe", "mi seller ahe",
    "mala farmer register karaycha ahe", "mala farmer register karayc ahe",
    "mala seller register karaycha ahe", "farmer registration kara",
    "seller registration kara", "farmer nondni kara", "seller nondni kara",
  ],
  [ROLES.EXPORTER]: [
    "exporter registration", "register as exporter", "register exporter",
    "exporter register", "exporter profile", "mi exporter ahe",
    "mala exporter register karaycha ahe", "mala exporter register karayc ahe",
    "exporter registration kara", "exporter register kara", "exporter nondni kara",
    "एक्सपोर्टर रजिस्टर करायचा आहे",
    "मला एक्सपोर्टर म्हणून रजिस्टर करायचं आहे",
    "मला एक्सपोर्टर रजिस्टर करायचं आहे",
  ],
  [ROLES.BUYER]: [
    "buyer registration", "register as buyer", "register buyer",
    "buyer register", "buyer profile", "i am a buyer",
    "i want to buy", "mala buyer register karaycha ahe",
    "buyer registration kara", "buyer nondni kara",
  ],
};

// ─── Welcome & help ───────────────────────────────────────────────────────────
export function getWelcomeMessage() {
  return (
    "👋 Welcome to *ExportConnect* — B2B Agriculture Marketplace!\n\n" +
    "I connect farmers/sellers directly with exporters and buyers.\n\n" +
    "Please tell me who you are:\n\n" +
    "1️⃣ *Farmer / Seller* — I grow or sell agricultural products\n" +
    "2️⃣ *Exporter* — I buy products from farmers and export them\n" +
    "3️⃣ *Buyer* — I want to buy agricultural products directly\n\n" +
    "Reply with *1*, *2*, or *3* to get started 👇"
  );
}

export function getHelpMessage() {
  return (
    "🌾 *ExportConnect Help*\n\n" +
    "👤 *Registration*\n" +
    "• *REGISTER* — start or resume your profile\n" +
    "• Register as *Farmer*, *Exporter*, or *Buyer*\n\n" +
    "🧑‍🌾 *For Farmers / Sellers*\n" +
    "• *ADD PRODUCT* — list a product for sale\n" +
    "• *SHOW PRODUCTS* — browse the marketplace\n" +
    "• *SHOW grass cutter* — search products by name\n" +
    "• *EXPORTERS* — find exporters\n" +
    "• *FIND EXPORTERS onion* — find exporters for a product\n" +
    "• *BUYERS* — find buyers for your products\n" +
    "• *PRICE onion* — check today's mandi price\n" +
    "• *PACKAGING* — get packaging guidance\n" +
    "• *ESCROW* — learn about payment protection\n\n" +
    "🏢 *For Exporters / Buyers*\n" +
    "• *FIND FARMERS* — find farmers for your products\n" +
    "• *FIND FARMERS onion* — find onion farmers specifically\n" +
    "• *DEMAND onion* — see which countries buy onion & at what price\n\n" +
    "🤖 *AI Assistant*\n" +
    "• *CAN I EXPORT mangoes to Dubai* — get export guidance\n" +
    "• *EXPORT GUIDE* — ask any export question\n\n" +
    "📊 *Market Intelligence*\n" +
    "• *PRICE <product>* — daily mandi price\n" +
    "• *TREND <product>* — export trend analysis\n" +
    "• *DEMAND <product>* — global demand by country\n\n" +
    "📄 *General*\n" +
    "• *MORE* — show next page of results\n" +
    "• *HELP* — show this menu"
  );
}

// ─── Role parsing ─────────────────────────────────────────────────────────────
export function parseRoleChoice(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (["1", "1️⃣", "farmer", "farmers", "seller", "sellers", "farmer / seller", "farmer/seller"].includes(normalized)) {
    return ROLES.FARMER;
  }
  if (["2", "2️⃣", "exporter", "exporters"].includes(normalized)) {
    return ROLES.EXPORTER;
  }
  if (["3", "3️⃣", "buyer", "buyers"].includes(normalized)) {
    return ROLES.BUYER;
  }
  return null;
}

export function parseRegistrationIntent(text) {
  const normalized = normalizeRegistrationText(text);
  if (!normalized) return null;

  if (REGISTRATION_INTENTS[ROLES.EXPORTER].some((phrase) => normalized.includes(phrase))) return ROLES.EXPORTER;
  if (REGISTRATION_INTENTS[ROLES.FARMER].some((phrase) => normalized.includes(phrase))) return ROLES.FARMER;
  if (REGISTRATION_INTENTS[ROLES.BUYER].some((phrase) => normalized.includes(phrase))) return ROLES.BUYER;

  return null;
}

function normalizeRegistrationText(text) {
  const raw = String(text || "").trim().toLowerCase();
  const devanagariIntent = [
    "एक्सपोर्टर रजिस्टर करायचा आहे",
    "मला एक्सपोर्टर म्हणून रजिस्टर करायचं आहे",
    "मला एक्सपोर्टर रजिस्टर करायचं आहे",
  ];
  if (devanagariIntent.some((phrase) => raw.includes(phrase))) return raw;
  return raw.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ");
}

export function parseLanguageChoice(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (["1", "1️⃣", "english", "en"].includes(normalized)) return "english";
  if (["2", "2️⃣", "hindi", "hi", "hin"].includes(normalized)) return "hindi";
  if (["3", "3️⃣", "marathi", "mr", "mar"].includes(normalized)) return "marathi";
  return null;
}

export function getLanguagePrompt() {
  return (
    "🌐 Choose your preferred language\n\n" +
    "1️⃣ English\n" +
    "2️⃣ हिन्दी — Hindi\n" +
    "3️⃣ मराठी — Marathi\n\n" +
    "Reply with *1*, *2*, or *3*."
  );
}

// ─── Start / resume registration ──────────────────────────────────────────────
export async function startRegistration(phone, role, tempData = {}) {
  const steps = getStepsForRole(role);
  const firstStep = steps[0];
  await updateState(phone, { role, currentStep: firstStep.key, tempData });
  return getStepPrompt(role, firstStep);
}

export async function resumeRegistration(phone, role, tempData = {}) {
  const steps = getStepsForRole(role);
  const nextStep = steps.find((step) => !tempData[step.key]);
  if (!nextStep) return getAlreadyRegisteredMessage(role);
  await updateState(phone, { role, currentStep: nextStep.key, tempData });
  return getStepPrompt(role, nextStep);
}

export async function startRoleRegistration(phone, role, currentState = {}) {
  const existingProfile = await getProfileForRole(phone, role);
  const profileTempData = pickProfileTempData(existingProfile, role);
  const baseTempData = await getBaseRegistrationTempData(phone, {
    ...(currentState?.tempData || {}),
    ...profileTempData,
  });
  const tempData = { ...profileTempData, ...baseTempData, ...(currentState?.tempData || {}) };

  if (isProfileComplete(existingProfile, role) || !stepsHaveMissingValues(tempData, role)) {
    return getAlreadyRegisteredMessage(role);
  }

  const steps = getStepsForRole(role);
  const nextStep = steps.find((step) => !tempData[step.key]);
  await updateState(phone, { role, currentStep: nextStep.key, tempData });
  return getStepPrompt(role, nextStep);
}

// ─── Handle each answer with validation ──────────────────────────────────────
export async function handleRegistrationInput(phone, role, text, currentState = {}) {
  const steps = getStepsForRole(role);
  const currentStep = steps.find((step) => step.key === currentState.currentStep);

  if (!currentStep) return startRegistration(phone, role);

  const validationError = validateField(currentStep.key, text);
  if (validationError) {
    const stepNumber = steps.findIndex((s) => s.key === currentStep.key) + 1;
    return (
      `❌ *Invalid input:* ${validationError}\n\n` +
      `📝 *${ROLE_LABELS[role]} Registration* (${stepNumber}/${steps.length})\n\n` +
      `Please enter your *${currentStep.label}*:`
    );
  }

  const tempData = { ...(currentState.tempData || {}) };
  tempData[currentStep.key] = normalizeFieldValue(currentStep.key, text);

  const nextStep = steps.find((step) => !tempData[step.key]);
  if (!nextStep) return saveCompletedRegistration(phone, role, tempData);

  await updateState(phone, { role, currentStep: nextStep.key, tempData });
  return getStepPrompt(role, nextStep);
}

// ─── Field-level validation ───────────────────────────────────────────────────
function validateField(key, value) {
  const text = String(value || "").trim();
  if (!text) return "This field cannot be empty.";

  switch (key) {
    case "name": {
      const parts = text.split(/\s+/).filter(Boolean);
      if (parts.length < 2) return "Please enter your full name (at least first and last name, e.g. Rahul Sharma).";
      if (/\d/.test(text)) return "Name should not contain numbers. Please enter your real name.";
      if (text.length < 4) return "Name is too short. Please enter your full name.";
      if (/[^a-zA-Z\s.\-']/.test(text)) return "Name contains invalid characters. Use only letters, spaces, dots, or hyphens.";
      return null;
    }
    case "email": {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(text)) return "Please enter a valid email address (e.g. rahul@gmail.com).";
      return null;
    }
    case "phone": {
      const digits = text.replace(/[\s\-+()]/g, "");
      if (!/^\d+$/.test(digits)) return "Phone number should contain only digits (e.g. 919876543210).";
      if (digits.length < 10 || digits.length > 15) return "Phone number must be 10–15 digits. Include country code (e.g. 919876543210 for India).";
      return null;
    }
    case "companyName": {
      if (text.length < 3) return "Company name is too short. Please enter the full company name.";
      if (/^\d+$/.test(text)) return "Company name cannot be just numbers.";
      return null;
    }
    case "iecNumber": {
      const iec = text.replace(/\s/g, "").toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(iec)) return "IEC number must be exactly 10 alphanumeric characters (e.g. AABCP1234C).";
      return null;
    }
    case "products":
    case "productsNeeded": {
      const items = text.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      if (items.length === 0) return "Please enter at least one product (e.g. onion, wheat, soybean).";
      for (const item of items) {
        if (/\d/.test(item)) return `"${item}" doesn't look like a product name. Please enter product names only.`;
        if (item.length < 2) return `"${item}" is too short to be a product name.`;
      }
      return null;
    }
    case "exportCountries": {
      const countries = text.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      if (countries.length === 0) return "Please enter at least one country (e.g. UAE, USA, UK).";
      for (const c of countries) {
        if (/\d/.test(c)) return `"${c}" doesn't look like a country name.`;
      }
      return null;
    }
    case "capacity":
    case "quantityRequired":
    case "quantity": {
      if (!/\d/.test(text)) return "Please include a number (e.g. 500 kg, 2 tonnes).";
      if (text.length < 3) return "Please provide more detail (e.g. 500 kg, 2 tonnes).";
      return null;
    }
    case "expectedPrice":
    case "targetPrice": {
      if (text.toLowerCase() === "negotiable") return null;
      if (!/\d/.test(text)) return "Please include a number for the price (e.g. ₹20/kg, 20 per kg) or type *negotiable*.";
      return null;
    }
    case "harvestDate":
    case "deliveryTimeline": {
      const monthNames = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i;
      const hasYear = /20\d{2}/.test(text);
      const hasMonth = monthNames.test(text);
      const hasSlashDate = /\d{1,2}[\/\-]\d{1,2}/.test(text);
      const hasRelative = /day|week|month|within|asap|immediately/i.test(text);
      if (!hasYear && !hasMonth && !hasSlashDate && !hasRelative) {
        return "Please enter a valid date or timeline (e.g. July 2026, within 30 days, ASAP).";
      }
      return null;
    }
    case "packagingType": {
      if (text.length < 3) return "Please describe your packaging type (e.g. gunny bags, cartons, loose).";
      if (/^\d+$/.test(text)) return "Packaging type should be a description, not a number.";
      return null;
    }
    case "paymentTerms": {
      if (text.length < 3) return "Please describe your payment terms (e.g. advance, 50% advance, LC, 30 days credit).";
      return null;
    }
    case "village":
    case "city": {
      if (text.length < 2) return `Please enter a valid ${key === "village" ? "village/town" : "city"} name.`;
      if (/^\d+$/.test(text)) return `${key === "village" ? "Village" : "City"} name cannot be just numbers.`;
      return null;
    }
    case "district":
    case "state":
    case "country": {
      if (text.length < 2) return `Please enter a valid ${key} name.`;
      if (/^\d+$/.test(text)) return `${key.charAt(0).toUpperCase() + key.slice(1)} name cannot be just numbers.`;
      if (/[^a-zA-Z\s.\-']/.test(text)) return `${key.charAt(0).toUpperCase() + key.slice(1)} name contains invalid characters.`;
      return null;
    }
    default:
      return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getStepsForRole(role) {
  if (role === ROLES.EXPORTER) return EXPORTER_STEPS;
  if (role === ROLES.FARMER) return FARMER_STEPS;
  if (role === ROLES.BUYER) return BUYER_STEPS;
  return [];
}

export function getStepPrompt(role, step) {
  const roleLabel = ROLE_LABELS[role] || "profile";
  const allSteps = getStepsForRole(role);
  const stepNumber = allSteps.findIndex((s) => s.key === step.key) + 1;
  const total = allSteps.length;
  return (
    `📝 *${roleLabel} Registration* (${stepNumber}/${total})\n\n` +
    `Please enter your *${step.label}*:`
  );
}

async function getBaseRegistrationTempData(phone, existingTempData = {}) {
  const preferredLanguage = normalizeLanguage(
    existingTempData?.preferredLanguage ||
    (await User.findOne({ phone }).select("preferredLanguage").lean())?.preferredLanguage
  );
  return { preferredLanguage };
}

async function getProfileForRole(phone, role) {
  if (role === ROLES.EXPORTER) return Exporter.findOne({ phone }).lean();
  if (role === ROLES.FARMER) return Farmer.findOne({ phone }).lean();
  if (role === ROLES.BUYER) return Buyer.findOne({ phone }).lean();
  return null;
}

function pickProfileTempData(profile, role) {
  if (!profile) return {};
  return getStepsForRole(role).reduce((acc, step) => {
    const value = profile[step.key];
    if (value !== undefined && value !== null && value !== "") acc[step.key] = value;
    return acc;
  }, {});
}

function stepsHaveMissingValues(tempData, role) {
  return getStepsForRole(role).some((step) => {
    const value = tempData?.[step.key];
    if (Array.isArray(value)) return value.length === 0;
    return value === undefined || value === null || String(value).trim() === "";
  });
}

function isProfileComplete(profile, role) {
  if (!profile) return false;
  return getStepsForRole(role).every((step) => {
    const value = profile[step.key];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function getAlreadyRegisteredMessage(role) {
  if (role === ROLES.EXPORTER) {
    return (
      "✅ Your Exporter registration is already complete.\n\n" +
      "Try:\n• *FIND FARMERS* — find farmers\n• *DEMAND onion* — check demand by country\n• *HELP* — see all commands"
    );
  }
  if (role === ROLES.BUYER) {
    return (
      "✅ Your Buyer registration is already complete.\n\n" +
      "Try:\n• *FIND FARMERS* — find farmers with your products\n• *FIND EXPORTERS* — find exporters\n• *HELP* — see all commands"
    );
  }
  return (
    "✅ Your Farmer / Seller registration is already complete.\n\n" +
    "Try:\n• *EXPORTERS* — find exporters\n• *BUYERS* — find buyers\n• *PRICE onion* — check mandi price\n• *HELP* — see all commands"
  );
}

// ─── Save to DB ───────────────────────────────────────────────────────────────
async function saveCompletedRegistration(phone, role, tempData) {
  const preferredLanguage = normalizeLanguage(tempData.preferredLanguage);

  if (role === ROLES.EXPORTER) {
    await Exporter.findOneAndUpdate(
      { phone },
      { ...tempData, phone, verified: false, verificationStatus: "pending", preferredLanguage },
      { upsert: true, new: true }
    );
    await updateUserLanguage(phone, tempData.name, preferredLanguage, tempData.city, tempData.country);
    await updateState(phone, { role, currentStep: STEPS.READY, tempData });
    return (
      "✅ *Exporter registration submitted!*\n\n" +
      "🔍 Your profile is pending admin verification. You'll be notified once approved.\n\n" +
      "Try:\n• *FIND FARMERS* — find farmers\n• *DEMAND onion* — check country demand\n• *HELP* — see all commands"
    );
  }

  if (role === ROLES.BUYER) {
    await Buyer.findOneAndUpdate(
      { phone },
      { ...tempData, phone, verified: false, verificationStatus: "pending", preferredLanguage },
      { upsert: true, new: true }
    );
    await updateUserLanguage(phone, tempData.name, preferredLanguage, tempData.city, tempData.country);
    await updateState(phone, { role, currentStep: STEPS.READY, tempData });
    return (
      "✅ *Buyer registration submitted!*\n\n" +
      "🔍 Your profile is pending admin verification. You'll be notified once approved.\n\n" +
      "Try:\n• *FIND FARMERS onion* — find onion farmers\n• *FIND EXPORTERS* — find exporters\n• *HELP* — see all commands"
    );
  }

  // Farmer
  await Farmer.findOneAndUpdate(
    { phone },
    { ...tempData, phone, verified: false, verificationStatus: "pending", preferredLanguage },
    { upsert: true, new: true }
  );
  await updateUserLanguage(phone, tempData.name, preferredLanguage, tempData.district, tempData.country);
  await updateState(phone, { role, currentStep: STEPS.READY, tempData });
  return (
    "✅ *Farmer / Seller registration submitted!*\n\n" +
    "🔍 Your profile is pending admin verification. You'll be notified once approved.\n\n" +
    "Try:\n• *EXPORTERS* — find exporters\n• *BUYERS* — find buyers\n• *PRICE onion* — check mandi price\n• *HELP* — see all commands"
  );
}

async function updateUserLanguage(phone, name, preferredLanguage, district, country) {
  await User.findOneAndUpdate(
    { phone },
    {
      name: name || "Unknown",
      preferredLanguage,
      location: [district, country].filter(Boolean).join(", ") || undefined,
      language: preferredLanguage === "english" ? "en" : preferredLanguage.slice(0, 2),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  invalidatePreferredLanguage(phone);
}

// ─── Value normalizers ────────────────────────────────────────────────────────
function normalizeFieldValue(key, value) {
  const text = String(value || "").trim();
  if (["products", "productsNeeded", "exportCountries", "certifications"].includes(key)) {
    return splitList(text);
  }
  if (key === "phone") return text.replace(/[\s\-+()]/g, "");
  if (key === "iecNumber") return text.replace(/\s/g, "").toUpperCase();
  if (key === "name") return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

function splitList(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}