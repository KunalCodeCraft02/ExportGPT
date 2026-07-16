import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    // NLP analysis of user messages
    intent: { type: String },
    language: { type: String },
    entities: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Index for fetching recent messages per user
chatMessageSchema.index({ phone: 1, createdAt: -1 });

// TTL index: auto-delete messages older than 30 days
chatMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.model("ChatMessage", chatMessageSchema);
