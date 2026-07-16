/**
 * Chat Memory Service — manage conversation history for multi-turn conversations.
 *
 * Stores user and assistant messages with NLP metadata.
 * Provides context for follow-up questions and conversation summaries.
 */

import ChatMessage from "../models/ChatMessage.js";
import logger from "../utils/logger.js";

const MAX_HISTORY_MESSAGES = 20;

/**
 * Save a user message with NLP analysis.
 */
export async function saveUserMessage(phone, content, analysis = {}) {
  try {
    return await ChatMessage.create({
      phone,
      role: "user",
      content,
      intent: analysis.intent || null,
      language: analysis.language || null,
      entities: analysis.entities || {},
    });
  } catch (error) {
    logger.error(`Failed to save user message: ${error.message}`);
    return null;
  }
}

/**
 * Save an assistant reply.
 */
export async function saveAssistantMessage(phone, content) {
  try {
    return await ChatMessage.create({
      phone,
      role: "assistant",
      content,
    });
  } catch (error) {
    logger.error(`Failed to save assistant message: ${error.message}`);
    return null;
  }
}

/**
 * Get recent conversation history for a user.
 * Returns messages in chronological order.
 */
export async function getConversationHistory(phone, limit = MAX_HISTORY_MESSAGES) {
  try {
    const messages = await ChatMessage.find({ phone })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Reverse to chronological order
    return messages.reverse();
  } catch (error) {
    logger.error(`Failed to get conversation history: ${error.message}`);
    return [];
  }
}

/**
 * Get recent user intents for a user.
 */
export async function getRecentIntents(phone, limit = 10) {
  try {
    const messages = await ChatMessage.find({ phone, role: "user", intent: { $exists: true, $ne: null } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("intent language entities createdAt")
      .lean();

    return messages;
  } catch (error) {
    logger.error(`Failed to get recent intents: ${error.message}`);
    return [];
  }
}

/**
 * Build conversation context for Groq from recent history.
 * Returns an array of { role, content } messages.
 */
export function buildGroqMessages(history, systemPrompt) {
  const messages = [{ role: "system", content: systemPrompt }];

  // Add last N user/assistant pairs
  const recent = history.slice(-10);
  for (const msg of recent) {
    messages.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content,
    });
  }

  return messages;
}

/**
 * Get conversation summary for context.
 * Extracts key facts from recent messages.
 */
export function summarizeContext(history) {
  const summary = {
    recentCommodities: [],
    recentLocations: [],
    recentIntents: [],
    languages: [],
    messageCount: history.length,
  };

  for (const msg of history.slice(-10)) {
    if (msg.intent) summary.recentIntents.push(msg.intent);
    if (msg.language) summary.languages.push(msg.language);
    if (msg.entities?.commodity) summary.recentCommodities.push(msg.entities.commodity);
    if (msg.entities?.state) summary.recentLocations.push(msg.entities.state);
    if (msg.entities?.district) summary.recentLocations.push(msg.entities.district);
  }

  // Deduplicate
  summary.recentCommodities = [...new Set(summary.recentCommodities)];
  summary.recentLocations = [...new Set(summary.recentLocations)];
  summary.recentIntents = [...new Set(summary.recentIntents)];
  summary.languages = [...new Set(summary.languages)];

  return summary;
}

/**
 * Clean up old messages for a phone number.
 */
export async function cleanupOldMessages(phone, keepLast = 50) {
  try {
    const messages = await ChatMessage.find({ phone })
      .sort({ createdAt: -1 })
      .skip(keepLast)
      .select("_id")
      .lean();

    if (messages.length > 0) {
      const ids = messages.map((m) => m._id);
      await ChatMessage.deleteMany({ _id: { $in: ids } });
    }
  } catch (error) {
    logger.error(`Failed to cleanup old messages: ${error.message}`);
  }
}

export default {
  saveUserMessage,
  saveAssistantMessage,
  getConversationHistory,
  getRecentIntents,
  buildGroqMessages,
  summarizeContext,
  cleanupOldMessages,
};
