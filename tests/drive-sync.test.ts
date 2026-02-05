import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../server/db", () => ({
  getDriveCredentials: vi.fn(),
  getActiveDriveCredentials: vi.fn(),
  updateDriveCredentials: vi.fn(),
  saveDriveCredentials: vi.fn(),
  deleteDriveCredentials: vi.fn(),
  addSyncHistory: vi.fn(),
  getSyncHistory: vi.fn(),
  getLastSyncedFile: vi.fn(),
  getAllUsers: vi.fn(),
  createSalesBatch: vi.fn(),
}));

// Mock Google Drive module
vi.mock("../server/google-drive", () => ({
  createOAuth2Client: vi.fn(() => ({})),
  getAuthUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/auth?..."),
  getTokensFromCode: vi.fn(),
  createDriveClient: vi.fn(),
  listFilesInFolder: vi.fn(),
  listFolders: vi.fn(),
  downloadFileContent: vi.fn(),
  validateFolderAccess: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

import * as db from "../server/db";
import * as GoogleDrive from "../server/google-drive";

describe("Google Drive Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("OAuth Flow", () => {
    it("should generate auth URL with correct scopes", () => {
      const authUrl = GoogleDrive.getAuthUrl({} as any);
      expect(authUrl).toContain("accounts.google.com");
    });

    it("should exchange code for tokens", async () => {
      const mockTokens = {
        access_token: "test_access_token",
        refresh_token: "test_refresh_token",
        expiry_date: Date.now() + 3600000,
      };
      
      vi.mocked(GoogleDrive.getTokensFromCode).mockResolvedValue(mockTokens);
      
      const tokens = await GoogleDrive.getTokensFromCode({} as any, "test_code");
      
      expect(tokens.access_token).toBe("test_access_token");
      expect(tokens.refresh_token).toBe("test_refresh_token");
    });
  });

  describe("Credentials Management", () => {
    it("should save drive credentials", async () => {
      const credentials = {
        userId: 1,
        accessToken: "access_token",
        refreshToken: "refresh_token",
        expiresAt: new Date(Date.now() + 3600000),
      };
      
      vi.mocked(db.saveDriveCredentials).mockResolvedValue(undefined);
      
      await db.saveDriveCredentials(credentials);
      
      expect(db.saveDriveCredentials).toHaveBeenCalledWith(credentials);
    });

    it("should get drive credentials by user ID", async () => {
      const mockCredentials = {
        id: 1,
        userId: 1,
        accessToken: "access_token",
        refreshToken: "refresh_token",
        expiresAt: new Date(),
        folderId: "folder123",
        folderName: "Sales Reports",
        lastSyncAt: new Date(),
        syncEnabled: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(db.getDriveCredentials).mockResolvedValue(mockCredentials);
      
      const result = await db.getDriveCredentials(1);
      
      expect(result).toEqual(mockCredentials);
      expect(result?.folderId).toBe("folder123");
    });

    it("should return null for non-existent credentials", async () => {
      vi.mocked(db.getDriveCredentials).mockResolvedValue(null);
      
      const result = await db.getDriveCredentials(999);
      
      expect(result).toBeNull();
    });
  });

  describe("Folder Operations", () => {
    it("should list folders from Google Drive", async () => {
      const mockFolders = [
        { id: "folder1", name: "Sales Reports" },
        { id: "folder2", name: "Monthly Data" },
      ];
      
      vi.mocked(GoogleDrive.listFolders).mockResolvedValue(mockFolders);
      
      const folders = await GoogleDrive.listFolders({} as any);
      
      expect(folders).toHaveLength(2);
      expect(folders[0].name).toBe("Sales Reports");
    });

    it("should validate folder access", async () => {
      vi.mocked(GoogleDrive.validateFolderAccess).mockResolvedValue({
        valid: true,
        folderName: "Sales Reports",
      });
      
      const result = await GoogleDrive.validateFolderAccess({} as any, "folder123");
      
      expect(result.valid).toBe(true);
      expect(result.folderName).toBe("Sales Reports");
    });

    it("should return error for invalid folder", async () => {
      vi.mocked(GoogleDrive.validateFolderAccess).mockResolvedValue({
        valid: false,
        error: "Folder not found or not accessible",
      });
      
      const result = await GoogleDrive.validateFolderAccess({} as any, "invalid");
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("File Operations", () => {
    it("should list files in folder", async () => {
      const mockFiles = [
        { id: "file1", name: "sales_jan.csv", mimeType: "text/csv", modifiedTime: "2026-01-15T10:00:00Z" },
        { id: "file2", name: "sales_feb.csv", mimeType: "text/csv", modifiedTime: "2026-02-01T10:00:00Z" },
      ];
      
      vi.mocked(GoogleDrive.listFilesInFolder).mockResolvedValue(mockFiles);
      
      const files = await GoogleDrive.listFilesInFolder({} as any, "folder123");
      
      expect(files).toHaveLength(2);
      expect(files[0].name).toBe("sales_jan.csv");
    });

    it("should download file content", async () => {
      const mockContent = `Date,Salesperson,Product,Quantity,Total
2026-02-01,Alice,Natural Soap,5,100.00`;
      
      vi.mocked(GoogleDrive.downloadFileContent).mockResolvedValue(mockContent);
      
      const content = await GoogleDrive.downloadFileContent({} as any, "file123");
      
      expect(content).toContain("Date,Salesperson");
      expect(content).toContain("Alice");
    });
  });

  describe("Token Refresh", () => {
    it("should refresh expired access token", async () => {
      vi.mocked(GoogleDrive.refreshAccessToken).mockResolvedValue({
        accessToken: "new_access_token",
        expiresAt: new Date(Date.now() + 3600000),
      });
      
      const result = await GoogleDrive.refreshAccessToken("refresh_token");
      
      expect(result?.accessToken).toBe("new_access_token");
    });

    it("should return null on refresh failure", async () => {
      vi.mocked(GoogleDrive.refreshAccessToken).mockResolvedValue(null);
      
      const result = await GoogleDrive.refreshAccessToken("invalid_token");
      
      expect(result).toBeNull();
    });
  });

  describe("Sync History", () => {
    it("should record sync history", async () => {
      const historyEntry = {
        credentialId: 1,
        fileId: "file123",
        fileName: "sales_feb.csv",
        fileModifiedTime: new Date(),
        recordsImported: 25,
        status: "success" as const,
      };
      
      vi.mocked(db.addSyncHistory).mockResolvedValue(undefined);
      
      await db.addSyncHistory(historyEntry);
      
      expect(db.addSyncHistory).toHaveBeenCalledWith(historyEntry);
    });

    it("should get sync history for credential", async () => {
      const mockHistory = [
        { id: 1, credentialId: 1, fileId: "file1", fileName: "sales.csv", status: "success", recordsImported: 10, syncedAt: new Date() },
        { id: 2, credentialId: 1, fileId: "file2", fileName: "sales2.csv", status: "failed", errorMessage: "Parse error", syncedAt: new Date() },
      ];
      
      vi.mocked(db.getSyncHistory).mockResolvedValue(mockHistory as any);
      
      const history = await db.getSyncHistory(1);
      
      expect(history).toHaveLength(2);
      expect(history[0].status).toBe("success");
    });

    it("should check if file was already synced", async () => {
      const mockLastSync = {
        id: 1,
        credentialId: 1,
        fileId: "file123",
        fileName: "sales.csv",
        fileModifiedTime: new Date("2026-02-01T10:00:00Z"),
        status: "success",
        syncedAt: new Date(),
      };
      
      vi.mocked(db.getLastSyncedFile).mockResolvedValue(mockLastSync as any);
      
      const lastSync = await db.getLastSyncedFile(1, "file123");
      
      expect(lastSync?.fileId).toBe("file123");
      expect(lastSync?.status).toBe("success");
    });
  });
});
