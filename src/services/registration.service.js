import Exporter from "../models/Exporter.js";
import Farmer from "../models/Farmer.js";
import { ROLES, STEPS, updateState } from "./conversation.service.js";

// ─── Exporter registration steps ────────────────────────────────────────────
export const EXPORTER_STEPS = [
  { key: "name",           label: "Full Name (First, Middle, Last)" },
  { key: "email",          label: "Email Address" },
  { key: "phone",          label: "Phone Number (with country code)" },
  { key: "companyName",    label: "Company Name" },
  { key: "iecNumber",      label: "IEC (Import Export Code) Number" },
  { key: "products",       label: "Products you buy from farmers (e.g. onion, soybean, wheat)" },
  { key: "exportCountries",label: "Countries you export to (e.g. UAE, USA, UK)" },
  { key: "capacity",       label: "Monthly buying capacity / quantity" },
  { key: "city",           label: "City" },
  { key: "state",          label: "State" },
  { key: "country",        label: "Country" },
];

// ─── Farmer / Seller registration steps ──────────────────────────────────────
export const FARMER_STEPS = [
  { key: "name",          label: "Full Name (First, Middle, Last)" },
  { key: "email",         label: "Email Address" },
  { key: "phone",         label: "Phone Number (with country code)" },
  { key: "products",      label: "Products you grow / want to sell (e.g. onion, soybean, wheat)" },
  { key: "quantity",      label: "Quantity available for sale (e.g. 500 kg, 2 tonnes)" },
  { key: "expectedPrice", label: "Expected price per unit (e.g. ₹20/kg)" },
  { key: "harvestDate",   label: "Expected harvest / available date (e.g. July 2025)" },
  { key: "packagingType", label: "Packaging type (e.g. gunny bags, cartons, loose)" },
  { key: "village",       label: "Village / Town" },
  { key: "district",      label: "District" },
  { key: "state",         label: "State" },
  { key: "country",       label: "Country" },
];

export const ROLE_LABELS = {
  [ROLES.FARMER]: "Farmer / Seller",
  [ROLES.EXPORTER]: "Exporter",
};

// ─── Welcome & help messages ─────────────────────────────────────────────────
export function getWelcomeMessage() {
  return (
    "👋 Welcome to *ExportConnect* — B2B Agriculture Marketplace!\n\n" +
    "I connect farmers/sellers directly with exporters.\n\n" +
    "Please tell me who you are:\n\n" +
    "1️⃣ *Farmer / Seller* — I grow or sell agricultural products\n" +
    "2️⃣ *Exporter* — I buy products from farmers and export them\n\n" +
    "Reply with *1* or *2* to get started 👇"
  );
}

export function getHelpMessage() {
  return (
    "🌾 *ExportConnect Help*\n\n" +
    "👤 *Registration*\n" +
    "• *REGISTER* — start or resume your profile\n\n" +
    "🧑‍🌾 *For Farmers / Sellers*\n" +
    "• *EXPORTERS* — find exporters\n" +
    "• *FIND EXPORTERS onion* — find exporters for a product\n" +
    "• *I WANT TO EXPORT onion* — same as above\n\n" +
    "🏢 *For Exporters*\n" +
    "• *FIND FARMERS* — find farmers for your products\n" +
    "• *FIND FARMERS onion* — find farmers for a specific product\n\n" +
    "📄 *General*\n" +
    "• *MORE* — show next page of results\n" +
    "• *HELP* — show this menu"
  );
}

// ─── Role parsing ─────────────────────────────────────────────────────────────
export function parseRoleChoice(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (
    ["1", "1️⃣", "farmer", "farmers", "seller", "sellers",
     "farmer / seller", "farmer/seller"].includes(normalized)
  ) {
    return ROLES.FARMER;
  }
  if (["2", "2️⃣", "exporter", "exporters"].includes(normalized)) {
    return ROLES.EXPORTER;
  }
  return null;
}

// ─── Start fresh registration ─────────────────────────────────────────────────
export async function startRegistration(phone, role) {
  const steps = getStepsForRole(role);
  const firstStep = steps[0];

  await updateState(phone, {
    role,
    currentStep: firstStep.key,
    tempData: {},
  });

  return getStepPrompt(role, firstStep);
}

// ─── Resume incomplete registration ──────────────────────────────────────────
export async function resumeRegistration(phone, role, tempData = {}) {
  const steps = getStepsForRole(role);
  const nextStep = steps.find((step) => !tempData[step.key]);

  if (!nextStep) {
    return (
      "✅ Your registration is already complete!\n\n" +
      "You can now search the marketplace.\n" +
      "Type *HELP* to see available commands."
    );
  }

  await updateState(phone, { role, currentStep: nextStep.key, tempData });
  return getStepPrompt(role, nextStep);
}

// ─── Handle each registration answer ─────────────────────────────────────────
export async function handleRegistrationInput(phone, role, text, currentState = {}) {
  const steps = getStepsForRole(role);
  const currentStep = steps.find((step) => step.key === currentState.currentStep);

  // If we somehow lost track of step, restart
  if (!currentStep) {
    return startRegistration(phone, role);
  }

  const tempData = { ...(currentState.tempData || {}) };
  tempData[currentStep.key] = normalizeFieldValue(currentStep.key, text);

  // Find the next unanswered step
  const nextStep = steps.find((step) => !tempData[step.key]);

  if (!nextStep) {
    // All steps answered — save to DB
    return saveCompletedRegistration(phone, role, tempData);
  }

  await updateState(phone, {
    role,
    currentStep: nextStep.key,
    tempData,
  });

  return getStepPrompt(role, nextStep);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getStepsForRole(role) {
  if (role === ROLES.EXPORTER) return EXPORTER_STEPS;
  if (role === ROLES.FARMER) return FARMER_STEPS;
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

// ─── Save completed registration to DB ───────────────────────────────────────
async function saveCompletedRegistration(phone, role, tempData) {
  if (role === ROLES.EXPORTER) {
    await Exporter.findOneAndUpdate(
      { phone },
      {
        ...tempData,
        phone,
        experience: parseNumber(tempData.experience),
        verified: false,
      },
      { upsert: true, new: true }
    );

    await updateState(phone, {
      role,
      currentStep: STEPS.READY,
      tempData,
    });

    return (
      "✅ *Exporter registration saved successfully!*\n\n" +
      "You can now find farmers who sell products you export.\n\n" +
      "Try:\n" +
      "• *FIND FARMERS* — find farmers for your products\n" +
      "• *FIND FARMERS onion* — find onion farmers specifically\n" +
      "• *HELP* — see all commands"
    );
  }

  // Farmer
  await Farmer.findOneAndUpdate(
    { phone },
    { ...tempData, phone },
    { upsert: true, new: true }
  );

  await updateState(phone, {
    role,
    currentStep: STEPS.READY,
    tempData,
  });

  return (
    "✅ *Farmer / Seller registration saved successfully!*\n\n" +
    "You can now find exporters who buy your products.\n\n" +
    "Try:\n" +
    "• *EXPORTERS* — find all exporters\n" +
    "• *FIND EXPORTERS onion* — find onion exporters specifically\n" +
    "• *HELP* — see all commands"
  );
}

// ─── Value normalizers ────────────────────────────────────────────────────────
function normalizeFieldValue(key, value) {
  const text = String(value || "").trim();
  if (["products", "exportCountries", "certifications"].includes(key)) {
    return splitList(text);
  }
  return text;
}

function splitList(value) {
  return String(value || "")
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}