import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import * as db from "./db";

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
  }),
});

export type AppRouter = typeof appRouter;
