import "dotenv/config";
import express from "express";
import connectDB from "./config/db.js";
import whatsappRoutes from "./routes/whatsapp.routes.js";
import logger from "./utils/logger.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ExportConnect B2B marketplace API is running 🌾",
    version: "2.1.0",
  });
});

app.use("/", whatsappRoutes);

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
      resolve(findAvailablePort(parseInt(startPort) + 1));
      server.close();
    });
    server.once("listening", () => {
      server.close();
      resolve(startPort);
    });
    server.listen(startPort);
  });
}

const startServer = async () => {
  await connectDB();

  const availablePort = await findAvailablePort(PORT);
  app.listen(availablePort, () => {
    if (availablePort !== parseInt(PORT)) {
      logger.warn(`Port ${PORT} was in use, using port ${availablePort}`);
    }

    logger.info(`ExportConnect server running on port ${availablePort}`);
    logger.info(`Health check: http://localhost:${availablePort}/`);
    logger.info("WhatsApp webhook: POST /webhook");
  });
};

startServer();
