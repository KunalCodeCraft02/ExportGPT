import TradeScore from "../models/TradeScore.js";
import Deal from "../models/Deal.js";
import Rating from "../models/Rating.js";
import logger from "../utils/logger.js";

export async function getOrCreateTradeScore(userId, userType) {
  let score = await TradeScore.findOne({ userId }).lean();
  if (!score) {
    score = await TradeScore.create({ userId, userType });
    score = score.toObject();
  }
  return score;
}

export async function calculateTradeScore(userId, userType) {
  const score = await getOrCreateTradeScore(userId, userType);

  const deals = await Deal.find({
    $or: [{ sellerId: userId }, { buyerId: userId }],
    status: "completed",
  }).lean();

  const ratings = await Rating.find({ rateeId: userId }).lean();

  const successfulOrders = deals.length;
  const totalRatings = ratings.length;
  const averageRating = totalRatings > 0
    ? ratings.reduce((sum, r) => sum + r.stars, 0) / totalRatings
    : 0;

  const uniqueBuyers = new Set(deals.map((d) => d.buyerId.toString()));
  const repeatBuyers = successfulOrders - uniqueBuyers.size;

  const avgResponseTime = 0;

  let tradeScore = 0;
  tradeScore += Math.min(successfulOrders * 3, 30);
  tradeScore += Math.min((averageRating / 5) * 25, 25);
  tradeScore += Math.min((score.totalQuantitySold / 100) * 10, 10);
  tradeScore += Math.min(Math.max(repeatBuyers, 0) * 2, 15);
  tradeScore += avgResponseTime < 4 ? 10 : avgResponseTime < 24 ? 5 : 0;
  tradeScore += (score.gstVerified || score.iecVerified) ? 10 : 0;
  tradeScore = Math.min(Math.round(tradeScore), 100);

  const trustLevel = getTrustLevel(tradeScore);

  await TradeScore.findOneAndUpdate(
    { userId },
    {
      tradeScore,
      successfulOrders,
      averageRating: Math.round(averageRating * 10) / 10,
      totalRatings,
      repeatBuyers: Math.max(repeatBuyers, 0),
      averageResponseTime: avgResponseTime,
      trustLevel,
    },
    { upsert: true }
  );

  return { tradeScore, successfulOrders, averageRating, totalRatings, repeatBuyers, trustLevel };
}

export function getTrustLevel(score) {
  if (score >= 80) return "platinum";
  if (score >= 60) return "gold";
  if (score >= 40) return "silver";
  if (score >= 20) return "bronze";
  return "new";
}

export function formatTradeScore(ts) {
  const stars = "★".repeat(Math.round(ts.averageRating)) + "☆".repeat(5 - Math.round(ts.averageRating));

  return (
    `📊 *Trade Score*\n\n` +
    `Trust Level: *${ts.trustLevel.toUpperCase()}*\n` +
    `Score: *${ts.tradeScore}/100*\n` +
    `Rating: ${stars} (${ts.averageRating}/5 from ${ts.totalRatings} ratings)\n\n` +
    `📦 Successful Orders: ${ts.successfulOrders}\n` +
    `🔄 Repeat Buyers: ${ts.repeatBuyers}\n` +
    `⏱️ Avg Response: ${ts.averageResponseTime || "N/A"}h` +
    (ts.countriesExported?.length ? `\n🌍 Countries: ${ts.countriesExported.join(", ")}` : "") +
    (ts.gstVerified ? "\n✅ GST Verified" : "") +
    (ts.iecVerified ? "\n✅ IEC Verified" : "")
  );
}
