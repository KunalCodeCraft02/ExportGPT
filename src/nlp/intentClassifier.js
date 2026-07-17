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
    name: "send_proposal",
    priority: 22,
    patterns: [
      /\b(send\s*proposal|proposal\s*bhej|propose|bhejo|send\s*offer)\b/i,
      /\b(i\s*want\s*to\s*send|send\s*to\s*buyer|send\s*to\s*exporter)\b/i,
    ],
  },
  {
    name: "view_proposals",
    priority: 20,
    patterns: [
      /\b(proposals?|my\s*proposals?|view\s*proposals?|check\s*proposals?|proposal\s*list)\b/i,
      /\b(proposal\s*dikhao|mere\s*proposal)\b/i,
    ],
  },
  {
    name: "accept_proposal",
    priority: 22,
    patterns: [
      /\b(accept\s*proposal|proposal\s*accept|manzoor|accept\s*kar|haan\s*mein)\b/i,
    ],
  },
  {
    name: "reject_proposal",
    priority: 22,
    patterns: [
      /\b(reject\s*proposal|proposal\s*reject|nahi\s*chahta|decline)\b/i,
    ],
  },
  {
    name: "counter_offer",
    priority: 22,
    patterns: [
      /\b(counter\s*offer|offer\s*badlo|new\s*price|different\s*price)\b/i,
    ],
  },
  {
    name: "request_info",
    priority: 22,
    patterns: [
      /\b(more\s*info|request\s*info|details\s*chahiye|information\s*needed)\b/i,
    ],
  },
  {
    name: "create_requirement",
    priority: 20,
    patterns: [
      /\b(post\s*requirement|create\s*requirement|need\s*product|looking\s*for|kharidna\s*hai)\b/i,
      /\b(requirement\s*post|requirement\s*banao|i\s*need|we\s*need)\b/i,
    ],
  },
  {
    name: "view_requirements",
    priority: 20,
    patterns: [
      /\b(requirements?|my\s*requirements?|view\s*requirements?|check\s*requirements?)\b/i,
      /\b(requirement\s*dikhao|mere\s*requirement)\b/i,
    ],
  },
  {
    name: "view_deals",
    priority: 20,
    patterns: [
      /\b(deals?|my\s*deals?|active\s*deals?|view\s*deals?|check\s*deals?|deal\s*tracker)\b/i,
      /\b(deal\s*dikhao|mere\s*deal|order\s*status)\b/i,
    ],
  },
  {
    name: "update_deal",
    priority: 20,
    patterns: [
      /\b(update\s*deal|deal\s*update|change\s*status|mark\s*delivered|mark\s*shipped)\b/i,
    ],
  },
  {
    name: "deal_timeline",
    priority: 18,
    patterns: [
      /\b(deal\s*timeline|deal\s*history|stage\s*history|deal\s*progress)\b/i,
    ],
  },
  {
    name: "rate_deal",
    priority: 18,
    patterns: [
      /\b(rate\s*deal|rate\s*seller|rate\s*buyer|give\s*rating|review\s*deal)\b/i,
      /\b(rating\s*do|review\s*do|stars\s*do)\b/i,
    ],
  },
  {
    name: "view_ratings",
    priority: 15,
    patterns: [
      /\b(ratings?|my\s*ratings?|view\s*ratings?|check\s*ratings?|reviews?)\b/i,
    ],
  },
  {
    name: "trade_score",
    priority: 15,
    patterns: [
      /\b(trade\s*score|my\s*score|trust\s*score|reputation|profile\s*score)\b/i,
      /\b(score\s*dikhao|meri\s*score|trust\s*level)\b/i,
    ],
  },
  {
    name: "view_matches",
    priority: 20,
    patterns: [
      /\b(matches?|ai\s*matches?|find\s*matches?|show\s*matches?|matching\s*buyers?)\b/i,
      /\b(match\s*dikhao|kaun\s*khareedega|matching\s*sellers?)\b/i,
    ],
  },
  {
    name: "select_match",
    priority: 22,
    patterns: [
      /\b(select\s*\d|choose\s*\d|pick\s*\d|send\s*to\s*\d)\b/i,
      /^\s*(select|choose|pick)\s+(\d+)\s*$/i,
    ],
  },
  {
    name: "packaging_guide",
    priority: 15,
    patterns: [
      /\b(packaging|pack\s*guide|packing\s*guide|how\s*to\s*pack|packaging\s*guide)\b/i,
    ],
  },
  {
    name: "notifications",
    priority: 18,
    patterns: [
      /\b(notifications?|alerts?|messages?|通知|notify|notification\s*list)\b/i,
      /\b(sandesh|message\s*list|alert\s*dikhao)\b/i,
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
    "register": "register",
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

  // If user mentioned a commodity, likely a product search
  const commodity = extractCommodity(normalized);
  if (commodity) {
    return { intent: "product_search", confidence: 0.5, method: "commodity_hint" };
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
    send_proposal: "Send Proposal",
    view_proposals: "View Proposals",
    accept_proposal: "Accept Proposal",
    reject_proposal: "Reject Proposal",
    counter_offer: "Counter Offer",
    request_info: "Request Info",
    create_requirement: "Create Requirement",
    view_requirements: "View Requirements",
    view_deals: "View Deals",
    update_deal: "Update Deal",
    deal_timeline: "Deal Timeline",
    rate_deal: "Rate Deal",
    view_ratings: "View Ratings",
    trade_score: "Trade Score",
    view_matches: "View Matches",
    select_match: "Select Match",
    packaging_guide: "Packaging Guide",
    notifications: "Notifications",
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
