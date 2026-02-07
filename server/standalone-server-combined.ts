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

/**
 * Seed staff data on startup - ensures admin and all 11 staff members exist
 */
async function seedStaffData() {
  const staffMembers = [
    { name: "Cindy Chu", pin: "9999", staffId: "", role: "admin" },
    { name: "Egenie Tang", pin: "4640", staffId: "78319321135", role: "staff" },
    { name: "Eva Lee", pin: "8577", staffId: "78319255599", role: "staff" },
    { name: "Maggie Liang", pin: "4491", staffId: "78319190063", role: "staff" },
    { name: "Maggie Wong", pin: "9635", staffId: "79208775727", role: "staff" },
    { name: "Ting Siew", pin: "3639", staffId: "78319386671", role: "staff" },
    { name: "Win Lee", pin: "1384", staffId: "78319550511", role: "staff" },
    { name: "Wing Ho", pin: "4019", staffId: "78319091759", role: "staff" },
    { name: "Sharon Li", pin: "6762", staffId: "101232115995", role: "staff" },
    { name: "Hailey Hoi Ling Wong", pin: "9849", staffId: "109111279899", role: "staff" },
    { name: "Bon Lau", pin: "2115", staffId: "111913632027", role: "staff" },
    { name: "Sze", pin: "2791", staffId: "118809198875", role: "staff" },
  ];

  for (const staff of staffMembers) {
    try {
      // Check if user already exists by PIN
      const [existing] = await db.execute("SELECT id, name, staffId FROM users WHERE pin = ?", [staff.pin]);
      if ((existing as any[]).length > 0) {
        // Update staff ID and name if needed
        const row = (existing as any[])[0];
        if (row.staffId !== staff.staffId || row.name !== staff.name) {
          await db.execute("UPDATE users SET staffId = ?, name = ? WHERE id = ?", [staff.staffId, staff.name, row.id]);
          console.log(`[Seed] Updated ${staff.name} (staffId: ${staff.staffId})`);
        }
        continue;
      }
      // Also check by name
      const [byName] = await db.execute("SELECT id FROM users WHERE name = ?", [staff.name]);
      if ((byName as any[]).length > 0) {
        await db.execute("UPDATE users SET pin = ?, staffId = ?, role = ? WHERE name = ?", [staff.pin, staff.staffId, staff.role, staff.name]);
        console.log(`[Seed] Updated existing ${staff.name}`);
        continue;
      }
      // Insert new user
      const openId = "staff-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      await db.execute(
        "INSERT INTO users (openId, name, pin, staffId, role, loginMethod) VALUES (?, ?, ?, ?, ?, ?)",
        [openId, staff.name, staff.pin, staff.staffId, staff.role, "pin"]
      );
      console.log(`[Seed] Added ${staff.name} (staffId: ${staff.staffId})`);
    } catch (err) {
      console.error(`[Seed] Error seeding ${staff.name}:`, err);
    }
  }
  // Clean up duplicate users - keep only the one with the correct role
  try {
    // Remove duplicate Cindy Chu entries (keep id=1 which has role=admin)
    await db.execute("DELETE FROM users WHERE name = 'Cindy Chu' AND id != 1");
    
    // For each staff member, keep only the entry with role='staff' and lowest id
    const staffNames = ['Egenie Tang', 'Eva Lee', 'Maggie Liang', 'Maggie Wong', 'Ting Siew', 'Win Lee', 'Wing Ho', 'Sharon Li', 'Hailey Hoi Ling Wong', 'Bon Lau', 'Sze'];
    for (const name of staffNames) {
      const [rows] = await db.execute("SELECT id FROM users WHERE name = ? AND role = 'staff' ORDER BY id ASC", [name]);
      const ids = (rows as any[]).map(r => r.id);
      if (ids.length > 1) {
        // Keep the first one, delete the rest
        const keepId = ids[0];
        await db.execute("DELETE FROM users WHERE name = ? AND id != ?", [name, keepId]);
        console.log(`[Seed] Cleaned up ${ids.length - 1} duplicate(s) for ${name}`);
      }
    }
    // Also remove any users with null role (leftover from broken seeds)
    await db.execute("DELETE FROM users WHERE role IS NULL");
    console.log("[Seed] Duplicate cleanup complete");
  } catch (err) {
    console.error("[Seed] Error cleaning duplicates:", err);
  }
  
  console.log("[Seed] Staff data seeding complete");
}

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
      const month = req.query.month as string || 'all';
      const staffName = req.query.staffName as string || '';
      let query = "SELECT id, orderDate, orderNo, salesChannel, netSales, paymentGateway, saleType, staffName FROM sales";
      let params: any[] = [];
      let whereConditions: string[] = [];
      
      // Filter by sale type
      if (saleType === 'online') {
        whereConditions.push("(saleType = 'online' OR saleType IS NULL)");
      } else if (saleType === 'pos') {
        whereConditions.push("saleType = 'pos'");
      }
      
      // If not admin, only show user's own sales (current month only)
      if (user.role !== "admin") {
        if (user.staffId) {
          // Match by staffId column OR by staffName containing the staffId
          // Sales records store staff info in staffName as "Name StaffId" (e.g. "Ting Siew 78319386671")
          whereConditions.push("(staffId = ? OR staffName LIKE ?)");
          params.push(user.staffId, `%${user.staffId}%`);
        }
        // Staff: current month only
        const now = new Date();
        const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
        whereConditions.push("orderDate >= ?");
        params.push(monthStart);
      } else {
        // Admin: apply month filter
        if (month && month !== 'all') {
          if (month === 'ytd') {
            const now = new Date();
            const yearStart = now.getFullYear() + '-01-01';
            whereConditions.push("orderDate >= ?");
            params.push(yearStart);
          } else {
            // month is YYYY-MM
            whereConditions.push("orderDate >= ? AND orderDate < DATE_ADD(?, INTERVAL 1 MONTH)");
            params.push(month + '-01', month + '-01');
          }
        }
        // Admin: apply staff name filter
        if (staffName) {
          whereConditions.push("staffName = ?");
          params.push(staffName);
        }
      }
      
      if (whereConditions.length > 0) {
        query += " WHERE " + whereConditions.join(" AND ");
      }
      
      query += " ORDER BY orderDate DESC LIMIT 500";
      
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

  // API endpoint to get distinct staff names for filter
  app.get("/api/sales/staff-names", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      const saleType = req.query.type as string || 'online';
      // Known staff members with their Staff IDs
      const knownStaff = [
        'Egenie Tang 78319321135',
        'Eva Lee 78319255599',
        'Maggie Liang 78319190063',
        'Maggie Wong 79208775727',
        'Ting Siew 78319386671',
        'Win Lee 78319550511',
        'Wing Ho 78319091759',
        'Sharon Li 101232115995',
        'Hailey Hoi Ling Wong 109111279899',
        'Bon Lau 111913632027',
        'Sze 118809198875',
      ];
      let query = "SELECT DISTINCT staffName FROM sales WHERE staffName IS NOT NULL AND staffName != ''";
      if (saleType === 'online') {
        query += " AND (saleType = 'online' OR saleType IS NULL)";
      } else if (saleType === 'pos') {
        query += " AND saleType = 'pos'";
      }
      query += " ORDER BY staffName";
      const [rows] = await db.execute(query);
      // Filter to only include known staff members (Name + StaffID format)
      const staffNames = (rows as any[]).map(r => r.staffName).filter(name => knownStaff.includes(name));
      res.json({ staffNames });
    } catch (error) {
      console.error("[API] Get staff names error:", error);
      res.status(500).json({ error: "Failed to get staff names" });
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
      
      const { csvData, saleType: uploadSaleType, staffMappings } = req.body;
      if (!csvData) {
        res.status(400).json({ error: "No CSV data provided" });
        return;
      }
      
      // Staff mappings from client-side Excel parsing: { orderNo: staffName }
      const orderStaffMap: Record<string, string> = staffMappings || {};
      
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
        
        // Check for duplicate - use orderNo + orderDate + netSales combination
        // because different orders can share the same Order Name but have different dates/amounts
        if (orderNo && orderDate) {
          const [existing] = await db.execute(
            "SELECT id FROM sales WHERE orderNo = ? AND orderDate = ? AND netSales = ? AND saleType = ?",
            [orderNo, orderDate, netSales, uploadSaleType || 'online']
          );
          if ((existing as any[]).length > 0) {
            skipped++;
            continue;
          }
        } else if (orderNo) {
          const [existing] = await db.execute("SELECT id FROM sales WHERE orderNo = ? AND saleType = ?", [orderNo, uploadSaleType || 'online']);
          if ((existing as any[]).length > 0) {
            skipped++;
            continue;
          }
        }
        
        // Check if we have a staff name from the Excel Customer Tags
        const staffName = (orderNo && orderStaffMap[orderNo]) ? orderStaffMap[orderNo] : null;
        
        await db.execute(
          "INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, saleType, staffName) VALUES (?, ?, ?, ?, ?, ?)",
          [orderDate || null, orderNo || null, salesChannel || null, netSales, uploadSaleType || 'online', staffName]
        );
        imported++;
      }
      
      res.json({ success: true, imported, skipped, message: `Imported ${imported} sales, skipped ${skipped} duplicates/invalid` });
    } catch (error) {
      console.error("[API] Upload sales error:", error);
      res.status(500).json({ error: "Failed to upload sales data" });
    }
  });

  // API endpoint to bulk update staffName for orders (admin only)
  app.post("/api/sales/update-staff", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      const { updates } = req.body;
      if (!updates || !Array.isArray(updates)) {
        res.status(400).json({ error: "Expected updates array" });
        return;
      }
      
      let updated = 0;
      for (const u of updates) {
        if (u.orderNo && u.staffName) {
          const [result] = await db.execute(
            "UPDATE sales SET staffName = ? WHERE orderNo = ? AND saleType = ? AND (staffName IS NULL OR staffName = '')",
            [u.staffName, u.orderNo, u.saleType || 'online']
          );
          if ((result as any).affectedRows > 0) updated++;
        }
      }
      
      res.json({ success: true, updated });
    } catch (error) {
      console.error("[API] Update staff names error:", error);
      res.status(500).json({ error: "Failed to update staff names" });
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

  // Staff view for Shopify POS tile
  app.get("/staff-view", (req, res) => {
    res.send(getStaffViewHTML());
  });

  // Seed staff data on startup
  await seedStaffData();

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
        .sales-table th.sortable { cursor: pointer; user-select: none; position: relative; padding-right: 20px; }
        .sales-table th.sortable:hover { background: #eef1f4; color: #333; }
        .sales-table th.sortable::after { content: '\u21C5'; position: absolute; right: 4px; top: 50%; transform: translateY(-50%); font-size: 11px; color: #aaa; }
        .sales-table th.sortable.sort-asc::after { content: '\u25B2'; color: #5b6abf; }
        .sales-table th.sortable.sort-desc::after { content: '\u25BC'; color: #5b6abf; }
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
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
                        <h2 style="margin:0">Online Sales History</h2>
                        <div style="display:flex;gap:8px;align-items:center">
                            <select id="onlineStaffFilter" onchange="loadOnlineSales()" style="padding:8px 12px;border-radius:8px;border:1px solid #ddd;font-size:14px;background:#fff;display:none"></select>
                            <select id="onlineMonthFilter" onchange="loadOnlineSales()" style="padding:8px 12px;border-radius:8px;border:1px solid #ddd;font-size:14px;background:#fff;display:none"></select>
                        </div>
                    </div>
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
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
                        <h2 style="margin:0">POS Sales History</h2>
                        <div style="display:flex;gap:8px;align-items:center">
                            <select id="posStaffFilter" onchange="loadPosSales()" style="padding:8px 12px;border-radius:8px;border:1px solid #ddd;font-size:14px;background:#fff;display:none"></select>
                            <select id="posMonthFilter" onchange="loadPosSales()" style="padding:8px 12px;border-radius:8px;border:1px solid #ddd;font-size:14px;background:#fff;display:none"></select>
                        </div>
                    </div>
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
                    <div class="form-row" style="margin-bottom:15px">
                        <label style="font-weight:600;margin-right:10px">Sale Type:</label>
                        <select id="uploadSaleType" style="padding:8px 12px;border-radius:6px;border:1px solid #ddd;font-size:14px">
                            <option value="online">Online Sales</option>
                            <option value="pos">POS Sales</option>
                        </select>
                    </div>
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
                    <p id="lastSyncTime" style="font-size:13px;color:#888;margin-bottom:10px">Last synced: checking...</p>
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
        let sessionToken = null;
        
        // Save reference to original fetch before any overrides
        const _originalFetch = window.fetch.bind(window);
        // Helper function for authenticated fetch calls
        function authFetch(url, options = {}) {
            const headers = options.headers || {};
            if (sessionToken) {
                headers['Authorization'] = 'Bearer ' + sessionToken;
            }
            return _originalFetch(url, { ...options, headers, credentials: 'include' });
        }
        let currentTab = 'online-sales';
        
        // Sort state for Online and POS tables
        let onlineSalesData = [];
        let posSalesData = [];
        let onlineSortCol = null;
        let onlineSortDir = null;
        let posSortCol = null;
        let posSortDir = null;
        
        function sortData(data, col, dir) {
            return [...data].sort((a, b) => {
                let va = a[col] || '';
                let vb = b[col] || '';
                if (col === 'orderDate') {
                    va = va ? new Date(va).getTime() : 0;
                    vb = vb ? new Date(vb).getTime() : 0;
                    return dir === 'asc' ? va - vb : vb - va;
                }
                va = String(va).toLowerCase();
                vb = String(vb).toLowerCase();
                if (va < vb) return dir === 'asc' ? -1 : 1;
                if (va > vb) return dir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        
        function handleOnlineSort(col) {
            if (onlineSortCol === col) {
                onlineSortDir = onlineSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                onlineSortCol = col;
                onlineSortDir = 'asc';
            }
            renderOnlineTable();
        }
        
        function handlePosSort(col) {
            if (posSortCol === col) {
                posSortDir = posSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                posSortCol = col;
                posSortDir = 'asc';
            }
            renderPosTable();
        }
        
        function sortClass(currentCol, activeCol, activeDir) {
            if (currentCol !== activeCol) return 'sortable';
            return 'sortable sort-' + activeDir;
        }
        
        function renderOnlineTable() {
            const isAdmin = currentUser && currentUser.role === 'admin';
            const data = onlineSortCol ? sortData(onlineSalesData, onlineSortCol, onlineSortDir) : onlineSalesData;
            if (!data || data.length === 0) {
                document.getElementById('onlineSalesTableContainer').innerHTML = '<p class="no-data">No online sales data yet</p>';
                return;
            }
            let html = '<table class="sales-table"><thead><tr>';
            html += '<th class="' + sortClass('orderDate', onlineSortCol, onlineSortDir) + '" onclick="handleOnlineSort(&#39;orderDate&#39;)">Order Date</th>';
            html += '<th class="' + sortClass('orderNo', onlineSortCol, onlineSortDir) + '" onclick="handleOnlineSort(&#39;orderNo&#39;)">Order</th>';
            html += '<th>Channel</th>';
            if (isAdmin) html += '<th>Staff Name</th>';
            html += '<th>Net Sales</th></tr></thead><tbody>';
            data.forEach(s => {
                const date = s.orderDate ? new Date(s.orderDate).toLocaleDateString() : '-';
                html += '<tr><td>' + date + '</td><td>' + (s.orderNo || '-') + '</td><td>' + (s.salesChannel || '-') + '</td>';
                if (isAdmin) html += '<td>' + (s.staffName || '-') + '</td>';
                html += '<td class="amount">HK$' + (parseFloat(s.netSales) || 0).toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
            });
            html += '</tbody></table>';
            document.getElementById('onlineSalesTableContainer').innerHTML = html;
        }
        
        function renderPosTable() {
            const isAdmin = currentUser && currentUser.role === 'admin';
            const data = posSortCol ? sortData(posSalesData, posSortCol, posSortDir) : posSalesData;
            if (!data || data.length === 0) {
                document.getElementById('posSalesTableContainer').innerHTML = '<p class="no-data">No POS sales data yet</p>';
                return;
            }
            let html = '<table class="sales-table"><thead><tr>';
            html += '<th class="' + sortClass('orderDate', posSortCol, posSortDir) + '" onclick="handlePosSort(&#39;orderDate&#39;)">Order Date</th>';
            html += '<th class="' + sortClass('orderNo', posSortCol, posSortDir) + '" onclick="handlePosSort(&#39;orderNo&#39;)">Order</th>';
            html += '<th class="' + sortClass('salesChannel', posSortCol, posSortDir) + '" onclick="handlePosSort(&#39;salesChannel&#39;)">Channel</th>';
            html += '<th class="' + sortClass('paymentGateway', posSortCol, posSortDir) + '" onclick="handlePosSort(&#39;paymentGateway&#39;)">Payment Gateway</th>';
            if (isAdmin) html += '<th>Staff Name</th>';
            html += '<th>Net Sales excl Gift Card</th></tr></thead><tbody>';
            data.forEach(s => {
                const date = s.orderDate ? new Date(s.orderDate).toLocaleDateString() : '-';
                html += '<tr><td>' + date + '</td><td>' + (s.orderNo || '-') + '</td><td>' + (s.salesChannel || '-') + '</td><td>' + (s.paymentGateway || '-') + '</td>';
                if (isAdmin) html += '<td>' + (s.staffName || '-') + '</td>';
                html += '<td class="amount">HK$' + (parseFloat(s.netSales) || 0).toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</td></tr>';
            });
            html += '</tbody></table>';
            document.getElementById('posSalesTableContainer').innerHTML = html;
        }
        
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
                const r = await fetch('/api/auth/pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ pin })
                });
                const d = await r.json();
                
                if (r.ok && d.success) {
                    currentUser = d.user;
                    sessionToken = d.sessionToken;
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
            // Set user info BEFORE showing dashboard
            document.getElementById('userName').textContent = currentUser.name;
            document.getElementById('userRole').textContent = currentUser.role;
            
            // Explicitly set admin tab/panel visibility based on role
            if (currentUser.role === 'admin') {
                document.getElementById('adminTab').style.display = 'block';
                document.getElementById('uploadTab').style.display = 'block';
                document.getElementById('emailTab').style.display = 'block';
            } else {
                // Staff: explicitly hide all admin tabs and panels
                document.getElementById('adminTab').style.display = 'none';
                document.getElementById('uploadTab').style.display = 'none';
                document.getElementById('emailTab').style.display = 'none';
                // Hide month and staff filters for staff
                document.getElementById('onlineMonthFilter').style.display = 'none';
                document.getElementById('posMonthFilter').style.display = 'none';
                document.getElementById('onlineStaffFilter').style.display = 'none';
                document.getElementById('posStaffFilter').style.display = 'none';
            }
            
            // Ensure correct default panel visibility - always start on Online Sales
            document.getElementById('onlineSalesPanel').style.display = 'block';
            document.getElementById('posSalesPanel').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'none';
            document.getElementById('uploadPanel').style.display = 'none';
            document.getElementById('emailPanel').style.display = 'none';
            
            // Set Online Sales tab as active
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab').classList.add('active');
            
            // Now show the dashboard
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('dashboard').style.display = 'block';
            
            loadOnlineSales();
        }
        
        function showTab(tab) {
            // Security: prevent staff from accessing admin tabs
            if (currentUser && currentUser.role !== 'admin' && (tab === 'admin' || tab === 'upload' || tab === 'email')) {
                return;
            }
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            if (event && event.target) { event.target.classList.add('active'); }
            
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
        
        async function populateStaffFilter(selectId, saleType) {
            const sel = document.getElementById(selectId);
            if (!sel) return;
            sel.style.display = 'block';
            if (sel.options.length > 1) return;
            try {
                const r = await authFetch('/api/sales/staff-names?type=' + saleType);
                const d = await r.json();
                if (r.ok && d.staffNames) {
                    sel.innerHTML = '<option value="all">All Staff</option>';
                    d.staffNames.forEach(name => {
                        sel.innerHTML += '<option value="' + name.replace(/"/g, '&quot;') + '">' + name + '</option>';
                    });
                }
            } catch (e) {
                console.error('Failed to load staff names:', e);
            }
        }
        
        function populateMonthFilter(selectId) {
            const sel = document.getElementById(selectId);
            if (!sel) return;
            sel.style.display = 'block';
            if (sel.options.length > 0) return;
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            sel.innerHTML = '<option value="all">All</option>';
            sel.innerHTML += '<option value="ytd">Year to Date</option>';
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            for (let m = currentMonth; m >= 0; m--) {
                const val = currentYear + '-' + String(m + 1).padStart(2, '0');
                const label = monthNames[m] + ' ' + currentYear;
                const selected = m === currentMonth ? ' selected' : '';
                sel.innerHTML += '<option value="' + val + '"' + selected + '>' + label + '</option>';
            }
            for (let m = 11; m >= 0; m--) {
                const val = (currentYear - 1) + '-' + String(m + 1).padStart(2, '0');
                const label = monthNames[m] + ' ' + (currentYear - 1);
                sel.innerHTML += '<option value="' + val + '">' + label + '</option>';
            }
        }
        
        async function loadOnlineSales() {
            const isAdmin = currentUser && currentUser.role === 'admin';
            if (isAdmin) {
                populateMonthFilter('onlineMonthFilter');
                populateStaffFilter('onlineStaffFilter', 'online');
            }
            try {
                let url = '/api/sales?type=online';
                if (isAdmin) {
                    const monthVal = document.getElementById('onlineMonthFilter')?.value || 'all';
                    url += '&month=' + monthVal;
                    const staffVal = document.getElementById('onlineStaffFilter')?.value || 'all';
                    if (staffVal !== 'all') url += '&staffName=' + encodeURIComponent(staffVal);
                }
                const r = await authFetch(url);
                const d = await r.json();
                
                if (r.ok) {
                    document.getElementById('totalOnlineSales').textContent = 'HK$' + d.total.toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    document.getElementById('onlineOrderCount').textContent = d.count;
                    onlineSalesData = d.sales || [];
                    onlineSortCol = null;
                    onlineSortDir = null;
                    renderOnlineTable();
                }
            } catch (e) {
                document.getElementById('onlineSalesTableContainer').innerHTML = '<p class="no-data">Failed to load sales data</p>';
            }
        }
        
        async function loadPosSales() {
            const isAdmin = currentUser && currentUser.role === 'admin';
            if (isAdmin) {
                populateMonthFilter('posMonthFilter');
                populateStaffFilter('posStaffFilter', 'pos');
            }
            try {
                let url = '/api/sales?type=pos';
                if (isAdmin) {
                    const monthVal = document.getElementById('posMonthFilter')?.value || 'all';
                    url += '&month=' + monthVal;
                    const staffVal = document.getElementById('posStaffFilter')?.value || 'all';
                    if (staffVal !== 'all') url += '&staffName=' + encodeURIComponent(staffVal);
                }
                const r = await authFetch(url);
                const d = await r.json();
                
                if (r.ok) {
                    document.getElementById('totalPosSales').textContent = 'HK$' + d.total.toLocaleString('en-HK', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                    document.getElementById('posOrderCount').textContent = d.count;
                    posSalesData = d.sales || [];
                    posSortCol = null;
                    posSortDir = null;
                    renderPosTable();
                }
            } catch (e) {
                document.getElementById('posSalesTableContainer').innerHTML = '<p class="no-data">Failed to load POS sales data</p>';
            }
        }
        
        async function loadStaff() {
            try {
                const r = await authFetch('/api/staff');
                const d = await r.json();
                
                if (r.ok && d.staff) {
                    let html = '<table class="staff-table"><thead><tr><th>Name</th><th>Staff ID</th><th>PIN</th><th>Role</th><th>Action</th></tr></thead><tbody>';
                    d.staff.forEach(s => {
                        const isCurrentUser = s.id === currentUser.id;
                        const staffName = s.name || 'Unknown';
                        html += '<tr><td>' + staffName + '</td><td>' + (s.staffId || '-') + '</td><td>' + (s.pin || '-') + '</td><td>' + (s.role || '-') + '</td><td>' + 
                            (isCurrentUser ? '<span style="color:#999">Current user</span>' : '<button class="delete-btn" onclick="deleteStaff(' + s.id + ', &#39;' + staffName.replace(/'/g, "\\'") + '&#39;)">Delete</button>') + 
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
                const r = await authFetch('/api/staff', {
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
                const r = await authFetch('/api/staff/' + id, {
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
        
        // Known staff ID to name mappings
        const KNOWN_STAFF = {
            '78319321135': 'Egenie Tang 78319321135',
            '78319255599': 'Eva Lee 78319255599',
            '78319190063': 'Maggie Liang 78319190063',
            '79208775727': 'Maggie Wong 79208775727',
            '78319386671': 'Ting Siew 78319386671',
            '78319550511': 'Win Lee 78319550511',
            '78319091759': 'Wing Ho 78319091759',
            '101232115995': 'Sharon Li 101232115995',
            '109111279899': 'Hailey Hoi Ling Wong 109111279899',
            '111913632027': 'Bon Lau 111913632027',
            '118809198875': 'Sze 118809198875'
        };
        
        // Store staff mappings extracted from Excel
        window._staffMappings = {};
        
        function parseExcelFile(file) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    
                    // Extract staff mappings from Customer Tags (Column E)
                    window._staffMappings = {};
                    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const orderName = row[1] ? String(row[1]).trim() : null;
                        const customerTags = row[4] ? String(row[4]).trim() : '';
                        if (orderName && customerTags) {
                            const match = customerTags.match(/WVReferredByStaff_(\d+)/);
                            if (match && KNOWN_STAFF[match[1]]) {
                                window._staffMappings[orderName] = KNOWN_STAFF[match[1]];
                            }
                        }
                    }
                    
                    const csv = XLSX.utils.sheet_to_csv(firstSheet);
                    document.getElementById('csvPreview').value = csv;
                    const staffCount = Object.keys(window._staffMappings).length;
                    showMessage('uploadMessage', 'Excel file converted. ' + staffCount + ' orders with staff attribution detected.', 'success');
                } catch (err) {
                    showMessage('uploadMessage', 'Failed to parse Excel file: ' + err.message, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        }
        
        async function uploadCSV() {
            const csvData = document.getElementById('csvPreview').value.trim();
            const saleType = document.getElementById('uploadSaleType').value;
            if (!csvData) {
                showMessage('uploadMessage', 'Please select a CSV file or paste CSV data', 'error');
                return;
            }
            
            try {
                const r = await authFetch('/api/sales/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ csvData, saleType, staffMappings: window._staffMappings || {} })
                });
                const d = await r.json();
                
                if (r.ok && d.success) {
                    showMessage('uploadMessage', d.message, 'success');
                    document.getElementById('csvPreview').value = '';
                    document.getElementById('fileName').textContent = 'No file selected';
                    if (saleType === 'pos') {
                        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                        document.querySelector('.tab:nth-child(2)').classList.add('active');
                        showTab('pos-sales');
                    } else {
                        loadOnlineSales();
                    }
                } else {
                    showMessage('uploadMessage', d.error || 'Failed to upload', 'error');
                }
            } catch (e) {
                showMessage('uploadMessage', 'Connection error', 'error');
            }
        }
        
        async function loadEmailConfig() {
            try {
                const r = await authFetch('/api/email/config');
                const d = await r.json();
                
                if (r.ok && d.config) {
                    updateEmailStatus(d.config.email, d.config.enabled, d.config.hasPassword);
                } else {
                    updateEmailStatus(null, false, false);
                }
                if (d.lastSyncTime) {
                    document.getElementById('lastSyncTime').textContent = 'Last synced: ' + new Date(d.lastSyncTime).toLocaleString();
                } else {
                    document.getElementById('lastSyncTime').textContent = 'Last synced: Never';
                }
            } catch (e) {
                updateEmailStatus(null, false, false);
            }
        }
        
        function updateEmailStatus(email, enabled, hasPassword) {
            const status = document.getElementById('emailStatus');
            if (email && hasPassword && enabled) {
                status.className = 'email-status connected';
                status.innerHTML = '<strong>Status:</strong> Connected and enabled<br><strong>Email:</strong> ' + email + '<br><strong>Auto-fetch:</strong> Every 1 hour';
            } else if (email && hasPassword) {
                status.className = 'email-status disconnected';
                status.innerHTML = '<strong>Status:</strong> Configured but disabled<br><strong>Email:</strong> ' + email;
            } else {
                status.className = 'email-status disconnected';
                status.innerHTML = '<strong>Status:</strong> Not configured<br>Set EMAIL_ADDRESS, EMAIL_PASSWORD, and EMAIL_ENABLED=true in environment variables';
            }
        }
        
        async function testEmailConnection() {
            showMessage('emailMessage', 'Testing connection...', 'success');
            try {
                const r = await authFetch('/api/email/test', {
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
                const r = await authFetch('/api/email/fetch', {
                    method: 'POST',
                    credentials: 'include'
                });
                const d = await r.json();
                
                if (d.success) {
                    showMessage('emailMessage', 'Fetch complete! Processed ' + d.emailsProcessed + ' emails, imported ' + d.imported + ' sales records.', 'success');
                    document.getElementById('lastSyncTime').textContent = 'Last synced: ' + new Date().toLocaleString();
                    loadOnlineSales();
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
                await authFetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
            } catch (e) {}
            currentUser = null;
            sessionToken = null;
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('dashboard').style.display = 'none';
            document.getElementById('adminTab').style.display = 'none';
            document.getElementById('uploadTab').style.display = 'none';
            document.getElementById('emailTab').style.display = 'none';
            // Reset all panels
            document.getElementById('onlineSalesPanel').style.display = 'block';
            document.getElementById('posSalesPanel').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'none';
            document.getElementById('uploadPanel').style.display = 'none';
            document.getElementById('emailPanel').style.display = 'none';
            // Reset month and staff filters
            var onlineFilter = document.getElementById('onlineMonthFilter');
            var posFilter = document.getElementById('posMonthFilter');
            var onlineStaffFilter = document.getElementById('onlineStaffFilter');
            var posStaffFilter = document.getElementById('posStaffFilter');
            if (onlineFilter) { onlineFilter.style.display = 'none'; onlineFilter.innerHTML = ''; }
            if (posFilter) { posFilter.style.display = 'none'; posFilter.innerHTML = ''; }
            if (onlineStaffFilter) { onlineStaffFilter.style.display = 'none'; onlineStaffFilter.innerHTML = ''; }
            if (posStaffFilter) { posStaffFilter.style.display = 'none'; posStaffFilter.innerHTML = ''; }
            // Reset tab active state
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.tab').classList.add('active');
            pins.forEach(p => p.value = '');
            pins[0].focus();
        }
        
        (async () => {
            try {
                const r = await authFetch('/api/auth/me');
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

function getStaffViewHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Ms. Chu - My Sales</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f7; min-height: 100vh; }
        .login-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .login-card { background: white; padding: 30px; border-radius: 20px; width: 100%; max-width: 340px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        .login-card .logo { font-size: 40px; margin-bottom: 10px; }
        .login-card h1 { font-size: 20px; color: #333; margin-bottom: 4px; }
        .login-card .subtitle { font-size: 13px; color: #888; margin-bottom: 20px; }
        .pin-row { display: flex; gap: 10px; justify-content: center; margin-bottom: 20px; }
        .pin-row input { width: 48px; height: 56px; text-align: center; font-size: 22px; border: 2px solid #ddd; border-radius: 12px; outline: none; -webkit-appearance: none; }
        .pin-row input:focus { border-color: #667eea; }
        .login-btn { width: 100%; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; }
        .login-btn:active { opacity: 0.9; transform: scale(0.98); }
        .error-msg { color: #e74c3c; font-size: 13px; margin-top: 12px; display: none; }

        .app { display: none; }
        .app-header { background: white; padding: 16px 20px; border-bottom: 1px solid #e5e5e5; position: sticky; top: 0; z-index: 10; }
        .app-header-top { display: flex; justify-content: space-between; align-items: center; }
        .staff-name { font-size: 17px; font-weight: 600; color: #333; }
        .staff-badge { font-size: 11px; color: #667eea; background: #eef0ff; padding: 2px 8px; border-radius: 4px; margin-left: 6px; }
        .logout-link { font-size: 14px; color: #999; cursor: pointer; border: none; background: none; }
        .month-label { font-size: 13px; color: #888; margin-top: 4px; }

        .tab-bar { display: flex; background: white; border-bottom: 1px solid #e5e5e5; padding: 0 20px; position: sticky; top: 57px; z-index: 9; }
        .tab-item { flex: 1; text-align: center; padding: 12px 0; font-size: 14px; font-weight: 500; color: #999; border-bottom: 2px solid transparent; cursor: pointer; }
        .tab-item.active { color: #667eea; border-bottom-color: #667eea; }

        .content { padding: 16px 20px 100px; }

        .summary-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
        .summary-card { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 14px; padding: 16px; color: white; text-align: center; }
        .summary-card .amount { font-size: 22px; font-weight: 700; }
        .summary-card .label { font-size: 11px; opacity: 0.85; margin-top: 4px; }

        .orders-section { background: white; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .orders-header { padding: 14px 16px; font-size: 15px; font-weight: 600; color: #333; border-bottom: 1px solid #f0f0f0; }
        .order-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f5f5f5; }
        .order-row:last-child { border-bottom: none; }
        .order-info { flex: 1; }
        .order-id { font-size: 14px; font-weight: 500; color: #333; }
        .order-meta { font-size: 12px; color: #999; margin-top: 2px; }
        .order-amount { font-size: 15px; font-weight: 600; color: #27ae60; text-align: right; white-space: nowrap; }
        .no-data { text-align: center; padding: 40px 20px; color: #bbb; font-size: 14px; }
        .loading { text-align: center; padding: 30px; color: #999; font-size: 14px; }
    </style>
</head>
<body>
    <div class="login-screen" id="loginScreen">
        <div class="login-card">
            <div class="logo">\u{1F9FC}</div>
            <h1>Ms. Chu Sales</h1>
            <p class="subtitle">Enter your PIN to view your sales</p>
            <div class="pin-row">
                <input type="password" maxlength="1" id="p1" inputmode="numeric" pattern="[0-9]*">
                <input type="password" maxlength="1" id="p2" inputmode="numeric" pattern="[0-9]*">
                <input type="password" maxlength="1" id="p3" inputmode="numeric" pattern="[0-9]*">
                <input type="password" maxlength="1" id="p4" inputmode="numeric" pattern="[0-9]*">
            </div>
            <button class="login-btn" id="loginBtn">Login</button>
            <p class="error-msg" id="errMsg"></p>
        </div>
    </div>

    <div class="app" id="app">
        <div class="app-header">
            <div class="app-header-top">
                <div><span class="staff-name" id="staffName"></span><span class="staff-badge">STAFF</span></div>
                <button class="logout-link" onclick="doLogout()">Logout</button>
            </div>
            <div class="month-label" id="monthLabel"></div>
        </div>
        <div class="tab-bar">
            <div class="tab-item active" id="tabOnline" onclick="switchTab('online')">Online Sales</div>
            <div class="tab-item" id="tabPos" onclick="switchTab('pos')">POS Sales</div>
        </div>
        <div class="content">
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="amount" id="totalAmount">HK$0</div>
                    <div class="label" id="totalLabel">Total Online Sales</div>
                </div>
                <div class="summary-card">
                    <div class="amount" id="totalOrders">0</div>
                    <div class="label">Orders</div>
                </div>
            </div>
            <div class="orders-section">
                <div class="orders-header" id="ordersHeader">Online Orders</div>
                <div id="ordersList"><div class="no-data">No orders yet</div></div>
            </div>
        </div>
    </div>

    <script>
        const _fetch = window.fetch.bind(window);
        let token = null;
        let staffUser = null;
        let onlineData = [];
        let posData = [];
        let currentTab = 'online';

        // PIN input auto-jump
        const pins = [document.getElementById('p1'), document.getElementById('p2'), document.getElementById('p3'), document.getElementById('p4')];
        pins.forEach((p, i) => {
            p.addEventListener('input', (e) => {
                if (e.target.value && i < 3) pins[i + 1].focus();
                if (i === 3 && e.target.value) doLogin();
            });
            p.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && i > 0) pins[i - 1].focus();
            });
        });

        document.getElementById('loginBtn').addEventListener('click', doLogin);

        async function doLogin() {
            const pin = pins.map(p => p.value).join('');
            if (pin.length < 4) return;
            const errEl = document.getElementById('errMsg');
            errEl.style.display = 'none';
            try {
                const res = await _fetch('/api/auth/pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin }),
                    credentials: 'include'
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    errEl.textContent = data.error || 'Invalid PIN';
                    errEl.style.display = 'block';
                    pins.forEach(p => p.value = '');
                    pins[0].focus();
                    return;
                }
                token = data.sessionToken;
                staffUser = data.user;
                if (staffUser.role === 'admin') {
                    // Admin should use the main dashboard
                    errEl.textContent = 'Please use the main dashboard for admin access';
                    errEl.style.display = 'block';
                    pins.forEach(p => p.value = '');
                    pins[0].focus();
                    return;
                }
                showApp();
            } catch (e) {
                errEl.textContent = 'Connection error';
                errEl.style.display = 'block';
            }
        }

        function authFetch(url, opts = {}) {
            opts.headers = opts.headers || {};
            if (token) opts.headers['Authorization'] = 'Bearer ' + token;
            opts.credentials = 'include';
            return _fetch(url, opts);
        }

        function showApp() {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            document.getElementById('staffName').textContent = staffUser.name;
            const now = new Date();
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            document.getElementById('monthLabel').textContent = monthNames[now.getMonth()] + ' ' + now.getFullYear();
            loadSales();
        }

        async function loadSales() {
            // API auto-filters to current month + staff's own data for non-admin users
            // We just need to pass the sale type

            // Load online sales
            try {
                const res = await authFetch('/api/sales?type=online');
                const data = await res.json();
                onlineData = data.sales || [];
            } catch (e) { onlineData = []; }

            // Load POS sales
            try {
                const res = await authFetch('/api/sales?type=pos');
                const data = await res.json();
                posData = data.sales || [];
            } catch (e) { posData = []; }

            renderTab();
        }

        function switchTab(tab) {
            currentTab = tab;
            document.getElementById('tabOnline').className = 'tab-item' + (tab === 'online' ? ' active' : '');
            document.getElementById('tabPos').className = 'tab-item' + (tab === 'pos' ? ' active' : '');
            renderTab();
        }

        function fmtCurrency(v) {
            const n = parseFloat(v) || 0;
            return 'HK$' + n.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        function renderTab() {
            const sales = currentTab === 'online' ? onlineData : posData;
            const typeLabel = currentTab === 'online' ? 'Online' : 'POS';
            const total = sales.reduce((s, r) => s + (parseFloat(r.netSales) || 0), 0);

            document.getElementById('totalAmount').textContent = fmtCurrency(total);
            document.getElementById('totalOrders').textContent = sales.length;
            document.getElementById('totalLabel').textContent = 'Total ' + typeLabel + ' Sales';
            document.getElementById('ordersHeader').textContent = typeLabel + ' Orders';

            const listEl = document.getElementById('ordersList');
            if (sales.length === 0) {
                listEl.innerHTML = '<div class="no-data">No ' + typeLabel.toLowerCase() + ' orders this month</div>';
                return;
            }
            let html = '';
            sales.forEach(r => {
                const date = r.orderDate ? new Date(r.orderDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
                const channel = r.salesChannel || '-';
                const gateway = r.paymentGateway || '';
                const meta = currentTab === 'pos' ? date + ' \u00B7 ' + channel + (gateway ? ' \u00B7 ' + gateway : '') : date + ' \u00B7 ' + channel;
                html += '<div class="order-row">';
                html += '  <div class="order-info">';
                html += '    <div class="order-id">#' + (r.orderNo || '-') + '</div>';
                html += '    <div class="order-meta">' + meta + '</div>';
                html += '  </div>';
                html += '  <div class="order-amount">' + fmtCurrency(r.netSales) + '</div>';
                html += '</div>';
            });
            listEl.innerHTML = html;
        }

        function doLogout() {
            token = null;
            staffUser = null;
            onlineData = [];
            posData = [];
            currentTab = 'online';
            document.getElementById('app').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'flex';
            pins.forEach(p => p.value = '');
            pins[0].focus();
        }

        pins[0].focus();
    </script>
</body>
</html>`;
}

startServer().catch(console.error);
