import mongoose from "mongoose";

const proposalSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "senderType",
      index: true,
    },
    senderType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter"],
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "receiverType",
      index: true,
    },
    receiverType: {
      type: String,
      required: true,
      enum: ["Buyer", "Exporter"],
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    requirementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Requirement",
      default: null,
    },
    productName: { type: String, trim: true },
    quantity: { type: String, trim: true },
    qualityGrade: { type: String, trim: true },
    location: { type: String, trim: true },
    images: { type: [String], default: [] },
    expectedPrice: { type: String, trim: true },
    message: { type: String, trim: true },
    deliveryAvailability: { type: String, trim: true },
    status: {
      type: String,
      enum: ["submitted", "accepted", "rejected", "counter_offer", "info_requested"],
      default: "submitted",
      index: true,
    },
    counterPrice: { type: String, trim: true },
    counterMessage: { type: String, trim: true },
    infoRequestMessage: { type: String, trim: true },
    viewedAt: { type: Date },
    respondedAt: { type: Date },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
    adminNotes: { type: String, trim: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

proposalSchema.index({ senderId: 1, status: 1 });
proposalSchema.index({ receiverId: 1, status: 1 });
proposalSchema.index({ productId: 1 });
proposalSchema.index({ createdAt: -1 });

export default mongoose.model("Proposal", proposalSchema);
