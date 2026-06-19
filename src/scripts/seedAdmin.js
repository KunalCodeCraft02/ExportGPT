import "dotenv/config";
import connectDB from "../config/db.js";
import AdminUser from "../models/AdminUser.js";
import { ensureAdminUser } from "../services/admin.service.js";
import logger from "../utils/logger.js";

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    logger.error("Missing ADMIN_USERNAME or ADMIN_PASSWORD. Set both environment variables before seeding.");
    process.exit(1);
  }

  await connectDB();

  const admin = await ensureAdminUser({
    username,
    password,
    name: process.env.ADMIN_NAME || "Admin",
    role: process.env.ADMIN_ROLE || "admin",
  });

  logger.info(`Admin user ready: ${admin.username}`);
  process.exit(0);
}

main().catch((error) => {
  logger.error(`Admin seed failed: ${error.message}`);
  process.exit(1);
});
