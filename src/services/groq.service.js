import Groq from "groq-sdk";
import systemPrompt from "../prompts/systemPrompt.js";
import logger from "../utils/logger.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Simple single-message Groq call (backward compatible).
 */
const askGroq = async (question) => {
  try {
    logger.info(`Groq request: "${question}"`);

    const chatCompletion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: question,
        },
      ],
      temperature: 0.7,
      max_tokens: 512,
    });

    const reply = chatCompletion.choices[0]?.message?.content || "Sorry, I could not generate a response. Please try again.";

    logger.info(`Groq response received (${reply.length} chars)`);
    return reply;
  } catch (error) {
    logger.error(`Groq API error: ${error.message}`);
    return "Sorry, the AI service is currently unavailable. Please try again later.";
  }
};

/**
 * Groq call with conversation history and language-aware prompt.
 *
 * @param {string} question - The user's current message
 * @param {object} options
 * @param {Array} options.history - Recent conversation messages [{ role, content }]
 * @param {string} options.language - Detected language
 * @param {string} options.systemPromptOverride - Custom system prompt
 * @param {number} options.maxTokens - Max tokens (default 512)
 */
const askGroqWithContext = async (question, options = {}) => {
  try {
    const {
      history = [],
      language = "english",
      systemPromptOverride = null,
      maxTokens = 512,
    } = options;

    // Build language-aware system prompt
    const langInstruction = getLanguageInstruction(language);
    const finalSystemPrompt = systemPromptOverride || `${systemPrompt}\n\n${langInstruction}`;

    // Build message history
    const messages = [{ role: "system", content: finalSystemPrompt }];

    // Add conversation history (last 10 messages)
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    // Add current message
    messages.push({ role: "user", content: question });

    logger.info(`Groq request (ctx, lang=${language}, history=${recentHistory.length}): "${question.substring(0, 80)}"`);

    const chatCompletion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_tokens: maxTokens,
    });

    const reply = chatCompletion.choices[0]?.message?.content || "Sorry, I could not generate a response. Please try again.";

    logger.info(`Groq response received (${reply.length} chars)`);
    return reply;
  } catch (error) {
    logger.error(`Groq API error: ${error.message}`);
    return "Sorry, the AI service is currently unavailable. Please try again later.";
  }
};

/**
 * Get language instruction for the system prompt.
 */
function getLanguageInstruction(language) {
  const instructions = {
    english: "Respond in English.",
    hindi: "Respond in Hindi (हिन्दी). Use Devanagari script. Keep it simple and farmer-friendly.",
    marathi: "Respond in Marathi (मराठी). Use Devanagari script. Keep it simple and farmer-friendly.",
    hinglish: "Respond in natural Hinglish — a mix of Hindi and English as commonly spoken in India. Use Roman script. Example: 'Aapka onion price aaj Nashik mein ₹1800/quintal hai.'",
  };
  return instructions[language] || instructions.english;
}

export { askGroq, askGroqWithContext, getLanguageInstruction };
export default askGroq;
