/**
 * Email IMAP sync module for automatic sales report fetching
 * Connects to Outlook/Hotmail to fetch CSV/Excel attachments
 */
import Imap from "imap";
import { simpleParser } from "mailparser";
import * as XLSX from "xlsx";
import * as db from "./db";
import { parseExcel } from "../lib/report-parser";

// IMAP configuration for Outlook
const IMAP_CONFIG = {
  host: "outlook.office365.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
};

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
    const imap = new Imap({
      user: config.email,
      password: config.password,
      ...IMAP_CONFIG
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
    const imap = new Imap({
      user: config.email,
      password: config.password,
      ...IMAP_CONFIG
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

        // Search for unseen emails
        imap.search(["UNSEEN"], async (err, results) => {
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

          console.log(`[EmailSync] Found ${results.length} unread emails`);
          const processPromises: Promise<number>[] = [];

          const f = imap.fetch(results, { bodies: "", markSeen: true });

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
    let csvData: string;

    if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      // For Excel files, convert to CSV
      const workbook = XLSX.read(content, { type: "buffer" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      csvData = XLSX.utils.sheet_to_csv(firstSheet);
    } else {
      csvData = content.toString("utf8");
    }

    return await importCSVData(csvData);
  } catch (error) {
    console.error("[EmailSync] Process attachment error:", error);
    return 0;
  }
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
      });
      imported++;
    } catch (error) {
      // Skip duplicates or other errors
      console.log(`[EmailSync] Skipped record: ${orderNo}`);
    }
  }

  return imported;
}

// Schedule auto-fetch every 6 hours
let syncInterval: ReturnType<typeof setInterval> | null = null;
const SIX_HOURS = 6 * 60 * 60 * 1000;

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

  // Schedule recurring sync every 6 hours
  syncInterval = setInterval(async () => {
    console.log("[EmailSync] Running scheduled email sync...");
    const result = await fetchAndProcessEmails();
    if (result.success) {
      console.log(`[EmailSync] Scheduled sync complete: ${result.imported} sales from ${result.emailsProcessed} emails`);
    } else {
      console.error("[EmailSync] Scheduled sync failed:", result.error);
    }
  }, SIX_HOURS);

  console.log("[EmailSync] Scheduled auto-fetch every 6 hours");
}

export function stopScheduledEmailSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[EmailSync] Stopped scheduled sync");
  }
}
