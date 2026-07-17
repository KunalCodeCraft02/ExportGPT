import mongoose from "mongoose";

const ratingSchema = new mongoose.Schema(
  {
    dealId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deal",
      required: true,
      index: true,
    },
    raterId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    raterType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter", "Buyer"],
    },
    rateeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    rateeType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter", "Buyer"],
    },
    stars: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, trim: true },
    deliveryExperience: { type: Number, min: 1, max: 5 },
    communication: { type: Number, min: 1, max: 5 },
    paymentTimeliness: { type: Number, min: 1, max: 5 },
    quality: { type: Number, min: 1, max: 5 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

ratingSchema.index({ dealId: 1 });
ratingSchema.index({ rateeId: 1, rateeType: 1 });

export default mongoose.model("Rating", ratingSchema);
