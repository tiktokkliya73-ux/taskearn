import { NextResponse } from "next/server";

import {
  ApiError,
  clearSessionCookie,
  getClientIp,
  getPublicOrigin,
  getSessionUser,
  parseJsonBody,
  requireAuth,
  setSessionCookie,
  toAppUser,
} from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSessionToken } from "@/lib/jwt";
import {
  ensureSupabaseAuthRecordForRecovery,
  ensureSupabaseAuthUser,
  supabaseCompleteRecovery,
  supabaseConfigured,
  supabasePasswordSignIn,
  supabaseSendRecoveryEmail,
} from "@/lib/supabase";
import { toSessionUser } from "@/app/api/_lib/helpers";
import { DEFAULT_ANIMATION_SETTINGS, getAnimationSettings } from "@/lib/animations";
import type { AppUser, SessionUser } from "@/lib/types";
import {
  fetchUserByEmail,
  fetchUserById,
  fetchWalletOrNull,
  getSupabaseSettings,
  mapUserRow,
  requireSupabaseAdmin,
  rpcCall,
  type UserRow,
} from "@/server/supabase/core";

/**
 * Supabase-mode implementations for the /api/auth/* routes (Task 8).
 *
 * Validation error messages + status codes mirror the local implementations
 * EXACTLY — the branch is chosen inside handleRoute before the local code.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* --------------------------------- signup ---------------------------------- */

interface SignupBody {
  name?: string;
  email?: string;
  password?: string;
  referralCode?: string;
  fingerprint?: string;
}

interface SignupRpcResult {
  ok: true;
  user: SessionUser;
}

export async function supabaseSignup(req: Request): Promise<NextResponse> {
  const body = await parseJsonBody<SignupBody>(req);

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fingerprint = typeof body.fingerprint === "string" && body.fingerprint ? body.fingerprint : null;

  if (name.length < 2) throw new ApiError("Please enter your full name.", 400);
  if (!EMAIL_RE.test(email)) throw new ApiError("Please enter a valid email address.", 400);
  if (password.length < 8) throw new ApiError("Password must be at least 8 characters.", 400);

  const existing = await fetchUserByEmail(email);
  if (existing) throw new ApiError("An account with this email already exists.", 409);

  // Optional referral code (trimmed + uppercased)
  const refCode = (body.referralCode ?? "").trim().toUpperCase();
  if (refCode) {
    const inviter = await fetchUserByReferralCode(refCode);
    if (!inviter) throw new ApiError("Invalid referral code.", 400);
  }

  // Create the account in the project's Supabase Auth first (same as local).
  let supabaseAuthId: string | null = null;
  if (supabaseConfigured) {
    const r = await ensureSupabaseAuthUser(email, password, { name });
    if (r.ok) {
      supabaseAuthId = r.authId ?? null;
    } else if (/already|registered|exists/i.test(r.error ?? "")) {
      throw new ApiError("An account with this email already exists.", 409);
    }
  }

  // handle_new_user() RPC — user + wallet created atomically in Postgres.
  const result = await rpcCall<SignupRpcResult>("api_signup_user", {
    p_name: name,
    p_email: email,
    p_password_hash: hashPassword(password),
    p_referred_by_code: refCode || null,
    p_ip: getClientIp(req),
    p_fingerprint: fingerprint,
    p_supabase_auth_id: supabaseAuthId,
  });

  await setSessionCookie(await createSessionToken(result.user.id));
  return NextResponse.json({ user: result.user }, { status: 201 });
}

async function fetchUserByReferralCode(code: string): Promise<AppUser | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("users")
    .select(
      "id,name,email,password_hash,role,referral_code,referred_by_id,is_banned,ip_address,fingerprint,supabase_auth_id,recovery_email,last_login_at,created_at,updated_at"
    )
    .eq("referral_code", code)
    .maybeSingle();
  if (error) {
    throw new ApiError(`Supabase data backend error: ${error.message} (referral lookup)`, 500);
  }
  return data ? mapUserRow(data as UserRow) : null;
}

/* --------------------------------- login ----------------------------------- */

interface LoginBody {
  email?: string;
  password?: string;
  fingerprint?: string;
}

export async function supabaseLogin(req: Request): Promise<NextResponse> {
  const body = await parseJsonBody<LoginBody>(req);

  const email = (body.email ?? "").trim().toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  const fingerprint =
    typeof body.fingerprint === "string" && body.fingerprint ? body.fingerprint : null;

  let user: AppUser | null = null;
  // Escape-hatch fallback: when the Supabase data backend itself is
  // unreachable (force-activated before provisioning, or a Supabase outage),
  // sign in against the always-readable LOCAL row so admins can still reach
  // Admin → Supabase → Deactivate. Data routes keep surfacing their own errors.
  let backendBroken = false;
  if (email) {
    try {
      user = await fetchUserByEmail(email);
    } catch (err) {
      console.warn(
        "[data-backend] supabase login lookup failed — local fallback:",
        err instanceof Error ? err.message : err
      );
      backendBroken = true;
      const local = await db.user.findUnique({ where: { email } });
      user = local ? toAppUser(local) : null;
    }
  }
  let authenticated = false;

  // 1) Supabase Auth first — the project's GoTrue is authoritative for creds.
  if (supabaseConfigured && email) {
    const r = await supabasePasswordSignIn(email, password);
    if (r.ok) {
      authenticated = true;
      if (!user && !backendBroken) {
        // Auth user exists but no profile row yet — provision profile + wallet
        // via the same atomic RPC signup uses (role always "user").
        const name = r.name && r.name.length >= 2 ? r.name : email.split("@")[0];
        const created = await rpcCall<SignupRpcResult>("api_signup_user", {
          p_name: name,
          p_email: email,
          p_password_hash: hashPassword(password),
          p_referred_by_code: null,
          p_ip: getClientIp(req),
          p_fingerprint: fingerprint,
          p_supabase_auth_id: r.authId ?? null,
        });
        user = await fetchUserById(created.user.id);
      } else if (user && !backendBroken) {
        // Keep the profile row in sync (auth id + scrypt hash).
        const sync: Record<string, string> = {};
        if (!user.supabaseAuthId && r.authId) sync.supabase_auth_id = r.authId;
        if (!verifyPassword(password, user.passwordHash ?? "")) {
          sync.password_hash = hashPassword(password);
        }
        if (Object.keys(sync).length > 0) {
          const { error } = await requireSupabaseAdmin()
            .from("users")
            .update(sync)
            .eq("id", user.id);
          if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);
        }
      }
    }
  }

  // 2) Local-row scrypt fallback — profile row + password_hash column.
  if (!authenticated) {
    if (!user || !verifyPassword(password, user.passwordHash ?? "")) {
      throw new ApiError("Invalid email or password.", 401);
    }
    authenticated = true;
    if (user.supabaseAuthId === null && supabaseConfigured) {
      const r = await ensureSupabaseAuthUser(email, password, { name: user.name });
      if (r.ok && r.authId) {
        try {
          await requireSupabaseAdmin()
            .from("users")
            .update({ supabase_auth_id: r.authId })
            .eq("id", user.id);
        } catch {
          // best-effort backfill — ignore failures
        }
      }
    }
  }

  if (!user) throw new ApiError("Invalid email or password.", 401);
  if (user.isBanned) throw new ApiError("Your account has been suspended. Contact support.", 403);

  // last_login_at + IP/fingerprint backfill (only fill nulls, like local).
  const patch: Record<string, string> = { last_login_at: new Date().toISOString() };
  if (user.ipAddress === null) patch.ip_address = getClientIp(req);
  if (user.fingerprint === null && fingerprint) patch.fingerprint = fingerprint;
  if (backendBroken) {
    // broken-backend fallback: persist the backfill on the LOCAL row instead
    try {
      await db.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...(user.ipAddress === null ? { ipAddress: getClientIp(req) } : {}),
          ...(user.fingerprint === null && fingerprint ? { fingerprint } : {}),
        },
      });
    } catch {
      // best-effort only
    }
  } else {
    const { error: loginErr } = await requireSupabaseAdmin()
      .from("users")
      .update(patch)
      .eq("id", user.id);
    if (loginErr) throw new ApiError(`Supabase data backend error: ${loginErr.message}`, 500);
  }

  await setSessionCookie(await createSessionToken(user.id));
  return NextResponse.json({ user: toSessionUser(user) });
}

/* --------------------------------- session --------------------------------- */

export async function supabaseSession(): Promise<NextResponse> {
  // getSessionUser() already dispatched to the users table (with its own
  // local fallback when the Supabase data backend is unreachable).
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ user: null, wallet: null });
  }
  let wallet: Awaited<ReturnType<typeof fetchWalletOrNull>> = null;
  try {
    wallet = await fetchWalletOrNull(user.id);
  } catch {
    // broken-backend fallback: read the always-available local wallet
    const local = await db.wallet.findUnique({ where: { userId: user.id } }).catch(() => null);
    wallet = local ? { taskBalance: local.taskBalance, withdrawableBalance: local.withdrawableBalance } : null;
  }
  // Admin success-animation switches (visual layer only). An unreachable
  // backend keeps the professional defaults — every animation ON.
  let animations = DEFAULT_ANIMATION_SETTINGS;
  try {
    animations = getAnimationSettings(await getSupabaseSettings());
  } catch {
    /* defaults */
  }
  return NextResponse.json({
    user: toSessionUser(user),
    wallet,
    animations,
  });
}

/* --------------------------------- logout ---------------------------------- */

export async function supabaseLogout(): Promise<NextResponse> {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

/* ------------------------------ forgot password ---------------------------- */

interface ForgotBody {
  email?: string;
}

/**
 * SECURE recovery request (Supabase data backend). Mirrors the local route:
 * no app-side reset token is ever created or returned. When the Supabase Auth
 * project is configured, the provider emails the ACCOUNT OWNER a recovery
 * link (built-in GoTrue mechanism); only the recovery session inside that
 * link can authorize a password change.
 *
 * System/configuration failures (provider not configured, provider
 * unreachable, rate limit) are reported honestly with safe messages that
 * reveal nothing about whether the account exists; only a confirmed provider
 * acceptance gets the generic anti-enumeration response.
 */
export async function supabaseForgotPassword(req: Request): Promise<NextResponse> {
  const body = await parseJsonBody<ForgotBody>(req);
  const email = (body.email ?? "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError("Please enter a valid email address.", 400);
  }

  // No secure channel exists without the provider — report the configuration
  // state honestly (a system fact, not account information).
  if (!supabaseConfigured) {
    throw new ApiError(
      "Password recovery email is not configured on this deployment yet. Please contact support to reset your password.",
      503
    );
  }

  // Profile rows created while the provider env vars were missing have no
  // Supabase Auth record — GoTrue cannot email a recovery link for an unknown
  // email. Lazily link/create the auth record for an EXISTING app account
  // (random undisclosed placeholder password; no session; nothing returned)
  // so the owner's mailbox becomes reachable by the provider. For emails
  // without an app account this stays a no-op — the response below is
  // identical either way (no enumeration). Best-effort: a broken data backend
  // must not mask the provider's own delivery decision.
  try {
    const row = await fetchUserByEmail(email);
    if (row && !row.supabaseAuthId) {
      const authId = await ensureSupabaseAuthRecordForRecovery(email, row.name);
      if (authId) {
        const { error } = await requireSupabaseAdmin()
          .from("users")
          .update({ supabase_auth_id: authId })
          .eq("id", row.id);
        if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);
      }
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
  }

  const result = await supabaseSendRecoveryEmail(email, `${getPublicOrigin(req)}/#/reset-password`);
  if (result === "rate-limited") {
    // Honest provider state: the built-in email service throttles requests
    // (a few per hour). Still no account information is revealed.
    throw new ApiError(
      "Too many recovery emails have been requested. Please wait a while before requesting another.",
      429
    );
  }
  if (result !== "sent") {
    throw new ApiError(
      "The password recovery service could not be reached. Please try again in a few minutes.",
      502
    );
  }

  // Provider accepted the request. Generic response — do not leak account
  // existence (GoTrue itself emails only the owner, if the account exists).
  return NextResponse.json({ ok: true });
}

/* ------------------------------ reset password ----------------------------- */

interface ResetBody {
  supabaseAccessToken?: string;
  password?: string;
}

/**
 * Complete a password reset using the provider-issued RECOVERY SESSION (the
 * access_token delivered to the email owner inside the provider's recovery
 * link). The email address alone is never an authorization: without a valid
 * recovery session there is nothing to authenticate the change with. After
 * GoTrue rotates the password, the profile row's hash is kept in sync so the
 * local scrypt fallback login continues to work.
 */
export async function supabaseResetPassword(req: Request): Promise<NextResponse> {
  const body = await parseJsonBody<ResetBody>(req);

  const accessToken =
    typeof body.supabaseAccessToken === "string" ? body.supabaseAccessToken.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (password.length < 8) {
    throw new ApiError("New password must be at least 8 characters.", 400);
  }
  if (!accessToken) {
    throw new ApiError("Invalid or expired reset link.", 400);
  }
  if (!supabaseConfigured) {
    throw new ApiError(
      "Secure password recovery is not configured on this deployment. Please contact support.",
      400
    );
  }

  // Validates the recovery session with GoTrue and rotates the password
  // through the provider; throws a safe user-facing error on failure —
  // surfaced with the correct client-error status instead of a generic 500
  // (the reset is still blocked either way).
  let email: string;
  try {
    email = await supabaseCompleteRecovery(accessToken, password);
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : "Invalid or expired reset link.",
      400
    );
  }

  // Keep the profile row's scrypt hash in sync (the Supabase data backend's
  // fallback login path) — same behavior the previous implementation had.
  const { error } = await requireSupabaseAdmin()
    .from("users")
    .update({ password_hash: hashPassword(password) })
    .eq("email", email);
  if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);

  return NextResponse.json({ ok: true });
}

/* ------------------------- change password (profile) ------------------------ */

interface ChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

/**
 * POST /api/auth/change-password — the signed-in member rotates their own
 * password after confirming the current one. Mirrors the local route's
 * validation messages exactly.
 */
export async function supabaseChangePassword(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<ChangePasswordBody>(req);

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!user.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
    throw new ApiError("Your current password is incorrect.", 400);
  }
  if (newPassword.length < 8) {
    throw new ApiError("New password must be at least 8 characters.", 400);
  }
  if (newPassword === currentPassword) {
    throw new ApiError("New password must be different from your current password.", 400);
  }

  const { error } = await requireSupabaseAdmin()
    .from("users")
    .update({ password_hash: hashPassword(newPassword) })
    .eq("id", user.id);
  if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);

  // keep the Supabase Auth password in sync (best-effort, same as reset)
  if (supabaseConfigured) {
    ensureSupabaseAuthUser(user.email, newPassword, { name: user.name }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}

/* ------------------------- recovery email (profile) ------------------------- */

interface RecoveryEmailBody {
  recoveryEmail?: string;
}

const RECOVERY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** GET /api/auth/recovery-email — the member's saved recovery contact. */
export async function supabaseGetRecoveryEmail(): Promise<NextResponse> {
  const user = await requireAuth();
  return NextResponse.json({ recoveryEmail: user.recoveryEmail ?? null });
}

/** POST /api/auth/recovery-email — set (or clear) the recovery contact. */
export async function supabaseSetRecoveryEmail(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<RecoveryEmailBody>(req);

  const raw = typeof body.recoveryEmail === "string" ? body.recoveryEmail.trim() : "";
  if (raw && !RECOVERY_EMAIL_RE.test(raw)) {
    throw new ApiError("Enter a valid email address.", 400);
  }
  const recoveryEmail = raw ? raw.toLowerCase() : null;

  const { error } = await requireSupabaseAdmin()
    .from("users")
    .update({ recovery_email: recoveryEmail })
    .eq("id", user.id);
  if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);

  return NextResponse.json({ ok: true, recoveryEmail });
}
