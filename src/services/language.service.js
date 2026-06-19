import askGroq from "./groq.service.js";

const translationCache = new Map();

const LANGUAGE_LABELS = {
  english: "English",
  hindi: "Hindi",
  marathi: "Marathi",
};

export function normalizeLanguage(language) {
  const normalized = String(language || "english").trim().toLowerCase();

  if (["english", "en"].includes(normalized)) return "english";
  if (["hindi", "hi", "hin"].includes(normalized)) return "hindi";
  if (["marathi", "mr", "mar"].includes(normalized)) return "marathi";

  return "english";
}

export async function translateText(text, language) {
  const targetLanguage = normalizeLanguage(language);
  const sourceText = String(text || "");

  if (!sourceText || targetLanguage === "english") {
    return sourceText;
  }

  const cacheKey = `${targetLanguage}:${sourceText}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const targetLabel = LANGUAGE_LABELS[targetLanguage] || "English";
  const translated = await askGroq(
    `Translate the following WhatsApp marketplace message to ${targetLabel}. Preserve emojis, line breaks, bold markdown asterisks, numbers, and placeholders exactly. Return only the translated message.\n\n${sourceText}`
  );

  translationCache.set(cacheKey, translated);
  return translated;
}
