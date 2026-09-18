import { randomBytes } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * TaskEarn Supabase integration (server-only).
 *
 * The service-role key must NEVER reach the client — every Supabase call in
 * this app happens inside API routes. Wallet mutations against the Supabase
 * data backend go through SECURITY DEFINER RPC functions (see
 * db/supabase-schema.sql), mirroring the original PRD design.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabaseAdmin: SupabaseClient | null =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

export const supabaseConfigured = Boolean(SUPABASE_URL && SERVICE_KEY);
export const SUPABASE_PROJECT_URL = SUPABASE_URL;

export interface AuthSyncResult {
  ok: boolean;
  authId?: string | null;
  exists?: boolean;
  error?: string;
}

/** Scan the auth user list (admin API) for an email. Small scale: a few pages. */
async function findAuthUser(email: string): Promise<{ id: string } | null> {
  if (!supabaseAdmin) return null;
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const users = (data as { users?: { id: string; email?: string }[] }).users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return { id: hit.id };
    if (users.length < perPage) return null;
  }
  return null;
}

/**
 * Create (or update) a Supabase Auth user so the account is visible in the
 * project's Authentication → Users list. Passwords stay in sync.
 * Best-effort: failures are reported, callers decide whether to fall back.
 */
export async function ensureSupabaseAuthUser(
  email: string,
  password: string,
  metadata: { name?: string; referral_code?: string } = {}
): Promise<AuthSyncResult> {
  if (!supabaseAdmin) return { ok: false, error: "supabase-not-configured" };
  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: metadata.name ?? "", referral_code: metadata.referral_code ?? "" },
    });
    if (!error && data?.user) return { ok: true, authId: data.user.id, exists: false };
    const msg = error?.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      const found = await findAuthUser(email);
      if (found) {
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(found.id, {
          password,
          email_confirm: true,
          user_metadata: { name: metadata.name ?? "", referral_code: metadata.referral_code ?? "" },
        });
        if (!updErr) return { ok: true, authId: found.id, exists: true };
        return { ok: false, error: updErr?.message ?? "update-failed" };
      }
    }
    return { ok: false, error: msg || "create-failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Verify email+password against the project's Supabase Auth (password grant).
 * Returns the auth user on success; the session is discarded (the app issues
 * its own httpOnly-cookie session afterwards).
 */
export async function supabasePasswordSignIn(
  email: string,
  password: string
): Promise<{ ok: boolean; authId?: string | null; name?: string; error?: string }> {
  if (!supabaseAdmin) return { ok: false, error: "supabase-not-configured" };
  try {
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error || !data?.user) {
      return { ok: false, error: error?.message ?? "invalid-credentials" };
    }
    const name =
      (data.user.user_metadata as { name?: string } | null)?.name ?? undefined;
    await supabaseAdmin.auth.signOut().catch(() => undefined);
    return { ok: true, authId: data.user.id, name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type RecoverySendResult = "sent" | "rate-limited" | "failed";

/**
 * Ask the project's Supabase Auth (GoTrue) to email the ACCOUNT OWNER a secure
 * password-recovery link (the provider's built-in recovery mechanism, implicit
 * flow). The emailed link redirects back to `redirectTo` carrying a short-lived
 * recovery session in the URL fragment — only someone with access to that
 * mailbox can open it. Never issues app-side reset tokens and never reveals
 * whether the account exists; callers must respond generically either way.
 *
 * The provider's honest system states are preserved (never masked as success):
 * "sent" = provider accepted the request (an email goes out only for mailboxes
 * of existing auth users — GoTrue stays silent otherwise, which is exactly the
 * anti-enumeration behavior we want); "rate-limited" = the provider throttled
 * the request (built-in email service allows only a few messages per hour);
 * "failed" = provider unreachable / rejected the request.
 */
export async function supabaseSendRecoveryEmail(
  email: string,
  redirectTo: string
): Promise<RecoverySendResult> {
  if (!supabaseAdmin) return "failed";
  try {
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
    if (!error) return "sent";
    if (error.status === 429 || /rate.?limit/i.test(error.message ?? "")) {
      return "rate-limited";
    }
    return "failed";
  } catch {
    return "failed";
  }
}

const INVALID_RECOVERY_LINK =
  "This recovery link is invalid or has expired. Please request a new one.";

/**
 * Lazily link (or create) the Supabase Auth record for an EXISTING app account
 * so the provider can deliver a recovery email to that account's mailbox.
 *
 * Why this exists: members who signed up while the provider env vars were
 * absent have a local profile row but no Supabase Auth record — GoTrue cannot
 * email a recovery link for an email it does not know, so their self-service
 * recovery would silently never deliver. This runs ONLY inside the recovery
 * REQUEST step (server-side, service-role):
 *
 * SECURITY: creating this record grants nobody anything. The placeholder
 * password is a cryptographically random secret that is never returned,
 * logged, stored app-side, or communicated to anyone — it exists only so the
 * auth record is complete. No session is issued. The recovery email still goes
 * exclusively to the account owner's mailbox, and a password can still only be
 * changed with the provider-issued recovery session from that mailbox. Knowing
 * the email address alone remains useless.
 *
 * Returns the auth user id (so the caller can keep its profile link in sync),
 * or null when the provider is unavailable — the caller then still lets the
 * provider decide whether an email can be sent.
 */
export async function ensureSupabaseAuthRecordForRecovery(
  email: string,
  name?: string
): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    // Already has an auth record → just return its id (never touch credentials).
    const existing = await findAuthUser(email);
    if (existing) return existing.id;

    // No auth record → create one with an undisclosed random password.
    const randomPassword = randomBytes(24).toString("base64url");
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { name: name ?? "" },
    });
    if (!error && data?.user) return data.user.id;
    if (error && /already|registered|exists/i.test(error.message ?? "")) {
      // Lost the race (e.g. concurrent request) — the record exists now.
      const found = await findAuthUser(email);
      return found?.id ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Complete a password reset using a Supabase Auth RECOVERY SESSION (the
 * `access_token` issued to the email owner via the provider's recovery link).
 *
 * The session is validated by GoTrue itself and the password is updated through
 * GoTrue's own user endpoint — exactly what supabase-js `updateUser` does after
 * a PASSWORD_RECOVERY event. An email address alone can never authorize this:
 * without the provider-issued recovery session there is nothing to call it with.
 *
 * Returns the account email (so callers can keep their profile hash in sync)
 * or throws an Error with a safe, user-facing message.
 */
export async function supabaseCompleteRecovery(
  accessToken: string,
  newPassword: string
): Promise<string> {
  if (!supabaseAdmin) {
    throw new Error(
      "Secure password recovery is not configured on this deployment. Please contact support."
    );
  }
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  let email: string | undefined;
  let failure: string | null = null;
  try {
    // 1) Validate the recovery session with the provider and resolve the
    //    account it belongs to.
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
    if (who.ok) {
      const user = (await who.json().catch(() => null)) as { email?: string } | null;
      email = user?.email ? user.email.toLowerCase() : undefined;
    } else {
      failure = INVALID_RECOVERY_LINK;
    }
    // 2) Rotate the password through the provider's user endpoint.
    if (email) {
      const upd = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ password: newPassword }),
      });
      if (!upd.ok) {
        failure = "We couldn't update your password. Please request a new recovery link.";
      }
    }
  } catch {
    failure = "Password recovery service is unreachable. Please try again.";
  }
  if (failure || !email) throw new Error(failure ?? INVALID_RECOVERY_LINK);
  return email;
}

/** Quick check whether the Supabase data backend tables exist yet. */
export async function supabaseDataProvisioned(): Promise<{
  provisioned: boolean;
  error?: string;
  userCount?: number;
}> {
  if (!supabaseAdmin) return { provisioned: false, error: "supabase-not-configured" };
  try {
    // NOTE: `head: true` (HTTP HEAD) swallows PostgREST 404s for missing
    // tables (no body → no parsed error), which produced a false "provisioned"
    // result. A plain GET with count=exact surfaces the schema-cache error.
    const { count, error } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact" })
      .limit(1);
    if (error) {
      return { provisioned: false, error: error.message };
    }
    // The investment-packages extension (Task 12) must exist too — older
    // deployments that ran a previous version of db/supabase-schema.sql need
    // one idempotent re-run before the packages engine works in Supabase mode.
    // NOTE: plain GET (not head:true) so PostgREST 404s surface as errors.
    const { error: pkgError } = await supabaseAdmin
      .from("investment_packages")
      .select("id", { count: "exact" })
      .limit(1);
    if (pkgError) {
      return {
        provisioned: false,
        error: `investment_packages missing — re-run the SQL script (${pkgError.message})`,
      };
    }
    // The dynamic-home extension (Task 15: promo codes + claims) likewise.
    const { error: promoError } = await supabaseAdmin
      .from("promo_codes")
      .select("id", { count: "exact" })
      .limit(1);
    if (promoError) {
      return {
        provisioned: false,
        error: `promo_codes missing — re-run the SQL script (${promoError.message})`,
      };
    }
    return { provisioned: true, userCount: count ?? 0 };
  } catch (e) {
    return { provisioned: false, error: e instanceof Error ? e.message : String(e) };
  }
}
