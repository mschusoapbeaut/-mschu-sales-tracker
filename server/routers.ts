import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as GoogleDrive from "./google-drive";
import * as DriveSync from "./drive-sync";
import { parseExcel, extractStaffIds } from "../lib/report-parser";

// Helper to get date ranges
function getDateRange(period: "week" | "month" | "year") {
  const now = new Date();
  const start = new Date();
  
  switch (period) {
    case "week":
      start.setDate(now.getDate() - 7);
      break;
    case "month":
      start.setMonth(now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "year":
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
  }
  
  return { startDate: start, endDate: now };
}

export const appRouter = router({
  system: systemRouter,
  
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // Sales endpoints
  sales: router({
    // Get dashboard summary for current user
    summary: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        const summary = await db.getUserSalesSummary(ctx.user.id, startDate, endDate);
        
        // Get user's monthly target
        const targetProgress = ctx.user.monthlyTarget 
          ? (summary.totalSales / parseFloat(ctx.user.monthlyTarget)) * 100 
          : 0;
        
        return {
          ...summary,
          targetProgress: Math.min(targetProgress, 100),
          monthlyTarget: parseFloat(ctx.user.monthlyTarget || "0"),
        };
      }),

    // Get recent sales for current user
    recent: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(50).default(5),
      }))
      .query(async ({ ctx, input }) => {
        return db.getRecentSales(ctx.user.id, input.limit);
      }),

    // Get all sales for current user with date filter
    list: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getUserSales(ctx.user.id, startDate, endDate);
      }),

    // Get product breakdown
    productBreakdown: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getUserProductBreakdown(ctx.user.id, startDate, endDate);
      }),

    // Get daily sales trend
    trend: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getDailySalesTrend(ctx.user.id, startDate, endDate);
      }),
  }),

  // User profile endpoints
  user: router({
    // Get current user's staff ID
    getStaffId: protectedProcedure.query(async ({ ctx }) => {
      return { staffId: ctx.user.staffId || null };
    }),

    // Update current user's own staff ID
    updateMyStaffId: protectedProcedure
      .input(z.object({
        staffId: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserStaffId(ctx.user.id, input.staffId);
        return { success: true };
      }),
  }),

  // Admin endpoints
  admin: router({
    // Get all users (admin only)
    users: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      return db.getAllUsers();
    }),

    // Get all users' sales summary (admin only)
    teamSummary: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        const { startDate, endDate } = getDateRange(input.period);
        return db.getAllUsersSalesSummary(startDate, endDate);
      }),

    // Update user's monthly target (admin only)
    updateTarget: protectedProcedure
      .input(z.object({
        userId: z.number(),
        target: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        await db.updateUserTarget(input.userId, input.target);
        return { success: true };
      }),

    // Import sales from parsed report data (admin only)
    importSales: protectedProcedure
      .input(z.object({
        sales: z.array(z.object({
          userId: z.number(),
          productName: z.string(),
          productCategory: z.string().optional(),
          quantity: z.number().default(1),
          unitPrice: z.string(),
          totalAmount: z.string(),
          saleDate: z.string(),
          customerName: z.string().optional(),
          orderReference: z.string().optional(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        
        const salesData = input.sales.map(sale => ({
          ...sale,
          saleDate: new Date(sale.saleDate),
        }));
        
        const count = await db.createSalesBatch(salesData);
        
        // Create report upload record
        await db.createReportUpload({
          uploadedBy: ctx.user.id,
          fileName: `Import ${new Date().toISOString()}`,
          recordsImported: count,
          status: "completed",
        });
        
        return { success: true, importedCount: count };
      }),

    // Get report upload history (admin only)
    reportHistory: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      return db.getReportUploads();
    }),

    // Update user's staff ID for report mapping (admin only)
    updateStaffId: protectedProcedure
      .input(z.object({
        userId: z.number(),
        staffId: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        await db.updateUserStaffId(input.userId, input.staffId);
        return { success: true };
      }),

    // Get staff mapping for Excel import
    getStaffMapping: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      return db.getStaffMapping();
    }),

    // Import Excel report with staff ID mapping
    importExcel: protectedProcedure
      .input(z.object({
        fileData: z.string(), // Base64 encoded Excel file
        fileName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        
        // Get staff mapping from database
        const staffMapping = await db.getStaffMapping();
        
        // Parse Excel file
        const result = parseExcel(input.fileData, staffMapping, true);
        
        if (!result.success || result.records.length === 0) {
          return {
            success: false,
            importedCount: 0,
            errors: result.errors,
            warnings: result.warnings,
            unmappedStaffIds: extractStaffIds(input.fileData, true),
          };
        }
        
        // Import sales data
        const salesData = result.records.map(r => ({
          userId: r.userId,
          productName: r.productName,
          productCategory: r.productCategory || null,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          totalAmount: r.totalAmount,
          saleDate: new Date(r.saleDate),
          customerName: r.customerName || null,
          orderReference: r.orderReference || null,
        }));
        
        const count = await db.createSalesBatch(salesData);
        
        // Create report upload record
        await db.createReportUpload({
          uploadedBy: ctx.user.id,
          fileName: input.fileName,
          recordsImported: count,
          status: "completed",
        });
        
        return {
          success: true,
          importedCount: count,
          errors: result.errors,
          warnings: result.warnings,
          unmappedStaffIds: [],
        };
      }),

    // Extract staff IDs from Excel file for mapping setup
    extractStaffIds: protectedProcedure
      .input(z.object({
        fileData: z.string(), // Base64 encoded Excel file
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        
        const staffIds = extractStaffIds(input.fileData, true);
        const existingMapping = await db.getStaffMapping();
        
        return {
          staffIds,
          mappedCount: staffIds.filter(id => existingMapping[id]).length,
          unmappedCount: staffIds.filter(id => !existingMapping[id]).length,
        };
      }),
  }),

  // Google Drive integration endpoints
  drive: router({
    // Get Google Drive auth URL
    getAuthUrl: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      const oauth2Client = GoogleDrive.createOAuth2Client();
      const authUrl = GoogleDrive.getAuthUrl(oauth2Client, String(ctx.user.id));
      return { authUrl };
    }),

    // Handle OAuth callback and save credentials
    saveCredentials: protectedProcedure
      .input(z.object({
        code: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        
        const oauth2Client = GoogleDrive.createOAuth2Client();
        const tokens = await GoogleDrive.getTokensFromCode(oauth2Client, input.code);
        
        if (!tokens.access_token || !tokens.refresh_token) {
          throw new Error("Failed to get valid tokens from Google");
        }
        
        await db.saveDriveCredentials({
          userId: ctx.user.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600000),
        });
        
        return { success: true };
      }),

    // Get current Drive connection status
    status: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        return { connected: false };
      }
      
      return {
        connected: true,
        folderId: credentials.folderId,
        folderName: credentials.folderName,
        lastSyncAt: credentials.lastSyncAt,
        syncEnabled: credentials.syncEnabled === 1,
      };
    }),

    // List folders from Google Drive
    listFolders: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error("Google Drive not connected");
      }
      
      const drive = GoogleDrive.createDriveClient(credentials.accessToken, credentials.refreshToken);
      const folders = await GoogleDrive.listFolders(drive);
      
      return folders.map(f => ({
        id: f.id || "",
        name: f.name || "Unnamed folder",
      }));
    }),

    // Set folder to sync from
    setFolder: protectedProcedure
      .input(z.object({
        folderId: z.string(),
        folderName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        
        const credentials = await db.getDriveCredentials(ctx.user.id);
        if (!credentials) {
          throw new Error("Google Drive not connected");
        }
        
        // Validate folder access
        const drive = GoogleDrive.createDriveClient(credentials.accessToken, credentials.refreshToken);
        const validation = await GoogleDrive.validateFolderAccess(drive, input.folderId);
        
        if (!validation.valid) {
          throw new Error(validation.error || "Invalid folder");
        }
        
        await db.updateDriveCredentials(ctx.user.id, {
          folderId: input.folderId,
          folderName: input.folderName,
        });
        
        return { success: true };
      }),

    // Trigger manual sync
    sync: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error("Google Drive not connected");
      }
      
      const result = await DriveSync.syncDriveReports(credentials.id);
      return result;
    }),

    // Get sync history
    syncHistory: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        return [];
      }
      
      return db.getSyncHistory(credentials.id);
    }),

    // Toggle sync enabled/disabled
    toggleSync: protectedProcedure
      .input(z.object({
        enabled: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }
        
        await db.updateDriveCredentials(ctx.user.id, {
          syncEnabled: input.enabled ? 1 : 0,
        });
        
        return { success: true };
      }),

    // Disconnect Google Drive
    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new Error("Unauthorized: Admin access required");
      }
      
      await db.deleteDriveCredentials(ctx.user.id);
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;
