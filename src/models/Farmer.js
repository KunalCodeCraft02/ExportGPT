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
    products: { type: [String], default: [], index: true },
    quantity: { type: String, trim: true },
    expectedPrice: { type: String, trim: true },
    harvestDate: { type: String, trim: true },
    packagingType: { type: String, trim: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

farmerSchema.index({ products: "text", name: "text", district: "text", state: "text" });
farmerSchema.index({ phone: 1, country: 1 });

export default mongoose.model("Farmer", farmerSchema);
