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
    iecNumber: { type: String, trim: true, uppercase: true, index: true },
    website: { type: String, trim: true },
    products: { type: [String], default: [], index: true },
    exportCountries: { type: [String], default: [] },
    capacity: { type: String, trim: true },
    certifications: { type: [String], default: [] },
    experience: { type: Number, min: 0 },
    verified: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

exporterSchema.index({ products: "text", companyName: "text", name: "text", country: "text" });
exporterSchema.index({ companyName: 1, country: 1 });

export default mongoose.model("Exporter", exporterSchema);
