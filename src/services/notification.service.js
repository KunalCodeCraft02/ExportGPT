import Notification from "../models/Notification.js";
import { sendLocalizedMessage } from "./whatsapp.service.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import Buyer from "../models/Buyer.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 20;

export async function createNotification({ userId, userType, type, title, message, referenceId, referenceType }) {
  return Notification.create({
    userId, userType, type, title, message,
    referenceId: referenceId || null,
    referenceType: referenceType || null,
  });
}

export async function getNotificationsForUser(userId, { page = 1 } = {}) {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const [notifications, total] = await Promise.all([
    Notification.find({ userId })
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Notification.countDocuments({ userId }),
  ]);

  return {
    notifications,
    total,
    page: pageNumber,
    hasNextPage: pageNumber * PAGE_SIZE < total,
  };
}

export async function markAsRead(notificationId) {
  return Notification.findByIdAndUpdate(notificationId, { read: true }, { new: true });
}

export async function markAllAsRead(userId) {
  return Notification.updateMany({ userId, read: false }, { read: true });
}

export async function getUnreadCount(userId) {
  return Notification.countDocuments({ userId, read: false });
}

export function formatNotificationCard(n, index) {
  const emoji = {
    proposal_received: "📋", proposal_accepted: "✅", proposal_rejected: "❌",
    proposal_counter_offer: "💰", proposal_info_requested: "❓",
    deal_status_update: "📊", deal_completed: "🎉",
    rating_received: "⭐", requirement_matched: "🔍", system: "🔔",
  };

  return (
    `*${index}. ${emoji[n.type] || "🔔"} ${n.title}*\n` +
    `${n.message}\n` +
    `📅 ${new Date(n.createdAt).toLocaleDateString("en-IN")}` +
    (n.read ? "" : " 🔴 New")
  );
}

export async function sendWhatsAppNotification(phone, message) {
  try {
    await sendLocalizedMessage(phone, message);
    return true;
  } catch (err) {
    logger.warn(`WhatsApp notification failed: ${err.message}`);
    return false;
  }
}
