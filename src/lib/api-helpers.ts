import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, sessionCookieOptions, verifySessionToken } from "@/lib/jwt";
import { isSupabaseData } from "@/lib/data-backend";
import type { AppUser } from "@/lib/types";
import type { User } from "@prisma/client";

/**
 * Server-side helpers shared by ALL API routes.
 * Wallet mutations only ever happen server-side inside $transaction blocks.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function jsonOk(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** Wrap a route handler: converts ApiError -> proper status, unexpected -> 500. */
export async function handleRoute(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api] unexpected error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

export async function parseJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (typeof body !== "object" || body === null) throw new Error("invalid");
    return body as T;
  } catch {
    throw new ApiError("Invalid JSON body", 400);
  }
}

/**
 * The public origin this request was addressed to (proxy-aware). Used for
 * building redirect URLs handed to the auth provider (e.g. the recovery-link
 * redirect target) so links work behind the gateway in production.
 */
export function getPublicOrigin(req: Request): string {
  const h = req.headers;
  let origin = "";
  try {
    origin = new URL(req.url).origin;
  } catch {
    origin = "";
  }
  const fwdHost = h.get("x-forwarded-host") ?? h.get("host");
  if (fwdHost) {
    const fwdProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    let proto = fwdProto || new URL(req.url).protocol.replace(":", "");
    // The internal proxy hop may report http even when the browser reached the
    // app over https. Cross-check the browser-supplied Origin header (browsers
    // always send it on cross-origin POSTs such as the recovery request): when
    // it points at the same forwarded host, its scheme is authoritative.
    const browserOrigin = h.get("origin");
    if (browserOrigin) {
      try {
        const parsed = new URL(browserOrigin);
        const scheme = parsed.protocol.replace(":", "");
        if ((parsed.host === fwdHost || parsed.host === h.get("host")) && /^https?$/.test(scheme)) {
          proto = scheme;
        }
      } catch {
        /* ignore malformed Origin header */
      }
    }
    origin = `${proto}://${fwdHost}`;
  }
  return origin || "http://localhost:3000";
}

/** Map a local Prisma user row onto the shared AppUser shape. */
export function toAppUser(user: User): AppUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as AppUser["role"],
    referralCode: user.referralCode,
    referredById: user.referredById,
    isBanned: user.isBanned,
    ipAddress: user.ipAddress,
    fingerprint: user.fingerprint,
    supabaseAuthId: user.supabaseAuthId,
    recoveryEmail: user.recoveryEmail,
    passwordHash: user.passwordHash,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/**
 * Current session user (or null). Reads the httpOnly JWT cookie.
 *
 * Dual data-backend dispatch (Task 8): in supabase mode the users row is
 * fetched via PostgREST and mapped snake_case → camelCase; in local mode the
 * Prisma row is returned in a shape-compatible AppUser. When the Supabase
 * lookup itself FAILS (e.g. force-activated before provisioning), we fall
 * back to the always-readable local row so sessions — and the admin
 * "deactivate" escape hatch — keep working; data routes surface their own
 * clear errors.
 */
export async function getSessionUser(): Promise<AppUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;

  if (await isSupabaseData()) {
    try {
      // Dynamic import avoids a static module cycle (core imports ApiError).
      const { fetchUserById } = await import("@/server/supabase/core");
      return await fetchUserById(userId);
    } catch (err) {
      console.warn(
        "[data-backend] supabase users lookup failed — falling back to the local row:",
        err instanceof Error ? err.message : err
      );
      const local = await db.user.findUnique({ where: { id: userId } });
      return local ? toAppUser(local) : null;
    }
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  return user ? toAppUser(user) : null;
}

/** Require an authenticated, non-banned user. */
export async function requireAuth(): Promise<AppUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("You must be signed in.", 401);
  if (user.isBanned) throw new ApiError("Your account has been suspended. Contact support.", 403);
  return user;
}

/** Require admin role. */
export async function requireAdmin(): Promise<AppUser> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("You must be signed in.", 401);
  if (user.isBanned) throw new ApiError("Your account has been suspended.", 403);
  if (user.role !== "admin") throw new ApiError("Admin access required.", 403);
  return user;
}

/** Capture client IP from proxy headers. */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
}
