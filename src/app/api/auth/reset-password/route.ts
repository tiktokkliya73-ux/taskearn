import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { supabaseCompleteRecovery, supabaseConfigured } from "@/lib/supabase";
import { supabaseResetPassword } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

interface ResetBody {
  supabaseAccessToken?: string;
  password?: string;
}

/**
 * SECURE password reset (completion step).
 *
 * SECURITY: a password can only be changed when the caller presents a valid
 * RECOVERY SESSION (`supabaseAccessToken`) that the authentication provider
 * (Supabase Auth / GoTrue) issued to the account owner's mailbox via the
 * recovery link. Knowing a member's email address alone is never enough —
 * there is no email+newPassword path, and no app-side reset tokens exist.
 * The provider validates the session and rotates the password itself; this
 * route only keeps the local profile hash in sync afterwards so the local
 * scrypt login fallback stays consistent.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseResetPassword(req);
    }

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

    // The provider validates the recovery session and rotates the password;
    // throws a safe user-facing error when the session is invalid/expired/
    // already used. Surface it with the correct client-error status instead
    // of the generic 500 (the reset is still blocked either way).
    let email: string;
    try {
      email = await supabaseCompleteRecovery(accessToken, password);
    } catch (err) {
      throw new ApiError(
        err instanceof Error ? err.message : "Invalid or expired reset link.",
        400
      );
    }

    // Keep the local scrypt hash in sync so the local login fallback (used
    // when the Supabase auth record is missing or out of sync) accepts the
    // new password too. Auth-only users simply have no local row.
    const localUser = await db.user.findUnique({ where: { email } });
    if (localUser) {
      await db.user.update({
        where: { id: localUser.id },
        data: { passwordHash: hashPassword(password) },
      });
    }

    return NextResponse.json({ ok: true });
  });
}
