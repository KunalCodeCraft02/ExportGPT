import crypto from "crypto";
import mongoose from "mongoose";
import AdminUser from "../models/AdminUser.js";
import Buyer from "../models/Buyer.js";
import BuyerLead from "../models/BuyerLead.js";
import Exporter from "../models/Exporter.js";
import Farmer from "../models/Farmer.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { sendLocalizedMessage } from "./whatsapp.service.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 20;
const PASSWORD_SALT = process.env.ADMIN_PASSWORD_SALT || "exportconnect-admin";

const PROFILE_MODELS = {
  exporter: Exporter,
  farmer: Farmer,
  buyer: Buyer,
};

const PROFILE_LABELS = {
  exporter: "Exporter",
  farmer: "Farmer / Seller",
  buyer: "Buyer",
};

const LEAD_STATUSES = ["pending", "accepted", "rejected", "logistics_connected", "completed"];

export function hashPassword(password) {
  return crypto.createHash("sha256").update(`${password}${PASSWORD_SALT}`).digest("hex");
}

export async function ensureAdminUser({ username, password, name = "Admin", role = "admin" }) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD are required.");
  }

  const passwordHash = hashPassword(password);
  return AdminUser.findOneAndUpdate(
    { username: normalizedUsername },
    {
      $set: {
        passwordHash,
        name: name || "Admin",
        role,
        active: true,
      },
      $setOnInsert: { username: normalizedUsername },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function validateAdminLogin(username, password) {
  const normalizedUsername = normalizeUsername(username);
  const configuredUsername = normalizeUsername(process.env.ADMIN_USERNAME);
  const configuredPassword = process.env.ADMIN_PASSWORD;

  if (configuredUsername && configuredPassword) {
    if (normalizedUsername !== configuredUsername || password !== configuredPassword) return null;

    return AdminUser.findOneAndUpdate(
      { username: configuredUsername },
      {
        $set: {
          passwordHash: hashPassword(configuredPassword),
          name: process.env.ADMIN_NAME || "Admin",
          role: process.env.ADMIN_ROLE || "admin",
          active: true,
        },
        $setOnInsert: { username: configuredUsername },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const admin = await AdminUser.findOne({ username: normalizedUsername, active: true });
  if (!admin || admin.passwordHash !== hashPassword(password || "")) return null;

  return admin;
}

export async function getAdminById(adminId) {
  if (!adminId || !mongoose.Types.ObjectId.isValid(adminId)) return null;
  return AdminUser.findById(adminId).select("name username role").lean();
}

export async function getDashboardStats() {
  const [
    farmers,
    exporters,
    buyers,
    leads,
    pendingExporters,
    pendingBuyers,
    pendingFarmers,
    rejectedExporterProfiles,
    rejectedBuyerProfiles,
    rejectedFarmerProfiles,
    pendingProducts,
    approvedProducts,
    rejectedProducts,
  ] = await Promise.all([
    Farmer.countDocuments(),
    Exporter.countDocuments(),
    Buyer.countDocuments(),
    BuyerLead.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Exporter.countDocuments({ verificationStatus: "pending" }),
    Buyer.countDocuments({ verificationStatus: "pending" }),
    Farmer.countDocuments({ verificationStatus: "pending" }),
    Exporter.countDocuments({ verificationStatus: "rejected" }),
    Buyer.countDocuments({ verificationStatus: "rejected" }),
    Farmer.countDocuments({ verificationStatus: "rejected" }),
    Product.countDocuments({ status: "pending" }),
    Product.countDocuments({ status: "approved" }),
    Product.countDocuments({ status: "rejected" }),
  ]);

  const leadStatusCounts = Object.fromEntries(leads.map((item) => [item._id, item.count]));

  return {
    farmers,
    exporters,
    buyers,
    users: await User.countDocuments(),
    leads: leads.reduce((total, item) => total + item.count, 0),
    leadStatusCounts,
    pendingExporters,
    pendingBuyers,
    pendingFarmers,
    pendingProfiles: pendingExporters + pendingBuyers + pendingFarmers,
    rejectedProfiles: rejectedExporterProfiles + rejectedBuyerProfiles + rejectedFarmerProfiles,
    pendingProducts,
    approvedProducts,
    rejectedProducts,
  };
}

export async function listProfiles({ role = "all", status = "pending", page = 1, limit = PAGE_SIZE } = {}) {
  const normalizedRole = normalizeProfileRole(role);
  const normalizedStatus = normalizeVerificationStatus(status);
  const pageNumber = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 100);

  const roles = normalizedRole === "all" ? Object.keys(PROFILE_MODELS) : [normalizedRole];
  const [counts, grouped] = await Promise.all([
    Promise.all(roles.map((profileRole) => PROFILE_MODELS[profileRole].countDocuments({ verificationStatus: normalizedStatus }))),
    Promise.all(roles.map((profileRole) => {
      const model = PROFILE_MODELS[profileRole];
      const query = { verificationStatus: normalizedStatus };

      return model
        .find(query)
        .sort({ createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean()
        .then((records) => records.map((record) => ({ ...record, profileRole })));
    })),
  ]);

  const profiles = grouped.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = counts.reduce((sum, count) => sum + count, 0);

  return {
    profiles: profiles.slice(0, pageSize),
    total,
    page: pageNumber,
    limit: pageSize,
    hasNextPage: pageNumber * pageSize < total,
  };
}

export async function approveProfile({ type, id, adminId }) {
  const model = getProfileModel(type);
  const profile = await model.findById(id);

  if (!profile) throw new Error("Profile not found.");

  profile.verified = true;
  profile.verificationStatus = "approved";
  profile.reviewedAt = new Date();
  profile.reviewedBy = adminId;
  profile.rejectionReason = undefined;

  await profile.save();
  await notifyProfileDecision(profile, type, true);

  return profile.toObject();
}

export async function rejectProfile({ type, id, adminId, reason }) {
  const model = getProfileModel(type);
  const profile = await model.findById(id);

  if (!profile) throw new Error("Profile not found.");

  const rejectionReason = String(reason || "Profile rejected by admin.").trim().slice(0, 500);

  profile.verified = false;
  profile.verificationStatus = "rejected";
  profile.reviewedAt = new Date();
  profile.reviewedBy = adminId;
  profile.rejectionReason = rejectionReason;

  await profile.save();
  await notifyProfileDecision(profile, type, false, rejectionReason);

  return profile.toObject();
}

export async function listLeads({ status = "all", page = 1, limit = PAGE_SIZE } = {}) {
  const normalizedStatus = LEAD_STATUSES.includes(status) ? status : "all";
  const pageNumber = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 100);
  const query = normalizedStatus === "all" ? {} : { status: normalizedStatus };

  const [leads, total] = await Promise.all([
    BuyerLead.find(query)
      .populate("farmerId", "name phone products state country")
      .populate("exporterId", "name companyName phone country")
      .populate("buyerId", "name companyName phone country")
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    BuyerLead.countDocuments(query),
  ]);

  return {
    leads,
    total,
    page: pageNumber,
    limit: pageSize,
    hasNextPage: pageNumber * pageSize < total,
    status: normalizedStatus,
  };
}

export async function updateLeadStatus({ id, status, adminId, notes }) {
  if (!LEAD_STATUSES.includes(status)) {
    throw new Error("Invalid lead status.");
  }

  const lead = await BuyerLead.findByIdAndUpdate(
    id,
    {
      status,
      reviewedAt: new Date(),
      reviewedBy: adminId,
      adminNotes: String(notes || "").trim().slice(0, 1000) || undefined,
    },
    { new: true }
  )
    .populate("farmerId", "name phone products state country")
    .populate("exporterId", "name companyName phone country")
    .populate("buyerId", "name companyName phone country")
    .lean();

  if (!lead) throw new Error("Lead not found.");

  return lead;
}

export async function listUsers({ page = 1, limit = PAGE_SIZE } = {}) {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(limit) || PAGE_SIZE, 1), 100);
  const [users, total] = await Promise.all([
    User.find()
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    User.countDocuments(),
  ]);

  return {
    users,
    total,
    page: pageNumber,
    limit: pageSize,
    hasNextPage: pageNumber * pageSize < total,
  };
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function normalizeProfileRole(role) {
  const normalized = String(role || "all").trim().toLowerCase();
  return PROFILE_MODELS[normalized] ? normalized : "all";
}

function normalizeVerificationStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return ["pending", "approved", "rejected"].includes(normalized) ? normalized : "pending";
}

function getProfileModel(type) {
  const normalizedType = normalizeProfileRole(type);
  const model = PROFILE_MODELS[normalizedType];

  if (!model) throw new Error("Invalid profile type.");
  return model;
}

async function notifyProfileDecision(profile, type, approved, reason) {
  const phone = profile.phone;
  if (!phone) return;

  const profileLabel = PROFILE_LABELS[type] || "profile";
  const message = approved
    ? `✅ Your ${profileLabel} profile has been approved.\n\nYou can now use the full marketplace features. Type *HELP* anytime to see available commands.`
    : `❌ Your ${profileLabel} profile was not approved.\n\nReason: ${reason || "Admin review failed."}\n\nPlease update your details and register again if needed.`;

  try {
    await sendLocalizedMessage(phone, message);
  } catch (error) {
    logger.warn(`Admin notification failed for ${phone}: ${error.message}`);
  }
}
