/**
 * Language Detector — automatic detection of user's dominant language.
 *
 * Supports: English, Hindi (Devanagari script), Hinglish (Roman Hindi),
 *           Marathi (Devanagari with Marathi markers), Mixed.
 *
 * Strategy:
 *   1. If text contains Devanagari characters → Hindi or Marathi
 *   2. If text is Roman script but contains known Hindi/Marathi words → Hinglish
 *   3. Otherwise → English
 *
 * Detection is pure rule-based (no API call) and runs in < 5ms.
 */

// ── Devanagari Unicode range ─────────────────────────────────────────────────
const DEVANAGARI_RANGE = /[\u0900-\u097F]/;

// ── Marathi-specific markers (Marathi uses Devanagari but has distinct words) ─
const MARATHI_MARKERS = [
  "आहे", "आहेत", "नाही", "करायचं", "करायचा", "करायची",
  "मला", "तुम्हाला", "म्हणून", "म्हणजे", "येते", "जाते",
  "सांग", "सांगा", "बतवा", "काय", "कसं", "कसे", "कुठे",
  "कधी", "कोण", "आणि", "पण", "तरी", "म्हणूनच",
  "झालं", "झाला", "झाली", "होतं", "होता", "होती",
  "द्या", "घ्या", "पाठवा", "लिहा", "बघा", "शक्य",
  "कांद्याचा", "कांदा", "भाव", "शेती", "शेतकरी",
];

// ── Common Hindi words in Roman script (Hinglish markers) ────────────────────
const HINGLISH_WORDS = [
  // Common Hindi verbs
  "batao", "bata", "bataye", "karo", "kar", "karna", "ho", "hai", "hain",
  "tha", "thi", "the", "hoga", "hogi", "honge",
  "jao", "aao", "chalo", "ruko", "dekhlo", "suno",
  // Common Hindi nouns
  "price", "rate", "bhav", "bhaav", "daam", "dam",
  "kisan", "kisaan", "kheti", "fasal", "paida",
  "sabzi", "sabji", "phal", "anaaj",
  // Common Hindi pronouns & particles
  "mujhe", "mera", "meri", "mere", "tumhara", "tumhari",
  "yeh", "woh", "ye", "uska", "iska",
  "ko", "se", "mein", "ke", "ka", "ki",
  "aur", "ya", "par", "pe", "me",
  "nahi", "nahin", "haan", "ji", "bhai",
  // Market-related
  "mandi", "kisan", "khet", "zameen",
  "aaj", "kal", "abhi", "jaldi",
  // Greetings
  "namaste", "namaskar", "pranam", "sat sri akal",
  // Hinglish patterns
  "ka", "ki", "ke", "ko", "me", "se", "ne", "pe",
  "batao", "batado", "bataiye", "bataega",
  "chahiye", "chahiye", "chahta", "chahti",
  "kaise", "kaisa", "kaisi", "kyun", "kyu",
  "sir", "bhaiya", "didi", "anna", "tai",
];

// ── Marathi words in Roman script ────────────────────────────────────────────
const MARATHI_ROMAN_WORDS = [
  "ahe", "ahet", "nahi", "karaycha", "karayc", "karaycha",
  "mala", "tumhala", "mhanun", "mhanje", "yet", "jat",
  "sanga", "bagh", "kaay", "kase", "kuthe", "kon",
  "aani", "pan", "tarhi", "zhala", "hota", "hoti",
  "dya", "ghya", "pawha", "liha", "shakya",
  "kandyacha", "kanda", "bhav", "sheti", "shetkari",
];

// ── Script detection ─────────────────────────────────────────────────────────
function containsDevanagari(text) {
  return DEVANAGARI_RANGE.test(text);
}

function devanagariRatio(text) {
  if (!text) return 0;
  const devanagariChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  const totalChars = text.replace(/\s+/g, "").length;
  return totalChars > 0 ? devanagariChars / totalChars : 0;
}

// ── Word-level detection ─────────────────────────────────────────────────────
function countRomanWords(text, wordList) {
  const words = text.toLowerCase().split(/[\s,.\-!?]+/).filter(Boolean);
  let count = 0;
  for (const word of words) {
    if (wordList.includes(word)) count++;
  }
  return count;
}

// ── Main detection function ──────────────────────────────────────────────────
export function detectLanguage(text) {
  const raw = String(text || "").trim();
  if (!raw) return { language: "english", confidence: 1.0, method: "empty" };

  // 1. Devanagari script detected
  if (containsDevanagari(raw)) {
    const ratio = devanagariRatio(raw);

    // Check for Marathi-specific markers
    const marathiHits = countRomanWords(raw, MARATHI_MARKERS);
    if (marathiHits > 0 || MARATHI_MARKERS.some((m) => raw.includes(m))) {
      return { language: "marathi", confidence: 0.85, method: "devanagari_marathi_markers" };
    }

    // Default Devanagari → Hindi
    return { language: "hindi", confidence: Math.min(0.6 + ratio * 0.4, 1.0), method: "devanagari_script" };
  }

  // 2. Roman script — check for Hinglish or Marathi Roman
  const lower = raw.toLowerCase();

  const marathiRomanHits = countRomanWords(lower, MARATHI_ROMAN_WORDS);
  if (marathiRomanHits >= 2) {
    return { language: "marathi", confidence: 0.8, method: "marathi_roman_words" };
  }

  const hinglishHits = countRomanWords(lower, HINGLISH_WORDS);
  const wordCount = lower.split(/\s+/).filter(Boolean).length;
  const hinglishRatio = wordCount > 0 ? hinglishHits / wordCount : 0;

  if (hinglishHits >= 2 || hinglishRatio > 0.3) {
    return { language: "hinglish", confidence: Math.min(0.6 + hinglishRatio * 0.4, 0.95), method: "hinglish_words" };
  }

  // 3. Default → English
  return { language: "english", confidence: 0.9, method: "default_english" };
}

/**
 * Detect language from conversation context.
 * If the user's last 3 messages were in Hindi, keep Hindi even if this
 * message is short/ambiguous.
 */
export function detectLanguageWithContext(text, recentLanguages = []) {
  const current = detectLanguage(text);

  // If confidence is high, use current detection
  if (current.confidence >= 0.8) return current;

  // If we have conversation history, lean toward the dominant language
  if (recentLanguages.length > 0) {
    const langCounts = {};
    for (const lang of recentLanguages) {
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
    const dominant = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0];
    if (dominant && dominant[1] >= 2) {
      return {
        language: dominant[0],
        confidence: 0.75,
        method: "context_override",
        detectedFirst: current.language,
      };
    }
  }

  return current;
}

export default { detectLanguage, detectLanguageWithContext };
