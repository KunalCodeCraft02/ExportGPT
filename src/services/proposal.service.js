import Proposal from "../models/Proposal.js";
import Product from "../models/Product.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import Buyer from "../models/Buyer.js";
import Notification from "../models/Notification.js";
import { sendLocalizedMessage } from "./whatsapp.service.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 10;

export async function createProposal({ senderId, senderType, receiverId, receiverType, productId, data }) {
  const existing = await Proposal.findOne({
    senderId,
    productId,
    receiverId,
    status: { $in: ["submitted", "counter_offer", "info_requested"] },
  }).lean();

  if (existing) {
    throw new Error("You have already sent a proposal for this product to this buyer.");
  }

  const product = await Product.findById(productId).lean();
  if (!product) throw new Error("Product not found.");

  const proposal = await Proposal.create({
    senderId,
    senderType,
    receiverId,
    receiverType,
    productId,
    requirementId: data.requirementId || null,
    productName: product.productName,
    quantity: data.quantity || product.quantity,
    qualityGrade: data.qualityGrade || product.qualityGrade,
    location: [product.village, product.district, product.state, product.country].filter(Boolean).join(", "),
    images: product.images || [],
    expectedPrice: data.expectedPrice || product.price,
    message: data.message || "",
    deliveryAvailability: data.deliveryAvailability || "",
    status: "submitted",
  });

  await createProposalNotification(proposal, senderType);
  await sendProposalWhatsApp(proposal, receiverId, receiverType);

  return proposal.toObject();
}

export async function respondToProposal(proposalId, action, { userId, counterPrice, counterMessage, infoRequestMessage }) {
  const proposal = await Proposal.findById(proposalId);
  if (!proposal) throw new Error("Proposal not found.");

  if (proposal.receiverId.toString() !== userId.toString()) {
    throw new Error("You can only respond to proposals addressed to you.");
  }

  const now = new Date();

  switch (action) {
    case "accept":
      proposal.status = "accepted";
      proposal.respondedAt = now;
      break;
    case "reject":
      proposal.status = "rejected";
      proposal.respondedAt = now;
      break;
    case "counter_offer":
      proposal.status = "counter_offer";
      proposal.counterPrice = counterPrice;
      proposal.counterMessage = counterMessage || "";
      proposal.respondedAt = now;
      break;
    case "info_request":
      proposal.status = "info_requested";
      proposal.infoRequestMessage = infoRequestMessage || "Please provide more details.";
      proposal.respondedAt = now;
      break;
    default:
      throw new Error("Invalid action.");
  }

  await proposal.save();

  await createProposalStatusNotification(proposal, action);
  await sendProposalStatusWhatsApp(proposal, action);

  return proposal.toObject();
}

export async function getProposalsForUser(userId, { status, page = 1, direction = "all" } = {}) {
  const query = {};
  if (direction === "sent") {
    query.senderId = userId;
  } else if (direction === "received") {
    query.receiverId = userId;
  } else {
    query.$or = [{ senderId: userId }, { receiverId: userId }];
  }

  if (status && status !== "all") {
    query.status = status;
  }

  const pageNumber = Math.max(Number(page) || 1, 1);
  const [proposals, total] = await Promise.all([
    Proposal.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Proposal.countDocuments(query),
  ]);

  return {
    proposals,
    total,
    page: pageNumber,
    hasNextPage: pageNumber * PAGE_SIZE < total,
  };
}

export async function getProposalById(proposalId) {
  return Proposal.findById(proposalId).lean();
}

export function formatProposalCard(proposal, index) {
  const statusEmoji = {
    submitted: "📤", accepted: "✅", rejected: "❌",
    counter_offer: "💰", info_requested: "❓",
  };

  return (
    `*${index}. ${proposal.productName || "Product"}*\n` +
    `📊 Qty: ${proposal.quantity || "—"}\n` +
    `💰 Price: ${proposal.expectedPrice || "—"}\n` +
    `📍 ${proposal.location || "—"}\n` +
    `${statusEmoji[proposal.status] || "❓"} Status: ${proposal.status.replace(/_/g, " ")}\n` +
    `📅 ${new Date(proposal.createdAt).toLocaleDateString("en-IN")}`
  );
}

export function formatProposalDetail(proposal) {
  return (
    `📋 *Proposal Detail*\n\n` +
    `📦 Product: ${proposal.productName || "—"}\n` +
    `📊 Quantity: ${proposal.quantity || "—"}\n` +
    `⭐ Quality: ${proposal.qualityGrade || "—"}\n` +
    `💰 Price: ${proposal.expectedPrice || "—"}\n` +
    `📍 Location: ${proposal.location || "—"}\n` +
    `📅 Delivery: ${proposal.deliveryAvailability || "—"}\n\n` +
    `💬 Message:\n${proposal.message || "No message"}\n\n` +
    `📊 Status: *${proposal.status.replace(/_/g, " ")}*` +
    (proposal.counterPrice ? `\n\n💰 Counter Offer: ${proposal.counterPrice}` : "") +
    (proposal.counterMessage ? `\n💬 ${proposal.counterMessage}` : "") +
    (proposal.infoRequestMessage ? `\n\n❓ Info Requested: ${proposal.infoRequestMessage}` : "")
  );
}

async function createProposalNotification(proposal, senderType) {
  const senderModel = senderType === "Farmer" ? Farmer : Exporter;
  const sender = await senderModel.findById(proposal.senderId).select("name companyName").lean();
  const senderName = sender?.companyName || sender?.name || "Seller";

  await Notification.create({
    userId: proposal.receiverId,
    userType: proposal.receiverType,
    type: "proposal_received",
    title: "New Proposal Received",
    message: `You received a proposal for ${proposal.productName} from ${senderName}.`,
    referenceId: proposal._id,
    referenceType: "Proposal",
  });
}

async function createProposalStatusNotification(proposal, action) {
  const statusMessages = {
    accept: "Your proposal has been accepted!",
    reject: "Your proposal was not accepted.",
    counter_offer: `Counter offer received: ${proposal.counterPrice}`,
    info_request: "Buyer requested more information.",
  };

  await Notification.create({
    userId: proposal.senderId,
    userType: proposal.senderType,
    type: `proposal_${action === "accept" ? "accepted" : action === "reject" ? "rejected" : action}`,
    title: `Proposal ${action.replace(/_/g, " ")}`,
    message: statusMessages[action] || "Proposal status updated.",
    referenceId: proposal._id,
    referenceType: "Proposal",
  });
}

async function sendProposalWhatsApp(proposal, receiverId, receiverType) {
  const Model = receiverType === "Buyer" ? Buyer : Exporter;
  const receiver = await Model.findById(receiverId).select("phone").lean();
  if (!receiver?.phone) return;

  const senderModel = proposal.senderType === "Farmer" ? Farmer : Exporter;
  const sender = await senderModel.findById(proposal.senderId).select("name companyName").lean();
  const senderName = sender?.companyName || sender?.name || "Seller";

  const message =
    `📋 *New Proposal*\n\n` +
    `From: *${senderName}*\n` +
    `Product: ${proposal.productName}\n` +
    `Quantity: ${proposal.quantity || "—"}\n` +
    `Price: ${proposal.expectedPrice || "—"}\n` +
    `Location: ${proposal.location || "—"}\n\n` +
    `💬 ${proposal.message || "No message"}\n\n` +
    `Reply:\n1 Accept\n2 Reject\n3 Counter Offer\n4 Request Info`;

  try {
    await sendLocalizedMessage(receiver.phone, message);
  } catch (err) {
    logger.warn(`WhatsApp proposal notification failed: ${err.message}`);
  }
}

async function sendProposalStatusWhatsApp(proposal, action) {
  const senderModel = proposal.senderType === "Farmer" ? Farmer : Exporter;
  const sender = await senderModel.findById(proposal.senderId).select("phone name companyName").lean();
  if (!sender?.phone) return;

  const messages = {
    accept: `✅ Your proposal for *${proposal.productName}* has been accepted!`,
    reject: `❌ Your proposal for *${proposal.productName}* was not accepted.`,
    counter_offer: `💰 Counter offer for *${proposal.productName}*: ${proposal.counterPrice}\n💬 ${proposal.counterMessage || ""}`,
    info_request: `❓ More info requested for *${proposal.productName}*\n💬 ${proposal.infoRequestMessage || ""}`,
  };

  try {
    await sendLocalizedMessage(sender.phone, messages[action] || "Proposal status updated.");
  } catch (err) {
    logger.warn(`WhatsApp proposal status notification failed: ${err.message}`);
  }
}
