import ConversationState from "../models/ConversationState.js";

export const ROLES = {
  FARMER: "farmer",
  EXPORTER: "exporter",
};

export const STEPS = {
  ROLE_SELECTION: "role_selection",
  READY: "ready",
  MARKETPLACE_PAGE: "marketplace_page",
};

export async function getState(phone) {
  if (!phone) return null;
  return ConversationState.findOne({ phone }).lean();
}

export async function createState(phone, role = null, currentStep = STEPS.ROLE_SELECTION, tempData = {}) {
  return ConversationState.findOneAndUpdate(
    { phone },
    { phone, role, currentStep, tempData },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

export async function updateState(phone, updates) {
  return ConversationState.findOneAndUpdate(
    { phone },
    { ...updates, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

export async function clearState(phone) {
  if (!phone) return null;
  return ConversationState.findOneAndDelete({ phone }).lean();
}

export function isRegistrationStep(currentStep) {
  return currentStep && !Object.values(STEPS).includes(currentStep);
}

export function buildPageState({ searchType, product, page = 1, sourceRole = null }) {
  return { searchType, product: product || null, page, sourceRole };
}