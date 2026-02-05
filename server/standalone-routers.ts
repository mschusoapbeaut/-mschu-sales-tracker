/**
 * Standalone tRPC routers for Railway deployment
 * Does not depend on Manus SDK - uses standalone authentication
 */
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { initTRPC, TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import type { User } from "../drizzle/schema";
import * as db from "./db";
import * as GoogleDrive from "./google-drive";
import * as DriveSync from "./drive-sync";
import { parseExcel, extractStaffIds } from "../lib/report-parser";

// Context type for standalone mode
type StandaloneContext = {
  req: Request;
  res: Response;
  user: User | null;
};

// Initialize tRPC
const t = initTRPC.context<StandaloneContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// Protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

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

export const standaloneAppRouter = router({
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
    summary: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        const summary = await db.getUserSalesSummary(ctx.user.id, startDate, endDate);
        
        const targetProgress = ctx.user.monthlyTarget 
          ? (summary.totalSales / parseFloat(ctx.user.monthlyTarget)) * 100 
          : 0;
        
        return {
          ...summary,
          targetProgress: Math.min(targetProgress, 100),
          monthlyTarget: parseFloat(ctx.user.monthlyTarget || "0"),
        };
      }),

    recent: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(50).default(5),
      }))
      .query(async ({ ctx, input }) => {
        return db.getRecentSales(ctx.user.id, input.limit);
      }),

    list: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getUserSales(ctx.user.id, startDate, endDate);
      }),

    productBreakdown: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getUserProductBreakdown(ctx.user.id, startDate, endDate);
      }),

    trend: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getDailySalesTrend(ctx.user.id, startDate, endDate);
      }),

    // POS Sales endpoints
    posList: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        return db.getUserPOSSales(ctx.user.id, startDate, endDate);
      }),

    posSummary: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        const { startDate, endDate } = getDateRange(input.period);
        const summary = await db.getUserPOSSalesSummary(ctx.user.id, startDate, endDate);
        
        return {
          ...summary,
          targetProgress: 0,
          monthlyTarget: 0,
        };
      }),
  }),

  // User profile endpoints
  user: router({
    getStaffId: protectedProcedure.query(async ({ ctx }) => {
      return { staffId: ctx.user.staffId || null };
    }),

    updateMyStaffId: protectedProcedure
      .input(z.object({
        staffId: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserStaffId(ctx.user.id, input.staffId);
        return { success: true };
      }),

    getPinStatus: protectedProcedure.query(async ({ ctx }) => {
      return { hasPin: !!ctx.user.pin };
    }),

    updatePin: protectedProcedure
      .input(z.object({
        pin: z.string().length(4).regex(/^\d{4}$/, "PIN must be 4 digits"),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserPin(ctx.user.id, input.pin);
        return { success: true };
      }),

    removePin: protectedProcedure.mutation(async ({ ctx }) => {
      await db.updateUserPin(ctx.user.id, null);
      return { success: true };
    }),
  }),

  // Admin endpoints
  admin: router({
    users: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      return db.getAllUsers();
    }),

    teamSummary: protectedProcedure
      .input(z.object({
        period: z.enum(["week", "month", "year"]).default("month"),
      }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        const { startDate, endDate } = getDateRange(input.period);
        return db.getAllUsersSalesSummary(startDate, endDate);
      }),

    updateTarget: protectedProcedure
      .input(z.object({
        userId: z.number(),
        target: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        await db.updateUserTarget(input.userId, input.target);
        return { success: true };
      }),

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
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        
        const salesData = input.sales.map(sale => ({
          ...sale,
          saleDate: new Date(sale.saleDate),
        }));
        
        const count = await db.createSalesBatch(salesData);
        
        await db.createReportUpload({
          uploadedBy: ctx.user.id,
          fileName: `Import ${new Date().toISOString()}`,
          recordsImported: count,
          status: "completed",
        });
        
        return { success: true, importedCount: count };
      }),

    reportHistory: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      return db.getReportUploads();
    }),

    updateStaffId: protectedProcedure
      .input(z.object({
        userId: z.number(),
        staffId: z.string().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        await db.updateUserStaffId(input.userId, input.staffId);
        return { success: true };
      }),

    getStaffMapping: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      return db.getStaffMapping();
    }),

    importExcel: protectedProcedure
      .input(z.object({
        fileData: z.string(),
        fileName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        
        const staffMapping = await db.getStaffMapping();
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

    extractStaffIds: protectedProcedure
      .input(z.object({
        fileData: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
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
    getAuthUrl: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const oauth2Client = GoogleDrive.createOAuth2Client();
      const authUrl = GoogleDrive.getAuthUrl(oauth2Client, String(ctx.user.id));
      return { authUrl };
    }),

    saveCredentials: protectedProcedure
      .input(z.object({
        code: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        
        const oauth2Client = GoogleDrive.createOAuth2Client();
        const tokens = await GoogleDrive.getTokensFromCode(oauth2Client, input.code);
        
        if (!tokens.access_token || !tokens.refresh_token) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Failed to get valid tokens from Google" });
        }
        
        await db.saveDriveCredentials({
          userId: ctx.user.id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600000),
        });
        
        return { success: true };
      }),

    status: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
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

    listFolders: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Google Drive not connected" });
      }
      
      const drive = GoogleDrive.createDriveClient(credentials.accessToken, credentials.refreshToken);
      const folders = await GoogleDrive.listFolders(drive);
      
      return folders.map(f => ({
        id: f.id || "",
        name: f.name || "Unnamed folder",
      }));
    }),

    setFolder: protectedProcedure
      .input(z.object({
        folderId: z.string(),
        folderName: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        
        const credentials = await db.getDriveCredentials(ctx.user.id);
        if (!credentials) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Google Drive not connected" });
        }
        
        const drive = GoogleDrive.createDriveClient(credentials.accessToken, credentials.refreshToken);
        const validation = await GoogleDrive.validateFolderAccess(drive, input.folderId);
        
        if (!validation.valid) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validation.error || "Invalid folder" });
        }
        
        await db.updateDriveCredentials(ctx.user.id, {
          folderId: input.folderId,
          folderName: input.folderName,
        });
        
        return { success: true };
      }),

    sync: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Google Drive not connected" });
      }
      
      const result = await DriveSync.syncDriveReports(credentials.id);
      return result;
    }),

    syncHistory: protectedProcedure.query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      
      const credentials = await db.getDriveCredentials(ctx.user.id);
      if (!credentials) {
        return [];
      }
      
      return db.getSyncHistory(credentials.id);
    }),

    toggleSync: protectedProcedure
      .input(z.object({
        enabled: z.boolean(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
        }
        
        await db.updateDriveCredentials(ctx.user.id, {
          syncEnabled: input.enabled ? 1 : 0,
        });
        
        return { success: true };
      }),

    disconnect: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      
      await db.deleteDriveCredentials(ctx.user.id);
      return { success: true };
    }),
  }),
});

export type StandaloneAppRouter = typeof standaloneAppRouter;
