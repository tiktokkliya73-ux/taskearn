import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { assertPackageNumbersFit, assertSortOrderFits } from "@/lib/package-limits";
import { db } from "@/lib/db";
import { toPackageDTO } from "../../_lib/helpers";
import { supabaseAdminPackagesGet, supabaseAdminPackagesPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface PackagePostBody {
  action?: string;
  id?: string;
  title?: string;
  description?: string | null;
  price?: number | string;
  dailyEarning?: number | string;
  durationDays?: number | string;
  totalReturn?: number | string | null;
  sortOrder?: number | string;
  isActive?: boolean;
}

const NUMERIC_FIELDS = ["price", "dailyEarning", "durationDays"] as const;

/**
 * GET /api/admin/packages — every investment package (active + disabled),
 * sorted by display priority.
 * POST /api/admin/packages — action: create | update | toggle.
 *
 * totalReturn defaults to dailyEarning * durationDays and may be overridden
 * with a custom value; netProfit is ALWAYS derived (totalReturn - price).
 * sortOrder sets the card display order (lowest first).
 *
 * Every numeric input is range-checked against the Int column limit
 * (packages hotfix): an oversized create previously stored values SQLite
 * accepted but Prisma could not read back (P2023), which broke the catalog
 * with "Could not load packages".
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPackagesGet();
    }

    await requireAdmin();
    const [packages, instanceAgg, activeAgg, earnedAgg] = await Promise.all([
      db.investmentPackage.findMany({
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      db.userPackage.aggregate({
        _count: { _all: true },
        _sum: { investAmount: true, dailyEarning: true },
      }),
      db.userPackage.aggregate({
        where: { status: "active", endsAt: { gt: new Date() } },
        _count: { _all: true },
        _sum: { dailyEarning: true },
      }),
      db.transaction.aggregate({
        where: { type: "daily_earning", status: "completed" },
        _sum: { amount: true },
      }),
    ]);
    return NextResponse.json({
      packages: packages.map(toPackageDTO),
      stats: {
        totalInstances: instanceAgg._count._all,
        activeInstances: activeAgg._count._all,
        totalInvested: instanceAgg._sum.investAmount ?? 0,
        dailyLiability: activeAgg._sum.dailyEarning ?? 0,
        totalEarnedPaid: earnedAgg._sum.amount ?? 0,
      },
    });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPackagesPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<PackagePostBody>(req);
    const action = (body.action ?? "").trim();

    if (action === "create") {
      const title = (body.title ?? "").trim();
      if (title.length < 2) throw new ApiError("Package title must be at least 2 characters.", 400);

      const nums: Record<string, number> = {};
      for (const field of NUMERIC_FIELDS) {
        const n = coercePositiveInt(body[field]);
        if (n === null) {
          throw new ApiError("Price, daily earnings and duration must be positive integers.", 400);
        }
        nums[field] = n;
      }

      // Total return: custom override or auto-calculated daily * duration.
      let totalReturn: number;
      if (body.totalReturn === undefined || body.totalReturn === null || body.totalReturn === "") {
        totalReturn = nums.dailyEarning * nums.durationDays;
      } else {
        const t = coercePositiveInt(body.totalReturn);
        if (t === null) throw new ApiError("Total return must be a positive integer.", 400);
        totalReturn = t;
      }

      let sortOrder: number;
      if (body.sortOrder === undefined || body.sortOrder === null || body.sortOrder === "") {
        const max = await db.investmentPackage.aggregate({ _max: { sortOrder: true } });
        sortOrder = (max._max.sortOrder ?? 0) + 1;
      } else {
        const s = coerceInt(body.sortOrder);
        if (s === null) throw new ApiError("Priority must be an integer.", 400);
        sortOrder = s;
      }

      // Reject values the Int columns cannot hold BEFORE writing them.
      assertPackageNumbersFit({
        price: nums.price,
        dailyEarning: nums.dailyEarning,
        durationDays: nums.durationDays,
        totalReturn,
      });
      assertSortOrderFits(sortOrder);

      await db.investmentPackage.create({
        data: {
          title,
          description: cleanDescription(body.description),
          price: nums.price,
          dailyEarning: nums.dailyEarning,
          durationDays: nums.durationDays,
          totalReturn,
          netProfit: totalReturn - nums.price,
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
          sortOrder,
        },
      });
    } else if (action === "update") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.investmentPackage.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Package not found.", 400);

      const data: Record<string, number | string | boolean | null> = {};
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (title.length < 2) throw new ApiError("Package title must be at least 2 characters.", 400);
        data.title = title;
      }
      if (body.description !== undefined) {
        data.description = cleanDescription(body.description);
      }

      const nums: Record<string, number> = {};
      for (const field of NUMERIC_FIELDS) {
        if (body[field] !== undefined) {
          const n = coercePositiveInt(body[field]);
          if (n === null) throw new ApiError(`${field} must be a positive integer.`, 400);
          nums[field] = n;
          data[field] = n;
        }
      }

      // Resolve the effective total return after any field updates.
      const daily = nums.dailyEarning ?? existing.dailyEarning;
      const duration = nums.durationDays ?? existing.durationDays;
      const price = nums.price ?? existing.price;

      if (body.totalReturn === undefined) {
        // No explicit total supplied → keep auto-calculated when it was, or
        // recompute if the inputs changed.
        const auto = daily * duration;
        data.totalReturn = existing.totalReturn === existing.dailyEarning * existing.durationDays
          ? auto
          : existing.totalReturn;
      } else if (body.totalReturn === null || body.totalReturn === "") {
        data.totalReturn = daily * duration; // cleared → back to auto
      } else {
        const t = coercePositiveInt(body.totalReturn);
        if (t === null) throw new ApiError("Total return must be a positive integer.", 400);
        data.totalReturn = t;
      }
      data.netProfit = (data.totalReturn as number) - price;

      // Reject values the Int columns cannot hold BEFORE writing them
      // (checks the resolved numbers whether or not they changed).
      assertPackageNumbersFit({ price, dailyEarning: daily, durationDays: duration, totalReturn: data.totalReturn as number });

      if (body.sortOrder !== undefined) {
        const s = coerceInt(body.sortOrder);
        if (s === null) throw new ApiError("Priority must be an integer.", 400);
        data.sortOrder = s;
        assertSortOrderFits(s);
      }
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

      await db.investmentPackage.update({ where: { id }, data });
    } else if (action === "toggle") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.investmentPackage.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Package not found.", 400);
      await db.investmentPackage.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });
    } else {
      throw new ApiError("Unknown action. Use create, update or toggle.", 400);
    }

    const packages = await db.investmentPackage.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ packages: packages.map(toPackageDTO) });
  });
}

function coercePositiveInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function coerceInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Trim + cap the optional package description (500 chars). */
function cleanDescription(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, 500);
  return s || null;
}
