import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import session from "express-session";
import connectDB from "./config/db.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import logger from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(
  session({
    secret: process.env.ADMIN_SESSION_SECRET || "exportconnect-admin-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ExportConnect B2B marketplace API is running 🌾",
    version: "2.1.0",
  });
});

app.use("/", whatsappRoutes);
app.use("/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

async function findAvailablePort(startPort) {
  const net = await import("net");
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      server.close();
      findAvailablePort(parseInt(startPort) + 1).then(resolve);
    });
    server.once("listening", () => {
      server.close(() => resolve(startPort));
    });
    server.listen(startPort);
  });
}

const startServer = async () => {
  await connectDB();

  const availablePort = await findAvailablePort(PORT);
  app.listen(availablePort, () => {
    const requestedPort = parseInt(PORT);
    if (availablePort !== requestedPort) {
      logger.warn(`Port ${PORT} was in use, using port ${availablePort}`);
    }

    logger.info(`ExportConnect server running on port ${availablePort}`);
    logger.info(`Health check: http://localhost:${availablePort}/`);
    logger.info("WhatsApp webhook: POST /webhook");
  });
};

startServer();
