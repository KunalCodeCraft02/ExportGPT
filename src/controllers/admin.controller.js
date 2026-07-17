import {
  approveProfile as approveProfileService,
  getAdminById,
  getDashboardStats,
  listLeads,
  listProfiles,
  listUsers,
  rejectProfile as rejectProfileService,
  updateLeadStatus as updateLeadStatusService,
  validateAdminLogin,
} from "../services/admin.service.js";
import {
  listProducts,
  approveProduct as approveProductService,
  rejectProduct as rejectProductService,
  deleteProduct as deleteProductService,
  getProductStats,
} from "../services/product.service.js";
import Proposal from "../models/Proposal.js";
import Deal from "../models/Deal.js";
import Requirement from "../models/Requirement.js";
import Rating from "../models/Rating.js";
import TradeScore from "../models/TradeScore.js";
import PackagingGuide from "../models/PackagingGuide.js";
import Notification from "../models/Notification.js";
import logger from "../utils/logger.js";

export async function showLoginPage(req, res) {
  if (req.session?.adminId) return res.redirect("/admin");

  return res.render("admin/login", {
    title: "Admin Login",
    error: req.query.error === "1",
  });
}

export async function login(req, res) {
  try {
    const { username, password } = req.body || {};
    logger.info(`Login attempt for user: ${username}`);

    const admin = await validateAdminLogin(username, password);

    if (!admin) {
      logger.warn(`Login failed for user: ${username}`);
      return res.redirect("/admin/login?error=1");
    }

    req.session.adminId = admin._id.toString();
    req.session.adminName = admin.name || "Admin";

    const returnTo = req.session.returnTo || "/admin";
    delete req.session.returnTo;

    logger.info(`Login successful for user: ${username}, session ID: ${req.session.id}`);
    return res.redirect(returnTo);
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    return res.redirect("/admin/login?error=1");
  }
}

export function logout(req, res) {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).send("Could not log out.");
    }

    res.clearCookie("connect.sid");
    return res.redirect("/admin/login");
  });
}

export async function showDashboard(req, res) {
  const [stats, admin, pendingLeads] = await Promise.all([
    getDashboardStats(),
    getAdminById(req.session.adminId),
    listLeads({ status: "pending", limit: 5 }),
  ]);

  return res.render("admin/dashboard", {
    title: "Dashboard",
    admin,
    stats,
    pendingLeads: pendingLeads.leads,
  });
}

export async function showProfiles(req, res) {
  const role = normalizeRole(req.query.role);
  const status = normalizeVerificationStatus(req.query.status);
  const page = Number(req.query.page) || 1;
  const search = String(req.query.search || "").trim();
  const result = await listProfiles({ role, status, page, search });

  return res.render("admin/profiles", {
    title: "Profile Verification",
    role,
    status,
    page,
    search,
    profiles: result.profiles,
    hasNextPage: result.hasNextPage,
    roles: ["all", "exporter", "farmer", "buyer"],
    statuses: ["pending", "approved", "rejected"],
  });
}

export async function approveProfile(req, res) {
  try {
    await approveProfileService({
      type: req.params.type,
      id: req.params.id,
      adminId: req.session.adminId,
    });
  } catch (error) {
    return res.status(400).send(error.message);
  }

  return res.redirect(`/admin/profiles?role=${req.params.type}&status=pending`);
}

export async function rejectProfile(req, res) {
  try {
    await rejectProfileService({
      type: req.params.type,
      id: req.params.id,
      adminId: req.session.adminId,
      reason: req.body?.reason,
    });
  } catch (error) {
    return res.status(400).send(error.message);
  }

  return res.redirect(`/admin/profiles?role=${req.params.type}&status=pending`);
}

export async function showLeads(req, res) {
  const status = normalizeLeadStatus(req.query.status);
  const page = Number(req.query.page) || 1;
  const result = await listLeads({ status, page });

  return res.render("admin/leads", {
    title: "Buyer Leads",
    status,
    page,
    leads: result.leads,
    hasNextPage: result.hasNextPage,
    statuses: ["all", "pending", "accepted", "rejected", "logistics_connected", "completed"],
  });
}

export async function updateLeadStatus(req, res) {
  try {
    await updateLeadStatusService({
      id: req.params.id,
      status: req.body?.status,
      adminId: req.session.adminId,
      notes: req.body?.notes,
    });
  } catch (error) {
    return res.status(400).send(error.message);
  }

  return res.redirect(`/admin/leads?status=${req.body?.status || "all"}`);
}

export async function showUsers(req, res) {
  const page = Number(req.query.page) || 1;
  const result = await listUsers({ page });

  return res.render("admin/users", {
    title: "Users",
    page,
    users: result.users,
    hasNextPage: result.hasNextPage,
  });
}

export async function showProducts(req, res) {
  const status = normalizeProductStatus(req.query.status);
  const page = Number(req.query.page) || 1;
  const result = await listProducts({ status, page });

  return res.render("admin/products", {
    title: "Product Marketplace",
    status,
    page,
    products: result.products,
    hasNextPage: result.hasNextPage,
    statuses: ["all", "pending", "approved", "rejected"],
  });
}

export async function approveProduct(req, res) {
  try {
    await approveProductService({
      productId: req.params.id,
      adminId: req.session.adminId,
    });
  } catch (error) {
    return res.status(400).send(error.message);
  }

  return res.redirect("/admin/products?status=pending");
}

export async function rejectProduct(req, res) {
  try {
    await rejectProductService({
      productId: req.params.id,
      adminId: req.session.adminId,
      reason: req.body?.reason,
    });
  } catch (error) {
    return res.status(400).send(error.message);
  }

  return res.redirect("/admin/products?status=pending");
}

export async function deleteProduct(req, res) {
  try {
    await deleteProductService(req.params.id);
  } catch (error) {
    return res.status(400).send(error.message);
  }

  return res.redirect("/admin/products?status=all");
}

function normalizeRole(role) {
  const normalized = String(role || "all").trim().toLowerCase();
  return ["all", "exporter", "farmer", "buyer"].includes(normalized) ? normalized : "all";
}

function normalizeVerificationStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return ["pending", "approved", "rejected"].includes(normalized) ? normalized : "pending";
}

function normalizeLeadStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return ["all", "pending", "accepted", "rejected", "logistics_connected", "completed"].includes(normalized)
    ? normalized
    : "pending";
}

function normalizeProductStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  return ["all", "pending", "approved", "rejected", "paused", "sold"].includes(normalized) ? normalized : "pending";
}

// ─── New Admin Handlers ─────────────────────────────────────────────────────

export async function showProposals(req, res) {
  const status = String(req.query.status || "all").trim();
  const page = Number(req.query.page) || 1;
  const query = status === "all" ? {} : { status };
  const PAGE_SIZE = 20;

  const [proposals, total] = await Promise.all([
    Proposal.find(query).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Proposal.countDocuments(query),
  ]);

  return res.render("admin/proposals", {
    title: "Proposals",
    status,
    page,
    proposals,
    total,
    hasNextPage: page * PAGE_SIZE < total,
    statuses: ["all", "submitted", "accepted", "rejected", "counter_offer", "info_requested"],
  });
}

export async function showDeals(req, res) {
  const status = String(req.query.status || "all").trim();
  const page = Number(req.query.page) || 1;
  const query = status === "all" ? {} : { status };
  const PAGE_SIZE = 20;

  const [deals, total] = await Promise.all([
    Deal.find(query).sort({ updatedAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Deal.countDocuments(query),
  ]);

  return res.render("admin/deals", {
    title: "Deals",
    status,
    page,
    deals,
    total,
    hasNextPage: page * PAGE_SIZE < total,
    statuses: ["all", "accepted", "negotiation", "order_confirmed", "in_transit", "delivered", "completed", "cancelled"],
  });
}

export async function showRequirements(req, res) {
  const status = String(req.query.status || "all").trim();
  const page = Number(req.query.page) || 1;
  const query = status === "all" ? {} : { status };
  const PAGE_SIZE = 20;

  const [requirements, total] = await Promise.all([
    Requirement.find(query).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Requirement.countDocuments(query),
  ]);

  return res.render("admin/requirements", {
    title: "Requirements",
    status,
    page,
    requirements,
    total,
    hasNextPage: page * PAGE_SIZE < total,
    statuses: ["all", "active", "fulfilled", "expired", "cancelled"],
  });
}

export async function showRatings(req, res) {
  const page = Number(req.query.page) || 1;
  const PAGE_SIZE = 20;

  const [ratings, total] = await Promise.all([
    Rating.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Rating.countDocuments(),
  ]);

  return res.render("admin/ratings", {
    title: "Ratings",
    page,
    ratings,
    total,
    hasNextPage: page * PAGE_SIZE < total,
  });
}

export async function showTradeScores(req, res) {
  const page = Number(req.query.page) || 1;
  const PAGE_SIZE = 20;

  const [scores, total] = await Promise.all([
    TradeScore.find().sort({ tradeScore: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    TradeScore.countDocuments(),
  ]);

  return res.render("admin/trade-scores", {
    title: "Trade Scores",
    page,
    scores,
    total,
    hasNextPage: page * PAGE_SIZE < total,
  });
}

export async function showPackagingGuides(req, res) {
  const guides = await PackagingGuide.find().sort({ commodity: 1 }).lean();
  return res.render("admin/packaging-guides", {
    title: "Packaging Guides",
    guides,
  });
}

export async function showNotifications(req, res) {
  const page = Number(req.query.page) || 1;
  const PAGE_SIZE = 20;

  const [notifications, total] = await Promise.all([
    Notification.find().sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Notification.countDocuments(),
  ]);

  return res.render("admin/notifications", {
    title: "Notifications",
    page,
    notifications,
    total,
    hasNextPage: page * PAGE_SIZE < total,
  });
}
