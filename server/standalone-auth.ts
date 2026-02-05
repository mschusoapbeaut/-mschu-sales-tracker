/**
 * Standalone authentication module for Railway deployment
 * Uses JWT-based sessions without Manus OAuth dependency
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "../shared/const.js";
import type { Express, Request, Response } from "express";
import { getUserByPin, getUserByOpenId, upsertUser } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../drizzle/schema";
import { ForbiddenError } from "../shared/_core/errors.js";
import { parse as parseCookieHeader } from "cookie";

// Use environment variable or fallback to a default (should be set in production)
const JWT_SECRET = process.env.JWT_SECRET || process.env.COOKIE_SECRET || "mschu-sales-tracker-secret-key-change-in-production";

function getSecretKey() {
  return new TextEncoder().encode(JWT_SECRET);
}

export type SessionPayload = {
  userId: number;
  openId: string;
  name: string;
};

function parseCookies(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return new Map<string, string>();
  }
  const parsed = parseCookieHeader(cookieHeader);
  return new Map(Object.entries(parsed));
}

function buildUserResponse(user: User | null) {
  if (!user) return null;
  return {
    id: user.id,
    openId: user.openId,
    name: user.name ?? null,
    email: user.email ?? null,
    loginMethod: user.loginMethod ?? "pin",
    role: user.role,
    lastSignedIn: (user.lastSignedIn ?? new Date()).toISOString(),
  };
}

/**
 * Create a session token for a user
 */
export async function createSessionToken(
  user: User,
  options: { expiresInMs?: number } = {}
): Promise<string> {
  const issuedAt = Date.now();
  const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
  const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
  const secretKey = getSecretKey();

  return new SignJWT({
    userId: user.id,
    openId: user.openId,
    name: user.name || "",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expirationSeconds)
    .sign(secretKey);
}

/**
 * Verify a session token and return the payload
 */
export async function verifySession(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }

  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    
    const { userId, openId, name } = payload as Record<string, unknown>;

    if (typeof userId !== "number" || typeof openId !== "string") {
      console.warn("[Auth] Session payload missing required fields");
      return null;
    }

    return {
      userId,
      openId,
      name: typeof name === "string" ? name : "",
    };
  } catch (error) {
    console.warn("[Auth] Session verification failed", String(error));
    return null;
  }
}

/**
 * Authenticate a request and return the user
 */
export async function authenticateRequest(req: Request): Promise<User> {
  // Check for Bearer token first
  const authHeader = req.headers.authorization || req.headers.Authorization;
  let token: string | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice("Bearer ".length).trim();
  }

  // Fall back to cookie
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = token || cookies.get(COOKIE_NAME);
  
  const session = await verifySession(sessionToken);
  if (!session) {
    throw ForbiddenError("Invalid session");
  }

  const user = await getUserByOpenId(session.openId);
  if (!user) {
    throw ForbiddenError("User not found");
  }

  return user;
}

/**
 * Register standalone authentication routes
 */
export function registerStandaloneAuthRoutes(app: Express) {
  // PIN-based login
  app.post("/api/auth/pin", async (req: Request, res: Response) => {
    const { pin } = req.body;
    
    if (!pin || typeof pin !== "string") {
      res.status(400).json({ error: "PIN is required" });
      return;
    }
    
    try {
      const user = await getUserByPin(pin);
      
      if (!user) {
        res.status(401).json({ error: "Invalid PIN" });
        return;
      }
      
      // Create session token
      const sessionToken = await createSessionToken(user);
      
      // Set cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      
      // Update last signed in
      await upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      });
      
      res.json({
        success: true,
        user: buildUserResponse(user),
        sessionToken,
      });
    } catch (error) {
      console.error("[Auth] PIN login failed:", error);
      res.status(500).json({ error: "PIN login failed" });
    }
  });

  // Logout
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });

  // Get current user
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch (error) {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  // Establish session from Bearer token (for mobile apps)
  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const user = await authenticateRequest(req);
      
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: buildUserResponse(user) });
    } catch (error) {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
