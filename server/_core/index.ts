import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { syncAllDriveConnections } from "../drive-sync";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
    
    // Start scheduled Google Drive sync (every 30 minutes)
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
