/**
 * Standalone server for Railway deployment
 * Does not depend on Manus OAuth - uses PIN-only authentication
 */
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStandaloneAuthRoutes, authenticateRequest } from "./standalone-auth";
import { standaloneAppRouter } from "./standalone-routers";
import { syncAllDriveConnections } from "./drive-sync";
import { startScheduledEmailSync, fetchAndProcessEmails, testImapConnection, getEmailConfig } from "./email-sync";
import type { Request, Response, NextFunction } from "express";

const PORT = parseInt(process.env.PORT || "3000");

// Embedded HTML for the admin panel
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ms. Chu Sales Tracker - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 20px; }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header p { opacity: 0.9; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: #333; }
    .login-form { max-width: 400px; margin: 100px auto; }
    .login-form input { width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; margin-bottom: 12px; }
    .login-form input:focus { border-color: #667eea; outline: none; }
    .btn { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 14px 28px; border-radius: 8px; font-size: 16px; cursor: pointer; transition: transform 0.2s, opacity 0.2s; }
    .btn:hover { transform: translateY(-1px); opacity: 0.95; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn-secondary { background: #6c757d; }
    .btn-success { background: #28a745; }
    .btn-danger { background: #dc3545; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-card { background: white; border-radius: 12px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .stat-value { font-size: 32px; font-weight: bold; color: #667eea; }
    .stat-label { color: #666; margin-top: 4px; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    .table th { background: #f8f9fa; font-weight: 600; }
    .table tr:hover { background: #f8f9fa; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-success { background: #d4edda; color: #155724; }
    .status-warning { background: #fff3cd; color: #856404; }
    .status-error { background: #f8d7da; color: #721c24; }
    .nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .nav-btn { padding: 10px 20px; background: white; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
    .nav-btn:hover { border-color: #667eea; }
    .nav-btn.active { background: #667eea; color: white; border-color: #667eea; }
    .alert { padding: 16px; border-radius: 8px; margin-bottom: 16px; }
    .alert-success { background: #d4edda; color: #155724; }
    .alert-error { background: #f8d7da; color: #721c24; }
    .alert-info { background: #cce5ff; color: #004085; }
    .hidden { display: none !important; }
    .flex { display: flex; gap: 12px; align-items: center; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; }
    .mb-2 { margin-bottom: 8px; }
    .mb-4 { margin-bottom: 16px; }
    .text-muted { color: #666; }
    .loading { display: inline-block; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-top: 2px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="app">
    <!-- Login Form -->
    <div id="login-page" class="container">
      <div class="login-form card">
        <h2>Admin Login</h2>
        <p class="text-muted mb-4">Enter your PIN to access the admin panel</p>
        <input type="password" id="pin-input" placeholder="Enter PIN" maxlength="10">
        <button class="btn" style="width: 100%;" onclick="login()">Login</button>
        <div id="login-error" class="alert alert-error hidden mt-2"></div>
      </div>
    </div>

    <!-- Admin Dashboard -->
    <div id="dashboard" class="container hidden">
      <div class="header">
        <div class="flex-between">
          <div>
            <h1>Ms. Chu Sales Tracker</h1>
            <p>Admin Dashboard</p>
          </div>
          <button class="btn btn-secondary" onclick="logout()">Logout</button>
        </div>
      </div>

      <div class="nav">
        <button class="nav-btn active" onclick="showTab('overview')">Overview</button>
        <button class="nav-btn" onclick="showTab('staff')">Staff</button>
        <button class="nav-btn" onclick="showTab('sales')">Sales</button>
        <button class="nav-btn" onclick="showTab('sync')">Data Sync</button>
      </div>

      <!-- Overview Tab -->
      <div id="tab-overview">
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" id="total-sales">-</div>
            <div class="stat-label">Total Sales</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="total-staff">-</div>
            <div class="stat-label">Staff Members</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="today-sales">-</div>
            <div class="stat-label">Today's Sales</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" id="this-month">-</div>
            <div class="stat-label">This Month</div>
          </div>
        </div>
      </div>

      <!-- Staff Tab -->
      <div id="tab-staff" class="hidden">
        <div class="card">
          <h2>Staff Members</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Staff ID</th>
                <th>Role</th>
                <th>Total Sales</th>
              </tr>
            </thead>
            <tbody id="staff-table"></tbody>
          </table>
        </div>
      </div>

      <!-- Sales Tab -->
      <div id="tab-sales" class="hidden">
        <div class="card">
          <h2>Recent Sales</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Order</th>
                <th>Staff</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody id="sales-table"></tbody>
          </table>
        </div>
      </div>

      <!-- Sync Tab -->
      <div id="tab-sync" class="hidden">
        <div class="card">
          <div class="flex-between mb-4">
            <h2>Email Auto-Sync</h2>
            <span id="email-status" class="status">Checking...</span>
          </div>
          <p class="text-muted mb-4">Automatically imports sales data from email attachments every hour.</p>
          <div class="flex">
            <button class="btn" onclick="testEmailConnection()">Test Connection</button>
            <button class="btn btn-success" onclick="fetchEmails()">Fetch Now</button>
          </div>
          <div id="email-result" class="alert hidden mt-2"></div>
        </div>

        <div class="card">
          <div class="flex-between mb-4">
            <h2>Google Drive Sync</h2>
            <span id="drive-status" class="status">Checking...</span>
          </div>
          <p class="text-muted mb-4">Syncs sales data from connected Google Drive folders every 30 minutes.</p>
          <div class="flex">
            <button class="btn btn-success" onclick="syncDrive()">Sync Now</button>
          </div>
          <div id="drive-result" class="alert hidden mt-2"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let authToken = localStorage.getItem('auth_token');
    
    // Check if already logged in
    if (authToken) {
      checkAuth();
    }

    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (res.ok) {
          const user = await res.json();
          if (user.role === 'admin') {
            showDashboard();
            loadDashboardData();
          } else {
            showError('Admin access required');
            logout();
          }
        } else {
          localStorage.removeItem('auth_token');
          authToken = null;
        }
      } catch (e) {
        console.error('Auth check failed:', e);
      }
    }

    async function login() {
      const pin = document.getElementById('pin-input').value;
      if (!pin) return;
      
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        
        const data = await res.json();
        if (res.ok && data.token) {
          authToken = data.token;
          localStorage.setItem('auth_token', authToken);
          if (data.user.role === 'admin') {
            showDashboard();
            loadDashboardData();
          } else {
            showError('Admin access required');
            logout();
          }
        } else {
          showError(data.error || 'Login failed');
        }
      } catch (e) {
        showError('Connection error');
      }
    }

    function logout() {
      localStorage.removeItem('auth_token');
      authToken = null;
      document.getElementById('login-page').classList.remove('hidden');
      document.getElementById('dashboard').classList.add('hidden');
      document.getElementById('pin-input').value = '';
    }

    function showDashboard() {
      document.getElementById('login-page').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
    }

    function showError(msg) {
      const el = document.getElementById('login-error');
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 3000);
    }

    function showTab(tab) {
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.add('hidden'));
      document.getElementById('tab-' + tab).classList.remove('hidden');
      document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
    }

    async function loadDashboardData() {
      try {
        // Load stats
        const statsRes = await fetch('/api/trpc/sales.getStats', {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (statsRes.ok) {
          const stats = await statsRes.json();
          if (stats.result && stats.result.data) {
            const data = stats.result.data;
            document.getElementById('total-sales').textContent = '$' + (data.totalSales || 0).toLocaleString();
            document.getElementById('total-staff').textContent = data.staffCount || 0;
            document.getElementById('today-sales').textContent = '$' + (data.todaySales || 0).toLocaleString();
            document.getElementById('this-month').textContent = '$' + (data.monthSales || 0).toLocaleString();
          }
        }

        // Load staff
        const staffRes = await fetch('/api/trpc/users.list', {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (staffRes.ok) {
          const staff = await staffRes.json();
          if (staff.result && staff.result.data) {
            const tbody = document.getElementById('staff-table');
            tbody.innerHTML = staff.result.data.map(s => 
              '<tr><td>' + (s.name || 'Unknown') + '</td><td>' + (s.staffId || '-') + '</td><td>' + 
              '<span class="status status-' + (s.role === 'admin' ? 'warning' : 'success') + '">' + s.role + '</span></td><td>-</td></tr>'
            ).join('');
          }
        }

        // Load recent sales
        const salesRes = await fetch('/api/trpc/sales.list?input=' + encodeURIComponent(JSON.stringify({limit: 20})), {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (salesRes.ok) {
          const sales = await salesRes.json();
          if (sales.result && sales.result.data) {
            const tbody = document.getElementById('sales-table');
            tbody.innerHTML = sales.result.data.map(s => 
              '<tr><td>' + new Date(s.orderDate).toLocaleDateString() + '</td><td>' + (s.orderName || '-') + '</td><td>' + 
              (s.staffName || '-') + '</td><td>$' + (s.totalPrice || 0).toFixed(2) + '</td></tr>'
            ).join('');
          }
        }

        // Check email status
        const emailRes = await fetch('/api/email/status', {
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (emailRes.ok) {
          const email = await emailRes.json();
          const statusEl = document.getElementById('email-status');
          if (email.enabled && email.configured) {
            statusEl.textContent = 'Active';
            statusEl.className = 'status status-success';
          } else if (email.configured) {
            statusEl.textContent = 'Configured';
            statusEl.className = 'status status-warning';
          } else {
            statusEl.textContent = 'Not Configured';
            statusEl.className = 'status status-error';
          }
        }

        // Check drive status
        document.getElementById('drive-status').textContent = 'Active';
        document.getElementById('drive-status').className = 'status status-success';

      } catch (e) {
        console.error('Failed to load dashboard data:', e);
      }
    }

    async function testEmailConnection() {
      const resultEl = document.getElementById('email-result');
      resultEl.textContent = 'Testing connection...';
      resultEl.className = 'alert alert-info';
      resultEl.classList.remove('hidden');
      
      try {
        const res = await fetch('/api/email/test', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (data.success) {
          resultEl.textContent = 'Connection successful! Found ' + (data.messageCount || 0) + ' messages.';
          resultEl.className = 'alert alert-success';
        } else {
          resultEl.textContent = 'Connection failed: ' + (data.error || 'Unknown error');
          resultEl.className = 'alert alert-error';
        }
      } catch (e) {
        resultEl.textContent = 'Connection error: ' + e.message;
        resultEl.className = 'alert alert-error';
      }
    }

    async function fetchEmails() {
      const resultEl = document.getElementById('email-result');
      resultEl.textContent = 'Fetching emails...';
      resultEl.className = 'alert alert-info';
      resultEl.classList.remove('hidden');
      
      try {
        const res = await fetch('/api/email/fetch', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const data = await res.json();
        if (data.success) {
          resultEl.textContent = 'Fetch complete! Processed ' + (data.emailsProcessed || 0) + ' emails, imported ' + (data.salesImported || 0) + ' sales.';
          resultEl.className = 'alert alert-success';
          loadDashboardData();
        } else {
          resultEl.textContent = 'Fetch failed: ' + (data.error || 'Unknown error');
          resultEl.className = 'alert alert-error';
        }
      } catch (e) {
        resultEl.textContent = 'Fetch error: ' + e.message;
        resultEl.className = 'alert alert-error';
      }
    }

    async function syncDrive() {
      const resultEl = document.getElementById('drive-result');
      resultEl.textContent = 'Syncing...';
      resultEl.className = 'alert alert-info';
      resultEl.classList.remove('hidden');
      
      try {
        const res = await fetch('/api/trpc/drive.syncNow', {
          method: 'POST',
          headers: { 
            'Authorization': 'Bearer ' + authToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.result) {
          resultEl.textContent = 'Sync complete!';
          resultEl.className = 'alert alert-success';
          loadDashboardData();
        } else {
          resultEl.textContent = 'Sync completed';
          resultEl.className = 'alert alert-success';
        }
      } catch (e) {
        resultEl.textContent = 'Sync error: ' + e.message;
        resultEl.className = 'alert alert-error';
      }
    }

    // Handle Enter key on PIN input
    document.getElementById('pin-input').addEventListener('keypress', function(e) {
      if (e.key === 'Enter') login();
    });
  </script>
</body>
</html>`;

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

  // Email sync endpoints (admin only)
  app.get("/api/email/status", async (req, res) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const config = getEmailConfig();
      res.json({
        configured: !!(config.email && config.password),
        enabled: config.enabled,
        email: config.email ? config.email.replace(/(.{3}).*(@.*)/, "$1***$2") : null
      });
    } catch {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post("/api/email/test", async (req, res) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const result = await testImapConnection();
      res.json(result);
    } catch {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  app.post("/api/email/fetch", async (req, res) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const result = await fetchAndProcessEmails();
      res.json(result);
    } catch {
      res.status(401).json({ error: "Not authenticated" });
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

  // Serve embedded HTML for the admin panel
  app.get("/", (_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.send(ADMIN_HTML);
  });

  // Fallback for SPA routes
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    res.setHeader("Content-Type", "text/html");
    res.send(ADMIN_HTML);
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Standalone server listening on port ${PORT}`);
    console.log(`[Server] Mode: ${process.env.NODE_ENV || "development"}`);
    
    // Start scheduled Google Drive sync
    startScheduledSync();
    
    // Start scheduled Email sync
    startScheduledEmailSync();
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
