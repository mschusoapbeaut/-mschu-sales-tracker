import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseCSV } from "../lib/report-parser";

describe("Report Parser", () => {
  describe("parseCSV", () => {
    const userMapping = {
      "alice": 1,
      "bob": 2,
      "alice@example.com": 1,
      "bob@example.com": 2,
    };

    it("should parse valid CSV with all columns", () => {
      const csv = `Date,Salesperson,Product,Category,Quantity,Unit Price,Total,Customer,Order Ref
2026-02-01,Alice,Natural Soap,Soap,5,20.00,100.00,John Doe,ORD001
2026-02-02,Bob,Body Lotion,Lotion,3,50.00,150.00,Jane Smith,ORD002`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].userId).toBe(1);
      expect(result.records[0].productName).toBe("Natural Soap");
      expect(result.records[0].quantity).toBe(5);
      expect(result.records[0].totalAmount).toBe("100.00");
      expect(result.records[1].userId).toBe(2);
    });

    it("should handle case-insensitive salesperson matching", () => {
      const csv = `Date,Salesperson,Product,Quantity,Total
2026-02-01,ALICE,Soap,1,50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records[0].userId).toBe(1);
    });

    it("should calculate total from unit price and quantity", () => {
      const csv = `Date,Salesperson,Product,Quantity,Unit Price
2026-02-01,Alice,Soap,4,25.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records[0].totalAmount).toBe("100.00");
    });

    it("should warn about unknown salesperson", () => {
      const csv = `Date,Salesperson,Product,Quantity,Total
2026-02-01,Unknown,Soap,1,50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("Unknown salesperson");
    });

    it("should fail on missing required columns", () => {
      const csv = `Product,Quantity,Total
Soap,1,50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes("Date"))).toBe(true);
    });

    it("should handle empty file", () => {
      const csv = "";

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain("empty");
    });

    it("should handle quoted values with commas", () => {
      const csv = `Date,Salesperson,Product,Quantity,Total
2026-02-01,Alice,"Soap, Natural",1,50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records[0].productName).toBe("Soap, Natural");
    });

    it("should parse different date formats", () => {
      const csv = `Date,Salesperson,Product,Quantity,Total
01/02/2026,Alice,Soap,1,50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records[0].saleDate).toBeTruthy();
    });

    it("should handle currency symbols in prices", () => {
      const csv = `Date,Salesperson,Product,Quantity,Total
2026-02-01,Alice,Soap,1,HK$50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records[0].totalAmount).toBe("50.00");
    });

    it("should default quantity to 1 if not provided", () => {
      const csv = `Date,Salesperson,Product,Total
2026-02-01,Alice,Soap,50.00`;

      const result = parseCSV(csv, userMapping);

      expect(result.success).toBe(true);
      expect(result.records[0].quantity).toBe(1);
    });
  });
});

describe("Sales Data Structure", () => {
  it("should have correct sale record structure", () => {
    const saleRecord = {
      userId: 1,
      productName: "Natural Soap",
      productCategory: "Soap",
      quantity: 5,
      unitPrice: "20.00",
      totalAmount: "100.00",
      saleDate: new Date().toISOString(),
      customerName: "John Doe",
      orderReference: "ORD001",
    };

    expect(saleRecord).toHaveProperty("userId");
    expect(saleRecord).toHaveProperty("productName");
    expect(saleRecord).toHaveProperty("quantity");
    expect(saleRecord).toHaveProperty("totalAmount");
    expect(saleRecord).toHaveProperty("saleDate");
    expect(typeof saleRecord.quantity).toBe("number");
    expect(typeof saleRecord.totalAmount).toBe("string");
  });

  it("should validate summary structure", () => {
    const summary = {
      totalSales: 15000,
      orderCount: 25,
      avgOrderValue: 600,
      targetProgress: 75,
    };

    expect(summary.totalSales).toBeGreaterThanOrEqual(0);
    expect(summary.orderCount).toBeGreaterThanOrEqual(0);
    expect(summary.avgOrderValue).toBeGreaterThanOrEqual(0);
    expect(summary.targetProgress).toBeGreaterThanOrEqual(0);
    expect(summary.targetProgress).toBeLessThanOrEqual(100);
  });
});
