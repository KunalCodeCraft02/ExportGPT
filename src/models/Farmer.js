import mongoose from "mongoose";

const farmerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    village: { type: String, trim: true },
    district: { type: String, trim: true, index: true },
    state: { type: String, required: true, trim: true, index: true },
    country: { type: String, required: true, trim: true, index: true },
    preferredLanguage: {
      type: String,
      enum: ["english", "hindi", "marathi"],
      default: "english",
    },
    products: { type: [String], default: [], index: true },
    quantity: { type: String, trim: true },
    expectedPrice: { type: String, trim: true },
    harvestDate: { type: String, trim: true },
    packagingType: { type: String, trim: true },
    verified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    rejectionReason: { type: String, trim: true },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminUser",
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

farmerSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $exists: true, $ne: null, $ne: "" } } });
farmerSchema.index({ products: "text", name: "text", district: "text", state: "text" });
farmerSchema.index({ phone: 1, country: 1 });
farmerSchema.index({ verificationStatus: 1, createdAt: -1 });

export default mongoose.model("Farmer", farmerSchema);
