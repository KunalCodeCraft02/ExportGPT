import ConversationState from "../models/ConversationState.js";
import { invalidatePreferredLanguage } from "./whatsapp.service.js";

export const ROLES = {
  FARMER: "farmer",
  EXPORTER: "exporter",
  BUYER: "buyer",
};

export const STEPS = {
  ROLE_SELECTION: "role_selection",
  WAITING_FOR_LANGUAGE_SELECTION: "waiting_for_language_selection",
  WAITING_FOR_LEAD_MESSAGE: "waiting_for_lead_message",
  WAITING_FOR_EXPORTER_RESPONSE: "waiting_for_exporter_response",
  WAITING_FOR_PRICE_PRODUCT: "waiting_for_price_product",
  WAITING_FOR_LOGISTICS_CHOICE: "waiting_for_logistics_choice",
  WAITING_FOR_ESCROW_CONFIRM: "waiting_for_escrow_confirm",
  WAITING_FOR_AI_EXPORT_QUESTION: "waiting_for_ai_export_question",
  READY: "ready",
  MARKETPLACE_PAGE: "marketplace_page",
};

export async function getState(phone) {
  if (!phone) return null;
  return ConversationState.findOne({ phone }).lean();
}

export async function createState(
  phone,
  role = null,
  currentStep = STEPS.ROLE_SELECTION,
  tempData = {}
) {
  return ConversationState.findOneAndUpdate(
    { phone },
    { phone, role, currentStep, tempData },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

export async function updateState(phone, updates) {
  const result = await ConversationState.findOneAndUpdate(
    { phone },
    { ...updates, updatedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  if (updates?.tempData?.preferredLanguage) {
    invalidatePreferredLanguage(phone);
  }

  return result;
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