/**
 * Standalone server for Railway deployment
 * Does not depend on Manus OAuth - uses PIN-only authentication
 */
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStandaloneAuthRoutes, authenticateRequest } from "./standalone-auth";
import { standaloneAppRouter } from "./standalone-routers";
import { syncAllDriveConnections } from "./drive-sync";
import type { Request, Response, NextFunction } from "express";

const PORT = parseInt(process.env.PORT || "3000");

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Register standalone auth routes (PIN login, logout, me)
  registerStandaloneAuthRoutes(app);

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now(), mode: "standalone" });
  });

  // Create context for tRPC
  const createContext = async ({ req, res }: { req: Request; res: Response }) => {
    let user = null;
    try {
      user = await authenticateRequest(req);
    } catch {
      // User not authenticated - that's ok for public procedures
    }
    return { req, res, user };
  };

  // tRPC middleware
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: standaloneAppRouter,
      createContext,
    })
  );

  // Serve static files for the web app (production)
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(__dirname, "../dist-web");
    app.use(express.static(distPath));
    
    // SPA fallback - serve index.html for all non-API routes
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Standalone server listening on port ${PORT}`);
    console.log(`[Server] Mode: ${process.env.NODE_ENV || "development"}`);
    
    // Start scheduled Google Drive sync
    startScheduledSync();
  });
}

// Scheduled sync for Google Drive
let syncInterval: ReturnType<typeof setInterval> | null = null;
const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function startScheduledSync() {
  // Run initial sync after 1 minute delay
  setTimeout(async () => {
    console.log("[DriveSync] Running initial sync...");
    try {
      const result = await syncAllDriveConnections();
      console.log(`[DriveSync] Initial sync complete: ${result.successful}/${result.total} successful`);
    } catch (error) {
      console.error("[DriveSync] Initial sync failed:", error);
    }
  }, 60000);

  // Set up recurring sync
  syncInterval = setInterval(async () => {
    console.log("[DriveSync] Running scheduled sync...");
    try {
      const result = await syncAllDriveConnections();
      console.log(`[DriveSync] Scheduled sync complete: ${result.successful}/${result.total} successful`);
    } catch (error) {
      console.error("[DriveSync] Scheduled sync failed:", error);
    }
  }, SYNC_INTERVAL_MS);

  console.log(`[DriveSync] Scheduled sync enabled (every ${SYNC_INTERVAL_MS / 60000} minutes)`);
}

startServer().catch(console.error);
