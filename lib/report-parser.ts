/**
 * Sales Report Parser
 * Parses CSV/Excel data into sales records
 */

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
}

export interface ParseResult {
  success: boolean;
  records: ParsedSaleRecord[];
  errors: string[];
  warnings: string[];
}

/**
 * Parse CSV content into sales records
 * Expected columns: Date, Salesperson, Product, Category, Quantity, Unit Price, Total, Customer, Order Ref
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
  
  const columnMap = {
    date: findColumnIndex(headers, ["date", "sale date", "saledate", "transaction date"]),
    salesperson: findColumnIndex(headers, ["salesperson", "sales person", "seller", "user", "staff", "employee"]),
    product: findColumnIndex(headers, ["product", "product name", "item", "item name"]),
    category: findColumnIndex(headers, ["category", "product category", "type"]),
    quantity: findColumnIndex(headers, ["quantity", "qty", "units"]),
    unitPrice: findColumnIndex(headers, ["unit price", "price", "unit cost"]),
    total: findColumnIndex(headers, ["total", "total amount", "amount", "subtotal"]),
    customer: findColumnIndex(headers, ["customer", "customer name", "client"]),
    orderRef: findColumnIndex(headers, ["order ref", "order reference", "order id", "reference", "invoice"]),
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

function parsePrice(value: string): string {
  // Remove currency symbols and commas
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? "0" : num.toFixed(2);
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
