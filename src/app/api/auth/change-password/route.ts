import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { ensureSupabaseAuthUser, supabaseConfigured } from "@/lib/supabase";
import { supabaseChangePassword } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

interface ChangePasswordBody {
  currentPassword?: string;
  newPassword?: string;
}

/**
 * POST /api/auth/change-password — the signed-in member rotates their own
 * password after confirming the current one. Purely additive: login, signup,
 * sessions and reset links are untouched. The Supabase Auth password is kept
 * in sync best-effort (same pattern as the reset-password route).
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseChangePassword(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<ChangePasswordBody>(req);

    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

    const stored = await db.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!stored || !verifyPassword(currentPassword, stored.passwordHash)) {
      throw new ApiError("Your current password is incorrect.", 400);
    }
    if (newPassword.length < 8) {
      throw new ApiError("New password must be at least 8 characters.", 400);
    }
    if (newPassword === currentPassword) {
      throw new ApiError("New password must be different from your current password.", 400);
    }

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(newPassword) },
    });

    // keep the Supabase Auth password in sync (best-effort, same as reset)
    if (supabaseConfigured) {
      ensureSupabaseAuthUser(user.email, newPassword, { name: user.name }).catch(() => undefined);
    }

    return NextResponse.json({ ok: true });
  });
}
