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

// Email subject filters
const ONLINE_SUBJECT_FILTER = "Online Orders by customer";
const POS_SUBJECT_FILTER = "POS_Sales_Attribution";

// Track last sync time
let lastSyncTime: Date | null = null;
let lastSyncResult: { success: boolean; imported?: number; emailsProcessed?: number; error?: string } | null = null;

// Email configuration stored in environment variables
export function getEmailConfig() {
  return {
    email: process.env.EMAIL_ADDRESS || "",
    password: process.env.EMAIL_PASSWORD || "",
    enabled: process.env.EMAIL_ENABLED === "true"
  };
}

// Get last sync info
export function getLastSyncInfo() {
  return {
    lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null,
    lastSyncResult
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

        // Search for Online report emails first, then POS report emails
        // Using two separate searches to avoid IMAP OR syntax compatibility issues
        const subjectFilters = [
          { filter: ONLINE_SUBJECT_FILTER, type: "online" as const },
          { filter: POS_SUBJECT_FILTER, type: "pos" as const }
        ];
        
        let allResults: { uid: number; type: "online" | "pos" }[] = [];
        let searchesCompleted = 0;
        
        function doSearch(filterObj: { filter: string; type: "online" | "pos" }) {
          // Search for emails from today (SINCE filter uses date only, not time)
          const today = new Date();
          const sinceDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          imap.search([["SUBJECT", filterObj.filter], ["SINCE", sinceDate]], (err, results) => {
            if (err) {
              console.error(`[EmailSync] Search error for ${filterObj.type}: ${err.message}`);
              // Fallback: try without date filter, use latest only
              imap.search([["SUBJECT", filterObj.filter]], (err2, results2) => {
                if (!err2 && results2 && results2.length > 0) {
                  const latestUid = Math.max(...results2);
                  console.log(`[EmailSync] Fallback: Found ${results2.length} emails for ${filterObj.type}, using latest UID: ${latestUid}`);
                  allResults.push({ uid: latestUid, type: filterObj.type });
                }
                searchesCompleted++;
                if (searchesCompleted === subjectFilters.length) processAllResults();
              });
              return;
            }
            if (results && results.length > 0) {
              // Process ALL emails from today (each may contain different order ranges)
              console.log(`[EmailSync] Found ${results.length} emails from today for ${filterObj.type}, processing ALL: UIDs ${results.join(', ')}`);
              results.forEach(uid => allResults.push({ uid, type: filterObj.type }));
            } else {
              // No emails from today - fall back to latest email overall
              imap.search([["SUBJECT", filterObj.filter]], (err2, results2) => {
                if (!err2 && results2 && results2.length > 0) {
                  const latestUid = Math.max(...results2);
                  console.log(`[EmailSync] No today emails for ${filterObj.type}, using latest overall UID: ${latestUid}`);
                  allResults.push({ uid: latestUid, type: filterObj.type });
                } else {
                  console.log(`[EmailSync] No emails found for ${filterObj.type} (subject: "${filterObj.filter}")`);
                }
                searchesCompleted++;
                if (searchesCompleted === subjectFilters.length) processAllResults();
              });
              return;
            }
            searchesCompleted++;
            if (searchesCompleted === subjectFilters.length) {
              processAllResults();
            }
          });
        }
        
        async function processAllResults() {
          if (allResults.length === 0) {
            clearTimeout(timeout);
            imap.end();
            console.log("[EmailSync] No emails to process from either search");
            resolve({ success: true, imported: 0, emailsProcessed: 0 });
            return;
          }
          
          console.log(`[EmailSync] Processing ${allResults.length} latest email(s): ${allResults.map(r => r.type + ':' + r.uid).join(', ')}`);
          
          // Build a map of uid -> type for quick lookup
          const uidTypeMap = new Map<number, "online" | "pos">();
          allResults.forEach(r => uidTypeMap.set(r.uid, r.type));
          const allUids = allResults.map(r => r.uid);
          
          const processPromises: Promise<number>[] = [];
          
          const f = imap.fetch(allUids, { bodies: "", markSeen: true });
          
          f.on("message", (msg, seqno) => {
            const processPromise = new Promise<number>((resolveMsg) => {
              let buffer = "";
              let msgUid: number | null = null;
              msg.on("attributes", (attrs) => {
                msgUid = attrs.uid;
              });
              msg.on("body", (stream) => {
                stream.on("data", (chunk) => {
                  buffer += chunk.toString("utf8");
                });
                stream.once("end", async () => {
                  try {
                    const parsed = await simpleParser(buffer);
                    let imported = 0;
                    
                    // Determine report type from email subject (more reliable than UID map)
                    const subject = parsed.subject || "";
                    const isPosReport = subject.toLowerCase().includes("pos_sales_attribution") || subject.toLowerCase().includes("pos sales attribution");
                    const reportType: "online" | "pos" = isPosReport ? "pos" : "online";
                    console.log(`[EmailSync] Email subject: "${subject}" → type: ${reportType}`);

                    if (parsed.attachments && parsed.attachments.length > 0) {
                      console.log(`[EmailSync] Processing ${reportType} email with ${parsed.attachments.length} attachments`);
                      
                      for (const attachment of parsed.attachments) {
                        const filename = attachment.filename || "";
                        if (filename.endsWith(".csv") || filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
                          console.log(`[EmailSync] Processing attachment: ${filename} (type: ${reportType})`);
                          const content = attachment.content;
                          imported += await processAttachment(filename, content, reportType);
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
            
            // Update last sync time
            lastSyncTime = new Date();
            lastSyncResult = { success: true, imported: totalImported, emailsProcessed };
            
            resolve({ success: true, imported: totalImported, emailsProcessed });
          });
        }
        
        // Start both searches
        subjectFilters.forEach(f => doSearch(f));
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
async function processAttachment(filename: string, content: Buffer, reportType: "online" | "pos" = "online"): Promise<number> {
  try {
    if (filename.endsWith(".xlsx") || filename.endsWith(".xls")) {
      if (reportType === "pos") {
        return await importPosExcelData(content);
      }
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
// Column A(0) = Order Date, Column B(1) = Order Name, Column C(2) = Sales Channel
// Column D(3) = Customer Created At, Column E(4) = Customer Tags (WVReferredByStaff)
// Column F(5) = Payment Method, Column G(6) = Email Marketing, Column H(7) = SMS Marketing
// Column I(8) = Order ID, Column J(9) = ShipAny Tracking, Column K(10) = ShipAny Order_id
// Column L(11) = ShipAny Way_bill, Column M(12) = Gross Sales, Column N(13) = Net Sales
// Column O(14) = Total Sales, Column P(15) = Refund Adjustment Amount
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
  
  // Use header-based column detection (same approach as manual upload) for robustness
  const headerRow = rows[0];
  console.log(`[EmailSync] Header row: ${JSON.stringify(headerRow)}`);
  
  // Normalize headers to lowercase for matching
  const headers = headerRow.map((h: any) => String(h || '').toLowerCase().replace(/[\s_-]/g, ''));
  
  // Detect column indices dynamically
  const dateIdx = headers.findIndex((h: string) => h.includes('orderdate') || h === 'date');
  const orderIdx = headers.findIndex((h: string) => h.includes('ordername') || h.includes('orderid') || h === 'order');
  const channelIdx = headers.findIndex((h: string) => h.includes('channel') || h.includes('saleschannel'));
  const customerTagsIdx = headers.findIndex((h: string) => h.includes('customertag'));
  // Detect Email Marketing and SMS Marketing columns
  const emailMarketingIdx = headers.findIndex((h: string) => h.includes('emailmark') || h === 'emailmarketting' || h === 'emailmarketing');
  const smsMarketingIdx = headers.findIndex((h: string) => h.includes('smsmark') || h === 'smsmarketing');
  // Detect Customer Email column
  const customerEmailIdx = headers.findIndex((h: string) => h === 'email' || h === 'customeremail');
  // Detect Actual Order Date column (Column M in new report format)
  const actualOrderDateIdx = headers.findIndex((h: string) => h === 'actualorderdate' || h.includes('actualorder'));
  // Detect Whatsapp Marketing column
  const whatsappMarketingIdx = headers.findIndex((h: string) => h.includes('whatsapp') || h === 'whatsappmarketing' || h === 'whatsappmkt');
  // Detect Shipping Price column (Column R)
  const shippingPriceIdx = headers.findIndex((h: string) => h === 'shippingprice' || h === 'shipping' || h.includes('shippingprice') || h.includes('shipping price'));
  // Detect Total Sales column (Column P)
  const totalSalesIdx = headers.findIndex((h: string) => h === 'totalsales' || h === 'total sales' || h.includes('totalsales') || h.includes('total sales'));
  // Prioritize exact "netsales" match to avoid matching "Gross Sales" or "Total Sales"
  let netSalesIdx = headers.findIndex((h: string) => h === 'netsales');
  if (netSalesIdx === -1) netSalesIdx = headers.findIndex((h: string) => h.includes('netsales'));
  if (netSalesIdx === -1) netSalesIdx = headers.findIndex((h: string) => h === 'net' || h === 'amount');
  
  console.log(`[EmailSync] Detected columns - date:${dateIdx}, order:${orderIdx}, channel:${channelIdx}, tags:${customerTagsIdx}, emailMkt:${emailMarketingIdx}, smsMkt:${smsMarketingIdx}, netSales:${netSalesIdx}`);
  console.log(`[EmailSync] Net Sales header: ${netSalesIdx >= 0 ? headerRow[netSalesIdx] : 'NOT FOUND'}`);
  
  if (netSalesIdx === -1) {
    console.error("[EmailSync] Could not find Net Sales column! Headers: " + JSON.stringify(headerRow));
    return 0;
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
    
    const orderDateRaw = dateIdx >= 0 ? row[dateIdx] : row[0];
    const orderName = orderIdx >= 0 ? (row[orderIdx] ? String(row[orderIdx]).trim() : null) : (row[1] ? String(row[1]).trim() : null);
    const salesChannel = channelIdx >= 0 ? (row[channelIdx] ? String(row[channelIdx]).trim() : null) : (row[2] ? String(row[2]).trim() : null);
    const customerTags = customerTagsIdx >= 0 ? (row[customerTagsIdx] ? String(row[customerTagsIdx]).trim() : "") : "";
    const emailMarketing = emailMarketingIdx >= 0 ? (row[emailMarketingIdx] ? String(row[emailMarketingIdx]).trim() : null) : null;
    const smsMarketing = smsMarketingIdx >= 0 ? (row[smsMarketingIdx] ? String(row[smsMarketingIdx]).trim() : null) : null;
    const customerEmail = customerEmailIdx >= 0 ? (row[customerEmailIdx] ? String(row[customerEmailIdx]).trim() : null) : null;
    const whatsappMarketing = whatsappMarketingIdx >= 0 ? (row[whatsappMarketingIdx] ? String(row[whatsappMarketingIdx]).trim() : null) : null;
    // Parse Shipping Price
    let shippingPrice: number | null = null;
    if (shippingPriceIdx >= 0 && row[shippingPriceIdx] != null) {
      if (typeof row[shippingPriceIdx] === 'number') {
        shippingPrice = row[shippingPriceIdx];
      } else {
        const rawSP = String(row[shippingPriceIdx]).replace(/[^0-9.-]/g, '');
        if (rawSP !== '') { const parsed = parseFloat(rawSP); shippingPrice = isNaN(parsed) ? null : parsed; }
      }
    }
    // Parse Total Sales
    let totalSales: number | null = null;
    if (totalSalesIdx >= 0 && row[totalSalesIdx] != null) {
      if (typeof row[totalSalesIdx] === 'number') {
        totalSales = row[totalSalesIdx];
      } else {
        const rawTS = String(row[totalSalesIdx]).replace(/[^0-9.-]/g, '');
        if (rawTS !== '') { const parsed = parseFloat(rawTS); totalSales = isNaN(parsed) ? null : parsed; }
      }
    }
    
    // Parse Actual Order Date
    let actualOrderDate: string | null = null;
    if (actualOrderDateIdx >= 0 && row[actualOrderDateIdx]) {
      const rawAOD = row[actualOrderDateIdx];
      if (typeof rawAOD === 'number') {
        // Excel serial date number
        const excelEpoch = new Date(1899, 11, 30);
        const aodDate = new Date(excelEpoch.getTime() + rawAOD * 24 * 60 * 60 * 1000);
        actualOrderDate = aodDate.toISOString().split('T')[0];
      } else {
        const rawStr = String(rawAOD).trim();
        if (rawStr.match(/^\d{4}-\d{2}-\d{2}/)) {
          actualOrderDate = rawStr.substring(0, 10);
        } else if (rawStr.match(/^\d{2}-\d{2}-\d{4}$/)) {
          const [mm, dd, yyyy] = rawStr.split('-');
          actualOrderDate = yyyy + '-' + mm + '-' + dd;
        } else if (rawStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
          const parts = rawStr.split('/');
          const mm = parts[0].padStart(2, '0');
          const dd = parts[1].padStart(2, '0');
          let yyyy = parts[2];
          if (yyyy.length === 2) yyyy = '20' + yyyy;
          actualOrderDate = yyyy + '-' + mm + '-' + dd;
        } else {
          const parsed = new Date(rawStr);
          if (!isNaN(parsed.getTime())) {
            actualOrderDate = parsed.toISOString().split('T')[0];
          }
        }
      }
    }
    const netSalesRaw = row[netSalesIdx]; // Dynamically detected Net Sales column
    
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
    
    if (isNaN(netSales)) continue;
    // Note: We no longer skip netSales === 0, as these are valid orders (e.g., exchanges, gift orders)
    
    // Skip invalid rows (Grand Total, empty order names, etc.)
    if (!orderName || orderName.toLowerCase().includes("grand total") || orderName.toLowerCase().includes("total")) {
      console.log(`[EmailSync] Skipping invalid row: ${orderName}`);
      continue;
    }
    
    // Skip Point of Sale orders from Online Sales import
    // The Shopify "Online Orders by customer" report may include POS orders
    if (salesChannel && salesChannel.toLowerCase().includes("point of sale")) {
      console.log(`[EmailSync] Skipping POS order from Online Sales import: ${orderName} (channel: ${salesChannel})`);
      continue;
    }
    
    // Try to find user ID and staff name from staff mapping using WVReferredByStaff
    let userId = 1; // Default to admin user
    let staffName: string | null = null;
    if (customerTags) {
      const staffIdMatch = customerTags.match(/WVReferredByStaff_(\d+)/);
      if (staffIdMatch) {
        const matchedStaffId = staffIdMatch[1];
        if (staffMapping[matchedStaffId]) {
          userId = staffMapping[matchedStaffId];
        }
        // Also look up staff name from users table for the staffName column
        try {
          const [staffRows] = await db.execute("SELECT name FROM users WHERE staffId = ? LIMIT 1", [matchedStaffId]);
          if ((staffRows as any[]).length > 0) {
            staffName = (staffRows as any[])[0].name + ' ' + matchedStaffId;
          } else {
            staffName = 'Unknown Staff ' + matchedStaffId;
          }
        } catch (e) {
          staffName = 'Unknown Staff ' + matchedStaffId;
        }
      }
    }
    
    // Check if order already exists to avoid duplicates (from manual upload or previous email sync)
    try {
      const existingOrder = await db.execute(
        "SELECT id FROM sales WHERE orderNo = ? LIMIT 1",
        [orderName]
      );
      // Check if any rows were returned - handle both array and object formats
      const rows = Array.isArray(existingOrder) ? existingOrder[0] : existingOrder;
      const hasExisting = rows && (Array.isArray(rows) ? rows.length > 0 : Object.keys(rows).length > 0);
      if (hasExisting) {
        console.log(`[EmailSync] Skipping duplicate order: ${orderName} (already exists in database)`);
        continue;
      }
    } catch (dupCheckError: any) {
      console.log(`[EmailSync] Duplicate check error for ${orderName}: ${dupCheckError.message}`);
      // Continue anyway - better to potentially have a duplicate than miss data
    }
    
    try {
      console.log(`[EmailSync] Inserting: order=${orderName}, channel=${salesChannel}, amount=${netSales}, date=${orderDate}`);
      // Use raw SQL to match production database schema (orderNo, not orderReference)
      const saleDate = orderDate ? orderDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      await db.execute(
        `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, staffId, staffName, saleType, emailMarketing, smsMarketing, customerEmail, actualOrderDate, whatsappMarketing, shippingPrice, totalSales) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleDate, orderName || null, salesChannel || "Online Store", netSales, userId > 1 ? userId.toString() : null, staffName, "online", emailMarketing, smsMarketing, customerEmail, actualOrderDate || null, whatsappMarketing, shippingPrice, totalSales]
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

// Import POS Excel data from POS_Sales_Attribution report
// Column A: Actual Order Date, Column B: Order Name, Column C: Payment Gateways
// Column D: Staff_Name, Column E: Sales Channel, Column F: Location Name
// Column G: Order Date, Column H: Net Quantity, Column I: Purchase of GC
// Column J: Net Sales, Column K: Returns, Column L: Total Sales
// Column M: Amount paid with GC, Column N: Net sales exclude GC Payment
async function importPosExcelData(content: Buffer): Promise<number> {
  const workbook = XLSX.read(content, { type: "buffer" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
  
  if (rows.length < 2) {
    console.log("[EmailSync-POS] Excel file has no data rows");
    return 0;
  }
  
  let imported = 0;
  let updated = 0;
  let inserted = 0;
  
  // Header-based column detection using original report column names
  const headerRow = rows[0];
  console.log(`[EmailSync-POS] Header row: ${JSON.stringify(headerRow)}`);
  const headers = headerRow.map((h: any) => String(h || '').toLowerCase().replace(/[\s_-]/g, ''));
  
  // Map columns by their original names in the POS_Sales_Attribution report
  const actualOrderDateIdx = headers.findIndex((h: string) => h === 'actualorderdate' || h.includes('actualorderdate'));
  const orderNameIdx = headers.findIndex((h: string) => h === 'ordername' || h.includes('ordername'));
  const paymentGatewaysIdx = headers.findIndex((h: string) => h === 'paymentgateways' || h.includes('paymentgateway'));
  const staffNameIdx = headers.findIndex((h: string) => h === 'staffname' || h.includes('staffname'));
  const locationNameIdx = headers.findIndex((h: string) => h === 'locationname' || h.includes('locationname'));
  const orderDateIdx = headers.findIndex((h: string) => h === 'orderdate' || h.includes('orderdate'));
  const totalSalesIdx = headers.findIndex((h: string) => h === 'totalsales' || h.includes('totalsales'));
  // "Net sales exclude GC Payment" → this is what we display as net sales for POS
  const netSalesExclGCIdx = headers.findIndex((h: string) => h.includes('netsalesexcludegcpayment') || h.includes('netsalesexcludegc') || h.includes('excludegc'));
  // Fallback to regular "Net Sales" column if exclude GC column not found
  let netSalesIdx = netSalesExclGCIdx;
  if (netSalesIdx === -1) {
    netSalesIdx = headers.findIndex((h: string) => h === 'netsales');
    if (netSalesIdx === -1) netSalesIdx = headers.findIndex((h: string) => h.includes('netsales'));
  }
  
  console.log(`[EmailSync-POS] Detected columns - actualOrderDate:${actualOrderDateIdx}, orderName:${orderNameIdx}, paymentGateways:${paymentGatewaysIdx}, staffName:${staffNameIdx}, locationName:${locationNameIdx}, orderDate:${orderDateIdx}, totalSales:${totalSalesIdx}, netSales:${netSalesIdx}`);
  
  if (netSalesIdx === -1) {
    console.error("[EmailSync-POS] Could not find Net Sales column! Headers: " + JSON.stringify(headerRow));
    return 0;
  }
  
  // Helper: parse date from Excel (serial number or string)
  function parseExcelDate(raw: any): string | null {
    if (!raw) return null;
    if (typeof raw === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const d = new Date(excelEpoch.getTime() + raw * 24 * 60 * 60 * 1000);
      return d.toISOString().split('T')[0];
    }
    const s = String(raw).trim();
    if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.substring(0, 10);
    if (s.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [mm, dd, yyyy] = s.split('-');
      return yyyy + '-' + mm + '-' + dd;
    }
    if (s.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
      const parts = s.split('/');
      const mm = parts[0].padStart(2, '0');
      const dd = parts[1].padStart(2, '0');
      let yyyy = parts[2];
      if (yyyy.length === 2) yyyy = '20' + yyyy;
      return yyyy + '-' + mm + '-' + dd;
    }
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return null;
  }
  
  // Helper: parse number
  function parseNum(raw: any): number | null {
    if (raw == null) return null;
    if (typeof raw === 'number') return raw;
    const cleaned = String(raw).replace(/[^0-9.-]/g, '');
    if (cleaned === '') return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    
    if (i <= 3) {
      console.log(`[EmailSync-POS] Row ${i}: ${JSON.stringify(row)}`);
    }
    
    // Get Order Name
    const orderName = orderNameIdx >= 0 ? (row[orderNameIdx] ? String(row[orderNameIdx]).trim() : null) : null;
    
    // Skip Grand Total / summary rows
    if (!orderName || orderName.toLowerCase().includes('grand total') || orderName.toLowerCase() === 'total') {
      console.log(`[EmailSync-POS] Skipping invalid row: ${orderName}`);
      continue;
    }
    
    // Parse fields using original column names
    const actualOrderDate = actualOrderDateIdx >= 0 ? parseExcelDate(row[actualOrderDateIdx]) : null;
    const paymentGateway = paymentGatewaysIdx >= 0 ? (row[paymentGatewaysIdx] ? String(row[paymentGatewaysIdx]).trim() : null) : null;
    const staffName = staffNameIdx >= 0 ? (row[staffNameIdx] ? String(row[staffNameIdx]).trim() : null) : null;
    const locationName = locationNameIdx >= 0 ? (row[locationNameIdx] ? String(row[locationNameIdx]).trim() : null) : null;
    const orderDate = orderDateIdx >= 0 ? parseExcelDate(row[orderDateIdx]) : null;
    const totalSales = totalSalesIdx >= 0 ? parseNum(row[totalSalesIdx]) : null;
    const netSalesRaw = parseNum(row[netSalesIdx]);
    const netSales = netSalesRaw !== null ? netSalesRaw : 0;
    
    if (isNaN(netSales)) continue;
    
    // Upsert: update existing POS records with richer data, or insert new ones
    try {
      const existingOrder = await db.execute(
        "SELECT id FROM sales WHERE orderNo = ? AND saleType = 'pos' LIMIT 1",
        [orderName]
      );
      const existingRows = Array.isArray(existingOrder) ? existingOrder[0] : existingOrder;
      const hasExisting = existingRows && (Array.isArray(existingRows) ? existingRows.length > 0 : Object.keys(existingRows).length > 0);
      if (hasExisting) {
        // Update existing record with richer data from email report
        const existingId = (existingRows as any[])[0].id;
        console.log(`[EmailSync-POS] Updating existing POS order: ${orderName} (id: ${existingId})`);
        await db.execute(
          `UPDATE sales SET orderDate = COALESCE(?, orderDate), salesChannel = COALESCE(?, salesChannel), netSales = ?, staffName = COALESCE(?, staffName), paymentGateway = COALESCE(?, paymentGateway), actualOrderDate = COALESCE(?, actualOrderDate), totalSales = COALESCE(?, totalSales) WHERE id = ?`,
          [orderDate || null, locationName || null, netSales, staffName, paymentGateway, actualOrderDate || null, totalSales, existingId]
        );
        imported++;
        updated++;
        continue;
      }
    } catch (dupErr: any) {
      console.log(`[EmailSync-POS] Duplicate check/update error for ${orderName}: ${dupErr.message}`);
    }
    
    try {
      console.log(`[EmailSync-POS] Inserting new: order=${orderName}, location=${locationName}, payment=${paymentGateway}, staff=${staffName}, netSales=${netSales}`);
      await db.execute(
        `INSERT INTO sales (orderDate, orderNo, salesChannel, netSales, saleType, staffName, paymentGateway, actualOrderDate, totalSales) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderDate || null, orderName || null, locationName || null, netSales, 'pos', staffName, paymentGateway, actualOrderDate || null, totalSales]
      );
      imported++;
      inserted++;
      console.log(`[EmailSync-POS] NEW: ${orderName} - ${locationName} - $${netSales}`);
    } catch (error: any) {
      console.error(`[EmailSync-POS] Error inserting ${orderName}:`, error.message || error);
    }
  }
  
  console.log(`[EmailSync-POS] POS Excel import complete: ${imported} total (${inserted} new, ${updated} updated) from ${rows.length - 1} data rows`);
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

    if (isNaN(netSales)) continue;
    // Note: We no longer skip netSales === 0, as these are valid orders (e.g., exchanges, gift orders)

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

  // Run initial sync immediately (async, non-blocking)
  (async () => {
    console.log("[EmailSync] Running initial email sync...");
    try {
      const result = await fetchAndProcessEmails();
      if (result.success) {
        console.log(`[EmailSync] Initial sync complete: ${result.imported} sales from ${result.emailsProcessed} emails`);
      } else {
        console.error("[EmailSync] Initial sync failed:", result.error);
      }
    } catch (e) {
      console.error("[EmailSync] Initial sync error:", e);
    }
  })();

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
