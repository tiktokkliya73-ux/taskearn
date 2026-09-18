import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { TELEGRAM_PROMO_CODE } from "@/lib/home-data";
import { supabaseAdminHomePromo } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface PromoPostBody {
  action?: string;
  id?: string;
  code?: string;
  title?: string;
  rewardAmount?: number | string;
  maxUses?: number | string | null;
  isActive?: boolean;
}

function coerceNonNegativeInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

/**
 * POST /api/admin/home/promo — action: create | update | toggle | delete.
 * The system TELEGRAM row can be toggled but never renamed or deleted.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminHomePromo(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<PromoPostBody>(req);
    const action = (body.action ?? "").trim();

    if (action === "create") {
      const code = normalizeCode(body.code);
      if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
        throw new ApiError("Code must be 3-32 letters, numbers, dash or underscore.", 400);
      }
      if (code === TELEGRAM_PROMO_CODE) {
        throw new ApiError("TELEGRAM is reserved for the system reward.", 400);
      }
      const exists = await db.promoCode.findUnique({ where: { code } });
      if (exists) throw new ApiError("This code already exists.", 400);

      const reward = coerceNonNegativeInt(body.rewardAmount);
      if (reward === null || reward < 1) {
        throw new ApiError("Reward amount must be a positive integer (PKR).", 400);
      }

      let maxUses: number | null = null; // unlimited by default
      if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== "") {
        const m = coerceNonNegativeInt(body.maxUses);
        if (m === null || m < 1) throw new ApiError("Usage limit must be a positive integer.", 400);
        maxUses = m;
      }

      await db.promoCode.create({
        data: {
          code,
          title: String(body.title ?? "").trim(),
          rewardAmount: reward,
          maxUses,
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
        },
      });
    } else if (action === "update") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.promoCode.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Promo code not found.", 400);

      const data: Record<string, string | number | boolean | null> = {};
      if (body.code !== undefined) {
        const code = normalizeCode(body.code);
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
          throw new ApiError("Code must be 3-32 letters, numbers, dash or underscore.", 400);
        }
        if (existing.isSystem && code !== existing.code) {
          throw new ApiError("The system reward code cannot be renamed.", 400);
        }
        const clash = code !== existing.code ? await db.promoCode.findUnique({ where: { code } }) : null;
        if (clash) throw new ApiError("This code already exists.", 400);
        data.code = code;
      }
      if (body.title !== undefined) data.title = String(body.title).trim();
      if (body.rewardAmount !== undefined) {
        const reward = coerceNonNegativeInt(body.rewardAmount);
        if (reward === null || reward < 1) {
          throw new ApiError("Reward amount must be a positive integer (PKR).", 400);
        }
        data.rewardAmount = reward;
      }
      if (body.maxUses === null || body.maxUses === "") {
        data.maxUses = null; // cleared → unlimited
      } else if (body.maxUses !== undefined) {
        const m = coerceNonNegativeInt(body.maxUses);
        if (m === null || m < 1) throw new ApiError("Usage limit must be a positive integer.", 400);
        data.maxUses = m;
      }
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

      await db.promoCode.update({ where: { id }, data });
    } else if (action === "toggle") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.promoCode.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Promo code not found.", 400);
      await db.promoCode.update({ where: { id }, data: { isActive: !existing.isActive } });
    } else if (action === "delete") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.promoCode.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Promo code not found.", 400);
      if (existing.isSystem) {
        throw new ApiError("The system Telegram reward cannot be deleted.", 400);
      }
      await db.promoCode.delete({ where: { id } });
    } else {
      throw new ApiError("Unknown action. Use create, update, toggle or delete.", 400);
    }

    return NextResponse.json({ ok: true });
  });
}
