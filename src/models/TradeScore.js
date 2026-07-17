import mongoose from "mongoose";

const tradeScoreSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter", "Buyer"],
    },
    tradeScore: { type: Number, default: 0, min: 0, max: 100 },
    successfulOrders: { type: Number, default: 0 },
    totalQuantitySold: { type: Number, default: 0 },
    averageResponseTime: { type: Number, default: 0 },
    repeatBuyers: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    totalRatings: { type: Number, default: 0 },
    trustLevel: {
      type: String,
      enum: ["new", "bronze", "silver", "gold", "platinum"],
      default: "new",
    },
    countriesExported: [{ type: String }],
    gstVerified: { type: Boolean, default: false },
    iecVerified: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

export default mongoose.model("TradeScore", tradeScoreSchema);
