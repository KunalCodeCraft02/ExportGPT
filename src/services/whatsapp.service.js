import axios from "axios";
import logger from "../utils/logger.js";

const WHATSAPP_API_URL = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * sendMessage - Sends a text message to a WhatsApp user via Meta Cloud API.
 * @param {string} phone - Recipient's phone number (with country code, no +)
 * @param {string} text - Message text to send
 * @returns {boolean} - true if sent successfully, false otherwise
 */
const sendMessage = async (phone, text) => {
  try {
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

    const response = await axios.post(WHATSAPP_API_URL, payload, {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    logger.info(`WhatsApp sendMessage response status: ${response.status}`);
    logger.info(`Message sent successfully. Message ID: ${response.data?.messages?.[0]?.id}`);
    return true;
  } catch (error) {
    const metaError = error.response?.data?.error || {};
    const errMsg = metaError.message || error.message;
    const errorCode = metaError.code || error.response?.status || "unknown";
    logger.error(`WhatsApp sendMessage failed [${errorCode}]: ${errMsg}`);
    return false;
  }
};

export { sendMessage };
export default sendMessage;