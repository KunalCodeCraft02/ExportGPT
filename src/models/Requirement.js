import mongoose from "mongoose";

const requirementSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    creatorType: {
      type: String,
      required: true,
      enum: ["Buyer", "Exporter"],
    },
    commodity: { type: String, required: true, trim: true, index: true },
    quantity: { type: String, trim: true },
    expectedPrice: { type: String, trim: true },
    requiredDate: { type: Date },
    deliveryLocation: { type: String, trim: true },
    notes: { type: String, trim: true },
    status: {
      type: String,
      enum: ["active", "fulfilled", "expired", "cancelled"],
      default: "active",
      index: true,
    },
    matchedSellerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Farmer" }],
    matchCount: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

requirementSchema.index({ creatorId: 1, status: 1 });
requirementSchema.index({ commodity: 1, status: 1 });
requirementSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("Requirement", requirementSchema);
