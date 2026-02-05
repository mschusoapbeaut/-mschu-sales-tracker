/**
 * Google Drive Integration Service
 * Handles authentication and file operations with Google Drive API
 */

import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";

// Environment variables for Google Drive API
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";

// Create OAuth2 client
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

// Generate authorization URL for user consent
export function getAuthUrl(oauth2Client: ReturnType<typeof createOAuth2Client>, state?: string): string {
  const scopes = [
    "https://www.googleapis.com/auth/drive.readonly",
  ];

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state: state,
    prompt: "consent", // Force consent to get refresh token
  });
}

// Exchange authorization code for tokens
export async function getTokensFromCode(
  oauth2Client: ReturnType<typeof createOAuth2Client>,
  code: string
) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Create Drive client with credentials
export function createDriveClient(accessToken: string, refreshToken?: string): drive_v3.Drive {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return google.drive({ version: "v3", auth: oauth2Client });
}

// List files in a folder
export async function listFilesInFolder(
  drive: drive_v3.Drive,
  folderId: string,
  mimeTypes: string[] = [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]
): Promise<drive_v3.Schema$File[]> {
  const mimeTypeQuery = mimeTypes.map(m => `mimeType='${m}'`).join(" or ");
  const query = `'${folderId}' in parents and (${mimeTypeQuery}) and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: "files(id, name, mimeType, modifiedTime, size)",
    orderBy: "modifiedTime desc",
    pageSize: 100,
  });

  return response.data.files || [];
}

// List all folders for selection
export async function listFolders(drive: drive_v3.Drive): Promise<drive_v3.Schema$File[]> {
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: "files(id, name, modifiedTime)",
    orderBy: "name",
    pageSize: 100,
  });

  return response.data.files || [];
}

// Download file content as string or buffer
export async function downloadFileContent(
  drive: drive_v3.Drive,
  fileId: string,
  asBinary: boolean = false
): Promise<string | ArrayBuffer> {
  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = response.data as Readable;
    
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      const buffer = Buffer.concat(chunks);
      if (asBinary) {
        resolve(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      } else {
        resolve(buffer.toString("utf-8"));
      }
    });
    stream.on("error", reject);
  });
}

// Get file metadata
export async function getFileMetadata(
  drive: drive_v3.Drive,
  fileId: string
): Promise<drive_v3.Schema$File> {
  const response = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, modifiedTime, size",
  });

  return response.data;
}

// Validate folder access
export async function validateFolderAccess(
  drive: drive_v3.Drive,
  folderId: string
): Promise<{ valid: boolean; folderName?: string; error?: string }> {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType",
    });

    if (response.data.mimeType !== "application/vnd.google-apps.folder") {
      return { valid: false, error: "The specified ID is not a folder" };
    }

    return { valid: true, folderName: response.data.name || undefined };
  } catch (error: any) {
    if (error.code === 404) {
      return { valid: false, error: "Folder not found or not accessible" };
    }
    return { valid: false, error: error.message || "Unknown error" };
  }
}

// Refresh access token if expired
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    if (credentials.access_token && credentials.expiry_date) {
      return {
        accessToken: credentials.access_token,
        expiresAt: new Date(credentials.expiry_date),
      };
    }
    return null;
  } catch (error) {
    console.error("[GoogleDrive] Failed to refresh token:", error);
    return null;
  }
}
