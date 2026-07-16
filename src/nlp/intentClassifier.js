/**
 * Intent Classifier — classify user messages into intents.
 *
 * Strategy:
 *   1. Rule-based pattern matching (fast, < 5ms, covers ~85% of messages)
 *   2. Groq AI fallback for ambiguous messages (covers remaining ~15%)
 *
 * Each intent has: name, patterns (regex/keywords), priority.
 * Higher priority wins when multiple intents match.
 */

import { extractCommodity } from "./entityExtractor.js";

// ── Intent definitions ───────────────────────────────────────────────────────
const INTENTS = [
  {
    name: "greeting",
    priority: 10,
    patterns: [
      /^(hi|hello|hey|namaste|namaskar|pranam|good\s*(morning|afternoon|evening|night)|sup|yo|hii+|helo|helllo)$/i,
      /^(ji|ji\s*hello|ji\s*namaste|acha|theek hai|ok|okay)$/i,
    ],
  },
  {
    name: "help",
    priority: 20,
    patterns: [
      /\b(help|madad|saayda|commands|menu|options|kya\s*kar\s*sakte|what\s*can\s*you|guide)\b/i,
    ],
  },
  {
    name: "register",
    priority: 15,
    patterns: [
      /\b(register|registration|sign\s*up|profile|nondni|apply)\b/i,
      /\b(ragister|regist|registr)/i,  // common typos
    ],
  },
  {
    name: "market_price",
    priority: 25,
    patterns: [
      /\b(price|rate|rates|prices|bhav|bhaav|daam|dam|rate|cost|mandi|market)\b/i,
      /\b(aaj|kal|today|yesterday|current|latest|abhi)\b.*\b(price|rate|bhav)\b/i,
      /\b(price|rate|bhav)\b.*\b(aaj|kal|today|current|latest)\b/i,
    ],
  },
  {
    name: "farmer_search",
    priority: 15,
    patterns: [
      /\b(find\s*farmer|search\s*farmer|farmers?|kisan|shetkari|seller)\b/i,
      /\b(farmer|kisan)\s*(dhund|search|find|dhoond)/i,
    ],
  },
  {
    name: "exporter_search",
    priority: 15,
    patterns: [
      /\b(find\s*exporter|search\s*exporter|exporters?|export\s*buyer)\b/i,
      /\b(i\s*want\s*to\s*export|export\s*karna|export\s*karaycha)\b/i,
    ],
  },
  {
    name: "buyer_search",
    priority: 15,
    patterns: [
      /\b(find\s*buyer|search\s*buyer|buyers?|kharedidar|kharidar)\b/i,
      /\b(buyer|kharidar)\s*(dhund|search|find)/i,
    ],
  },
  {
    name: "product_create",
    priority: 20,
    patterns: [
      /\b(add\s*product|create\s*product|list\s*product|sell\s*product|new\s*product)\b/i,
      /\b(i\s*want\s*to\s*sell|sell\s*my|list\s*my|add\s*my|create\s*listing)\b/i,
      /\b(register\s*product|product\s*list\s*karo|product\s*add\s*karo)\b/i,
      /\b(my\s*crop\s*is\s*ready|crop\s*bech|sell\s*crop|list\s*crop)\b/i,
      /\b(want\s*to\s*list|list\s*it|sell\s*it|add\s*it)\b/i,
    ],
  },
  {
    name: "product_search",
    priority: 15,
    patterns: [
      /\b(show\s*products?|browse\s*products?|product\s*list|marketplace|product\s*dhund)\b/i,
      /\b(view\s*product|find\s*product|search\s*product|available\s*products?)\b/i,
    ],
  },
  {
    name: "my_products",
    priority: 20,
    patterns: [
      /\b(my\s*products?|mera\s*product|my\s*listing|my\s*crops?|my\s*stock)\b/i,
      /\b(maine\s*add\s*kya|mere\s*product|product\s*dikhao|list\s*dikhao)\b/i,
    ],
  },
  {
    name: "update_profile",
    priority: 18,
    patterns: [
      /\b(update\s*profile|edit\s*profile|change\s*details|update\s*registration)\b/i,
      /\b(profile\s*update|details\s*change|info\s*update)\b/i,
    ],
  },
  {
    name: "product_edit",
    priority: 18,
    patterns: [
      /\b(edit\s*product|update\s*product|change\s*product|modify\s*product)\b/i,
      /\b(product\s*edit|product\s*update)\b/i,
    ],
  },
  {
    name: "product_delete",
    priority: 18,
    patterns: [
      /\b(delete\s*product|remove\s*product|cancel\s*listing|remove\s*listing)\b/i,
      /\b(product\s*delete|listing\s*delete|listing\s*remove)\b/i,
    ],
  },
  {
    name: "product_pause",
    priority: 18,
    patterns: [
      /\b(pause\s*product|hide\s*product|deactivate\s*product|pause\s*listing)\b/i,
      /\b(product\s*pause|listing\s*pause|暂时\s*下架)\b/i,
    ],
  },
  {
    name: "product_resume",
    priority: 18,
    patterns: [
      /\b(resume\s*product|show\s*product|activate\s*product|resume\s*listing)\b/i,
      /\b(product\s*resume|listing\s*resume|reactivate)\b/i,
    ],
  },
  {
    name: "mark_sold",
    priority: 18,
    patterns: [
      /\b(mark\s*sold|sold\s*out|product\s*sold|listing\s*sold|bech\s*diya)\b/i,
      /\b(sold|bik\s*gya|ho\s*gya\s*sale)\b/i,
    ],
  },
  {
    name: "demand_intelligence",
    priority: 20,
    patterns: [
      /\b(demand|global\s*demand|export\s*demand|buyer\s*demand)\b/i,
      /\b(can\s*i\s*export|export\s*guide|export\s*document|export\s*certif)/i,
      /\b(countries?\s*buy|which\s*countries?|kahan\s*bech|export\s*kahan)\b/i,
    ],
  },
  {
    name: "weather",
    priority: 10,
    patterns: [
      /\b(weather|mausam|rain|barish|temperature|tapman|samasya|storm|flood)\b/i,
    ],
  },
  {
    name: "crop_recommendation",
    priority: 10,
    patterns: [
      /\b(crop\s*recommend|what\s*should\s*i\s*grow|kya\s*ugaye|which\s*crop|fasal\s*suggest)/i,
    ],
  },
  {
    name: "government_scheme",
    priority: 10,
    patterns: [
      /\b(government\s*scheme|sarkari\s*yojana|subsidy|loan|pm\s*kisan|pmfby|crop\s*insurance)\b/i,
    ],
  },
  {
    name: "logistics",
    priority: 10,
    patterns: [
      /\b(logistics|transport|delivery|shipping|truck|gaadi|bhejna|freight|carrier)\b/i,
    ],
  },
  {
    name: "payment",
    priority: 10,
    patterns: [
      /\b(payment|pay|paisa|paise|cash|transfer|upi|bank|escrow|bhugtan)\b/i,
    ],
  },
  {
    name: "quality",
    priority: 10,
    patterns: [
      /\b(quality|grading|standard|certif|fssai|organic|pesticide|residue)\b/i,
    ],
  },
  {
    name: "packaging",
    priority: 10,
    patterns: [
      /\b(packaging|pack|bag|box|carton|container|gunny|packing)\b/i,
    ],
  },
  {
    name: "trend",
    priority: 15,
    patterns: [
      /\b(trend|analysis|forecast|outlook|future\s*price|price\s*forecast)\b/i,
    ],
  },
  {
    name: "complaint",
    priority: 5,
    patterns: [
      /\b(complaint|problem|issue|not\s*working|broken|bug|error|grievance)\b/i,
    ],
  },
  {
    name: "feedback",
    priority: 5,
    patterns: [
      /\b(feedback|suggestion|improve|good|great|excellent|awesome|nice|thanks|thank\s*you)\b/i,
    ],
  },
  {
    name: "goodbye",
    priority: 5,
    patterns: [
      /\b(bye|goodbye|good\s*night|alvida|tata|chal|ok\s*bye|see\s*you|phir\s*milenge)\b/i,
    ],
  },
];

// ── Classification function ──────────────────────────────────────────────────
export function classifyIntent(text, context = {}) {
  const raw = String(text || "").trim();
  if (!raw) return { intent: "unknown", confidence: 0, method: "empty" };

  const normalized = raw.toLowerCase().trim();

  // Exact match for single-word inputs
  const singleWordIntents = {
    "hi": "greeting", "hello": "greeting", "hey": "greeting",
    "namaste": "greeting", "namaskar": "greeting",
    "help": "help", "madad": "help",
    "register": "register", "register": "register",
    "more": "more", "next": "more",
    "skip": "skip",
    "1": "option_1", "2": "option_2", "3": "option_3",
  };

  if (singleWordIntents[normalized]) {
    return { intent: singleWordIntents[normalized], confidence: 1.0, method: "exact_match" };
  }

  // Pattern-based classification
  let bestMatch = null;
  let bestPriority = -1;

  for (const intentDef of INTENTS) {
    for (const pattern of intentDef.patterns) {
      if (pattern.test(normalized)) {
        if (intentDef.priority > bestPriority) {
          bestPriority = intentDef.priority;
          bestMatch = intentDef.name;
        }
      }
    }
  }

  if (bestMatch) {
    return { intent: bestMatch, confidence: 0.85, method: "pattern_match" };
  }

  // Context-based fallback: if user is in a known conversation step, infer intent
  if (context.currentStep) {
    const stepIntentMap = {
      "waiting_for_price_product": "market_price",
      "waiting_for_lead_message": "lead_message",
      "waiting_for_exporter_response": "exporter_response",
      "waiting_for_product_image": "product_image",
      "role_selection": "register",
      "waiting_for_language_selection": "language_selection",
    };
    const mapped = stepIntentMap[context.currentStep];
    if (mapped) {
      return { intent: mapped, confidence: 0.6, method: "context_step" };
    }
  }

  // If user mentioned a commodity, likely a price query
  const commodity = extractCommodity(normalized);
  if (commodity) {
    return { intent: "market_price", confidence: 0.5, method: "commodity_hint" };
  }

  // Default: unknown (will fall through to Groq AI)
  return { intent: "unknown", confidence: 0.3, method: "no_match" };
}

/**
 * Get a human-readable intent label for the user (for debugging).
 */
export function getIntentLabel(intent) {
  const labels = {
    greeting: "Greeting",
    help: "Help",
    register: "Registration",
    market_price: "Market Price",
    farmer_search: "Farmer Search",
    exporter_search: "Exporter Search",
    buyer_search: "Buyer Search",
    product_search: "Product Search",
    product_create: "Product Create",
    my_products: "My Products",
    update_profile: "Update Profile",
    product_edit: "Product Edit",
    product_delete: "Product Delete",
    product_pause: "Product Pause",
    product_resume: "Product Resume",
    mark_sold: "Mark Sold",
    demand_intelligence: "Export/Demand Intelligence",
    weather: "Weather",
    crop_recommendation: "Crop Recommendation",
    government_scheme: "Government Schemes",
    logistics: "Logistics",
    payment: "Payment",
    quality: "Quality Standards",
    packaging: "Packaging",
    trend: "Trend Analysis",
    complaint: "Complaint",
    feedback: "Feedback",
    goodbye: "Goodbye",
    lead_message: "Lead Message",
    exporter_response: "Exporter Response",
    product_image: "Product Image",
    language_selection: "Language Selection",
    more: "More Results",
    skip: "Skip",
    option_1: "Option 1",
    option_2: "Option 2",
    option_3: "Option 3",
    unknown: "Unknown",
  };
  return labels[intent] || intent;
}

export default { classifyIntent, getIntentLabel };
