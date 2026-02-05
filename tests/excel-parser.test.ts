import { describe, it, expect } from "vitest";
import { parseExcel, extractStaffIds, parseCSV, StaffMapping } from "../lib/report-parser";
import * as XLSX from "xlsx";

describe("Excel Report Parser", () => {
  // Helper to create a mock Excel file as base64
  function createMockExcel(data: any[][]): string {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    return XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
  }

  describe("parseExcel", () => {
    it("should parse Excel file with WVReferredByStaff tags", () => {
      const data = [
        ["Order Date", "Order Name", "Sales Channel", "Customer Created At", "Customer Tags", "Payment Method", "Gross Sales", "Net Sales", "Total Sales", "Refund Adjustment Amount"],
        ["2026-01-15", "72500", "Online Store", "2025-12-01", "WVReferredByStaff_78319091759, WVTier_Gold", "VISA", 500, 450, 500, 0],
        ["2026-01-16", "72501", "Online Store", "2025-12-02", "WVReferredByStaff_78319550511, WVTier_Silver", "MASTERCARD", 300, 270, 300, 0],
      ];

      const staffMapping: StaffMapping = {
        "78319091759": 1,
        "78319550511": 2,
      };

      const base64 = createMockExcel(data);
      const result = parseExcel(base64, staffMapping, true);

      expect(result.success).toBe(true);
      expect(result.records.length).toBe(2);
      expect(result.records[0].userId).toBe(1);
      expect(result.records[0].totalAmount).toBe("500.00");
      expect(result.records[0].orderReference).toBe("72500");
      expect(result.records[1].userId).toBe(2);
      expect(result.records[1].totalAmount).toBe("300.00");
    });

    it("should skip rows without WVReferredByStaff tag", () => {
      const data = [
        ["Order Date", "Order Name", "Sales Channel", "Customer Created At", "Customer Tags", "Payment Method", "Gross Sales", "Net Sales", "Total Sales", "Refund Adjustment Amount"],
        ["2026-01-15", "72500", "Online Store", "2025-12-01", "WVTier_Gold, Login with Shop", "VISA", 500, 450, 500, 0],
      ];

      const staffMapping: StaffMapping = {};
      const base64 = createMockExcel(data);
      const result = parseExcel(base64, staffMapping, true);

      expect(result.success).toBe(false);
      expect(result.records.length).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("No WVReferredByStaff found");
    });

    it("should warn about unmapped staff IDs", () => {
      const data = [
        ["Order Date", "Order Name", "Sales Channel", "Customer Created At", "Customer Tags", "Payment Method", "Gross Sales", "Net Sales", "Total Sales", "Refund Adjustment Amount"],
        ["2026-01-15", "72500", "Online Store", "2025-12-01", "WVReferredByStaff_99999999999, WVTier_Gold", "VISA", 500, 450, 500, 0],
      ];

      const staffMapping: StaffMapping = {};
      const base64 = createMockExcel(data);
      const result = parseExcel(base64, staffMapping, true);

      expect(result.success).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("Unknown staff ID");
    });

    it("should skip rows with zero sales amount", () => {
      const data = [
        ["Order Date", "Order Name", "Sales Channel", "Customer Created At", "Customer Tags", "Payment Method", "Gross Sales", "Net Sales", "Total Sales", "Refund Adjustment Amount"],
        ["2026-01-15", "72500", "Online Store", "2025-12-01", "WVReferredByStaff_78319091759", "VISA", 0, 0, 0, 0],
      ];

      const staffMapping: StaffMapping = { "78319091759": 1 };
      const base64 = createMockExcel(data);
      const result = parseExcel(base64, staffMapping, true);

      expect(result.success).toBe(false);
      expect(result.warnings.some(w => w.includes("Zero sales amount"))).toBe(true);
    });
  });

  describe("extractStaffIds", () => {
    it("should extract unique staff IDs from Excel file", () => {
      const data = [
        ["Order Date", "Order Name", "Sales Channel", "Customer Created At", "Customer Tags"],
        ["2026-01-15", "72500", "Online Store", "2025-12-01", "WVReferredByStaff_78319091759, WVTier_Gold"],
        ["2026-01-16", "72501", "Online Store", "2025-12-02", "WVReferredByStaff_78319550511, WVTier_Silver"],
        ["2026-01-17", "72502", "Online Store", "2025-12-03", "WVReferredByStaff_78319091759, WVTier_Gold"],
      ];

      const base64 = createMockExcel(data);
      const staffIds = extractStaffIds(base64, true);

      expect(staffIds.length).toBe(2);
      expect(staffIds).toContain("78319091759");
      expect(staffIds).toContain("78319550511");
    });

    it("should return empty array for file without customer tags column", () => {
      const data = [
        ["Order Date", "Order Name", "Sales Channel"],
        ["2026-01-15", "72500", "Online Store"],
      ];

      const base64 = createMockExcel(data);
      const staffIds = extractStaffIds(base64, true);

      expect(staffIds.length).toBe(0);
    });
  });

  describe("parseCSV with Ms. Chu format", () => {
    it("should parse CSV with Customer Tags column using staff ID mapping", () => {
      const csvContent = `Order Date,Order Name,Sales Channel,Customer Created At,Customer Tags,Payment Method,Gross Sales,Net Sales,Total Sales,Refund Adjustment Amount
2026-01-15,72500,Online Store,2025-12-01,"WVReferredByStaff_78319091759, WVTier_Gold",VISA,500,450,500,0`;

      const userMapping: Record<string, number> = {
        "78319091759": 1,
      };

      const result = parseCSV(csvContent, userMapping);

      expect(result.success).toBe(true);
      expect(result.records.length).toBe(1);
      expect(result.records[0].userId).toBe(1);
      expect(result.records[0].totalAmount).toBe("500.00");
    });
  });
});
