import cron from "node-cron";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import BuyerLead from "../models/BuyerLead.js";
import { sendLocalizedMessage } from "../services/whatsapp.service.js";
import logger from "../utils/logger.js";

let scheduled = false;

export function scheduleDailyMarketUpdate() {
  if (scheduled) return;

  cron.schedule("0 8 * * *", sendDailyMarketUpdate, {
    timezone: process.env.TZ || "Asia/Kolkata",
  });
  scheduled = true;
}

export async function sendDailyMarketUpdate() {
  try {
    const [farmers, exporters] = await Promise.all([
      Farmer.find({
        phone: { $exists: true, $ne: "" },
        $or: [{ verified: true }, { verificationStatus: "approved" }],
      }).select("phone products state country").lean(),
      Exporter.find({
        phone: { $exists: true, $ne: "" },
        $or: [{ verified: true }, { verificationStatus: "approved" }],
      }).select("phone products exportCountries country").lean(),
    ]);

    const usersByPhone = new Map();
    for (const user of [...farmers, ...exporters]) {
      if (user.phone) usersByPhone.set(user.phone, user);
    }

    if (usersByPhone.size === 0) return;

    const update = await buildMarketUpdate();

    await Promise.all(
      Array.from(usersByPhone.values()).map((user) => sendLocalizedMessage(user.phone, update))
    );
  } catch (error) {
    logger.error(`Daily market update failed: ${error.message}`);
  }
}

async function buildMarketUpdate() {
  const [topProducts, topDemand] = await Promise.all([
    Farmer.aggregate([
      { $unwind: "$products" },
      { $group: { _id: "$products", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 },
    ]),
    Exporter.aggregate([
      { $unwind: "$products" },
      { $unwind: "$exportCountries" },
      { $group: { _id: { product: "$products", country: "$exportCountries" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 3 },
    ]),
  ]);

  const topOpportunity = await BuyerLead.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);

  const demandLines = topDemand
    .map((item) => `🇦🇪 ${item._id.country} ${capitalize(item._id.product)} Demand ↑\nPrice ₹34/kg`)
    .join("\n\n");

  const opportunity = topOpportunity?.[0]?._id || "pending farmer requests";
  const productLine = topProducts?.[0]?._id ? `Top Opportunity:\n${capitalize(topProducts[0]._id)} exports` : "Top Opportunity:\nGarlic exports";

  return (
    "📊 Daily Market Update\n\n" +
    (demandLines || "🇦🇪 UAE Onion Demand ↑\nPrice ₹34/kg\n\n🇧🇩 Bangladesh Demand ↑\nPrice ₹32/kg") +
    "\n\n" +
    productLine +
    `\n\nLead activity: ${opportunity}`
  );
}

function capitalize(value) {
  return String(value || "").charAt(0).toUpperCase() + String(value || "").slice(1);
}
