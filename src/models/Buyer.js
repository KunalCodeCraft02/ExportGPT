import mongoose from "mongoose";

const buyerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    companyName: { type: String, trim: true },
    country: { type: String, required: true, trim: true, index: true },
    state: { type: String, trim: true, index: true },
    city: { type: String, trim: true },
    preferredLanguage: {
      type: String,
      enum: ["english", "hindi", "marathi"],
      default: "english",
    },
    productsNeeded: { type: [String], default: [], index: true },
    quantityRequired: { type: String, trim: true },
    targetPrice: { type: String, trim: true },
    deliveryTimeline: { type: String, trim: true },
    paymentTerms: { type: String, trim: true },
    verified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    rejectionReason: { type: String, trim: true },
    reviewedAt: { type: Date },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

buyerSchema.index({ productsNeeded: "text", companyName: "text", country: "text" });
buyerSchema.index({ verificationStatus: 1, createdAt: -1 });

export default mongoose.model("Buyer", buyerSchema);