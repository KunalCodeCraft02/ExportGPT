import mongoose from "mongoose";

const logisticsPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    companyName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true },
    serviceAreas: { type: [String], default: [] }, // states / countries they cover
    services: { type: [String], default: [] },     // ["cold storage", "air freight", "sea freight"]
    ratePerKg: { type: String, trim: true },
    website: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("LogisticsPartner", logisticsPartnerSchema);