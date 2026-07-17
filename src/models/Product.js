import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "ownerType",
      index: true,
    },
    ownerType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter"],
      index: true,
    },
    productName: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    price: { type: String, trim: true },
    unit: { type: String, trim: true, default: "kg" },
    quantity: { type: String, trim: true },
    qualityGrade: { type: String, trim: true },
    village: { type: String, trim: true },
    district: { type: String, trim: true, index: true },
    state: { type: String, trim: true, index: true },
    country: { type: String, trim: true, index: true },
    images: { type: [String], default: [] },
    imagePublicIds: { type: [String], default: [] },
    thumbnail: { type: String, trim: true },
    thumbnailPublicId: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    availableUntil: { type: Date },
    certifications: { type: [String], default: [] },
    minOrderQuantity: { type: String, trim: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "paused", "sold"],
      default: "pending",
      index: true,
    },
    approvalReason: { type: String, trim: true },
    views: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

productSchema.index({ productName: "text", description: "text", category: "text" });
productSchema.index({ status: 1, createdAt: -1 });
productSchema.index({ ownerId: 1, status: 1 });

export default mongoose.model("Product", productSchema);
