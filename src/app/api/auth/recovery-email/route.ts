import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  supabaseGetRecoveryEmail,
  supabaseSetRecoveryEmail,
} from "@/server/supabase/auth-routes";
import type { AccountActionResponseDTO, RecoveryEmailResponseDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecoveryEmailBody {
  recoveryEmail?: string;
}

/**
 * GET /api/auth/recovery-email — the member's saved recovery contact
 * (null when none is set). POST sets or clears it. Purely additive — the
 * forgot-password flow itself is untouched.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseGetRecoveryEmail();
    }

    const user = await requireAuth();
    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { recoveryEmail: true },
    });
    const body: RecoveryEmailResponseDTO = { recoveryEmail: row?.recoveryEmail ?? null };
    return NextResponse.json(body);
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseSetRecoveryEmail(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<RecoveryEmailBody>(req);

    const raw = typeof body.recoveryEmail === "string" ? body.recoveryEmail.trim() : "";
    if (raw && !EMAIL_RE.test(raw)) {
      throw new ApiError("Enter a valid email address.", 400);
    }
    const recoveryEmail = raw ? raw.toLowerCase() : null;

    await db.user.update({ where: { id: user.id }, data: { recoveryEmail } });

    const res: AccountActionResponseDTO = { ok: true, recoveryEmail };
    return NextResponse.json(res);
  });
}
