import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toUserPackageDTO } from "../_lib/helpers";
import { supabasePackagesGet } from "@/server/supabase/user-routes";
import type { PackagesResponseDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/packages — the Investment Plans catalogue for members.
 * Returns active packages (admin-managed, sorted), the signed-in user's
 * package instances, and portfolio totals. Auth required.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePackagesGet();
    }

    const user = await requireAuth();

    const [packages, myPackages, earnedAgg] = await Promise.all([
      db.investmentPackage.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
      }),
      db.userPackage.findMany({
        where: { userId: user.id },
        include: { pkg: { select: { title: true, dailyEarning: true } } },
        orderBy: { startedAt: "desc" },
      }),
      db.transaction.aggregate({
        where: { userId: user.id, type: "daily_earning", status: "completed" },
        _sum: { amount: true },
      }),
    ]);

    const active = myPackages.filter(
      (p) => p.status === "active" && p.endsAt.getTime() > Date.now()
    );

    const body: PackagesResponseDTO = {
      packages: packages.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        price: p.price,
        dailyEarning: p.dailyEarning,
        durationDays: p.durationDays,
        totalReturn: p.totalReturn,
        netProfit: p.netProfit,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
      })),
      myPackages: myPackages.map(toUserPackageDTO),
      totals: {
        activeCount: active.length,
        // LIVE package config — the members' daily income follows the admin's
        // current package settings without any per-user update.
        dailyIncome: active.reduce((sum, p) => sum + (p.pkg?.dailyEarning ?? p.dailyEarning), 0),
        investedTotal: myPackages.reduce((sum, p) => sum + p.investAmount, 0),
        earnedTotal: earnedAgg._sum.amount ?? 0,
      },
    };

    return NextResponse.json(body);
  });
}
