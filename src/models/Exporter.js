import mongoose from "mongoose";

const exporterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    companyName: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true, index: true },
    country: { type: String, required: true, trim: true, index: true },
    preferredLanguage: {
      type: String,
      enum: ["english", "hindi", "marathi"],
      default: "english",
    },
    iecNumber: { type: String, trim: true, uppercase: true, index: true },
    gstin: { type: String, trim: true, uppercase: true },
    website: { type: String, trim: true },
    products: { type: [String], default: [], index: true },
    exportCountries: { type: [String], default: [] },
    capacity: { type: String, trim: true },
    certifications: { type: [String], default: [] },
    experience: { type: Number, min: 0 },
    tradeScoreId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TradeScore",
      default: null,
    },
    overallRating: { type: Number, default: 0, min: 0, max: 5 },
    totalDeals: { type: Number, default: 0 },
    gstVerified: { type: Boolean, default: false },
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

exporterSchema.index({ products: "text", companyName: "text", name: "text", country: "text" });
exporterSchema.index({ companyName: 1, country: 1 });
exporterSchema.index({ verificationStatus: 1, createdAt: -1 });

export default mongoose.model("Exporter", exporterSchema);
