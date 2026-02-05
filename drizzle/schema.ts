import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with sales target for performance tracking.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  monthlyTarget: decimal("monthlyTarget", { precision: 12, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Sales transactions table - stores individual sales records
 */
export const sales = mysqlTable("sales", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  productName: varchar("productName", { length: 255 }).notNull(),
  productCategory: varchar("productCategory", { length: 100 }),
  quantity: int("quantity").notNull().default(1),
  unitPrice: decimal("unitPrice", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("totalAmount", { precision: 12, scale: 2 }).notNull(),
  saleDate: timestamp("saleDate").notNull(),
  customerName: varchar("customerName", { length: 255 }),
  orderReference: varchar("orderReference", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Sale = typeof sales.$inferSelect;
export type InsertSale = typeof sales.$inferInsert;

/**
 * Report uploads table - tracks uploaded sales reports
 */
export const reportUploads = mysqlTable("reportUploads", {
  id: int("id").autoincrement().primaryKey(),
  uploadedBy: int("uploadedBy").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl"),
  recordsImported: int("recordsImported").default(0),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ReportUpload = typeof reportUploads.$inferSelect;
export type InsertReportUpload = typeof reportUploads.$inferInsert;

/**
 * Google Drive credentials table - stores OAuth tokens for Drive access
 */
export const driveCredentials = mysqlTable("driveCredentials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(), // Only one Drive connection per user/org
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  folderId: varchar("folderId", { length: 100 }), // Target folder to sync from
  folderName: varchar("folderName", { length: 255 }),
  lastSyncAt: timestamp("lastSyncAt"),
  syncEnabled: int("syncEnabled").default(1).notNull(), // 1 = enabled, 0 = disabled
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DriveCredential = typeof driveCredentials.$inferSelect;
export type InsertDriveCredential = typeof driveCredentials.$inferInsert;

/**
 * Drive sync history - tracks files that have been synced
 */
export const driveSyncHistory = mysqlTable("driveSyncHistory", {
  id: int("id").autoincrement().primaryKey(),
  credentialId: int("credentialId").notNull(),
  fileId: varchar("fileId", { length: 100 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileModifiedTime: timestamp("fileModifiedTime").notNull(),
  recordsImported: int("recordsImported").default(0),
  status: mysqlEnum("status", ["success", "failed", "skipped"]).notNull(),
  errorMessage: text("errorMessage"),
  syncedAt: timestamp("syncedAt").defaultNow().notNull(),
});

export type DriveSyncHistory = typeof driveSyncHistory.$inferSelect;
export type InsertDriveSyncHistory = typeof driveSyncHistory.$inferInsert;
