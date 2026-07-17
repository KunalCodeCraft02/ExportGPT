import PackagingGuide from "../models/PackagingGuide.js";
import logger from "../utils/logger.js";

const STATIC_GUIDES = [
  {
    commodity: "turmeric",
    recommendedPackaging: "Moisture-proof PP bags, double-layered",
    bagType: "PP/HDPE bags, 25-50 kg",
    weight: "25 kg or 50 kg bags",
    labelRequirements: "Product name, grade, net weight, batch number, manufacturer details, FSSAI logo",
    storage: "Cool, dry place. Keep away from moisture. Store on pallets, not directly on floor.",
    handlingTips: "Avoid moisture exposure. Handle bags carefully to prevent tearing. Keep away from strong odors.",
    exportNotes: "EU requires curcumin content test. USA requires FDA registration. Organic certification adds 30-40% premium.",
    documentsNeeded: ["Phytosanitary Certificate", "Certificate of Origin", "FSSAI License", "APEDA Registration", "Spices Board Registration"],
  },
  {
    commodity: "rice",
    recommendedPackaging: "New PP/HDPE bags, moisture-proof lining",
    bagType: "PP bags, 1-50 kg",
    weight: "1 kg, 5 kg, 10 kg, 25 kg, or 50 kg",
    labelRequirements: "Brand name, variety, grade, net weight, date of packaging, batch number, FSSAI logo",
    storage: "Cool, dry, well-ventilated area. Temperature below 25°C. Humidity below 65%.",
    handlingTips: "Keep dry at all times. Stack bags properly. First In First Out (FIFO) rotation.",
    exportNotes: "Basmati requires GI tag verification. Non-basmati has different export quotas. Check current DGFT policy.",
    documentsNeeded: ["FSSAI License", "APEDA Registration", "Phytosanitary Certificate", "Certificate of Origin", "GI Tag (for Basmati)"],
  },
  {
    commodity: "onion",
    recommendedPackaging: "Mesh bags or jute bags for ventilation",
    bagType: "Mesh bags (25-50 kg) or jute bags",
    weight: "25 kg or 50 kg",
    labelRequirements: "Product name, variety, grade, net weight, origin, packing date",
    storage: "Well-ventilated, dry area. Temperature 0-2°C for long-term. Humidity 65-70%.",
    handlingTips: "Ensure good ventilation. Avoid stacking too high. Check for sprouting regularly.",
    exportNotes: "Malaysia prefers red variety. UAE prefers premium grades. Singapore has strict quality standards.",
    documentsNeeded: ["Phytosanitary Certificate", "Certificate of Origin", "APEDA Registration", "Fumigation Certificate"],
  },
  {
    commodity: "banana",
    recommendedPackaging: "Corrugated cartons with individual wrapping",
    bagType: "Corrugated cartons, 13-18 kg",
    weight: "13 kg or 18 kg per carton",
    labelRequirements: "Brand, variety (Cavendish/etc), grade, count, origin, packing date",
    storage: "Cold chain mandatory. Temperature 13-14°C. Humidity 85-90%.",
    handlingTips: "Handle with care. Do not drop. Keep away from ethylene-producing fruits. Ripen only when ready for market.",
    exportNotes: "Requires cold chain throughout. Ripening control is critical. Different markets prefer different ripeness levels.",
    documentsNeeded: ["Phytosanitary Certificate", "Certificate of Origin", "FSSAI License", "Cold Chain Certification"],
  },
  {
    commodity: "mango",
    recommendedPackaging: "Corrugated cartons with foam/net trays",
    bagType: "Corrugated cartons, 2-5 kg",
    weight: "2 kg, 3 kg, or 5 kg per carton",
    labelRequirements: "Variety (Alphonso/Kesar/etc), grade, count, weight, origin, packed date",
    storage: "Cold chain at 10-13°C. Handle gently. Separate by ripeness stage.",
    handlingTips: "Extremely delicate. No stacking above 3 layers. Individual fruit wrapping prevents bruising.",
    exportNotes: "USA requires USDA irradiation. UK requires cold chain. Alphonso commands highest premium. Seasonal (Apr-Jun).",
    documentsNeeded: ["Phytosanitary Certificate", "FSSAI License", "APEDA Registration", "Global GAP (preferred)", "Irradiation Certificate (for USA)"],
  },
  {
    commodity: "spices",
    recommendedPackaging: "Airtight, moisture-proof containers",
    bagType: "PP bags with moisture barrier, 10-25 kg",
    weight: "10 kg or 25 kg",
    labelRequirements: "Spice name, variety, grade, net weight, batch number, FSSAI logo, manufacturing date",
    storage: "Cool, dry, dark place. Away from strong odors. Airtight containers preferred.",
    handlingTips: "Keep away from moisture and sunlight. Store separately by spice type. Check for insects regularly.",
    exportNotes: "EU has strict pesticide residue limits. Organic spices command premium. Each spice has specific quality parameters.",
    documentsNeeded: ["FSSAI License", "Spices Board Registration", "Phytosanitary Certificate", "Certificate of Origin", "Pesticide Residue Test Report"],
  },
  {
    commodity: "cotton",
    recommendedPackaging: "Compressed bales with standard export baling",
    bagType: "Compressed bales, wrapped in HDPE",
    weight: "170-220 kg per bale (standard)",
    labelRequirements: "Cotton variety, grade, staple length, micronaire, bale number, origin",
    storage: "Dry, covered storage. Protect from rain and moisture. Stack on raised platforms.",
    handlingTips: "Keep dry. Handle with hooks carefully. Avoid contamination. Separate grades during storage.",
    exportNotes: "Quality consistency is key for repeat orders. BCI certification adds value. China and Bangladesh are major buyers.",
    documentsNeeded: ["Textiles Committee Certificate", "Phytosanitary Certificate", "BCI Certificate (optional)", "Certificate of Origin"],
  },
  {
    commodity: "wheat",
    recommendedPackaging: "New PP bags, moisture-proof",
    bagType: "PP/HDPE bags, 50 kg",
    weight: "50 kg per bag",
    labelRequirements: "Variety, grade, protein content, moisture, net weight, batch number, FSSAI logo",
    storage: "Cool, dry, well-ventilated. Temperature below 25°C. Moisture content below 12%.",
    handlingTips: "Keep dry. FIFO rotation. Check for moisture and insects regularly. Stack on pallets.",
    exportNotes: "India periodically restricts wheat exports. Check current DGFT policy before committing. Durum wheat has separate demand.",
    documentsNeeded: ["FSSAI License", "APEDA Registration", "Phytosanitary Certificate", "Fumigation Certificate", "Certificate of Origin"],
  },
  {
    commodity: "soybean",
    recommendedPackaging: "New PP bags, moisture-proof lining",
    bagType: "PP bags, 50 kg",
    weight: "50 kg per bag",
    labelRequirements: "Variety, grade, moisture content, protein content, GMO status, net weight",
    storage: "Cool, dry area. Moisture below 12%. Temperature below 20°C for long-term.",
    handlingTips: "Keep dry. Avoid direct sunlight. Check for insects and moisture regularly.",
    exportNotes: "Non-GMO certification adds value. China is largest buyer. Aflatoxin testing required.",
    documentsNeeded: ["APEDA Registration", "Phytosanitary Certificate", "Non-GMO Certificate", "Aflatoxin Test Certificate"],
  },
  {
    commodity: "groundnut",
    recommendedPackaging: "New PP bags, moisture-controlled",
    bagType: "PP bags, 25-50 kg",
    weight: "25 kg or 50 kg",
    labelRequirements: "Variety, grade, moisture content, aflatoxin status, net weight, origin",
    storage: "Cool, dry, well-ventilated. Moisture below 7%. Temperature below 20°C.",
    handlingTips: "Keep dry. Aflatoxin contamination is the #1 rejection reason. Test every lot before export.",
    exportNotes: "Indonesia and Vietnam are top buyers. Aflatoxin testing is mandatory. Roasted and raw have different markets.",
    documentsNeeded: ["APEDA Registration", "Aflatoxin Test Certificate", "Phytosanitary Certificate", "Certificate of Origin"],
  },
];

export async function getPackagingGuide(commodity) {
  const key = String(commodity || "").toLowerCase().trim();
  const guide = await PackagingGuide.findOne({ commodity: key }).lean();
  if (guide) return guide;

  const staticGuide = STATIC_GUIDES.find((g) => g.commodity === key);
  return staticGuide || null;
}

export function formatPackagingGuide(guide) {
  if (!guide) {
    return "❌ No packaging guide found for this commodity.\n\nTry: *turmeric*, *rice*, *onion*, *banana*, *mango*, *spices*, *cotton*, *wheat*, *soybean*, *groundnut*";
  }

  return (
    `📦 *Packaging Guide — ${guide.commodity.charAt(0).toUpperCase() + guide.commodity.slice(1)}*\n\n` +
    `🏭 *Packaging:* ${guide.recommendedPackaging || "—"}\n` +
    `👜 *Bag Type:* ${guide.bagType || "—"}\n` +
    `⚖️ *Weight:* ${guide.weight || "—"}\n\n` +
    `🏷️ *Label Requirements:*\n${guide.labelRequirements || "—"}\n\n` +
    `🏗️ *Storage:*\n${guide.storage || "—"}\n\n` +
    `🤲 *Handling Tips:*\n${guide.handlingTips || "—"}\n\n` +
    `🌍 *Export Notes:*\n${guide.exportNotes || "—"}\n\n` +
    `📄 *Documents Needed:*\n${(guide.documentsNeeded || []).map((d) => `• ${d}`).join("\n") || "—"}`
  );
}

export async function seedPackagingGuides() {
  for (const guide of STATIC_GUIDES) {
    await PackagingGuide.findOneAndUpdate(
      { commodity: guide.commodity },
      guide,
      { upsert: true }
    );
  }
  logger.info(`Seeded ${STATIC_GUIDES.length} packaging guides`);
}
