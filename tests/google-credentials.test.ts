import { describe, it, expect } from "vitest";

describe("Google Drive Credentials Validation", () => {
  it("should have GOOGLE_CLIENT_ID environment variable set", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    expect(clientId).toBeDefined();
    expect(clientId).not.toBe("");
    expect(clientId).toContain(".apps.googleusercontent.com");
  });

  it("should have GOOGLE_CLIENT_SECRET environment variable set", () => {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    expect(clientSecret).toBeDefined();
    expect(clientSecret).not.toBe("");
    expect(clientSecret?.startsWith("GOCSPX-")).toBe(true);
  });

  it("should have GOOGLE_REDIRECT_URI environment variable set", () => {
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    expect(redirectUri).toBeDefined();
    expect(redirectUri).not.toBe("");
    expect(redirectUri).toContain("/api/auth/google/callback");
  });

  it("should have valid Google Client ID format", () => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    // Google Client IDs follow pattern: numbers-alphanumeric.apps.googleusercontent.com
    const pattern = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
    expect(pattern.test(clientId || "")).toBe(true);
  });
});
