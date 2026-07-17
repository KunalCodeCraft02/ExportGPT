import mongoose from "mongoose";

const packagingGuideSchema = new mongoose.Schema(
  {
    commodity: { type: String, required: true, unique: true, trim: true },
    recommendedPackaging: { type: String, trim: true },
    bagType: { type: String, trim: true },
    weight: { type: String, trim: true },
    labelRequirements: { type: String, trim: true },
    storage: { type: String, trim: true },
    handlingTips: { type: String, trim: true },
    exportNotes: { type: String, trim: true },
    documentsNeeded: [{ type: String }],
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export default mongoose.model("PackagingGuide", packagingGuideSchema);
