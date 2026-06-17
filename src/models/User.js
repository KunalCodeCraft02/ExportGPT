import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "Unknown",
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    language: {
      type: String,
      default: "en",
    },
    location: {
      type: String,
      default: "India",
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
  }
);

const User = mongoose.model("User", userSchema);

export default User;