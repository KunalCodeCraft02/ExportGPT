import axios from "axios";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import User from "../models/User.js";
import ConversationState from "../models/ConversationState.js";
import logger from "../utils/logger.js";
import { normalizeLanguage, translateText } from "./language.service.js";

const preferredLanguageCache = new Map();

function getWhatsAppApiUrl() {
  return `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableWhatsAppError(error) {
  const status = error.response?.status;
  const code = error.response?.data?.error?.code;
  return status === 429 || status >= 500 || code === 190;
}

function validateWhatsAppConfig() {
  const missing = [];
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID) missing.push("WHATSAPP_PHONE_NUMBER_ID");
  if (!process.env.WHATSAPP_TOKEN) missing.push("WHATSAPP_TOKEN");

  if (missing.length > 0) {
    logger.error(`Missing WhatsApp config: ${missing.join(", ")}`);
    return false;
  }

  return true;
}

/**
 * sendMessage - Sends a text message to a WhatsApp user via Meta Cloud API.
 * @param {string} phone - Recipient's phone number (with country code, no +)
 * @param {string} text - Message text to send
 * @param {{ skipLocalization?: boolean }} [options]
 * @returns {boolean} - true if sent successfully, false otherwise
 */
const sendMessage = async (phone, text, options = {}) => {
  if (!options.skipLocalization) {
    return sendLocalizedMessage(phone, text);
  }

  try {
    if (!validateWhatsAppConfig()) return false;

    logger.info(`Sending WhatsApp message to ${phone}`);

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: {
        preview_url: false,
        body: text,
      },
    };

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await axios.post(getWhatsAppApiUrl(), payload, {
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        });

        logger.info(`WhatsApp sendMessage response status: ${response.status}`);
        logger.info(`Message sent successfully. Message ID: ${response.data?.messages?.[0]?.id}`);
        return true;
      } catch (error) {
        lastError = error;
        if (!isRetryableWhatsAppError(error) || attempt === 3) break;

        const waitMs = attempt * 1000;
        logger.warn(`WhatsApp sendMessage retryable error [${error.response?.data?.error?.code || error.response?.status || "unknown"}]; retrying in ${waitMs}ms...`);
        await delay(waitMs);
      }
    }

    const metaError = lastError?.response?.data?.error || {};
    const errMsg = metaError.message || lastError?.message;
    const errorCode = metaError.code || lastError?.response?.status || "unknown";
    logger.error(`WhatsApp sendMessage failed [${errorCode}]: ${errMsg}`);
    return false;
  } catch (error) {
    const metaError = error.response?.data?.error || {};
    const errMsg = metaError.message || error.message;
    const errorCode = metaError.code || error.response?.status || "unknown";
    logger.error(`WhatsApp sendMessage failed [${errorCode}]: ${errMsg}`);
    return false;
  }
};

async function getPreferredLanguage(phone) {
  const normalizedPhone = String(phone || "").trim();
  if (!normalizedPhone) return "english";
  if (preferredLanguageCache.has(normalizedPhone)) {
    return preferredLanguageCache.get(normalizedPhone);
  }

  const [user, farmer, exporter, conversationState] = await Promise.all([
    User.findOne({ phone: normalizedPhone }).select("preferredLanguage language").lean(),
    Farmer.findOne({ phone: normalizedPhone }).select("preferredLanguage").lean(),
    Exporter.findOne({ phone: normalizedPhone }).select("preferredLanguage").lean(),
    ConversationState.findOne({ phone: normalizedPhone }).select("tempData.preferredLanguage").lean(),
  ]);

  const language =
    conversationState?.tempData?.preferredLanguage ||
    user?.preferredLanguage ||
    farmer?.preferredLanguage ||
    exporter?.preferredLanguage ||
    user?.language ||
    "english";

  const normalizedLanguage = normalizeLanguage(language);
  preferredLanguageCache.set(normalizedPhone, normalizedLanguage);
  return normalizedLanguage;
}

export async function sendLocalizedMessage(phone, text) {
  const language = await getPreferredLanguage(phone);
  const translatedText = await translateText(text, language);
  return sendMessage(phone, translatedText, { skipLocalization: true });
}

export function invalidatePreferredLanguage(phone) {
  if (phone) preferredLanguageCache.delete(String(phone).trim());
}

export { sendMessage };
export default sendMessage;