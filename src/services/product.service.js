import Product from "../models/Product.js";
import Farmer from "../models/Farmer.js";
import Exporter from "../models/Exporter.js";
import { updateState, STEPS } from "./conversation.service.js";
import { sendLocalizedMessage } from "./whatsapp.service.js";
import { deleteImages } from "./cloudinary.service.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 10;

const PRODUCT_CATEGORIES = [
  "Tools & Equipment",
  "Machinery",
  "Organic Products",
  "Seeds & Plants",
  "Irrigation",
  "Processing Equipment",
  "Other",
];

export const PRODUCT_REGISTRATION_STEPS = [
  { key: "productName", step: STEPS.WAITING_FOR_PRODUCT_NAME, label: "Product name (e.g. Grass Cutter, Water Pump)" },
  { key: "description", step: STEPS.WAITING_FOR_PRODUCT_DESCRIPTION, label: "Product description (what it does, key features)" },
  { key: "category", step: STEPS.WAITING_FOR_PRODUCT_CATEGORY, label: "Category (choose one):\n\n1. Tools & Equipment\n2. Machinery\n3. Organic Products\n4. Seeds & Plants\n5. Irrigation\n6. Processing Equipment\n7. Other\n\nReply with a number (1-7) or type the category name" },
  { key: "price", step: STEPS.WAITING_FOR_PRODUCT_PRICE, label: "Price (e.g. ₹5000, ₹250 per kg, negotiable)" },
  { key: "quantity", step: STEPS.WAITING_FOR_PRODUCT_QUANTITY, label: "Quantity available (e.g. 5 units, 100 kg, made to order)" },
];

export const PRODUCT_CATEGORY_MAP = {
  "1": "Tools & Equipment",
  "2": "Machinery",
  "3": "Organic Products",
  "4": "Seeds & Plants",
  "5": "Irrigation",
  "6": "Processing Equipment",
  "7": "Other",
};

export async function startProductRegistration(phone, state) {
  const step = PRODUCT_REGISTRATION_STEPS[0];
  const tempData = { ...(state?.tempData || {}), productRegistrationData: {} };

  await updateState(phone, {
    currentStep: step.step,
    tempData,
  });

  return getProductStepPrompt(step, 0);
}

export async function handleProductRegistrationInput(phone, text, state) {
  const currentStepKey = state.currentStep;
  const stepIndex = PRODUCT_REGISTRATION_STEPS.findIndex((s) => s.step === currentStepKey);
  if (stepIndex === -1) return null;

  const step = PRODUCT_REGISTRATION_STEPS[stepIndex];
  const tempData = { ...(state.tempData || {}) };
  const productData = { ...(tempData.productRegistrationData || {}) };

  const validationError = validateProductField(step.key, text);
  if (validationError) {
    return (
      `❌ *Invalid input:* ${validationError}\n\n` +
      getProductStepPrompt(step, stepIndex)
    );
  }

  productData[step.key] = normalizeProductField(step.key, text);
  tempData.productRegistrationData = productData;

  const nextIndex = stepIndex + 1;
  const nextStep = PRODUCT_REGISTRATION_STEPS[nextIndex];

  if (!nextStep) {
    return await handleProductImageStep(phone, { ...state, tempData });
  }

  await updateState(phone, {
    currentStep: nextStep.step,
    tempData,
  });

  return getProductStepPrompt(nextStep, nextIndex);
}

export async function handleProductImageStep(phone, state) {
  const tempData = { ...(state?.tempData || {}) };

  await updateState(phone, {
    currentStep: STEPS.WAITING_FOR_PRODUCT_IMAGE,
    tempData,
  });

  return (
    "📸 Upload a product photo\n\n" +
    "Send a photo of your product. This will be shown to potential buyers.\n\n" +
    "Or type *SKIP* to continue without a photo."
  );
}

export async function handleProductImageMessage(phone, mediaResult, state) {
  const tempData = { ...(state.tempData || {}) };
  const productData = { ...(tempData.productRegistrationData || {}) };

  const { url, publicId } = mediaResult;

  if (!productData.images) productData.images = [];
  if (!productData.imagePublicIds) productData.imagePublicIds = [];
  productData.images.push(url);
  productData.imagePublicIds.push(publicId);
  if (!productData.thumbnail) productData.thumbnail = url;
  if (!productData.thumbnailPublicId) productData.thumbnailPublicId = publicId;
  tempData.productRegistrationData = productData;

  await updateState(phone, {
    currentStep: STEPS.READY,
    tempData,
  });

  return await finishProductRegistration(phone, state.role, tempData);
}

export async function handleProductImageSkip(phone, state) {
  const tempData = { ...(state.tempData || {}) };
  tempData.productRegistrationData = tempData.productRegistrationData || {};

  await updateState(phone, {
    currentStep: STEPS.READY,
    tempData,
  });

  return await finishProductRegistration(phone, state.role, tempData);
}

async function finishProductRegistration(phone, role, tempData) {
  const productData = tempData.productRegistrationData || {};

  const ownerType = role === "farmer" ? "Farmer" : "Exporter";
  const owner = await getOwnerForProduct(phone, ownerType);

  const product = await Product.create({
    ownerId: owner?._id || null,
    ownerType,
    productName: productData.productName,
    description: productData.description || "",
    category: productData.category || "",
    price: productData.price || "",
    quantity: productData.quantity || "",
    district: owner?.district || owner?.city || "",
    state: owner?.state || "",
    country: owner?.country || "",
    images: productData.images || [],
    imagePublicIds: productData.imagePublicIds || [],
    thumbnail: productData.thumbnail || "",
    thumbnailPublicId: productData.thumbnailPublicId || "",
    contactPhone: owner?.phone || phone,
    status: "pending",
  });

  tempData.productRegistrationData = undefined;
  await updateState(phone, { currentStep: STEPS.READY, tempData });

  return (
    "✅ *Product listed successfully!*\n\n" +
    `📦 ${product.productName}\n` +
    `💰 Price: ${product.price}\n` +
    `📍 ${[product.district, product.state, product.country].filter(Boolean).join(", ")}\n\n` +
    "🔍 Your product is pending admin approval. You'll be notified once it's live on the marketplace.\n\n" +
    "Type *HELP* to see all commands."
  );
}

async function getOwnerForProduct(phone, ownerType) {
  if (ownerType === "Farmer") {
    return Farmer.findOne({ phone }).lean();
  }
  return Exporter.findOne({ phone }).lean();
}

export function validateProductField(key, value) {
  const text = String(value || "").trim();
  if (!text) return "This field cannot be empty.";

  switch (key) {
    case "productName": {
      if (text.length < 2) return "Product name is too short.";
      if (/^\d+$/.test(text)) return "Product name cannot be just numbers.";
      return null;
    }
    case "description": {
      if (text.length < 5) return "Please provide a brief description (at least 5 characters).";
      return null;
    }
    case "category": {
      const lower = text.toLowerCase();
      if (PRODUCT_CATEGORY_MAP[text]) return null;
      if (PRODUCT_CATEGORIES.some((c) => c.toLowerCase() === lower)) return null;
      if (["tools", "equipment", "tool"].includes(lower)) return null;
      if (["machine", "machinery"].includes(lower)) return null;
      if (["organic", "fertilizer", "compost"].includes(lower)) return null;
      if (["seed", "seeds", "plant", "plants"].includes(lower)) return null;
      if (["irrigation", "pump", "water"].includes(lower)) return null;
      if (["processing", "cutter", "cutting"].includes(lower)) return null;
      return "Please choose a valid category (1-7) or type a category name.";
    }
    case "price": {
      if (text.toLowerCase() === "negotiable") return null;
      if (!/\d/.test(text)) return "Please include a price (e.g. ₹5000, ₹250 per kg) or type *negotiable*.";
      return null;
    }
    case "quantity": {
      if (text.length < 1) return "Please enter the quantity available.";
      return null;
    }
    default:
      return null;
  }
}

export function normalizeProductField(key, value) {
  const text = String(value || "").trim();
  if (key === "category") {
    const lower = text.toLowerCase();
    if (PRODUCT_CATEGORY_MAP[text]) return PRODUCT_CATEGORY_MAP[text];
    const matched = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === lower);
    if (matched) return matched;
    if (["tools", "equipment", "tool"].includes(lower)) return "Tools & Equipment";
    if (["machine", "machinery"].includes(lower)) return "Machinery";
    if (["organic", "fertilizer", "compost"].includes(lower)) return "Organic Products";
    if (["seed", "seeds", "plant", "plants"].includes(lower)) return "Seeds & Plants";
    if (["irrigation", "pump", "water"].includes(lower)) return "Irrigation";
    if (["processing", "cutter", "cutting"].includes(lower)) return "Processing Equipment";
    return text;
  }
  if (key === "productName") return text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text;
}

function getProductStepPrompt(step, index) {
  const total = PRODUCT_REGISTRATION_STEPS.length;
  return (
    `📦 *Add Product* (${index + 1}/${total})\n\n` +
    `Please enter your *${step.label}*:`
  );
}

export async function searchProducts({ product, page = 1, limit = PAGE_SIZE } = {}) {
  const baseQuery = { status: "approved" };
  const query = product
    ? {
        ...baseQuery,
        $or: [
          { productName: { $regex: new RegExp(escapeRegex(product), "i") } },
          { description: { $regex: new RegExp(escapeRegex(product), "i") } },
          { category: { $regex: new RegExp(escapeRegex(product), "i") } },
        ],
      }
    : baseQuery;

  const total = await Product.countDocuments(query);
  const products = await Product.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    total,
    page,
    limit,
    hasNextPage: page * limit < total,
    results: products,
  };
}

export function formatProductResults(searchResult) {
  const { total, page, limit, hasNextPage, results } = searchResult;
  if (!results.length) {
    return "❌ No products found.\n\nTry another search term or check *HELP* for available commands.";
  }

  const cards = results
    .map((product, index) => formatProductCard(product, index + 1))
    .join("\n\n---\n\n");
  const pagination = hasNextPage
    ? `\n\n📄 Page ${page} of results. Type *MORE* for the next ${limit}.`
    : "";

  return `📦 *Products Found* (${total})\n\n${cards}${pagination}`;
}

export function formatProductCard(product, index) {
  const location = [product.district, product.state, product.country]
    .filter(Boolean)
    .join(", ");

  return (
    `*${index}. ${product.productName}*\n` +
    `💰 Price: ${product.price || "—"}\n` +
    `📍 Location: ${location || "—"}\n` +
    `👤 Owner: ${product.ownerType || "—"}\n\n` +
    `Reply *VIEW ${index}* for details`
  );
}

export async function formatProductDetail(product) {
  const location = [product.district, product.state, product.country]
    .filter(Boolean)
    .join(", ");

  await Product.findByIdAndUpdate(product._id, { $inc: { views: 1 } });

  let msg =
    `📦 *${product.productName}*\n\n` +
    `📝 Description: ${product.description || "Not provided"}\n` +
    `💰 Price: ${product.price || "—"}\n` +
    `📊 Quantity: ${product.quantity || "—"}\n` +
    `🏷️ Category: ${product.category || "—"}\n` +
    `📍 Location: ${location || "—"}\n` +
    `👁️ Views: ${product.views || 0}\n`;

  if (product.contactPhone) {
    msg += `\n📞 Contact: ${product.contactPhone}\n`;
  }

  if (product.images && product.images.length > 0) {
    msg += `\n📷 ${product.images.length} photo(s) available\n`;
  }

  return msg;
}

export async function approveProduct({ productId, adminId }) {
  const product = await Product.findById(productId);
  if (!product) throw new Error("Product not found.");

  product.status = "approved";
  product.approvalReason = undefined;
  await product.save();

  await notifyProductDecision(product, true);

  return product.toObject();
}

export async function rejectProduct({ productId, adminId, reason }) {
  const product = await Product.findById(productId);
  if (!product) throw new Error("Product not found.");

  const rejectionReason = String(reason || "Product rejected by admin.")
    .trim()
    .slice(0, 500);

  product.status = "rejected";
  product.approvalReason = rejectionReason;
  await product.save();

  await notifyProductDecision(product, false, rejectionReason);

  return product.toObject();
}

async function notifyProductDecision(product, approved, reason) {
  const phone = product.contactPhone;
  if (!phone) return;

  const message = approved
    ? `✅ *Congratulations!*\n\nYour product *${product.productName}* has been approved and is now visible to other farmers and buyers.\n\nType *SHOW PRODUCTS* on WhatsApp to see the marketplace.`
    : `❌ Your product *${product.productName}* was not approved.\n\nReason: ${reason || "Admin review failed."}\n\nYou can try adding the product again with correct details.`;

  try {
    await sendLocalizedMessage(phone, message);
  } catch (error) {
    logger.warn(`Product notification failed for ${phone}: ${error.message}`);
  }
}

export async function listProducts({
  status = "all",
  page = 1,
  limit = PAGE_SIZE,
} = {}) {
  const normalizedStatus =
    ["pending", "approved", "rejected"].includes(status) ? status : "all";
  const pageNumber = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(
    Math.max(Number(limit) || PAGE_SIZE, 1),
    100
  );
  const query =
    normalizedStatus === "all" ? {} : { status: normalizedStatus };

  const [products, total] = await Promise.all([
    Product.find(query)
      .sort({ createdAt: -1 })
      .skip((pageNumber - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Product.countDocuments(query),
  ]);

  return {
    products,
    total,
    page: pageNumber,
    limit: pageSize,
    hasNextPage: pageNumber * pageSize < total,
  };
}

export async function getProductStats() {
  const [pending, approved, rejected, total] = await Promise.all([
    Product.countDocuments({ status: "pending" }),
    Product.countDocuments({ status: "approved" }),
    Product.countDocuments({ status: "rejected" }),
    Product.countDocuments(),
  ]);

  return { pending, approved, rejected, total };
}

export async function incrementProductViews(productId) {
  return Product.findByIdAndUpdate(productId, { $inc: { views: 1 } });
}

export async function incrementProductLikes(productId) {
  return Product.findByIdAndUpdate(productId, { $inc: { likes: 1 } });
}

export async function deleteProduct(productId) {
  const product = await Product.findById(productId);
  if (!product) return null;

  const publicIds = [
    ...(product.imagePublicIds || []),
    product.thumbnailPublicId,
  ].filter(Boolean);

  if (publicIds.length > 0) {
    await deleteImages(publicIds);
  }

  return Product.findByIdAndDelete(productId);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
