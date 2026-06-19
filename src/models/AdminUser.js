import mongoose from "mongoose";

const adminUserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      trim: true,
      default: "Admin",
    },
    role: {
      type: String,
      enum: ["admin", "super_admin"],
      default: "admin",
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

adminUserSchema.index({ username: 1 });

export default mongoose.model("AdminUser", adminUserSchema);
