import Rating from "../models/Rating.js";
import Deal from "../models/Deal.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import Buyer from "../models/Buyer.js";
import TradeScore from "../models/TradeScore.js";
import { calculateTradeScore } from "./tradeScore.service.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 10;

export async function submitRating(dealId, raterId, raterType, data) {
  const deal = await Deal.findById(dealId);
  if (!deal) throw new Error("Deal not found.");
  if (deal.status !== "completed") throw new Error("Can only rate completed deals.");

  const isSeller = deal.sellerId.toString() === raterId.toString();
  const isBuyer = deal.buyerId.toString() === raterId.toString();
  if (!isSeller && !isBuyer) throw new Error("You are not part of this deal.");

  const rateeId = isSeller ? deal.buyerId : deal.sellerId;
  const rateeType = isSeller ? deal.buyerType : deal.sellerType;

  const existing = await Rating.findOne({ dealId, raterId }).lean();
  if (existing) throw new Error("You have already rated this deal.");

  const rating = await Rating.create({
    dealId,
    raterId,
    raterType,
    rateeId,
    rateeType,
    stars: data.stars,
    review: data.review || "",
    deliveryExperience: data.deliveryExperience,
    communication: data.communication,
    paymentTimeliness: data.paymentTimeliness,
    quality: data.quality,
  });

  if (isSeller) {
    deal.sellerRatingId = rating._id;
  } else {
    deal.buyerRatingId = rating._id;
  }
  await deal.save();

  await updateOverallRating(rateeId, rateeType);
  await calculateTradeScore(rateeId, rateeType);

  return rating.toObject();
}

export async function getRatingsForUser(userId, { page = 1 } = {}) {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const [ratings, total] = await Promise.all([
    Rating.find({ rateeId: userId })
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Rating.countDocuments({ rateeId: userId }),
  ]);

  return {
    ratings,
    total,
    page: pageNumber,
    hasNextPage: pageNumber * PAGE_SIZE < total,
  };
}

export async function getAverageRating(userId) {
  const result = await Rating.aggregate([
    { $match: { rateeId: userId } },
    { $group: { _id: null, avg: { $avg: "$stars" }, count: { $sum: 1 } } },
  ]);

  return result[0] || { avg: 0, count: 0 };
}

export async function canRate(dealId, userId) {
  const deal = await Deal.findById(dealId).lean();
  if (!deal) return false;
  if (deal.status !== "completed") return false;

  const isSeller = deal.sellerId.toString() === userId.toString();
  const isBuyer = deal.buyerId.toString() === userId.toString();
  if (!isSeller && !isBuyer) return false;

  const existing = await Rating.findOne({ dealId, raterId: userId }).lean();
  return !existing;
}

export function formatRatingCard(rating, index) {
  const stars = "★".repeat(rating.stars) + "☆".repeat(5 - rating.stars);

  return (
    `*${index}. ${stars}*\n` +
    `💬 ${rating.review || "No review"}\n` +
    (rating.deliveryExperience ? `📦 Delivery: ${"★".repeat(rating.deliveryExperience)}\n` : "") +
    (rating.communication ? `📞 Communication: ${"★".repeat(rating.communication)}\n` : "") +
    (rating.paymentTimeliness ? `💳 Payment: ${"★".repeat(rating.paymentTimeliness)}\n` : "") +
    (rating.quality ? `⭐ Quality: ${"★".repeat(rating.quality)}\n` : "") +
    `📅 ${new Date(rating.createdAt).toLocaleDateString("en-IN")}`
  );
}

async function updateOverallRating(userId, userType) {
  const result = await Rating.aggregate([
    { $match: { rateeId: userId } },
    { $group: { _id: null, avg: { $avg: "$stars" } } },
  ]);

  const avg = result[0]?.avg || 0;
  const Model = userType === "Farmer" ? Farmer : userType === "Exporter" ? Exporter : Buyer;

  await Model.findByIdAndUpdate(userId, { overallRating: Math.round(avg * 10) / 10 });
}
