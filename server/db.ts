import { and, between, desc, eq, sql, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertSale, InsertUser, InsertReportUpload, sales, users, reportUploads } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Raw SQL execute function for standalone server
export async function execute(query: string, params?: any[]): Promise<[any[], any]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.execute(query);
  return result as unknown as [any[], any];
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ USER FUNCTIONS ============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    staffId: users.staffId,
    monthlyTarget: users.monthlyTarget,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.name);
}

export async function updateUserTarget(userId: number, target: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(users).set({ monthlyTarget: target }).where(eq(users.id, userId));
}

export async function updateUserStaffId(userId: number, staffId: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(users).set({ staffId }).where(eq(users.id, userId));
}

export async function getStaffMapping(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  
  const result = await db.select({
    id: users.id,
    staffId: users.staffId,
  }).from(users).where(sql`${users.staffId} IS NOT NULL`);
  
  const mapping: Record<string, number> = {};
  for (const user of result) {
    if (user.staffId) {
      mapping[user.staffId] = user.id;
    }
  }
  return mapping;
}

export async function updateUserPin(userId: number, pin: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(users).set({ pin }).where(eq(users.id, userId));
}

export async function getUserByPin(pin: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(users).where(eq(users.pin, pin)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// ============ SALES FUNCTIONS ============

export async function createSale(data: InsertSale) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(sales).values(data);
  return result[0].insertId;
}

export async function createSalesBatch(salesData: InsertSale[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (salesData.length === 0) return 0;
  
  await db.insert(sales).values(salesData);
  return salesData.length;
}

export async function getUserSales(userId: number, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(sales.userId, userId)];
  
  if (startDate && endDate) {
    conditions.push(between(sales.saleDate, startDate, endDate));
  }
  
  return db.select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.saleDate));
}

export async function getUserSalesSummary(userId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return { totalSales: 0, orderCount: 0, avgOrderValue: 0 };
  
  const result = await db.select({
    totalSales: sum(sales.totalAmount),
    orderCount: sql<number>`COUNT(*)`,
  })
    .from(sales)
    .where(and(
      eq(sales.userId, userId),
      between(sales.saleDate, startDate, endDate)
    ));
  
  const totalSales = parseFloat(result[0]?.totalSales || "0");
  const orderCount = result[0]?.orderCount || 0;
  const avgOrderValue = orderCount > 0 ? totalSales / orderCount : 0;
  
  return { totalSales, orderCount, avgOrderValue };
}

export async function getUserProductBreakdown(userId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    productName: sales.productName,
    productCategory: sales.productCategory,
    totalQuantity: sum(sales.quantity),
    totalAmount: sum(sales.totalAmount),
  })
    .from(sales)
    .where(and(
      eq(sales.userId, userId),
      between(sales.saleDate, startDate, endDate)
    ))
    .groupBy(sales.productName, sales.productCategory)
    .orderBy(desc(sum(sales.totalAmount)));
}

export async function getDailySalesTrend(userId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    date: sql<string>`DATE(${sales.saleDate})`,
    totalSales: sum(sales.totalAmount),
    orderCount: sql<number>`COUNT(*)`,
  })
    .from(sales)
    .where(and(
      eq(sales.userId, userId),
      between(sales.saleDate, startDate, endDate)
    ))
    .groupBy(sql`DATE(${sales.saleDate})`)
    .orderBy(sql`DATE(${sales.saleDate})`);
}

export async function getRecentSales(userId: number, limit: number = 5) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(sales)
    .where(eq(sales.userId, userId))
    .orderBy(desc(sales.saleDate))
    .limit(limit);
}

// ============ POS SALES FUNCTIONS ============

export async function getUserPOSSales(userId: number, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(sales.userId, userId), eq(sales.saleType, "pos")];
  
  if (startDate && endDate) {
    conditions.push(between(sales.saleDate, startDate, endDate));
  }
  
  return db.select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.saleDate));
}

export async function getUserPOSSalesSummary(userId: number, startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return { totalSales: 0, orderCount: 0, avgOrderValue: 0 };
  
  const result = await db.select({
    totalSales: sum(sales.totalAmount),
    orderCount: sql<number>`COUNT(*)`,
  })
    .from(sales)
    .where(and(
      eq(sales.userId, userId),
      eq(sales.saleType, "pos"),
      between(sales.saleDate, startDate, endDate)
    ));
  
  const totalSales = parseFloat(result[0]?.totalSales || "0");
  const orderCount = result[0]?.orderCount || 0;
  const avgOrderValue = orderCount > 0 ? totalSales / orderCount : 0;
  
  return { totalSales, orderCount, avgOrderValue };
}

// Update getUserSales to filter for online sales only
export async function getUserOnlineSales(userId: number, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(sales.userId, userId), eq(sales.saleType, "online")];
  
  if (startDate && endDate) {
    conditions.push(between(sales.saleDate, startDate, endDate));
  }
  
  return db.select()
    .from(sales)
    .where(and(...conditions))
    .orderBy(desc(sales.saleDate));
}

// ============ ADMIN FUNCTIONS ============

export async function getAllUsersSalesSummary(startDate: Date, endDate: Date) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    userId: sales.userId,
    userName: users.name,
    totalSales: sum(sales.totalAmount),
    orderCount: sql<number>`COUNT(*)`,
  })
    .from(sales)
    .leftJoin(users, eq(sales.userId, users.id))
    .where(between(sales.saleDate, startDate, endDate))
    .groupBy(sales.userId, users.name)
    .orderBy(desc(sum(sales.totalAmount)));
}

// ============ REPORT UPLOAD FUNCTIONS ============

export async function createReportUpload(data: InsertReportUpload) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(reportUploads).values(data);
  return result[0].insertId;
}

export async function updateReportUpload(id: number, data: Partial<InsertReportUpload>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(reportUploads).set(data).where(eq(reportUploads.id, id));
}

export async function getReportUploads(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(reportUploads)
    .orderBy(desc(reportUploads.createdAt))
    .limit(limit);
}


// ============ GOOGLE DRIVE FUNCTIONS ============

import { driveCredentials, driveSyncHistory, InsertDriveCredential, InsertDriveSyncHistory } from "../drizzle/schema";

export async function saveDriveCredentials(data: InsertDriveCredential) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Upsert - update if exists, insert if not
  await db.insert(driveCredentials).values(data).onDuplicateKeyUpdate({
    set: {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      folderId: data.folderId,
      folderName: data.folderName,
    },
  });
}

export async function getDriveCredentials(userId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(driveCredentials)
    .where(eq(driveCredentials.userId, userId))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function getActiveDriveCredentials() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(driveCredentials)
    .where(eq(driveCredentials.syncEnabled, 1));
}

export async function updateDriveCredentials(userId: number, data: Partial<InsertDriveCredential>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(driveCredentials).set(data).where(eq(driveCredentials.userId, userId));
}

export async function deleteDriveCredentials(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(driveCredentials).where(eq(driveCredentials.userId, userId));
}

export async function addSyncHistory(data: InsertDriveSyncHistory) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(driveSyncHistory).values(data);
}

export async function getSyncHistory(credentialId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(driveSyncHistory)
    .where(eq(driveSyncHistory.credentialId, credentialId))
    .orderBy(desc(driveSyncHistory.syncedAt))
    .limit(limit);
}

export async function getLastSyncedFile(credentialId: number, fileId: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(driveSyncHistory)
    .where(and(
      eq(driveSyncHistory.credentialId, credentialId),
      eq(driveSyncHistory.fileId, fileId),
      eq(driveSyncHistory.status, "success")
    ))
    .orderBy(desc(driveSyncHistory.syncedAt))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}
