import express from "express";
import {
  showLoginPage,
  login,
  logout,
  showDashboard,
  showProfiles,
  approveProfile,
  rejectProfile,
  showLeads,
  updateLeadStatus,
  showUsers,
  showProducts,
  approveProduct,
  rejectProduct,
  deleteProduct,
} from "../controllers/admin.controller.js";

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.session?.adminId) return next();

  req.session.returnTo = req.originalUrl;
  return res.redirect("/admin/login");
}

router.get("/login", showLoginPage);
router.post("/login", login);
router.get("/logout", logout);

router.get("/", requireAdmin, showDashboard);
router.get("/profiles", requireAdmin, showProfiles);
router.post("/profiles/:type/:id/approve", requireAdmin, approveProfile);
router.post("/profiles/:type/:id/reject", requireAdmin, rejectProfile);
router.get("/leads", requireAdmin, showLeads);
router.post("/leads/:id/status", requireAdmin, updateLeadStatus);
router.get("/users", requireAdmin, showUsers);
router.get("/products", requireAdmin, showProducts);
router.post("/products/:id/approve", requireAdmin, approveProduct);
router.post("/products/:id/reject", requireAdmin, rejectProduct);
router.post("/products/:id/delete", requireAdmin, deleteProduct);

export default router;
