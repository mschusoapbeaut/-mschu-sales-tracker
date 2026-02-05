/**
 * Google Drive Sync Service
 * Handles automatic extraction and import of sales reports from Google Drive
 * Supports both CSV and Excel (.xlsx) files with WVReferredByStaff mapping
 */

import * as GoogleDrive from "./google-drive";
import * as db from "./db";
import { parseCSV, parseExcel } from "../lib/report-parser";

interface SyncResult {
  success: boolean;
  filesProcessed: number;
  recordsImported: number;
  errors: string[];
}

/**
 * Sync sales reports from Google Drive for a specific credential
 */
export async function syncDriveReports(credentialId: number): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    filesProcessed: 0,
    recordsImported: 0,
    errors: [],
  };

  try {
    // Get credentials from database
    const credentials = await db.getDriveCredentials(credentialId);
    if (!credentials) {
      return { ...result, success: false, errors: ["Credentials not found"] };
    }

    if (!credentials.folderId) {
      return { ...result, success: false, errors: ["No folder configured for sync"] };
    }

    // Check if token needs refresh
    let accessToken = credentials.accessToken;
    if (new Date(credentials.expiresAt) <= new Date()) {
      console.log("[DriveSync] Token expired, refreshing...");
      const refreshed = await GoogleDrive.refreshAccessToken(credentials.refreshToken);
      if (!refreshed) {
        return { ...result, success: false, errors: ["Failed to refresh access token"] };
      }
      accessToken = refreshed.accessToken;
      await db.updateDriveCredentials(credentials.userId, {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      });
    }

    // Create Drive client
    const drive = GoogleDrive.createDriveClient(accessToken, credentials.refreshToken);

    // List files in the configured folder (CSV and Excel)
    const files = await GoogleDrive.listFilesInFolder(drive, credentials.folderId);
    console.log(`[DriveSync] Found ${files.length} files in folder`);

    // Get staff ID mapping for Excel files
    const staffMapping = await db.getStaffMapping();
    
    // Get all users for CSV name-based mapping
    const allUsers = await db.getAllUsers();
    const userMapping: Record<string, number> = {};
    allUsers.forEach((u) => {
      if (u.name) userMapping[u.name.toLowerCase()] = u.id;
      if (u.email) userMapping[u.email.toLowerCase()] = u.id;
    });

    // Process each file
    for (const file of files) {
      if (!file.id || !file.name) continue;

      // Check file extension
      const fileName = file.name.toLowerCase();
      const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
      const isCSV = fileName.endsWith('.csv');
      
      if (!isExcel && !isCSV) {
        console.log(`[DriveSync] Skipping ${file.name} - unsupported format`);
        continue;
      }

      try {
        // Check if file was already synced with same modification time
        const lastSync = await db.getLastSyncedFile(credentials.id, file.id);
        if (lastSync && file.modifiedTime) {
          const fileModTime = new Date(file.modifiedTime);
          if (fileModTime <= new Date(lastSync.fileModifiedTime)) {
            console.log(`[DriveSync] Skipping ${file.name} - already synced`);
            continue;
          }
        }

        console.log(`[DriveSync] Processing ${file.name}...`);

        // Download file content
        const content = await GoogleDrive.downloadFileContent(drive, file.id, isExcel);

        // Parse based on file type
        let parseResult;
        if (isExcel) {
          // For Excel, use staff ID mapping (WVReferredByStaff)
          parseResult = parseExcel(content, staffMapping, false);
        } else {
          // For CSV, use name-based mapping
          parseResult = parseCSV(content as string, userMapping);
        }

        if (!parseResult.success || parseResult.records.length === 0) {
          await db.addSyncHistory({
            credentialId: credentials.id,
            fileId: file.id,
            fileName: file.name,
            fileModifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
            status: "failed",
            errorMessage: parseResult.errors.join("; ") || "No valid records found",
          });
          result.errors.push(`${file.name}: ${parseResult.errors.join("; ")}`);
          continue;
        }

        // Import sales data
        const salesData = parseResult.records.map((r) => ({
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

        const importedCount = await db.createSalesBatch(salesData);

        // Record sync history
        await db.addSyncHistory({
          credentialId: credentials.id,
          fileId: file.id,
          fileName: file.name,
          fileModifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
          recordsImported: importedCount,
          status: "success",
        });

        result.filesProcessed++;
        result.recordsImported += importedCount;
        console.log(`[DriveSync] Imported ${importedCount} records from ${file.name}`);

      } catch (fileError: any) {
        console.error(`[DriveSync] Error processing ${file.name}:`, fileError);
        await db.addSyncHistory({
          credentialId: credentials.id,
          fileId: file.id!,
          fileName: file.name!,
          fileModifiedTime: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
          status: "failed",
          errorMessage: fileError.message || "Unknown error",
        });
        result.errors.push(`${file.name}: ${fileError.message}`);
      }
    }

    // Update last sync time
    await db.updateDriveCredentials(credentials.userId, {
      lastSyncAt: new Date(),
    });

    return result;

  } catch (error: any) {
    console.error("[DriveSync] Sync failed:", error);
    return {
      ...result,
      success: false,
      errors: [error.message || "Unknown error"],
    };
  }
}

/**
 * Sync all active Drive connections
 */
export async function syncAllDriveConnections(): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: Array<{ userId: number; result: SyncResult }>;
}> {
  const activeCredentials = await db.getActiveDriveCredentials();
  const results: Array<{ userId: number; result: SyncResult }> = [];
  
  let successful = 0;
  let failed = 0;

  for (const cred of activeCredentials) {
    const result = await syncDriveReports(cred.id);
    results.push({ userId: cred.userId, result });
    
    if (result.success && result.errors.length === 0) {
      successful++;
    } else {
      failed++;
    }
  }

  return {
    total: activeCredentials.length,
    successful,
    failed,
    results,
  };
}
