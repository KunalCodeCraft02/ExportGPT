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

export async function showLoginPage(req, res) {
  if (req.session?.adminId) return res.redirect("/admin");

  return res.render("admin/login", {
    title: "Admin Login",
    error: req.query.error === "1",
  });
}

export async function login(req, res) {
  const admin = await validateAdminLogin(req.body?.username, req.body?.password);

  if (!admin) {
    return res.redirect("/admin/login?error=1");
  }

  req.session.adminId = admin._id.toString();
  req.session.adminName = admin.name || "Admin";

  const returnTo = req.session.returnTo || "/admin";
  delete req.session.returnTo;

  return res.redirect(returnTo);
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
  const result = await listProfiles({ role, status, page });

  return res.render("admin/profiles", {
    title: "Profile Verification",
    role,
    status,
    page,
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
  return ["all", "pending", "approved", "rejected"].includes(normalized) ? normalized : "pending";
}
