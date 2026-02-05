/**
 * Sales Report Parser
 * Parses CSV/Excel data into sales records
 * Supports Ms. Chu's specific Excel format with WVReferredByStaff staff mapping
 */

import * as XLSX from "xlsx";

export interface ParsedSaleRecord {
  userId: number;
  productName: string;
  productCategory?: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  saleDate: string;
  customerName?: string;
  orderReference?: string;
  salesChannel?: string;
  netSales?: string;
  refundAdjustment?: string;
}

export interface ParseResult {
  success: boolean;
  records: ParsedSaleRecord[];
  errors: string[];
  warnings: string[];
}

/**
 * Staff ID to User mapping
 * Maps WVReferredByStaff IDs to user identifiers
 */
export interface StaffMapping {
  [staffId: string]: number; // staffId -> userId
}

/**
 * Parse Excel file content (as base64 or buffer) into sales records
 * Handles Ms. Chu's specific format:
 * - Column A: Order Date
 * - Column B: Order Name
 * - Column C: Sales Channel
 * - Column E: Customer Tags (contains WVReferredByStaff_XXXXX)
 * - Column H: Net Sales
 * - Column I: Total Sales
 * - Column J: Refund Adjustment
 */
export function parseExcel(
  data: string | ArrayBuffer,
  staffMapping: StaffMapping,
  isBase64: boolean = false
): ParseResult {
  const records: ParsedSaleRecord[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Parse Excel file
    const workbook = XLSX.read(data, { 
      type: isBase64 ? "base64" : "buffer",
      cellDates: true 
    });
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON with header row
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    if (jsonData.length < 2) {
      return { success: false, records: [], errors: ["File is empty or has no data rows"], warnings: [] };
    }

    // Get headers (first row)
    const headers = jsonData[0].map((h: any) => String(h || "").toLowerCase().trim());
    
    // Find column indices based on Ms. Chu's format
    const columnMap = {
      orderDate: findColumnIndex(headers, ["order date", "date"]),
      orderName: findColumnIndex(headers, ["order name", "order"]),
      salesChannel: findColumnIndex(headers, ["sales channel", "channel"]),
      customerTags: findColumnIndex(headers, ["customer tags", "tags"]),
      netSales: findColumnIndex(headers, ["net sales"]),
      totalSales: findColumnIndex(headers, ["total sales", "total"]),
      refundAdj: findColumnIndex(headers, ["refund adjustment amount", "refund adjustment", "refund"]),
      grossSales: findColumnIndex(headers, ["gross sales"]),
    };

    // Validate we have the essential columns
    if (columnMap.orderDate === -1) {
      errors.push("Missing required column: Order Date");
    }
    if (columnMap.customerTags === -1) {
      errors.push("Missing required column: Customer Tags (for staff identification)");
    }
    if (columnMap.totalSales === -1 && columnMap.netSales === -1) {
      errors.push("Missing required columns: Need either Total Sales or Net Sales");
    }

    if (errors.length > 0) {
      return { success: false, records: [], errors, warnings };
    }

    // Extract WVReferredByStaff pattern
    const staffPattern = /WVReferredByStaff_(\d+)/;

    // Parse data rows
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;

      try {
        // Get customer tags and extract staff ID
        const customerTags = String(row[columnMap.customerTags] || "");
        const staffMatch = customerTags.match(staffPattern);
        
        if (!staffMatch) {
          // No staff attribution - skip or assign to default
          warnings.push(`Row ${i + 1}: No WVReferredByStaff found - order not attributed to any staff`);
          continue;
        }

        const staffId = staffMatch[1];
        const userId = staffMapping[staffId];

        if (!userId) {
          warnings.push(`Row ${i + 1}: Unknown staff ID "${staffId}" - skipped`);
          continue;
        }

        // Parse sales amounts
        const totalSales = parsePrice(row[columnMap.totalSales]);
        const netSales = columnMap.netSales !== -1 ? parsePrice(row[columnMap.netSales]) : totalSales;
        const refundAdj = columnMap.refundAdj !== -1 ? parsePrice(row[columnMap.refundAdj]) : "0";

        // Skip if no sales amount
        if (totalSales === "0.00" && netSales === "0.00") {
          warnings.push(`Row ${i + 1}: Zero sales amount - skipped`);
          continue;
        }

        // Parse order date
        let orderDate: string;
        const dateValue = row[columnMap.orderDate];
        if (dateValue instanceof Date) {
          orderDate = dateValue.toISOString();
        } else {
          orderDate = parseDate(String(dateValue || ""));
        }

        const record: ParsedSaleRecord = {
          userId,
          productName: "Online Order", // Generic product name for order-level data
          quantity: 1,
          unitPrice: netSales, // Use Net Sales as the primary amount
          totalAmount: netSales, // Use Net Sales as the primary amount
          saleDate: orderDate,
          orderReference: String(row[columnMap.orderName] || "").replace(/\.0$/, ""),
          salesChannel: columnMap.salesChannel !== -1 ? String(row[columnMap.salesChannel] || "") : undefined,
          netSales,
          refundAdjustment: refundAdj,
        };

        records.push(record);
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "Parse error"}`);
      }
    }

    return {
      success: records.length > 0,
      records,
      errors,
      warnings,
    };
  } catch (err) {
    return {
      success: false,
      records: [],
      errors: [`Failed to parse Excel file: ${err instanceof Error ? err.message : "Unknown error"}`],
      warnings: [],
    };
  }
}

/**
 * Parse CSV content into sales records
 * Supports both generic CSV format and Ms. Chu's specific format
 */
export function parseCSV(content: string, userMapping: Record<string, number>): ParseResult {
  const lines = content.trim().split(/\r?\n/);
  const records: ParsedSaleRecord[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (lines.length < 2) {
    return { success: false, records: [], errors: ["File is empty or has no data rows"], warnings: [] };
  }

  // Parse header row to find column indices
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  
  // Check if this is Ms. Chu's format (has Customer Tags column)
  const customerTagsIndex = findColumnIndex(headers, ["customer tags", "tags"]);
  
  if (customerTagsIndex !== -1) {
    // Use Ms. Chu's format parsing
    return parseCSVMsChuFormat(lines, headers, userMapping);
  }

  // Generic CSV format
  const columnMap = {
    date: findColumnIndex(headers, ["date", "sale date", "saledate", "transaction date", "order date"]),
    salesperson: findColumnIndex(headers, ["salesperson", "sales person", "seller", "user", "staff", "employee"]),
    product: findColumnIndex(headers, ["product", "product name", "item", "item name"]),
    category: findColumnIndex(headers, ["category", "product category", "type"]),
    quantity: findColumnIndex(headers, ["quantity", "qty", "units"]),
    unitPrice: findColumnIndex(headers, ["unit price", "price", "unit cost"]),
    total: findColumnIndex(headers, ["total", "total amount", "amount", "subtotal", "total sales"]),
    customer: findColumnIndex(headers, ["customer", "customer name", "client"]),
    orderRef: findColumnIndex(headers, ["order ref", "order reference", "order id", "reference", "invoice", "order name"]),
  };

  // Validate required columns
  if (columnMap.date === -1) {
    errors.push("Missing required column: Date");
  }
  if (columnMap.salesperson === -1) {
    errors.push("Missing required column: Salesperson");
  }
  if (columnMap.product === -1) {
    errors.push("Missing required column: Product");
  }
  if (columnMap.total === -1 && (columnMap.unitPrice === -1 || columnMap.quantity === -1)) {
    errors.push("Missing required columns: Need either Total or both Unit Price and Quantity");
  }

  if (errors.length > 0) {
    return { success: false, records: [], errors, warnings };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const values = parseCSVLine(line);
      
      const salesperson = getValue(values, columnMap.salesperson);
      const userId = userMapping[salesperson.toLowerCase()];
      
      if (!userId) {
        warnings.push(`Row ${i + 1}: Unknown salesperson "${salesperson}" - skipped`);
        continue;
      }

      const quantity = parseInt(getValue(values, columnMap.quantity) || "1") || 1;
      const unitPrice = parsePrice(getValue(values, columnMap.unitPrice) || "0");
      let totalAmount = columnMap.total !== -1 ? parsePrice(getValue(values, columnMap.total) || "0") : "0";
      
      // Calculate total if not provided or if total column doesn't exist
      if ((totalAmount === "0" || totalAmount === "0.00") && unitPrice !== "0" && unitPrice !== "0.00") {
        totalAmount = (parseFloat(unitPrice) * quantity).toFixed(2);
      }

      const record: ParsedSaleRecord = {
        userId,
        productName: getValue(values, columnMap.product),
        productCategory: getValue(values, columnMap.category) || undefined,
        quantity,
        unitPrice,
        totalAmount,
        saleDate: parseDate(getValue(values, columnMap.date)),
        customerName: getValue(values, columnMap.customer) || undefined,
        orderReference: getValue(values, columnMap.orderRef) || undefined,
      };

      records.push(record);
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "Parse error"}`);
    }
  }

  return {
    success: records.length > 0,
    records,
    errors,
    warnings,
  };
}

/**
 * Parse CSV in Ms. Chu's specific format
 */
function parseCSVMsChuFormat(
  lines: string[],
  headers: string[],
  userMapping: Record<string, number>
): ParseResult {
  const records: ParsedSaleRecord[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const columnMap = {
    orderDate: findColumnIndex(headers, ["order date", "date"]),
    orderName: findColumnIndex(headers, ["order name", "order"]),
    salesChannel: findColumnIndex(headers, ["sales channel", "channel"]),
    customerTags: findColumnIndex(headers, ["customer tags", "tags"]),
    netSales: findColumnIndex(headers, ["net sales"]),
    totalSales: findColumnIndex(headers, ["total sales", "total"]),
    refundAdj: findColumnIndex(headers, ["refund adjustment amount", "refund adjustment", "refund"]),
  };

  if (columnMap.orderDate === -1) {
    errors.push("Missing required column: Order Date");
    return { success: false, records: [], errors, warnings };
  }

  const staffPattern = /WVReferredByStaff_(\d+)/;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const values = parseCSVLine(line);
      
      const customerTags = getValue(values, columnMap.customerTags);
      const staffMatch = customerTags.match(staffPattern);
      
      if (!staffMatch) {
        warnings.push(`Row ${i + 1}: No WVReferredByStaff found - order not attributed`);
        continue;
      }

      const staffId = staffMatch[1];
      const userId = userMapping[staffId];

      if (!userId) {
        warnings.push(`Row ${i + 1}: Unknown staff ID "${staffId}" - skipped`);
        continue;
      }

      const totalSales = parsePrice(getValue(values, columnMap.totalSales));
      const netSales = columnMap.netSales !== -1 ? parsePrice(getValue(values, columnMap.netSales)) : totalSales;

      if (totalSales === "0.00" && netSales === "0.00") {
        warnings.push(`Row ${i + 1}: Zero sales amount - skipped`);
        continue;
      }

      const record: ParsedSaleRecord = {
        userId,
        productName: "Online Order",
        quantity: 1,
        unitPrice: totalSales,
        totalAmount: totalSales,
        saleDate: parseDate(getValue(values, columnMap.orderDate)),
        orderReference: getValue(values, columnMap.orderName),
        salesChannel: getValue(values, columnMap.salesChannel) || undefined,
        netSales,
      };

      records.push(record);
    } catch (err) {
      errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : "Parse error"}`);
    }
  }

  return {
    success: records.length > 0,
    records,
    errors,
    warnings,
  };
}

// Helper functions

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

function findColumnIndex(headers: string[], possibleNames: string[]): number {
  for (const name of possibleNames) {
    const index = headers.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

function getValue(values: string[], index: number): string {
  if (index === -1 || index >= values.length) return "";
  return values[index].trim();
}

function parsePrice(value: any): string {
  if (value === null || value === undefined) return "0.00";
  // Remove currency symbols and commas
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? "0.00" : num.toFixed(2);
}

function parseDate(value: string): string {
  // Try to parse various date formats
  const date = new Date(value);
  
  if (isNaN(date.getTime())) {
    // Try DD/MM/YYYY format
    const parts = value.split(/[\/\-\.]/);
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const parsed = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    throw new Error(`Invalid date format: ${value}`);
  }
  
  return date.toISOString();
}

/**
 * Extract unique staff IDs from Excel file for mapping setup
 */
export function extractStaffIds(data: string | ArrayBuffer, isBase64: boolean = false): string[] {
  try {
    const workbook = XLSX.read(data, { type: isBase64 ? "base64" : "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    const headers = jsonData[0].map((h: any) => String(h || "").toLowerCase().trim());
    const customerTagsIndex = findColumnIndex(headers, ["customer tags", "tags"]);
    
    if (customerTagsIndex === -1) return [];
    
    const staffIds = new Set<string>();
    const staffPattern = /WVReferredByStaff_(\d+)/g;
    
    for (let i = 1; i < jsonData.length; i++) {
      const tags = String(jsonData[i][customerTagsIndex] || "");
      let match;
      while ((match = staffPattern.exec(tags)) !== null) {
        staffIds.add(match[1]);
      }
    }
    
    return Array.from(staffIds).sort();
  } catch {
    return [];
  }
}
