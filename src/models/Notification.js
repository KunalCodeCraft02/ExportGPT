import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userType: {
      type: String,
      required: true,
      enum: ["Farmer", "Exporter", "Buyer"],
    },
    type: {
      type: String,
      required: true,
      enum: [
        "proposal_received", "proposal_accepted", "proposal_rejected",
        "proposal_counter_offer", "proposal_info_requested",
        "deal_status_update", "deal_completed",
        "rating_received", "requirement_matched",
        "system",
      ],
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    referenceType: { type: String, trim: true },
    read: { type: Boolean, default: false },
    sentViaWhatsApp: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
