import mongoose from "mongoose";

const dealSchema = new mongoose.Schema(
  {
    proposalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Proposal",
      required: true,
      unique: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "sellerType",
      index: true,
    },
    sellerType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter"],
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "buyerType",
      index: true,
    },
    buyerType: {
      type: String,
      required: true,
      enum: ["Buyer", "Exporter"],
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    status: {
      type: String,
      enum: [
        "proposal_sent", "accepted", "negotiation", "sample_requested",
        "order_confirmed", "packaging", "pickup_scheduled", "in_transit",
        "delivered", "completed", "cancelled",
      ],
      default: "proposal_sent",
      index: true,
    },
    stageHistory: [
      {
        status: String,
        timestamp: { type: Date, default: Date.now },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "AdminUser" },
        notes: { type: String, trim: true },
      },
    ],
    agreedPrice: { type: String, trim: true },
    totalQuantity: { type: String, trim: true },
    packagingGuideSent: { type: Boolean, default: false },
    logisticsPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    logisticsStatus: { type: String, trim: true },
    sellerRatingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rating",
      default: null,
    },
    buyerRatingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rating",
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

dealSchema.index({ sellerId: 1, status: 1 });
dealSchema.index({ buyerId: 1, status: 1 });
dealSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Deal", dealSchema);
