import Groq from "groq-sdk";
import systemPrompt from "../prompts/systemPrompt.js";
import logger from "../utils/logger.js";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

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

export { askGroq };
export default askGroq;
