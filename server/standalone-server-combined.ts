/**
 * Standalone server for Railway deployment
 * Does not depend on Manus OAuth - uses PIN-only authentication
 * Includes Email IMAP auto-sync for sales reports
 */
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStandaloneAuthRoutes, authenticateRequest } from "./standalone-auth";
import { standaloneAppRouter } from "./standalone-routers";
import * as db from "./db"; // Uses raw MySQL execute/query methods
import type { Request, Response } from "express";
import { startScheduledEmailSync, testImapConnection, fetchAndProcessEmails, getEmailConfig, getLastSyncInfo } from "./email-sync";

const PORT = parseInt(process.env.PORT || "8080");

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
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ ok: true, timestamp: Date.now(), mode: "standalone" });
  });

  // Register auth routes
  registerStandaloneAuthRoutes(app);

  // API endpoint to get sales data
  app.get("/api/sales", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      
      const saleType = req.query.type as string || 'online';
      let query = "SELECT id, orderDate, orderNo, salesChannel, netSales, paymentGateway, saleType FROM sales";
      let params: any[] = [];
      let whereConditions: string[] = [];
      
      // Filter by sale type
      if (saleType === 'online') {
        whereConditions.push("(saleType = 'online' OR saleType IS NULL)");
      } else if (saleType === 'pos') {
        whereConditions.push("saleType = 'pos'");
      }
      
      // If not admin, only show user's own sales
      if (user.role !== "admin" && user.staffId) {
        whereConditions.push("staffId = ?");
        params.push(user.staffId);
      }
      
      if (whereConditions.length > 0) {
        query += " WHERE " + whereConditions.join(" AND ");
      }
      
      query += " ORDER BY orderDate DESC LIMIT 100";
      
      const [rows] = await db.execute(query, params);
      const sales = rows as any[];
      
      // Calculate total
      const total = sales.reduce((sum, s) => sum + (parseFloat(s.netSales) || 0), 0);
      
      res.json({ sales, total, count: sales.length });
    } catch (error) {
      console.error("[API] Get sales error:", error);
      res.status(500).json({ error: "Failed to get sales" });
    }
  });

  // API endpoint to upload CSV sales data (admin only)
  app.post("/api/sales/upload", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const { csvData } = req.body;
      if (!csvData) {
        res.status(400).json({ error: "No CSV data provided" });
        return;
      }
      
      // Parse CSV
      const lines = csvData.trim().split("\n");
      if (lines.length < 2) {
        res.status(400).json({ error: "CSV must have header and at least one data row" });
        return;
      }
      
      // Parse header using proper CSV parsing
      function parseCSVHeader(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let j = 0; j < line.length; j++) {
          const char = line[j];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/^"|"$/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim().replace(/^"|"$/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
        return result;
      }
      
      const header = parseCSVHeader(lines[0]);
      
      // Find column indices
      const dateIdx = header.findIndex((h: string) => h.includes("date") || h.includes("orderdate"));
      const orderIdx = header.findIndex((h: string) => h.includes("orderid") || h.includes("orderno") || h.includes("ordername") || h === "order");
      const channelIdx = header.findIndex((h: string) => h.includes("channel") || h.includes("saleschannel"));
      const netSalesIdx = header.findIndex((h: string) => h.includes("netsales") || h.includes("net") || h.includes("amount") || h.includes("total"));
      
      if (netSalesIdx === -1) {
        res.status(400).json({ error: "Could not find Net Sales column in CSV" });
        return;
      }
      
      let imported = 0;
      let skipped = 0;
      
      // Better CSV parsing function that handles quoted fields
      function parseCSVLine(line: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim().replace(/^"|"$/g, ''));
        return result;
      }
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Parse CSV line handling quoted fields
        const values = parseCSVLine(line);
        
        // Parse and convert date to MySQL format (YYYY-MM-DD)
        let orderDate: string | null = null;
        if (dateIdx >= 0 && values[dateIdx]) {
          const rawDate = values[dateIdx].trim();
          // Try different date formats
          if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
            // MM-DD-YYYY format -> YYYY-MM-DD
            const [mm, dd, yyyy] = rawDate.split('-');
            orderDate = `${yyyy}-${mm}-${dd}`;
          } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            // Already YYYY-MM-DD format
            orderDate = rawDate;
          } else if (rawDate.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
            // M/D/YYYY or MM/DD/YYYY format -> YYYY-MM-DD
            const parts = rawDate.split('/');
            const mm = parts[0].padStart(2, '0');
            const dd = parts[1].padStart(2, '0');
            const yyyy = parts[2];
            orderDate = `${yyyy}-${mm}-${dd}`;
          } else {
            // Try to parse as date string
            const parsed = new Date(rawDate);
            if (!isNaN(parsed.getTime())) {
              orderDate = parsed.toISOString().split('T')[0];
            }
          }
        }
        const orderNo = orderIdx >= 0 ? values[orderIdx] : null;
        const salesChannel = channelIdx >= 0 ? values[channelIdx] : null;
        const netSales = parseFloat(values[netSalesIdx]?.replace(/[^0-9.-]/g, "") || "0");
        
        if (isNaN(netSales)) {
          skipped++;
          continue;
        }
        
        // Check for duplicate
        if (orderNo) {
          const [existing] = await db.execute("SELECT id FROM sales WHERE orderNo = ?", [orderNo]);
          if ((existing as any[]).length > 0) {
            skipped++;
            continue;
          }
        }
        
        await db.execute(
          "INSERT INTO sales (orderDate, orderNo, salesChannel, netSales) VALUES (?, ?, ?, ?)",
          [orderDate || null, orderNo || null, salesChannel || null, netSales]
        );
        imported++;
      }
      
      res.json({ success: true, imported, skipped, message: `Imported ${imported} sales, skipped ${skipped} duplicates/invalid` });
    } catch (error) {
      console.error("[API] Upload sales error:", error);
      res.status(500).json({ error: "Failed to upload sales data" });
    }
  });

  // API endpoint to get Google Drive config (admin only)
  app.get("/api/drive/config", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const [rows] = await db.execute("SELECT * FROM driveConfig LIMIT 1");
      const config = (rows as any[])[0] || null;
      
      res.json({ config });
    } catch (error) {
      console.error("[API] Get drive config error:", error);
      res.status(500).json({ error: "Failed to get drive config" });
    }
  });

  // API endpoint to save Google Drive config (admin only)
  app.post("/api/drive/config", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const { folderId, enabled } = req.body;
      
      // Check if config exists
      const [existing] = await db.execute("SELECT id FROM driveConfig LIMIT 1");
      
      if ((existing as any[]).length > 0) {
        await db.execute(
          "UPDATE driveConfig SET folderId = ?, enabled = ?, updatedAt = NOW()",
          [folderId || null, enabled ? 1 : 0]
        );
      } else {
        await db.execute(
          "INSERT INTO driveConfig (folderId, enabled) VALUES (?, ?)",
          [folderId || null, enabled ? 1 : 0]
        );
      }
      
      res.json({ success: true, message: "Drive config saved" });
    } catch (error) {
      console.error("[API] Save drive config error:", error);
      res.status(500).json({ error: "Failed to save drive config" });
    }
  });

  // API endpoint to get all staff (admin only)
  app.get("/api/staff", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const [rows] = await db.execute("SELECT id, openId, name, role, staffId, pin FROM users ORDER BY name");
      res.json({ staff: rows });
    } catch (error) {
      console.error("[API] Get staff error:", error);
      res.status(500).json({ error: "Failed to get staff" });
    }
  });

  // API endpoint to add new staff (admin only)
  app.post("/api/staff", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const { name, pin, staffId, role = "staff" } = req.body;
      
      if (!name || !pin || pin.length < 4) {
        res.status(400).json({ error: "Name and PIN (at least 4 digits) are required" });
        return;
      }
      
      // Check if PIN already exists
      const [existing] = await db.execute("SELECT id FROM users WHERE pin = ?", [pin]);
      if ((existing as any[]).length > 0) {
        res.status(400).json({ error: "PIN already in use" });
        return;
      }
      
      const openId = "staff-" + Date.now();
      await db.execute(
        "INSERT INTO users (openId, name, role, staffId, pin, loginMethod) VALUES (?, ?, ?, ?, ?, 'pin')",
        [openId, name, role, staffId || null, pin]
      );
      
      res.json({ success: true, message: "Staff added successfully" });
    } catch (error) {
      console.error("[API] Add staff error:", error);
      res.status(500).json({ error: "Failed to add staff" });
    }
  });

  // API endpoint to delete staff (admin only)
  app.delete("/api/staff/:id", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const staffId = parseInt(req.params.id);
      
      // Prevent deleting yourself
      if (staffId === user.id) {
        res.status(400).json({ error: "Cannot delete yourself" });
        return;
      }
      
      await db.execute("DELETE FROM users WHERE id = ?", [staffId]);
      res.json({ success: true, message: "Staff deleted successfully" });
    } catch (error) {
      console.error("[API] Delete staff error:", error);
      res.status(500).json({ error: "Failed to delete staff" });
    }
  });

  // Email sync API endpoints
  app.get("/api/email/config", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const config = getEmailConfig();
      const syncInfo = getLastSyncInfo();
      res.json({ 
        config: {
          email: config.email,
          enabled: config.enabled,
          hasPassword: !!config.password,
          lastSyncTime: syncInfo.lastSyncTime,
          lastSyncResult: syncInfo.lastSyncResult
        }
      });
    } catch (error) {
      console.error("[API] Get email config error:", error);
      res.status(500).json({ error: "Failed to get email config" });
    }
  });

  app.post("/api/email/test", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const result = await testImapConnection();
      res.json(result);
    } catch (error) {
      console.error("[API] Test email error:", error);
      res.status(500).json({ success: false, error: "Failed to test connection" });
    }
  });

  app.post("/api/email/fetch", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const result = await fetchAndProcessEmails();
      res.json(result);
    } catch (error) {
      console.error("[API] Fetch email error:", error);
      res.status(500).json({ success: false, error: "Failed to fetch emails" });
    }
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

  // Serve web interface at root
  app.get("/", (req, res) => {
    res.send(getAdminHTML());
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Standalone server listening on port ${PORT}`);
    console.log(`[Server] Mode: ${process.env.NODE_ENV || "development"}`);
    
    // Start email sync
    startScheduledEmailSync();
  });
}

function getAdminHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ms. Chu Sales Tracker</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { background: white; padding: 30px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); width: 100%; max-width: 1000px; margin: 0 auto; }
        .logo { font-size: 36px; margin-bottom: 5px; text-align: center; }
        h1 { color: #333; margin-bottom: 5px; font-size: 22px; text-align: center; }
        .subtitle { color: #666; margin-bottom: 25px; font-size: 14px; text-align: center; }
        .pin-input { display: flex; gap: 10px; justify-content: center; margin-bottom: 25px; }
        .pin-input input { width: 50px; height: 60px; text-align: center; font-size: 24px; border: 2px solid #ddd; border-radius: 10px; outline: none; }
        .pin-input input:focus { border-color: #667eea; }
        .login-btn { display: block; width: 200px; margin: 0 auto; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .login-btn:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4); }
        .error { color: #e74c3c; margin-top: 15px; font-size: 14px; display: none; text-align: center; }
        .dashboard { display: none; }
        .dashboard-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; flex-wrap: wrap; gap: 10px; }
        .user-info { text-align: left; }
        .user-name { font-weight: 600; color: #333; font-size: 20px; }
        .user-role { font-size: 12px; color: #666; text-transform: uppercase; background: #f0f0f0; padding: 3px 8px; border-radius: 4px; display: inline-block; margin-top: 4px; }
        .header-buttons { display: flex; gap: 10px; }
        .logout-btn { padding: 10px 20px; background: #f1f1f1; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; }
        .logout-btn:hover { background: #e5e5e5; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; }
        .stat-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; text-align: center; color: white; }
        .stat-value { font-size: 32px; font-weight: 700; }
        .stat-label { font-size: 13px; opacity: 0.9; margin-top: 5px; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #333; font-size: 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
        .sales-table, .staff-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .sales-table th, .staff-table th { background: #f8f9fa; padding: 12px 10px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #e0e0e0; }
        .sales-table td, .staff-table td { padding: 12px 10px; border-bottom: 1px solid #eee; color: #333; }
        .sales-table tr:hover, .staff-table tr:hover { background: #f8f9fa; }
        .sales-table .amount { font-weight: 600; color: #27ae60; }
        .no-data { text-align: center; padding: 40px; color: #999; }
        .loading { text-align: center; padding: 20px; color: #666; }
        .tabs { display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 2px solid #eee; padding-bottom: 10px; flex-wrap: wrap; }
        .tab { padding: 10px 20px; background: none; border: none; cursor: pointer; font-size: 15px; color: #666; border-radius: 8px; }
        .tab.active { background: #667eea; color: white; }
        .tab:hover:not(.active) { background: #f0f0f0; }
        .admin-panel, .upload-panel, .drive-panel, .email-panel { display: none; }
        .form-section { background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
        .form-section h3 { margin-bottom: 15px; color: #333; font-size: 16px; }
        .form-row { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
        .form-row input, .form-row select, .form-row textarea { padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; }
        .form-row input, .form-row select { flex: 1; min-width: 120px; }
        .form-row textarea { width: 100%; min-height: 150px; font-family: monospace; }
        .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; }
        .btn-primary { background: #667eea; color: white; }
        .btn-primary:hover { background: #5a6fd6; }
        .btn-success { background: #27ae60; color: white; }
        .btn-success:hover { background: #219a52; }
        .btn-danger { background: #e74c3c; color: white; }
        .btn-danger:hover { background: #c0392b; }
        .btn-secondary { background: #95a5a6; color: white; }
        .btn-secondary:hover { background: #7f8c8d; }
        .delete-btn { padding: 5px 12px; background: #e74c3c; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 12px; }
        .delete-btn:hover { background: #c0392b; }
        .message { padding: 10px 15px; border-radius: 8px; margin-bottom: 15px; display: none; }
        .message.success { background: #d4edda; color: #155724; display: block; }
        .message.error { background: #f8d7da; color: #721c24; display: block; }
        .file-input-wrapper { position: relative; }
        .file-input-wrapper input[type="file"] { position: absolute; left: 0; top: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
        .file-input-label { display: inline-block; padding: 10px 20px; background: #667eea; color: white; border-radius: 8px; cursor: pointer; }
        .file-input-label:hover { background: #5a6fd6; }
        .drive-status, .email-status { padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .drive-status.connected, .email-status.connected { background: #d4edda; color: #155724; }
        .drive-status.disconnected, .email-status.disconnected { background: #fff3cd; color: #856404; }
        .help-text { font-size: 12px; color: #666; margin-top: 5px; }
        @media (max-width: 600px) {
            .container { padding: 20px; }
            .stats-grid { grid-template-columns: 1fr; }
            .sales-table, .staff-table { font-size: 12px; }
            .sales-table th, .sales-table td, .staff-table th, .staff-table td { padding: 8px 5px; }
            .form-row { flex-direction: column; }
            .form-row input, .form-row select { width: 100%; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="login-form" id="loginForm">
            <div class="logo">🧼</div>
            <h1>Ms. Chu Sales Tracker</h1>
            <p class="subtitle">Enter your PIN to login</p>
            <div class="pin-input">
                <input type="password" maxlength="1" id="pin1" inputmode="numeric" pattern="[0-9]*">
                <input type="password" maxlength="1" id="pin2" inputmode="numeric" pattern="[0-9]*">
                <input type="password" maxlength="1" id="pin3" inputmode="numeric" pattern="[0-9]*">
                <input type="password" maxlength="1" id="pin4" inputmode="numeric" pattern="[0-9]*">
            </div>
            <button class="login-btn" id="loginBtn">Login</button>
            <p class="error" id="error"></p>
        </div>
        <div class="dashboard" id="dashboard">
            <div class="dashboard-header">
                <div class="user-info">
                    <div class="user-name" id="userName">Welcome</div>
                    <div class="user-role" id="userRole">Staff</div>
                </div>
                <div class="header-buttons">
                    <button class="logout-btn" onclick="logout()">Logout</button>
                </div>
            </div>
            
            <div class="tabs" id="tabs">
                <button class="tab active" onclick="showTab('online-sales')">Online Sales</button>
                <button class="tab" onclick="showTab('pos-sales')">POS Sales</button>
                <button class="tab" onclick="showTab('admin')" id="adminTab" style="display:none">Staff Management</button>
                <button class="tab" onclick="showTab('upload')" id="uploadTab" style="display:none">Upload Sales</button>
                <button class="tab" onclick="showTab('email')" id="emailTab" style="display:none">Email Sync</button>
            </div>
            
            <div id="onlineSalesPanel">
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value" id="totalOnlineSales">$0</div>
                        <div class="stat-label">Total Online Sales</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="onlineOrderCount">0</div>
                        <div class="stat-label">Total Orders</div>
                    </div>
                </div>
                <div class="section">
                    <h2>Online Sales History</h2>
                    <div id="onlineSalesTableContainer">
                        <p class="loading">Loading sales data...</p>
                    </div>
                </div>
            </div>
            
            <div id="posSalesPanel" style="display:none">
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value" id="totalPosSales">$0</div>
                        <div class="stat-label">Total POS Sales</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="posOrderCount">0</div>
                        <div class="stat-label">Total Orders</div>
                    </div>
                </div>
                <div class="section">
                    <h2>POS Sales History</h2>
                    <div id="posSalesTableContainer">
                        <p class="loading">Loading POS sales data...</p>
                    </div>
                </div>
            </div>
            
            <div id="adminPanel" class="admin-panel">
                <div class="form-section">
                    <h3>Add New Staff</h3>
                    <div id="staffMessage" class="message"></div>
                    <div class="form-row">
                        <input type="text" id="newName" placeholder="Staff Name" required>
                        <input type="text" id="newPin" placeholder="PIN (4-6 digits)" maxlength="6" pattern="[0-9]*">
                        <input type="text" id="newStaffId" placeholder="Staff ID (optional)">
                        <select id="newRole">
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                        </select>
                        <button class="btn btn-success" onclick="addStaff()">Add Staff</button>
                    </div>
                </div>
                <div class="section">
                    <h2>Staff List</h2>
                    <div id="staffTableContainer">
                        <p class="loading">Loading staff...</p>
                    </div>
                </div>
            </div>
            
            <div id="uploadPanel" class="upload-panel">
                <div class="form-section">
                    <h3>Upload Sales Report (CSV or Excel)</h3>
                    <div id="uploadMessage" class="message"></div>
                    <p class="help-text" style="margin-bottom:15px">Upload a CSV or Excel (.xlsx) file with columns: Order Date, Order ID, Sales Channel, Net Sales</p>
                    <div class="form-row">
                        <div class="file-input-wrapper">
                            <span class="file-input-label">Choose File (CSV or Excel)</span>
                            <input type="file" id="csvFile" accept=".csv,.xlsx,.xls" onchange="handleFileSelect(event)">
                        </div>
                        <span id="fileName" style="color:#666">No file selected</span>
                    </div>
                    <div class="form-row" style="margin-top:15px">
                        <textarea id="csvPreview" placeholder="CSV content will appear here after selecting a file, or paste CSV data directly..."></textarea>
                    </div>
                    <div class="form-row" style="margin-top:10px">
                        <button class="btn btn-primary" onclick="uploadCSV()">Upload Sales Data</button>
                    </div>
                </div>
            </div>
            
            <div id="emailPanel" class="email-panel">
                <div class="form-section">
                    <h3>Email Auto-Sync</h3>
                    <div id="emailMessage" class="message"></div>
                    <div id="emailStatus" class="email-status disconnected">
                        <strong>Status:</strong> Checking...
                    </div>
                    <p class="help-text" style="margin-bottom:15px">
                        Automatically fetch sales reports from email attachments (CSV/Excel files).
                        The system checks for new emails every hour.
                    </p>
                    <div class="form-row" style="margin-top:15px">
                        <button class="btn btn-primary" onclick="testEmailConnection()">Test Connection</button>
                        <button class="btn btn-success" onclick="fetchEmailsNow()">Fetch Emails Now</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script>
        let currentUser = null;
        let currentTab = 'online-sales';
        const pins = [
            document.getElementById('pin1'),
            document.getElementById('pin2'),
            document.getElementById('pin3'),
            document.getElementById('pin4')
        ];
        
        pins.forEach((p, i) => {
            p.addEventListener('input', (e) => {
                if (e.target.value && i < 3) pins[i + 1].focus();
                const pinValue = pins.map(x => x.value).join('');
                if (pinValue.length >= 4) {
                    // Auto-login when 4+ digits entered
                    setTimeout(() => {
                        const currentPin = pins.map(x => x.value).join('');
                        if (currentPin.length >= 4) login();
                    }, 300);
                }
            });
            p.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && i > 0) pins[i - 1].focus();
            });
        });
        
        document.getElementById('loginBtn').onclick = login;
        
        async function login() {
            const pin = pins.map(p => p.value).join('');
            if (pin.length < 4) return;
            
            document.getElementById('error').style.display = 'none';
            
            try {
                const r = await fetch('/api/auth/pin-login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ pin })
                });
                const d = await r.json();
                
                if (r.ok && d.success) {
                    currentUser = d.user;
                    showDashboard();
                } else {
                    document.getElementById('error').textContent = d.error || 'Invalid PIN';
                    document.getElementById('error').style.display = 'block';
                    pins.forEach(p => p.value = '');
                    pins[0].focus();
                }
            } catch (e) {
                document.getElementById('error').textContent = 'Connection error';
                document.getElementById('error').style.display = 'block';
            }
        }
        
        function showDashboard() {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userRole').textContent = currentUser.role;
            
            // Show admin tabs for admin users
            if (currentUser.role === 'admin') {
                document.getElementById('adminTab').style.display = 'block';
                document.getElementById('uploadTab').style.display = 'block';
                document.getElementById('emailTab').style.display = 'block';
            }
            
            loadOnlineSales();
        }
        
        function showTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            
            document.getElementById('onlineSalesPanel').style.display = tab === 'online-sales' ? 'block' : 'none';
            document.getElementById('posSalesPanel').style.display = tab === 'pos-sales' ? 'block' : 'none';
            document.getElementById('adminPanel').style.display = tab === 'admin' ? 'block' : 'none';
            document.getElementById('uploadPanel').style.display = tab === 'upload' ? 'block' : 'none';
            document.getElementById('emailPanel').style.display = tab === 'email' ? 'block' : 'none';
            
            if (tab === 'online-sales') loadOnlineSales();
            if (tab === 'pos-sales') loadPosSales();
            if (tab === 'admin') loadStaff();
            if (tab === 'email') loadEmailConfig();
        }
        
        async function loadOnlineSales() {
            try {
                const r = await fetch('/api/sales?type=online', { credentials: 'include' });
                const d = await r.json();
                
                if (r.ok) {
                    document.getElementById('totalOnlineSales').textContent = 'HK$' + d.total.toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    document.getElementById('onlineOrderCount').textContent = d.count;
                    
                    if (d.sales && d.sales.length > 0) {
                        let html = '<table class="sales-table"><thead><tr><th>Order Date</th><th>Order</th><th>Channel</th><th>Net Sales</th></tr></thead><tbody>';
                        d.sales.forEach(s => {
                            const date = s.orderDate ? new Date(s.orderDate).toLocaleDateString() : '-';
                            html += '<tr><td>' + date + '</td><td>' + (s.orderNo || '-') + '</td><td>' + (s.salesChannel || '-') + '</td><td class="amount">HK$' + (parseFloat(s.netSales) || 0).toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
                        });
                        html += '</tbody></table>';
                        document.getElementById('onlineSalesTableContainer').innerHTML = html;
                    } else {
                        document.getElementById('onlineSalesTableContainer').innerHTML = '<p class="no-data">No online sales data yet</p>';
                    }
                }
            } catch (e) {
                document.getElementById('onlineSalesTableContainer').innerHTML = '<p class="no-data">Failed to load sales data</p>';
            }
        }
        
        async function loadPosSales() {
            try {
                const r = await fetch('/api/sales?type=pos', { credentials: 'include' });
                const d = await r.json();
                
                if (r.ok) {
                    document.getElementById('totalPosSales').textContent = 'HK$' + d.total.toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    document.getElementById('posOrderCount').textContent = d.count;
                    
                    if (d.sales && d.sales.length > 0) {
                        let html = '<table class="sales-table"><thead><tr><th>Order Date</th><th>Order</th><th>Channel</th><th>Payment Gateway</th><th>Net Sales</th></tr></thead><tbody>';
                        d.sales.forEach(s => {
                            const date = s.orderDate ? new Date(s.orderDate).toLocaleDateString() : '-';
                            html += '<tr><td>' + date + '</td><td>' + (s.orderNo || '-') + '</td><td>' + (s.salesChannel || '-') + '</td><td>' + (s.paymentGateway || '-') + '</td><td class="amount">HK$' + (parseFloat(s.netSales) || 0).toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
                        });
                        html += '</tbody></table>';
                        document.getElementById('posSalesTableContainer').innerHTML = html;
                    } else {
                        document.getElementById('posSalesTableContainer').innerHTML = '<p class="no-data">No POS sales data yet</p>';
                    }
                }
            } catch (e) {
                document.getElementById('posSalesTableContainer').innerHTML = '<p class="no-data">Failed to load POS sales data</p>';
            }
        }
        
        async function loadStaff() {
            try {
                const r = await fetch('/api/staff', { credentials: 'include' });
                const d = await r.json();
                
                if (r.ok && d.staff) {
                    let html = '<table class="staff-table"><thead><tr><th>Name</th><th>Staff ID</th><th>PIN</th><th>Role</th><th>Action</th></tr></thead><tbody>';
                    d.staff.forEach(s => {
                        const isCurrentUser = s.id === currentUser.id;
                        html += '<tr><td>' + s.name + '</td><td>' + (s.staffId || '-') + '</td><td>' + (s.pin || '-') + '</td><td>' + s.role + '</td><td>' + 
                            (isCurrentUser ? '<span style="color:#999">Current user</span>' : '<button class="delete-btn" onclick="deleteStaff(' + s.id + ', \\'' + s.name.replace(/'/g, "\\\\'") + '\\')">Delete</button>') + 
                            '</td></tr>';
                    });
                    html += '</tbody></table>';
                    document.getElementById('staffTableContainer').innerHTML = html;
                }
            } catch (e) {
                document.getElementById('staffTableContainer').innerHTML = '<p class="no-data">Failed to load staff</p>';
            }
        }
        
        async function addStaff() {
            const name = document.getElementById('newName').value.trim();
            const pin = document.getElementById('newPin').value.trim();
            const staffId = document.getElementById('newStaffId').value.trim();
            const role = document.getElementById('newRole').value;
            
            if (!name || !pin || pin.length < 4) {
                showMessage('staffMessage', 'Please enter name and PIN (at least 4 digits)', 'error');
                return;
            }
            
            try {
                const r = await fetch('/api/staff', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ name, pin, staffId, role })
                });
                const d = await r.json();
                
                if (r.ok && d.success) {
                    showMessage('staffMessage', 'Staff added successfully!', 'success');
                    document.getElementById('newName').value = '';
                    document.getElementById('newPin').value = '';
                    document.getElementById('newStaffId').value = '';
                    document.getElementById('newRole').value = 'staff';
                    loadStaff();
                } else {
                    showMessage('staffMessage', d.error || 'Failed to add staff', 'error');
                }
            } catch (e) {
                showMessage('staffMessage', 'Connection error', 'error');
            }
        }
        
        async function deleteStaff(id, name) {
            if (!confirm('Are you sure you want to delete ' + name + '?')) return;
            
            try {
                const r = await fetch('/api/staff/' + id, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                const d = await r.json();
                
                if (r.ok && d.success) {
                    showMessage('staffMessage', 'Staff deleted successfully!', 'success');
                    loadStaff();
                } else {
                    showMessage('staffMessage', d.error || 'Failed to delete staff', 'error');
                }
            } catch (e) {
                showMessage('staffMessage', 'Connection error', 'error');
            }
        }
        
        async function handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            document.getElementById('fileName').textContent = file.name;
            const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
            
            if (isExcel) {
                // Load SheetJS library dynamically for Excel parsing
                if (!window.XLSX) {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
                    script.onload = () => parseExcelFile(file);
                    document.head.appendChild(script);
                } else {
                    parseExcelFile(file);
                }
            } else {
                // CSV file - read as text
                const reader = new FileReader();
                reader.onload = function(e) {
                    document.getElementById('csvPreview').value = e.target.result;
                };
                reader.readAsText(file);
            }
        }
        
        function parseExcelFile(file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const csv = XLSX.utils.sheet_to_csv(firstSheet);
                    document.getElementById('csvPreview').value = csv;
                    showMessage('uploadMessage', 'Excel file converted to CSV format', 'success');
                } catch (err) {
                    showMessage('uploadMessage', 'Failed to parse Excel file: ' + err.message, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        }
        
        async function uploadCSV() {
            const csvData = document.getElementById('csvPreview').value.trim();
            if (!csvData) {
                showMessage('uploadMessage', 'Please select a CSV file or paste CSV data', 'error');
                return;
            }
            
            try {
                const r = await fetch('/api/sales/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ csvData })
                });
                const d = await r.json();
                
                if (r.ok && d.success) {
                    showMessage('uploadMessage', d.message, 'success');
                    document.getElementById('csvPreview').value = '';
                    document.getElementById('fileName').textContent = 'No file selected';
                    loadOnlineSales();
                } else {
                    showMessage('uploadMessage', d.error || 'Failed to upload', 'error');
                }
            } catch (e) {
                showMessage('uploadMessage', 'Connection error', 'error');
            }
        }
        
        async function loadEmailConfig() {
            try {
                const r = await fetch('/api/email/config', { credentials: 'include' });
                const d = await r.json();
                
                if (r.ok && d.config) {
                    updateEmailStatus(d.config.email, d.config.enabled, d.config.hasPassword, d.config.lastSyncTime, d.config.lastSyncResult);
                } else {
                    updateEmailStatus(null, false, false, null, null);
                }
            } catch (e) {
                updateEmailStatus(null, false, false, null, null);
            }
        }
        
        function formatLastSyncTime(isoString) {
            if (!isoString) return 'Never';
            const date = new Date(isoString);
            return date.toLocaleString();
        }
        
        function updateEmailStatus(email, enabled, hasPassword, lastSyncTime, lastSyncResult) {
            const status = document.getElementById('emailStatus');
            let syncInfo = '';
            if (lastSyncTime) {
                syncInfo = '<br><strong>Last Sync:</strong> ' + formatLastSyncTime(lastSyncTime);
                if (lastSyncResult) {
                    syncInfo += ' (' + (lastSyncResult.imported || 0) + ' records imported)';
                }
            } else {
                syncInfo = '<br><strong>Last Sync:</strong> Never (waiting for first sync)';
            }
            
            if (email && hasPassword && enabled) {
                status.className = 'email-status connected';
                status.innerHTML = '<strong>Status:</strong> Connected and enabled<br><strong>Email:</strong> ' + email + '<br><strong>Auto-fetch:</strong> Every 1 hour' + syncInfo;
            } else if (email && hasPassword) {
                status.className = 'email-status disconnected';
                status.innerHTML = '<strong>Status:</strong> Configured but disabled<br><strong>Email:</strong> ' + email + syncInfo;
            } else {
                status.className = 'email-status disconnected';
                status.innerHTML = '<strong>Status:</strong> Not configured<br>Set EMAIL_ADDRESS, EMAIL_PASSWORD, and EMAIL_ENABLED=true in environment variables';
            }
        }
        
        async function testEmailConnection() {
            showMessage('emailMessage', 'Testing connection...', 'success');
            try {
                const r = await fetch('/api/email/test', {
                    method: 'POST',
                    credentials: 'include'
                });
                const d = await r.json();
                
                if (d.success) {
                    showMessage('emailMessage', 'Connection successful! Found ' + d.messageCount + ' emails in inbox.', 'success');
                } else {
                    showMessage('emailMessage', 'Connection failed: ' + (d.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                showMessage('emailMessage', 'Connection error', 'error');
            }
        }
        
        async function fetchEmailsNow() {
            showMessage('emailMessage', 'Fetching emails... This may take a minute.', 'success');
            try {
                const r = await fetch('/api/email/fetch', {
                    method: 'POST',
                    credentials: 'include'
                });
                const d = await r.json();
                
                if (d.success) {
                    showMessage('emailMessage', 'Fetch complete! Processed ' + d.emailsProcessed + ' emails, imported ' + d.imported + ' sales records.', 'success');
                    loadOnlineSales();
                    loadEmailConfig(); // Refresh to show updated last sync time
                } else {
                    showMessage('emailMessage', 'Fetch failed: ' + (d.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                showMessage('emailMessage', 'Connection error', 'error');
            }
        }
        
        function showMessage(elementId, text, type) {
            const msg = document.getElementById(elementId);
            msg.textContent = text;
            msg.className = 'message ' + type;
            setTimeout(() => { msg.className = 'message'; }, 5000);
        }
        
        async function logout() {
            try {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            } catch (e) {}
            currentUser = null;
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('dashboard').style.display = 'none';
            document.getElementById('adminTab').style.display = 'none';
            document.getElementById('uploadTab').style.display = 'none';
            document.getElementById('emailTab').style.display = 'none';
            pins.forEach(p => p.value = '');
            pins[0].focus();
            showTab('sales');
        }
        
        (async () => {
            try {
                const r = await fetch('/api/auth/me', { credentials: 'include' });
                if (r.ok) {
                    const d = await r.json();
                    if (d.user) {
                        currentUser = d.user;
                        showDashboard();
                    }
                }
            } catch (e) {}
        })();
        
        pins[0].focus();
    </script>
</body>
</html>`;
}

startServer().catch(console.error);
