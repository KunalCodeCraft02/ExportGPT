import Requirement from "../models/Requirement.js";
import Notification from "../models/Notification.js";
import Farmer from "../models/Farmer.js";
import { sendLocalizedMessage } from "./whatsapp.service.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 10;

export async function createRequirement({ creatorId, creatorType, commodity, quantity, expectedPrice, requiredDate, deliveryLocation, notes }) {
  const requirement = await Requirement.create({
    creatorId,
    creatorType,
    commodity: String(commodity || "").trim(),
    quantity: String(quantity || "").trim(),
    expectedPrice: String(expectedPrice || "").trim(),
    requiredDate: requiredDate || null,
    deliveryLocation: String(deliveryLocation || "").trim(),
    notes: String(notes || "").trim(),
    status: "active",
  });

  return requirement.toObject();
}

export async function getRequirementsForUser(creatorId, { status, page = 1 } = {}) {
  const query = { creatorId };
  if (status && status !== "all") {
    query.status = status;
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const [requirements, total] = await Promise.all([
    Requirement.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Requirement.countDocuments(query),
  ]);

  return {
    requirements,
    total,
    page: pageNumber,
    hasNextPage: pageNumber * PAGE_SIZE < total,
  };
}

export async function updateRequirement(requirementId, data) {
  return Requirement.findByIdAndUpdate(requirementId, { $set: data }, { new: true }).lean();
}

export async function cancelRequirement(requirementId) {
  return Requirement.findByIdAndUpdate(requirementId, { status: "cancelled" }, { new: true }).lean();
}

export async function searchRequirements({ commodity, page = 1 } = {}) {
  const query = { status: "active" };
  if (commodity) {
    query.commodity = new RegExp(String(commodity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const [requirements, total] = await Promise.all([
    Requirement.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Requirement.countDocuments(query),
  ]);

  return {
    requirements,
    total,
    page: pageNumber,
    hasNextPage: pageNumber * PAGE_SIZE < total,
  };
}

export function formatRequirementCard(req, index) {
  return (
    `*${index}. ${req.commodity}*\n` +
    `📊 Qty: ${req.quantity || "—"}\n` +
    `💰 Price: ${req.expectedPrice || "—"}\n` +
    `📍 ${req.deliveryLocation || "—"}\n` +
    `📅 Need by: ${req.requiredDate ? new Date(req.requiredDate).toLocaleDateString("en-IN") : "Flexible"}\n` +
    `📊 Status: ${req.status}`
  );
}

export function formatRequirementResults(results) {
  const { requirements, total, hasNextPage, page } = results;
  if (!requirements.length) {
    return "❌ No active requirements found.";
  }

  const cards = requirements.map((r, i) => formatRequirementCard(r, i + 1)).join("\n\n");
  const pagination = hasNextPage ? `\n\n📄 Page ${page}. Type *MORE* for next.` : "";

  return `📋 *Active Requirements* (${total})\n\n${cards}${pagination}`;
}
