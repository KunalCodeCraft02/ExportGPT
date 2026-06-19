import mongoose from "mongoose";

const escrowRequestSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuyerLead",
      required: true,
      index: true,
    },
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Farmer",
      required: true,
    },
    exporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exporter",
      required: true,
    },
    amount: { type: String, trim: true },
    currency: { type: String, default: "INR" },
    status: {
      type: String,
      enum: ["requested", "funded", "released", "disputed", "refunded"],
      default: "requested",
      index: true,
    },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("EscrowRequest", escrowRequestSchema);