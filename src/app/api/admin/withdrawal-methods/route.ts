import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { listAllWithdrawalMethods, toWithdrawalMethodDTO } from "@/lib/business";
import { isImageSourceUrl } from "../../_lib/helpers";
import { supabaseAdminWithdrawalMethodsGet, supabaseAdminWithdrawalMethodsPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface WithdrawalMethodPostBody {
  action?: string; // update | toggle (the channel set itself is fixed)
  id?: string;
  logoUrl?: string;
  sortOrder?: number | string;
  isActive?: boolean;
}

/** All channels (admin list), sorted by display order. */
async function fetchAllWithdrawalMethods() {
  const rows = await listAllWithdrawalMethods();
  return rows.map(toWithdrawalMethodDTO);
}

function coerceSortOrder(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * GET  /api/admin/withdrawal-methods — every withdrawal channel (admin manager).
 * POST /api/admin/withdrawal-methods — action: update | toggle.
 *
 * The channel set is FIXED (the seven payout channels members pick from on
 * the Withdraw page: EasyPaisa, JazzCash, UPaisa, SadaPay, NayaPay, UBL Bank,
 * Bank Al Habib) — no create/delete. The admin manages each channel's logo
 * image, display order and enable state; changes go live on the Withdraw
 * page dropdown instantly.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminWithdrawalMethodsGet();
    }
    await requireAdmin();
    return NextResponse.json({ methods: await fetchAllWithdrawalMethods() });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminWithdrawalMethodsPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<WithdrawalMethodPostBody>(req);
    const action = (body.action ?? "").trim();

    const id = (body.id ?? "").trim();
    const existing = id ? await db.withdrawalMethod.findUnique({ where: { id } }) : null;
    if (!existing) throw new ApiError("Withdrawal method not found.", 400);

    if (action === "update") {
      const logoUrl = (body.logoUrl ?? "").trim();
      if (logoUrl && !isImageSourceUrl(logoUrl)) {
        throw new ApiError(
          "Logo image must be an http(s) URL or an uploaded image (JPG, PNG or WEBP).",
          400,
        );
      }
      const nextActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive;
      if (existing.isActive && !nextActive) {
        const remaining = await db.withdrawalMethod.count({
          where: { isActive: true, id: { not: existing.id } },
        });
        if (remaining === 0) {
          throw new ApiError("At least one withdrawal method must stay enabled.", 400);
        }
      }
      const sortOrder = coerceSortOrder(body.sortOrder);
      await db.withdrawalMethod.update({
        where: { id },
        data: {
          // Partial update: only fields actually sent are written.
          ...(body.logoUrl !== undefined ? { logoUrl: logoUrl || null } : {}),
          ...(sortOrder !== null ? { sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: nextActive } : {}),
        },
      });
    } else if (action === "toggle") {
      const remaining = await db.withdrawalMethod.count({
        where: { isActive: true, id: { not: existing.id } },
      });
      if (existing.isActive && remaining === 0) {
        throw new ApiError("At least one withdrawal method must stay enabled.", 400);
      }
      await db.withdrawalMethod.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });
    } else {
      throw new ApiError("Unknown action. Use update or toggle.", 400);
    }

    return NextResponse.json({ methods: await fetchAllWithdrawalMethods() });
  });
}
