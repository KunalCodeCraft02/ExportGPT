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
  WAITING_FOR_PRODUCT_NAME: "waiting_for_product_name",
  WAITING_FOR_PRODUCT_DESCRIPTION: "waiting_for_product_description",
  WAITING_FOR_PRODUCT_CATEGORY: "waiting_for_product_category",
  WAITING_FOR_PRODUCT_PRICE: "waiting_for_product_price",
  WAITING_FOR_PRODUCT_QUANTITY: "waiting_for_product_quantity",
  WAITING_FOR_PRODUCT_IMAGE: "waiting_for_product_image",
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

export function isProductRegistrationStep(currentStep) {
  return currentStep && Object.values(PRODUCT_REG_STEPS).includes(currentStep);
}

const PRODUCT_REG_STEPS = [
  STEPS.WAITING_FOR_PRODUCT_NAME,
  STEPS.WAITING_FOR_PRODUCT_DESCRIPTION,
  STEPS.WAITING_FOR_PRODUCT_CATEGORY,
  STEPS.WAITING_FOR_PRODUCT_PRICE,
  STEPS.WAITING_FOR_PRODUCT_QUANTITY,
  STEPS.WAITING_FOR_PRODUCT_IMAGE,
];

export function buildPageState({ searchType, product, page = 1, sourceRole = null }) {
  return { searchType, product: product || null, page, sourceRole };
}