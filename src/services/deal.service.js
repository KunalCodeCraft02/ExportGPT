import Deal from "../models/Deal.js";
import Proposal from "../models/Proposal.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import Buyer from "../models/Buyer.js";
import Notification from "../models/Notification.js";
import { sendLocalizedMessage } from "./whatsapp.service.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 10;

const VALID_TRANSITIONS = {
  proposal_sent: ["accepted", "cancelled"],
  accepted: ["negotiation", "sample_requested", "order_confirmed", "cancelled"],
  negotiation: ["order_confirmed", "cancelled"],
  sample_requested: ["order_confirmed", "cancelled"],
  order_confirmed: ["packaging", "cancelled"],
  packaging: ["pickup_scheduled"],
  pickup_scheduled: ["in_transit"],
  in_transit: ["delivered"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
};

const SELLER_UPDATABLE = ["packaging", "pickup_scheduled", "in_transit", "delivered"];
const BUYER_UPDATABLE = ["accepted", "negotiation", "sample_requested", "order_confirmed", "delivered", "completed"];

export async function createDeal(proposalId) {
  const proposal = await Proposal.findById(proposalId).lean();
  if (!proposal) throw new Error("Proposal not found.");
  if (proposal.status !== "accepted") throw new Error("Proposal must be accepted to create a deal.");

  const existing = await Deal.findOne({ proposalId }).lean();
  if (existing) throw new Error("Deal already exists for this proposal.");

  const deal = await Deal.create({
    proposalId,
    sellerId: proposal.senderId,
    sellerType: proposal.senderType,
    buyerId: proposal.receiverId,
    buyerType: proposal.receiverType,
    productId: proposal.productId,
    status: "accepted",
    agreedPrice: proposal.expectedPrice,
    totalQuantity: proposal.quantity,
    stageHistory: [
      { status: "proposal_sent", timestamp: proposal.createdAt },
      { status: "accepted", timestamp: new Date() },
    ],
  });

  await notifyDealCreated(deal);
  return deal.toObject();
}

export async function updateDealStatus(dealId, newStatus, userId, notes = "") {
  const deal = await Deal.findById(dealId);
  if (!deal) throw new Error("Deal not found.");

  const allowed = VALID_TRANSITIONS[deal.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(`Cannot transition from "${deal.status}" to "${newStatus}".`);
  }

  if (!canUpdateStatus(deal, userId, newStatus)) {
    throw new Error("You do not have permission to update this deal status.");
  }

  deal.status = newStatus;
  deal.stageHistory.push({
    status: newStatus,
    timestamp: new Date(),
    updatedBy: userId,
    notes,
  });

  await deal.save();
  await notifyDealStatusUpdate(deal, newStatus, userId);

  return deal.toObject();
}

export async function getDealById(dealId) {
  return Deal.findById(dealId).lean();
}

export async function getDealsForUser(userId, { status, page = 1 } = {}) {
  const query = { $or: [{ sellerId: userId }, { buyerId: userId }] };
  if (status && status !== "all") {
    query.status = status;
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const [deals, total] = await Promise.all([
    Deal.find(query)
      .sort({ updatedAt: -1 })
      .skip((pageNumber - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Deal.countDocuments(query),
  ]);

  return {
    deals,
    total,
    page: pageNumber,
    hasNextPage: pageNumber * PAGE_SIZE < total,
  };
}

export function canUpdateStatus(deal, userId, newStatus) {
  const isSeller = deal.sellerId.toString() === userId.toString();
  const isBuyer = deal.buyerId.toString() === userId.toString();

  if (newStatus === "cancelled") return isSeller || isBuyer;
  if (isSeller) return SELLER_UPDATABLE.includes(newStatus);
  if (isBuyer) return BUYER_UPDATABLE.includes(newStatus);
  return false;
}

export function getDealTimeline(deal) {
  return (deal.stageHistory || [])
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((s) => {
      const date = new Date(s.timestamp).toLocaleDateString("en-IN");
      const time = new Date(s.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      return `✅ ${s.status.replace(/_/g, " ")} — ${date} ${time}` + (s.notes ? `\n   💬 ${s.notes}` : "");
    })
    .join("\n");
}

export function formatDealCard(deal, index) {
  const statusEmoji = {
    accepted: "✅", negotiation: "💬", sample_requested: "📦",
    order_confirmed: "📝", packaging: "📦", pickup_scheduled: "🚚",
    in_transit: "🚛", delivered: "📬", completed: "🎉", cancelled: "❌",
  };

  return (
    `*${index}. Deal #${deal._id.toString().slice(-6).toUpperCase()}*\n` +
    `📊 Status: ${statusEmoji[deal.status] || "❓"} ${deal.status.replace(/_/g, " ")}\n` +
    `💰 Agreed Price: ${deal.agreedPrice || "—"}\n` +
    `📦 Quantity: ${deal.totalQuantity || "—"}\n` +
    `📅 ${new Date(deal.updatedAt).toLocaleDateString("en-IN")}`
  );
}

export function formatDealDetail(deal) {
  const timeline = getDealTimeline(deal);

  return (
    `📋 *Deal #${deal._id.toString().slice(-6).toUpperCase()}*\n\n` +
    `📊 Status: *${deal.status.replace(/_/g, " ")}*\n` +
    `💰 Agreed Price: ${deal.agreedPrice || "—"}\n` +
    `📦 Quantity: ${deal.totalQuantity || "—"}\n\n` +
    `📅 *Timeline:*\n${timeline || "No history"}`
  );
}

async function notifyDealCreated(deal) {
  const sellerModel = deal.sellerType === "Farmer" ? Farmer : Exporter;
  const buyerModel = deal.buyerType === "Buyer" ? Buyer : Exporter;

  const [seller, buyer] = await Promise.all([
    sellerModel.findById(deal.sellerId).select("phone name companyName").lean(),
    buyerModel.findById(deal.buyerId).select("phone name companyName").lean(),
  ]);

  const sellerName = seller?.companyName || seller?.name || "Seller";
  const buyerName = buyer?.companyName || buyer?.name || "Buyer";

  if (seller?.phone) {
    await sendLocalizedMessage(seller.phone,
      `🎉 *Deal Created!*\n\nYour proposal was accepted by *${buyerName}*.\n\nDeal #${deal._id.toString().slice(-6).toUpperCase()} is now active.\n\nType *DEALS* to track your deals.`
    ).catch((err) => logger.warn(`Deal notification failed: ${err.message}`));
  }

  if (buyer?.phone) {
    await sendLocalizedMessage(buyer.phone,
      `🎉 *Deal Created!*\n\nYou accepted a proposal from *${sellerName}*.\n\nDeal #${deal._id.toString().slice(-6).toUpperCase()} is now active.\n\nType *DEALS* to track your deals.`
    ).catch((err) => logger.warn(`Deal notification failed: ${err.message}`));
  }
}

async function notifyDealStatusUpdate(deal, newStatus, updatedBy) {
  const isSellerUpdate = deal.sellerId.toString() === updatedBy.toString();
  const recipientModel = isSellerUpdate
    ? (deal.buyerType === "Buyer" ? Buyer : Exporter)
    : (deal.sellerType === "Farmer" ? Farmer : Exporter);
  const recipientId = isSellerUpdate ? deal.buyerId : deal.sellerId;

  const recipient = await recipientModel.findById(recipientId).select("phone").lean();
  if (!recipient?.phone) return;

  const statusMessages = {
    negotiation: "🔄 Deal is now in negotiation.",
    sample_requested: "📦 Sample has been requested.",
    order_confirmed: "📝 Order has been confirmed!",
    packaging: "📦 Packaging has started.",
    pickup_scheduled: "🚚 Pickup has been scheduled.",
    in_transit: "🚛 Shipment is in transit.",
    delivered: "📬 Product has been delivered!",
    completed: "🎉 Deal completed successfully!",
    cancelled: "❌ Deal has been cancelled.",
  };

  try {
    await sendLocalizedMessage(recipient.phone,
      `📋 *Deal Update*\n\nDeal #${deal._id.toString().slice(-6).toUpperCase()}\n\n${statusMessages[newStatus] || "Status updated."}`
    );
  } catch (err) {
    logger.warn(`Deal status notification failed: ${err.message}`);
  }
}
