import mongoose from "mongoose";

const buyerLeadSchema = new mongoose.Schema(
  {
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Farmer",
      required: true,
      index: true,
    },
    exporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exporter",
      required: true,
      index: true,
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Buyer",
      default: null,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    product: { type: String, trim: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "logistics_connected", "completed"],
      default: "pending",
      index: true,
    },
    logisticsPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LogisticsPartner",
      default: null,
    },
    packagingGuidanceSent: { type: Boolean, default: false },
    escrowRequested: { type: Boolean, default: false },
    reviewedAt: { type: Date },
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

buyerLeadSchema.index({ farmerId: 1, exporterId: 1, status: 1 });
buyerLeadSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("BuyerLead", buyerLeadSchema);