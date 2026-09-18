import { NextResponse } from "next/server";
import { ApiError, getPublicOrigin, handleRoute, parseJsonBody } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  ensureSupabaseAuthRecordForRecovery,
  supabaseConfigured,
  supabaseSendRecoveryEmail,
} from "@/lib/supabase";
import { supabaseForgotPassword } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

interface ForgotBody {
  email?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SECURE password recovery (request step).
 *
 * SECURITY: knowing a member's email address is NEVER authorization to change
 * that member's password. This endpoint never issues, stores or returns any
 * app-side reset token. When the Supabase Auth project is configured, the
 * provider's own recovery mechanism emails the ACCOUNT OWNER a link that
 * carries a short-lived recovery session; only that session (proof of mailbox
 * ownership) can complete a reset via /api/auth/reset-password.
 *
 * HONEST SYSTEM ERRORS: a recovery email can only be sent through the
 * authentication provider's secure channel. When the provider is not
 * configured — or the provider call itself fails (network / provider /
 * rate-limit) — that is a SYSTEM/CONFIGURATION error, not a successful
 * request, so it is reported honestly with a safe message that reveals
 * nothing about whether the account exists. Only a confirmed provider
 * acceptance gets the generic anti-enumeration response.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseForgotPassword(req);
    }

    const body = await parseJsonBody<ForgotBody>(req);
    const email = (body.email ?? "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) {
      throw new ApiError("Please enter a valid email address.", 400);
    }

    // No Supabase Auth project configured → no secure channel exists that can
    // prove mailbox ownership. Report the configuration state honestly
    // (this is a system fact, not account information) instead of pretending
    // a recovery link was sent.
    if (!supabaseConfigured) {
      throw new ApiError(
        "Password recovery email is not configured on this deployment yet. Please contact support to reset your password.",
        503
      );
    }

    // Local-track members who signed up while the provider env vars were
    // missing have no Supabase Auth record — GoTrue cannot email a recovery
    // link for an unknown email. Lazily link/create the auth record for an
    // EXISTING app account (random undisclosed placeholder password; no
    // session; nothing returned to the caller) so the owner's mailbox becomes
    // reachable by the provider. For emails without an app account this stays
    // a no-op — the response below is identical either way (no enumeration).
    const localUser = await db.user.findUnique({ where: { email } }).catch(() => null);
    if (localUser && !localUser.supabaseAuthId) {
      const authId = await ensureSupabaseAuthRecordForRecovery(email, localUser.name);
      if (authId) {
        await db.user
          .update({ where: { id: localUser.id }, data: { supabaseAuthId: authId } })
          .catch(() => undefined); // best-effort link — recovery works regardless
      }
    }

    // Provider-native recovery: GoTrue emails the owner a secure link that
    // redirects back to the app with the recovery session in the fragment.
    const result = await supabaseSendRecoveryEmail(
      email,
      `${getPublicOrigin(req)}/#/reset-password`
    );
    if (result === "rate-limited") {
      // Honest provider state: the built-in email service throttles requests
      // (a few per hour). Still no account information is revealed.
      throw new ApiError(
        "Too many recovery emails have been requested. Please wait a while before requesting another.",
        429
      );
    }
    if (result !== "sent") {
      // The provider itself failed (unreachable / rejected the request).
      // Honest system error — still no account information.
      throw new ApiError(
        "The password recovery service could not be reached. Please try again in a few minutes.",
        502
      );
    }

    // Provider accepted the request. Generic response — do not leak account
    // existence (GoTrue itself emails only the owner, if the account exists).
    return NextResponse.json({ ok: true });
  });
}
