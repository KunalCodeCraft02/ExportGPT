/**
 * NLP Pipeline — orchestrates language detection, intent classification,
 * entity extraction, and context resolution.
 *
 * Flow:
 *   Message → Language Detection → Intent Classification → Entity Extraction
 *            → Context Resolution → { intent, language, entities, confidence }
 *
 * Total latency: < 50ms for rule-based path (no API calls).
 */

import { detectLanguageWithContext } from "./languageDetector.js";
import { classifyIntent } from "./intentClassifier.js";
import { extractEntities } from "./entityExtractor.js";
import logger from "../utils/logger.js";

/**
 * Run the full NLP pipeline on a user message.
 *
 * @param {string} text - The raw user message
 * @param {object} context - Conversation context from state
 * @param {string[]} recentLanguages - Last N detected languages for stability
 * @returns {object} { intent, language, entities, confidence, method }
 */
export function analyzeMessage(text, context = {}, recentLanguages = []) {
  const startTime = Date.now();

  // 1. Language detection (with context stabilization)
  const langResult = detectLanguageWithContext(text, recentLanguages);

  // 2. Intent classification
  const intentResult = classifyIntent(text, context);

  // 3. Entity extraction
  const entities = extractEntities(text);

  // 4. Resolve ambiguities using context
  const resolved = resolveContext(intentResult, entities, context);

  const result = {
    intent: resolved.intent,
    language: langResult.language,
    entities: resolved.entities,
    confidence: Math.min(langResult.confidence, intentResult.confidence),
    method: {
      language: langResult.method,
      intent: intentResult.method,
    },
  };

  const elapsed = Date.now() - startTime;
  logger.info(`NLP pipeline [${elapsed}ms]: intent=${result.intent} (${result.confidence}) lang=${result.language}`);

  return result;
}

/**
 * Resolve ambiguities using conversation context.
 * For example, if user said "onion" earlier and now says "price",
 * we fill in the commodity from context.
 */
function resolveContext(intentResult, entities, context) {
  const resolvedEntities = { ...entities };

  // If intent is market_price but no commodity detected, use context
  if (intentResult.intent === "market_price" && !resolvedEntities.commodity) {
    if (context.lastCommodity) {
      resolvedEntities.commodity = context.lastCommodity;
    }
  }

  // If intent is search but no product detected, use context
  if (["farmer_search", "exporter_search", "buyer_search"].includes(intentResult.intent)) {
    if (!resolvedEntities.commodity && context.lastCommodity) {
      resolvedEntities.commodity = context.lastCommodity;
    }
  }

  // If user is from a specific state, fill in state if missing
  if (!resolvedEntities.state && context.userState) {
    resolvedEntities.state = context.userState;
  }

  // If user is from a specific district, fill in district if missing
  if (!resolvedEntities.district && context.userDistrict) {
    resolvedEntities.district = context.userDistrict;
  }

  return { intent: intentResult.intent, entities: resolvedEntities };
}

/**
 * Build context object from conversation state and user profile.
 */
export function buildContext(state, userProfile = null) {
  const tempData = state?.tempData || {};
  return {
    currentStep: state?.currentStep || null,
    role: state?.role || null,
    lastCommodity: tempData.lastCommodity || null,
    lastIntent: tempData.lastIntent || null,
    userState: userProfile?.state || null,
    userDistrict: userProfile?.district || null,
    recentIntents: tempData.recentIntents || [],
    recentLanguages: tempData.recentLanguages || [],
  };
}

/**
 * Update conversation context after processing a message.
 */
export function updateContext(tempData, analysis) {
  const updated = { ...(tempData || {}) };

  // Track last commodity
  if (analysis.entities.commodity) {
    updated.lastCommodity = analysis.entities.commodity;
  }

  // Track last intent
  updated.lastIntent = analysis.intent;

  // Track recent intents (keep last 5)
  const recentIntents = updated.recentIntents || [];
  recentIntents.push(analysis.intent);
  updated.recentIntents = recentIntents.slice(-5);

  // Track recent languages (keep last 5)
  const recentLanguages = updated.recentLanguages || [];
  recentLanguages.push(analysis.language);
  updated.recentLanguages = recentLanguages.slice(-5);

  return updated;
}

export default { analyzeMessage, buildContext, updateContext };
