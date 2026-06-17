import mongoose from "mongoose";

const conversationStateSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true, trim: true },
    role: { type: String, trim: true },
    currentStep: { type: String, required: true, trim: true },
    tempData: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

conversationStateSchema.index({ role: 1, currentStep: 1 });

export default mongoose.model("ConversationState", conversationStateSchema);
