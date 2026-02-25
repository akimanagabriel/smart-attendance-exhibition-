/**
 * Smart Campus Hub - Main Server Entry Point
 * Production-ready Express server
 */

import "dotenv/config";
import express, { Express, Request, Response, NextFunction } from "express";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { webSocketService } from "./services/websocket";
import { getLocalIPs } from "./utils/network";

// Import routes
import adminRoutes from "./routes/admin";
import parentRoutes from "./routes/parent";
import staffRoutes from "./routes/staff";

// iot
import iot from "./iot/api";

// ============================================
// SERVER CONFIGURATION
// ============================================

const app: Express = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// ============================================
// MIDDLEWARE SETUP
// ============================================

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }),
);

// Rate limiting - relaxed for exhibition/dev
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logging middleware (development only)
if (NODE_ENV === "development") {
  app.use((req: Request, res: Response, next: NextFunction) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
  });
}

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
  });
});

// ============================================
// API ROUTES
// ============================================

app.use("/api/admin", adminRoutes);
app.use("/api/parent", parentRoutes);
app.use("/api/staff", staffRoutes);

// Register iot endpoints
app.use("/iot", iot);

// Base API info
app.get("/api", (req, res) => {
  res.json({
    message: "Smart Campus Hub API is active",
    version: "1.0.0",
    endpoints: {
      admin: "/api/admin",
      parent: "/api/parent",
      staff: "/api/staff",
    },
  });
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

// 404 handler
app.use((req: Request, _res: Response) => {
  _res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message:
      NODE_ENV === "development" ? err.message : "An unexpected error occurred",
  });
});

// ============================================
// SERVER STARTUP
// ============================================

async function startServer() {
  try {
    const httpServer = createServer(app);

    // Initialize WebSocket server
    console.log("[Server] Initializing WebSocket server...");
    webSocketService.initialize(httpServer);
    console.log("[Server] WebSocket server initialized");

    httpServer.listen(PORT, () => {
      const localIPs = getLocalIPs();
      console.log(
        `[Server] 🚀 Smart Campus Hub backend running on port ${PORT}`,
      );
      console.log(`[Server] Environment: ${NODE_ENV}`);
      console.log(`[Server] Local Access: http://localhost:${PORT}/api`);
      if (localIPs.length > 0) {
        console.log(`[Server] Network Access (for other PCs/IoT):`);
        localIPs.forEach((ip) => {
          console.log(`         - http://${ip}:${PORT}/api`);
          console.log(`         - http://${ip}:${PORT}/iot`);
        });
      }
      console.log(`[Server] Health check: http://localhost:${PORT}/health`);
      console.log(`[Server] WebSocket: ws://localhost:${PORT}`);
    });

    process.on("SIGTERM", async () => {
      console.log("[Server] SIGTERM received, shutting down gracefully...");
      httpServer.close(() => {
        console.log("[Server] HTTP server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      console.log("[Server] SIGINT received, shutting down gracefully...");
      httpServer.close(() => {
        console.log("[Server] HTTP server closed");
        process.exit(0);
      });
    });
  } catch (error) {
    console.error("[Server] Failed to start server:", error);
    process.exit(1);
  }
}

startServer();

export default app;
