/**
 * Email IMAP sync module for automatic sales report fetching
 * Connects to Outlook/Hotmail to fetch CSV/Excel attachments
 */
import Imap from "imap";
import { simpleParser } from "mailparser";
import * as XLSX from "xlsx";
import * as db from "./db";
import { parseExcel } from "../lib/report-parser";

// IMAP configuration - auto-detect based on email domain
function getImapConfig(email: string) {
  if (email.includes("@gmail.com")) {
    return {
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };
  } else if (email.includes("@outlook") || email.includes("@hotmail") || email.includes("@live")) {
    return {
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };
  } else {
    // Default to Gmail
    return {
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };
  }
}

// Email subject filter
const EMAIL_SUBJECT_FILTER = "Online Orders by customer";

// Email configuration stored in environment variables
export function getEmailConfig() {
  return {
    email: process.env.EMAIL_ADDRESS || "",
    password: process.env.EMAIL_PASSWORD || "",
    enabled: process.env.EMAIL_ENABLED === "true"
  };
}

// Test IMAP connection
export async function testImapConnection(): Promise<{ success: boolean; messageCount?: number; error?: string }> {
  const config = getEmailConfig();
  
  if (!config.email || !config.password) {
    return { success: false, error: "Email credentials not configured" };
  }

  return new Promise((resolve) => {
    const imapConfig = getImapConfig(config.email);
    const imap = new Imap({
      user: config.email,
      password: config.password,
      ...imapConfig
    });

    const timeout = setTimeout(() => {
      try { imap.end(); } catch {}
      resolve({ success: false, error: "Connection timeout" });
    }, 30000);

    imap.once("ready", () => {
      clearTimeout(timeout);
      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          imap.end();
          resolve({ success: false, error: "Failed to open inbox: " + err.message });
          return;
        }
        const count = box.messages.total;
        imap.end();
        resolve({ success: true, messageCount: count });
      });
    });

    imap.once("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: "Connection failed: " + err.message });
    });

    imap.connect();
  });
}

// Fetch and process emails with attachments
export async function fetchAndProcessEmails(): Promise<{ 
  success: boolean; 
  imported?: number; 
  emailsProcessed?: number; 
  error?: string 
}> {
  const config = getEmailConfig();
  
  if (!config.email || !config.password) {
    return { success: false, error: "Email credentials not configured" };
  }

  return new Promise((resolve) => {
    const imapConfig = getImapConfig(config.email);
    const imap = new Imap({
      user: config.email,
      password: config.password,
      ...imapConfig
    });

    let totalImported = 0;
    let emailsProcessed = 0;

    const timeout = setTimeout(() => {
      try { imap.end(); } catch {}
      resolve({ success: false, error: "Connection timeout" });
    }, 120000); // 2 minute timeout for processing

    imap.once("ready", () => {
      imap.openBox("INBOX", false, async (err, box) => {
        if (err) {
          clearTimeout(timeout);
          imap.end();
          resolve({ success: false, error: "Failed to open inbox: " + err.message });
          return;
        }

        // Search for all emails with matching subject (including read ones)
        // Using ALL instead of UNSEEN to catch emails that may have been read
        imap.search([["SUBJECT", EMAIL_SUBJECT_FILTER]], async (err, results) => {
          if (err) {
            clearTimeout(timeout);
            imap.end();
            resolve({ success: false, error: "Search failed: " + err.message });
            return;
          }

          if (!results || results.length === 0) {
            clearTimeout(timeout);
            imap.end();
            console.log("[EmailSync] No new emails to process");
            resolve({ success: true, imported: 0, emailsProcessed: 0 });
            return;
          }

          console.log(`[EmailSync] Found ${results.length} emails matching subject filter`);
          
          // Only process the latest email (last one in results)
          const latestEmailId = results[results.length - 1];
          console.log(`[EmailSync] Processing only the latest email (ID: ${latestEmailId})`);
          
          const processPromises: Promise<number>[] = [];

          const f = imap.fetch([latestEmailId], { bodies: "", markSeen: true });

          f.on("message", (msg) => {
            const processPromise = new Promise<number>((resolveMsg) => {
              let buffer = "";
              msg.on("body", (stream) => {
                stream.on("data", (chunk) => {
                  buffer += chunk.toString("utf8");
                });
                stream.once("end", async () => {
                  try {
                    const parsed = await simpleParser(buffer);
                    let imported = 0;

                    if (parsed.attachments && parsed.attachments.length > 0) {
                      console.log(`[EmailSync] Processing email with ${parsed.attachments.length} attachments`);
                      
                      for (const attachment of parsed.attachments) {
                        const filename = attachment.filename || "";
                        if (filename.endsWith(".csv") || filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
                          console.log(`[EmailSync] Processing attachment: ${filename}`);
                          const content = attachment.content;
                          imported += await processAttachment(filename, content);
                        }
                      }
                    }
                    resolveMsg(imported);
                  } catch (e) {
                    console.error("[EmailSync] Parse error:", e);
                    resolveMsg(0);
                  }
                });
              });
            });
            processPromises.push(processPromise);
            emailsProcessed++;
          });

          f.once("error", (err) => {
            console.error("[EmailSync] Fetch error:", err);
          });

          f.once("end", async () => {
            const results = await Promise.all(processPromises);
            totalImported = results.reduce((a, b) => a + b, 0);
            
            clearTimeout(timeout);
            imap.end();
            console.log(`[EmailSync] Processed ${emailsProcessed} emails, imported ${totalImported} sales`);
            resolve({ success: true, imported: totalImported, emailsProcessed });
          });
        });
      });
    });

    imap.once("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: "Connection failed: " + err.message });
    });

    imap.connect();
  });
}

// Process attachment (CSV or Excel)
async function processAttachment(filename: string, content: Buffer): Promise<number> {
  try {
    if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      // For Excel files, use direct column mapping
      return await importExcelData(content);
    } else {
      // For CSV files, convert to string and parse
      const csvData = content.toString("utf8");
      return await importCSVData(csvData);
    }
  } catch (error) {
    console.error("[EmailSync] Process attachment error:", error);
    return 0;
  }
}

// Import Excel data using direct column mapping
// Column A = Order Date, Column B = Order Name, Column C = Sales Channel
// Column E = WVReferredByStaff (Customer Tags), Column H = Net Sales
async function importExcelData(content: Buffer): Promise<number> {
  const workbook = XLSX.read(content, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  
  // Convert to JSON with header row
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
  
  if (rows.length < 2) {
    console.log("[EmailSync] Excel file has no data rows");
    return 0;
  }
  
  // Get staff mapping for user assignment
  const staffMapping = await db.getStaffMapping();
  
  let imported = 0;
  
  // Log the header row to verify column positions
  if (rows.length > 0) {
    console.log(`[EmailSync] Header row: ${JSON.stringify(rows[0])}`);
  }
  
  // Skip header row (row 0), start from row 1
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    // Log first data row for debugging
    if (i === 1) {
      console.log(`[EmailSync] First data row: ${JSON.stringify(row)}`);
      console.log(`[EmailSync] Row length: ${row.length}`);
    }
    
    // Column mapping (0-indexed) based on actual Excel format:
    // A=0: Order Date, B=1: Order Name, C=2: Sales Channel, D=3: Customer Created At
    // E=4: Customer Tags (WVReferredByStaff), F=5: Payment Method
    // G=6: Email Marketing, H=7: SMS Marketing
    // I=8: Gross Sales, J=9: Net Sales, K=10: Total Sales, L=11: Refund Adjustment
    const orderDateRaw = row[0];
    const orderName = row[1] ? String(row[1]).trim() : null;
    const salesChannel = row[2] ? String(row[2]).trim() : null;
    const customerTags = row[4] ? String(row[4]).trim() : "";
    const netSalesRaw = row[9]; // Column J = Net Sales (index 9)
    
    // Log parsed values for first few rows
    if (i <= 3) {
      console.log(`[EmailSync] Row ${i}: date=${orderDateRaw}, order=${orderName}, channel=${salesChannel}, tags=${customerTags}, netSales=${netSalesRaw}`);
    }
    
    // Parse order date
    let orderDate: Date | null = null;
    if (orderDateRaw) {
      if (typeof orderDateRaw === "number") {
        // Excel serial date number - convert to JS Date
        // Excel dates are days since 1900-01-01 (with a bug for 1900 leap year)
        const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
        orderDate = new Date(excelEpoch.getTime() + orderDateRaw * 24 * 60 * 60 * 1000);
      } else {
        const rawDate = String(orderDateRaw).trim();
        if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
          const [mm, dd, yyyy] = rawDate.split("-");
          orderDate = new Date(`${yyyy}-${mm}-${dd}`);
        } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
          orderDate = new Date(rawDate);
        } else if (rawDate.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
          const parts = rawDate.split("/");
          orderDate = new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`);
        } else {
          const parsed = new Date(rawDate);
          if (!isNaN(parsed.getTime())) {
            orderDate = parsed;
          }
        }
      }
    }
    
    // Parse net sales
    let netSales = 0;
    if (typeof netSalesRaw === "number") {
      netSales = netSalesRaw;
    } else if (netSalesRaw) {
      netSales = parseFloat(String(netSalesRaw).replace(/[^0-9.-]/g, "") || "0");
    }
    
    if (isNaN(netSales) || netSales === 0) continue;
    
    // Try to find user ID from staff mapping using WVReferredByStaff
    let userId = 1; // Default to admin user
    if (customerTags) {
      const staffIdMatch = customerTags.match(/WVReferredByStaff_(\d+)/);
      if (staffIdMatch && staffMapping[staffIdMatch[1]]) {
        userId = staffMapping[staffIdMatch[1]];
      }
    }
    
    // Check if order already exists to avoid duplicates
    if (orderName) {
      const existingOrder = await db.execute(
        "SELECT id FROM sales WHERE orderNo = ? LIMIT 1",
        [orderName]
      );
      if (existingOrder[0] && (existingOrder[0] as any[]).length > 0) {
        console.log(`[EmailSync] Skipping duplicate: ${orderName}`);
        continue;
      }
    }
    
    try {
      console.log(`[EmailSync] Inserting: order=${orderName}, channel=${salesChannel}, amount=${netSales}, date=${orderDate}`);
      // Use raw SQL to match production database schema (orderNo, not orderReference)
      const saleDate = orderDate ? orderDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      await db.execute(
        `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, staffId, saleType) VALUES (?, ?, ?, ?, ?, ?)`,
        [saleDate, orderName || null, salesChannel || "Online Store", netSales, userId > 1 ? userId.toString() : null, "online"]
      );
      imported++;
      console.log(`[EmailSync] Imported: ${orderName} - ${salesChannel} - $${netSales}`);
    } catch (error: any) {
      // Log the actual error for debugging
      console.error(`[EmailSync] Error inserting ${orderName}:`, error.message || error);
    }
  }
  
  console.log(`[EmailSync] Excel import complete: ${imported} records`);
  return imported;
}

// Import CSV data to database
async function importCSVData(csvData: string): Promise<number> {
  const lines = csvData.trim().split("\n");
  if (lines.length < 2) return 0;

  // Parse header
  function parseCSVHeader(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    return result;
  }

  function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim().replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ""));
    return result;
  }

  const header = parseCSVHeader(lines[0]);
  const dateIdx = header.findIndex((h) => h.includes("date") || h.includes("orderdate"));
  const orderIdx = header.findIndex((h) => h.includes("orderid") || h.includes("orderno") || h.includes("ordername") || h === "order");
  const channelIdx = header.findIndex((h) => h.includes("channel") || h.includes("saleschannel"));
  const netSalesIdx = header.findIndex((h) => h.includes("netsales") || h.includes("net") || h.includes("amount") || h.includes("total"));

  if (netSalesIdx === -1) {
    console.log("[EmailSync] Could not find Net Sales column");
    return 0;
  }

  // Get staff mapping for user assignment
  const staffMapping = await db.getStaffMapping();
  const staffIdIdx = header.findIndex((h) => h.includes("staffid") || h.includes("wvreferredbystaff") || h.includes("customertags"));
  
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    // Parse date
    let orderDate: Date | null = null;
    if (dateIdx >= 0 && values[dateIdx]) {
      const rawDate = values[dateIdx].trim();
      if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
        const [mm, dd, yyyy] = rawDate.split("-");
        orderDate = new Date(`${yyyy}-${mm}-${dd}`);
      } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        orderDate = new Date(rawDate);
      } else if (rawDate.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        const parts = rawDate.split("/");
        orderDate = new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`);
      } else {
        const parsed = new Date(rawDate);
        if (!isNaN(parsed.getTime())) {
          orderDate = parsed;
        }
      }
    }

    const orderNo = orderIdx >= 0 ? values[orderIdx] : null;
    const salesChannel = channelIdx >= 0 ? values[channelIdx] : null;
    const netSales = parseFloat(values[netSalesIdx]?.replace(/[^0-9.-]/g, "") || "0");

    if (isNaN(netSales) || netSales === 0) continue;

    // Try to find user ID from staff mapping
    let userId = 1; // Default to admin user
    if (staffIdIdx >= 0 && values[staffIdIdx]) {
      const staffIdMatch = values[staffIdIdx].match(/WVReferredByStaff:(\d+)/);
      if (staffIdMatch && staffMapping[staffIdMatch[1]]) {
        userId = staffMapping[staffIdMatch[1]];
      }
    }

    try {
      await db.createSale({
        userId,
        productName: salesChannel || "Sale",
        productCategory: "Shopify",
        quantity: 1,
        unitPrice: netSales.toString(),
        totalAmount: netSales.toString(),
        saleDate: orderDate || new Date(),
        orderReference: orderNo || undefined,
        saleType: "online", // Email imports are always online sales
      });
      imported++;
    } catch (error) {
      // Skip duplicates or other errors
      console.log(`[EmailSync] Skipped record: ${orderNo}`);
    }
  }

  return imported;
}

// Schedule auto-fetch every 1 hour
let syncInterval: ReturnType<typeof setInterval> | null = null;
const ONE_HOUR = 1 * 60 * 60 * 1000;

export function startScheduledEmailSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
  }

  const config = getEmailConfig();
  if (!config.enabled || !config.email || !config.password) {
    console.log("[EmailSync] Auto-sync disabled - email not configured or disabled");
    return;
  }

  // Run initial sync after 1 minute delay
  setTimeout(async () => {
    console.log("[EmailSync] Running initial email sync...");
    const result = await fetchAndProcessEmails();
    if (result.success) {
      console.log(`[EmailSync] Initial sync complete: ${result.imported} sales from ${result.emailsProcessed} emails`);
    } else {
      console.error("[EmailSync] Initial sync failed:", result.error);
    }
  }, 60000);

  // Schedule recurring sync every 1 hour
  syncInterval = setInterval(async () => {
    console.log("[EmailSync] Running scheduled email sync...");
    const result = await fetchAndProcessEmails();
    if (result.success) {
      console.log(`[EmailSync] Scheduled sync complete: ${result.imported} sales from ${result.emailsProcessed} emails`);
    } else {
      console.error("[EmailSync] Scheduled sync failed:", result.error);
    }
  }, ONE_HOUR);

  console.log("[EmailSync] Scheduled auto-fetch every 1 hour");
}

export function stopScheduledEmailSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[EmailSync] Stopped scheduled sync");
  }
}
