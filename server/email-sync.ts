/**
 * Email IMAP sync module for automatic sales report fetching
 * Connects to Gmail to fetch CSV/Excel attachments for both Online and POS reports
 * 
 * Online Sales: emails with subject "Online Orders by customer"
 * POS Sales: emails with subject "POS_Sales_Attribution"
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
    return {
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    };
  }
}

// Email subject filters for both report types
const ONLINE_SUBJECT_FILTER = "Online Orders by customer";
const POS_SUBJECT_FILTER = "POS_Sales_Attribution";

// Staff name mapping for WVReferredByStaff IDs
const STAFF_NAME_MAP: Record<string, string> = {
  '78319321135': 'Egenie Tang',
  '78319255599': 'Eva Lee',
  '78319190063': 'Maggie Liang',
  '79208775727': 'Maggie Wong',
  '78319386671': 'Ting Siew',
  '78319550511': 'Win Lee',
  '78319091759': 'Wing Ho',
  '101232115995': 'Sharon Li',
  '109111279899': 'Hailey Hoi Ling Wong',
  '111913632027': 'Bon Lau',
  '118809198875': 'Sze',
  '78303264815': 'Cindy Chu',
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

// Fetch and process emails for a specific report type
async function fetchReportEmails(
  imap: any,
  subjectFilter: string,
  saleType: "online" | "pos"
): Promise<{ imported: number; emailsProcessed: number }> {
  return new Promise((resolve) => {
    imap.search([["SUBJECT", subjectFilter]], async (err: any, results: number[]) => {
      if (err) {
        console.error(`[EmailSync] Search failed for "${subjectFilter}":`, err);
        resolve({ imported: 0, emailsProcessed: 0 });
        return;
      }

      if (!results || results.length === 0) {
        console.log(`[EmailSync] No emails found for "${subjectFilter}"`);
        resolve({ imported: 0, emailsProcessed: 0 });
        return;
      }

      console.log(`[EmailSync] Found ${results.length} emails for "${subjectFilter}"`);
      
      // Only process the latest email
      const latestEmailId = results[results.length - 1];
      console.log(`[EmailSync] Processing latest email (ID: ${latestEmailId}) for ${saleType}`);
      
      let totalImported = 0;
      let emailsProcessed = 0;
      const processPromises: Promise<number>[] = [];

      const f = imap.fetch([latestEmailId], { bodies: "", markSeen: true });

      f.on("message", (msg: any) => {
        const processPromise = new Promise<number>((resolveMsg) => {
          let buffer = "";
          msg.on("body", (stream: any) => {
            stream.on("data", (chunk: any) => {
              buffer += chunk.toString("utf8");
            });
            stream.once("end", async () => {
              try {
                const parsed = await simpleParser(buffer);
                let imported = 0;

                if (parsed.attachments && parsed.attachments.length > 0) {
                  console.log(`[EmailSync] Processing ${saleType} email with ${parsed.attachments.length} attachments`);
                  
                  for (const attachment of parsed.attachments) {
                    const filename = attachment.filename || "";
                    if (filename.endsWith(".csv") || filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
                      console.log(`[EmailSync] Processing ${saleType} attachment: ${filename}`);
                      const content = attachment.content;
                      imported += await processAttachment(filename, content, saleType);
                    }
                  }
                }
                resolveMsg(imported);
              } catch (e) {
                console.error(`[EmailSync] Parse error for ${saleType}:`, e);
                resolveMsg(0);
              }
            });
          });
        });
        processPromises.push(processPromise);
        emailsProcessed++;
      });

      f.once("error", (err: any) => {
        console.error(`[EmailSync] Fetch error for ${saleType}:`, err);
      });

      f.once("end", async () => {
        const results = await Promise.all(processPromises);
        totalImported = results.reduce((a, b) => a + b, 0);
        console.log(`[EmailSync] ${saleType}: processed ${emailsProcessed} emails, imported ${totalImported} sales`);
        resolve({ imported: totalImported, emailsProcessed });
      });
    });
  });
}

// Fetch and process emails with attachments (both Online and POS)
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
      ...imapConfig,
      authTimeout: 30000,
      connTimeout: 30000
    });

    const timeout = setTimeout(() => {
      try { imap.end(); } catch {}
      resolve({ success: false, error: "Connection timeout" });
    }, 180000); // 3 minute timeout for processing both report types

    imap.once("ready", () => {
      imap.openBox("INBOX", false, async (err, box) => {
        if (err) {
          clearTimeout(timeout);
          imap.end();
          resolve({ success: false, error: "Failed to open inbox: " + err.message });
          return;
        }

        try {
          // Process Online Sales emails
          const onlineResult = await fetchReportEmails(imap, ONLINE_SUBJECT_FILTER, "online");
          
          // Process POS Sales emails
          const posResult = await fetchReportEmails(imap, POS_SUBJECT_FILTER, "pos");

          clearTimeout(timeout);
          imap.end();

          const totalImported = onlineResult.imported + posResult.imported;
          const totalEmails = onlineResult.emailsProcessed + posResult.emailsProcessed;

          console.log(`[EmailSync] Total: processed ${totalEmails} emails, imported ${totalImported} sales (online: ${onlineResult.imported}, pos: ${posResult.imported})`);
          resolve({ success: true, imported: totalImported, emailsProcessed: totalEmails });
        } catch (e: any) {
          clearTimeout(timeout);
          imap.end();
          resolve({ success: false, error: "Processing error: " + e.message });
        }
      });
    });

    imap.once("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: "Connection failed: " + err.message });
    });

    imap.connect();
  });
}

// Process attachment (CSV or Excel) with saleType context
async function processAttachment(filename: string, content: Buffer, saleType: "online" | "pos"): Promise<number> {
  try {
    if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      return await importExcelData(content, saleType);
    } else {
      const csvData = content.toString("utf8");
      return await importCSVData(csvData, saleType);
    }
  } catch (error) {
    console.error(`[EmailSync] Process attachment error (${saleType}):`, error);
    return 0;
  }
}

// Parse date from various formats
function parseDate(raw: any): Date | null {
  if (!raw) return null;
  if (typeof raw === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + raw * 24 * 60 * 60 * 1000);
  }
  const rawDate = String(raw).trim();
  if (rawDate.match(/^\d{2}-\d{2}-\d{4}$/)) {
    const [mm, dd, yyyy] = rawDate.split("-");
    return new Date(`${yyyy}-${mm}-${dd}`);
  } else if (rawDate.match(/^\d{4}-\d{2}-\d{2}/)) {
    return new Date(rawDate.split("T")[0]);
  } else if (rawDate.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    const parts = rawDate.split("/");
    return new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`);
  } else {
    const parsed = new Date(rawDate);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
}

// Parse numeric value
function parseNumber(raw: any): number {
  if (typeof raw === "number") return raw;
  if (!raw) return 0;
  return parseFloat(String(raw).replace(/[^0-9.-]/g, "") || "0");
}

// Import Excel data with saleType-aware column mapping
async function importExcelData(content: Buffer, saleType: "online" | "pos"): Promise<number> {
  const workbook = XLSX.read(content, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
  
  if (rows.length < 2) {
    console.log(`[EmailSync] Excel file has no data rows`);
    return 0;
  }

  // Normalize headers
  const rawHeaders = (rows[0] || []).map((h: any) => String(h || "").trim());
  const headers = rawHeaders.map((h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  console.log(`[EmailSync] ${saleType} Excel headers: ${JSON.stringify(rawHeaders)}`);

  // Find column indices by header name
  const dateIdx = headers.findIndex(h => h.includes("date") || h.includes("orderdate"));
  const orderIdx = headers.findIndex(h => h.includes("ordername") || h.includes("orderno") || h.includes("orderid") || h === "order");
  const channelIdx = headers.findIndex(h => h.includes("channel") || h.includes("saleschannel") || h.includes("poslocationname") || h.includes("location"));

  // Net Sales: for POS prefer "Net Sales excl Gift Card", for Online use "Net Sales"
  let netSalesIdx: number;
  if (saleType === "pos") {
    netSalesIdx = headers.findIndex(h => h.includes("netsalesexcl") || h.includes("excl") || h.includes("exclud"));
    if (netSalesIdx === -1) {
      netSalesIdx = headers.findIndex(h => h.includes("netsales") || h.includes("net") || h.includes("amount") || h.includes("total"));
    }
  } else {
    netSalesIdx = headers.findIndex(h => h.includes("netsales") || h.includes("net") || h.includes("amount") || h.includes("total"));
  }

  // POS-specific columns
  const paymentGatewayIdx = saleType === "pos" ? headers.findIndex(h => h.includes("paymentgateway") || h.includes("payment")) : -1;
  const staffNameIdx = saleType === "pos" ? headers.findIndex(h => h.includes("staffname") || h === "staff") : -1;
  
  // Online-specific: Customer Tags for WVReferredByStaff
  const customerTagsIdx = saleType === "online" ? headers.findIndex(h => h.includes("customertag") || h.includes("customer_tag")) : -1;

  if (netSalesIdx === -1) {
    console.log(`[EmailSync] Could not find Net Sales column for ${saleType}`);
    return 0;
  }

  console.log(`[EmailSync] ${saleType} column indices: date=${dateIdx}, order=${orderIdx}, channel=${channelIdx}, netSales=${netSalesIdx}, paymentGateway=${paymentGatewayIdx}, staffName=${staffNameIdx}, customerTags=${customerTagsIdx}`);

  const staffMapping = await db.getStaffMapping();
  let imported = 0;
  let lastChannel = "";
  let lastPaymentGateway = "";
  let lastStaffName = "";

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const orderDate = dateIdx >= 0 ? parseDate(row[dateIdx]) : null;
    const orderName = orderIdx >= 0 && row[orderIdx] ? String(row[orderIdx]).trim() : null;
    const netSales = netSalesIdx >= 0 ? parseNumber(row[netSalesIdx]) : 0;

    // Skip invalid rows
    if (!orderName || orderName === "None" || orderName.toLowerCase().includes("grand total") || orderName.toLowerCase().includes("total")) {
      continue;
    }

    if (isNaN(netSales) || netSales === 0) continue;

    // Channel
    let salesChannel = channelIdx >= 0 && row[channelIdx] ? String(row[channelIdx]).trim() : null;
    if (salesChannel === "None") salesChannel = null;

    // POS: carry forward channel/gateway/staff from previous row with same order
    if (saleType === "pos") {
      if (salesChannel && salesChannel !== "None") {
        lastChannel = salesChannel;
      } else if (!salesChannel) {
        salesChannel = lastChannel || null;
      }

      let paymentGateway = paymentGatewayIdx >= 0 && row[paymentGatewayIdx] ? String(row[paymentGatewayIdx]).trim() : null;
      if (paymentGateway === "None") paymentGateway = null;
      if (paymentGateway) {
        lastPaymentGateway = paymentGateway;
      } else {
        paymentGateway = lastPaymentGateway || null;
      }

      let staffName = staffNameIdx >= 0 && row[staffNameIdx] ? String(row[staffNameIdx]).trim() : null;
      if (staffName === "None") staffName = null;
      if (staffName) {
        lastStaffName = staffName;
      } else {
        staffName = lastStaffName || null;
      }

      // Check for duplicate
      try {
        const existingOrder = await db.execute("SELECT id FROM sales WHERE orderNo = ? AND saleType = 'pos' LIMIT 1", [orderName]);
        const rows2 = Array.isArray(existingOrder) ? existingOrder[0] : existingOrder;
        const hasExisting = rows2 && (Array.isArray(rows2) ? rows2.length > 0 : Object.keys(rows2).length > 0);
        if (hasExisting) {
          // Update existing record if it has missing data
          const updates: string[] = [];
          const params: any[] = [];
          if (salesChannel) { updates.push("salesChannel = ?"); params.push(salesChannel); }
          if (paymentGateway) { updates.push("paymentGateway = ?"); params.push(paymentGateway); }
          if (staffName) { updates.push("staffName = ?"); params.push(staffName); }
          updates.push("netSales = ?"); params.push(netSales);
          if (updates.length > 0) {
            params.push(orderName);
            await db.execute(`UPDATE sales SET ${updates.join(", ")} WHERE orderNo = ? AND saleType = 'pos'`, params);
          }
          continue;
        }
      } catch (e: any) {
        console.log(`[EmailSync] POS duplicate check error for ${orderName}: ${e.message}`);
      }

      // Insert new POS record
      try {
        const saleDate = orderDate ? orderDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        await db.execute(
          `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, saleType, paymentGateway, staffName) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [saleDate, orderName, salesChannel || "-", netSales, "pos", paymentGateway || null, staffName || null]
        );
        imported++;
      } catch (error: any) {
        console.error(`[EmailSync] POS insert error for ${orderName}:`, error.message || error);
      }

    } else {
      // Online Sales processing
      let userId = 1;
      let staffName: string | null = null;
      
      if (customerTagsIdx >= 0 && row[customerTagsIdx]) {
        const customerTags = String(row[customerTagsIdx]).trim();
        const staffIdMatch = customerTags.match(/WVReferredByStaff_(\d+)/);
        if (staffIdMatch) {
          const sid = staffIdMatch[1];
          if (staffMapping[sid]) {
            userId = staffMapping[sid];
          }
          const name = STAFF_NAME_MAP[sid];
          staffName = name ? `${name} ${sid}` : sid;
        }
      }

      // Check for duplicate
      try {
        const existingOrder = await db.execute("SELECT id FROM sales WHERE orderNo = ? AND saleType = 'online' LIMIT 1", [orderName]);
        const rows2 = Array.isArray(existingOrder) ? existingOrder[0] : existingOrder;
        const hasExisting = rows2 && (Array.isArray(rows2) ? rows2.length > 0 : Object.keys(rows2).length > 0);
        if (hasExisting) {
          // Update staffName if missing
          if (staffName) {
            await db.execute(`UPDATE sales SET staffName = ? WHERE orderNo = ? AND saleType = 'online' AND (staffName IS NULL OR staffName = '')`, [staffName, orderName]);
          }
          continue;
        }
      } catch (e: any) {
        console.log(`[EmailSync] Online duplicate check error for ${orderName}: ${e.message}`);
      }

      // Insert new online record
      try {
        const saleDate = orderDate ? orderDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        await db.execute(
          `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, staffId, saleType, staffName) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [saleDate, orderName, salesChannel || "Online Store", netSales, userId > 1 ? userId.toString() : null, "online", staffName]
        );
        imported++;
      } catch (error: any) {
        console.error(`[EmailSync] Online insert error for ${orderName}:`, error.message || error);
      }
    }
  }

  console.log(`[EmailSync] ${saleType} Excel import complete: ${imported} records`);
  return imported;
}

// Import CSV data with saleType-aware column mapping
async function importCSVData(csvData: string, saleType: "online" | "pos"): Promise<number> {
  const lines = csvData.trim().split("\n");
  if (lines.length < 2) return 0;

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
  console.log(`[EmailSync] ${saleType} CSV headers: ${JSON.stringify(header)}`);

  const dateIdx = header.findIndex(h => h.includes("date") || h.includes("orderdate"));
  const orderIdx = header.findIndex(h => h.includes("orderid") || h.includes("orderno") || h.includes("ordername") || h === "order");
  const channelIdx = header.findIndex(h => h.includes("channel") || h.includes("saleschannel") || h.includes("poslocationname") || h.includes("location"));

  // Net Sales: for POS prefer "Net Sales excl Gift Card"
  let netSalesIdx: number;
  if (saleType === "pos") {
    netSalesIdx = header.findIndex(h => h.includes("netsalesexcl") || h.includes("excl") || h.includes("exclud"));
    if (netSalesIdx === -1) {
      netSalesIdx = header.findIndex(h => h.includes("netsales") || h.includes("net") || h.includes("amount") || h.includes("total"));
    }
  } else {
    netSalesIdx = header.findIndex(h => h.includes("netsales") || h.includes("net") || h.includes("amount") || h.includes("total"));
  }

  // POS-specific columns
  const paymentGatewayIdx = saleType === "pos" ? header.findIndex(h => h.includes("paymentgateway") || h.includes("payment")) : -1;
  const staffNameIdx = saleType === "pos" ? header.findIndex(h => h.includes("staffname") || h === "staff") : -1;
  const customerTagsIdx = saleType === "online" ? header.findIndex(h => h.includes("customertag") || h.includes("customer_tag")) : -1;

  if (netSalesIdx === -1) {
    console.log(`[EmailSync] Could not find Net Sales column for ${saleType}`);
    return 0;
  }

  const staffMapping = await db.getStaffMapping();
  let imported = 0;
  let lastChannel = "";
  let lastPaymentGateway = "";
  let lastStaffName = "";

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const orderDate = dateIdx >= 0 ? parseDate(values[dateIdx]) : null;
    const orderNo = orderIdx >= 0 ? values[orderIdx]?.trim() : null;
    const netSales = netSalesIdx >= 0 ? parseNumber(values[netSalesIdx]) : 0;

    if (!orderNo || orderNo === "None" || orderNo.toLowerCase().includes("total")) continue;
    if (isNaN(netSales) || netSales === 0) continue;

    let salesChannel = channelIdx >= 0 ? values[channelIdx]?.trim() : null;
    if (salesChannel === "None" || !salesChannel) salesChannel = null;

    if (saleType === "pos") {
      // Carry forward for POS
      if (salesChannel) { lastChannel = salesChannel; } else { salesChannel = lastChannel || null; }

      let paymentGateway = paymentGatewayIdx >= 0 ? values[paymentGatewayIdx]?.trim() : null;
      if (!paymentGateway || paymentGateway === "None") paymentGateway = null;
      if (paymentGateway) { lastPaymentGateway = paymentGateway; } else { paymentGateway = lastPaymentGateway || null; }

      let staffNameVal = staffNameIdx >= 0 ? values[staffNameIdx]?.trim() : null;
      if (!staffNameVal || staffNameVal === "None") staffNameVal = null;
      if (staffNameVal) { lastStaffName = staffNameVal; } else { staffNameVal = lastStaffName || null; }

      try {
        const existingOrder = await db.execute("SELECT id FROM sales WHERE orderNo = ? AND saleType = 'pos' LIMIT 1", [orderNo]);
        const rows2 = Array.isArray(existingOrder) ? existingOrder[0] : existingOrder;
        const hasExisting = rows2 && (Array.isArray(rows2) ? rows2.length > 0 : Object.keys(rows2).length > 0);
        if (hasExisting) {
          const updates: string[] = [];
          const params: any[] = [];
          if (salesChannel) { updates.push("salesChannel = ?"); params.push(salesChannel); }
          if (paymentGateway) { updates.push("paymentGateway = ?"); params.push(paymentGateway); }
          if (staffNameVal) { updates.push("staffName = ?"); params.push(staffNameVal); }
          updates.push("netSales = ?"); params.push(netSales);
          if (updates.length > 0) {
            params.push(orderNo);
            await db.execute(`UPDATE sales SET ${updates.join(", ")} WHERE orderNo = ? AND saleType = 'pos'`, params);
          }
          continue;
        }
      } catch (e: any) {
        console.log(`[EmailSync] POS CSV duplicate check error: ${e.message}`);
      }

      try {
        const saleDate = orderDate ? orderDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        await db.execute(
          `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, saleType, paymentGateway, staffName) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [saleDate, orderNo, salesChannel || "-", netSales, "pos", paymentGateway || null, staffNameVal || null]
        );
        imported++;
      } catch (error: any) {
        console.error(`[EmailSync] POS CSV insert error: ${error.message}`);
      }

    } else {
      // Online Sales
      let userId = 1;
      let staffName: string | null = null;
      if (customerTagsIdx >= 0 && values[customerTagsIdx]) {
        const tags = values[customerTagsIdx].trim();
        const staffIdMatch = tags.match(/WVReferredByStaff_(\d+)/);
        if (staffIdMatch) {
          const sid = staffIdMatch[1];
          if (staffMapping[sid]) userId = staffMapping[sid];
          const name = STAFF_NAME_MAP[sid];
          staffName = name ? `${name} ${sid}` : sid;
        }
      }

      try {
        const existingOrder = await db.execute("SELECT id FROM sales WHERE orderNo = ? AND saleType = 'online' LIMIT 1", [orderNo]);
        const rows2 = Array.isArray(existingOrder) ? existingOrder[0] : existingOrder;
        const hasExisting = rows2 && (Array.isArray(rows2) ? rows2.length > 0 : Object.keys(rows2).length > 0);
        if (hasExisting) {
          if (staffName) {
            await db.execute(`UPDATE sales SET staffName = ? WHERE orderNo = ? AND saleType = 'online' AND (staffName IS NULL OR staffName = '')`, [staffName, orderNo]);
          }
          continue;
        }
      } catch (e: any) {
        console.log(`[EmailSync] Online CSV duplicate check error: ${e.message}`);
      }

      try {
        const saleDate = orderDate ? orderDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
        await db.execute(
          `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, staffId, saleType, staffName) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [saleDate, orderNo, salesChannel || "Online Store", netSales, userId > 1 ? userId.toString() : null, "online", staffName]
        );
        imported++;
      } catch (error: any) {
        console.error(`[EmailSync] Online CSV insert error: ${error.message}`);
      }
    }
  }

  console.log(`[EmailSync] ${saleType} CSV import complete: ${imported} records`);
  return imported;
}

// Schedule auto-fetch every 1 hour
let syncInterval: ReturnType<typeof setInterval> | null = null;
const ONE_HOUR = 1 * 60 * 60 * 1000;

// Track last sync time
let lastSyncTime: Date | null = null;
let lastSyncResult: string = '';

export function getLastSyncInfo() {
  return {
    lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null,
    lastSyncResult
  };
}

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
    console.log("[EmailSync] Running initial email sync (Online + POS)...");
    const result = await fetchAndProcessEmails();
    lastSyncTime = new Date();
    if (result.success) {
      lastSyncResult = `Imported ${result.imported} sales from ${result.emailsProcessed} emails (Online + POS)`;
      console.log(`[EmailSync] Initial sync complete: ${lastSyncResult}`);
    } else {
      lastSyncResult = `Failed: ${result.error}`;
      console.error("[EmailSync] Initial sync failed:", result.error);
    }
  }, 60000);

  // Schedule recurring sync every 1 hour
  syncInterval = setInterval(async () => {
    console.log("[EmailSync] Running scheduled email sync (Online + POS)...");
    const result = await fetchAndProcessEmails();
    lastSyncTime = new Date();
    if (result.success) {
      lastSyncResult = `Imported ${result.imported} sales from ${result.emailsProcessed} emails (Online + POS)`;
      console.log(`[EmailSync] Scheduled sync complete: ${lastSyncResult}`);
    } else {
      lastSyncResult = `Failed: ${result.error}`;
      console.error("[EmailSync] Scheduled sync failed:", result.error);
    }
  }, ONE_HOUR);

  console.log("[EmailSync] Scheduled auto-fetch every 1 hour (Online + POS reports)");
}

export function stopScheduledEmailSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[EmailSync] Stopped scheduled sync");
  }
}
