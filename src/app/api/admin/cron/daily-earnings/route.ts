import { NextResponse } from "next/server";
import { handleRoute, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { runDailyEarnings } from "@/lib/business";
import { db } from "@/lib/db";
import { supabaseAdminCronDailyEarnings } from "@/server/supabase/admin-routes";
import type { DailyEarningsSummaryDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cron/daily-earnings — manual/scheduled trigger for the
 * nightly earnings distribution. The standalone cron script
 * (scripts/daily-earnings.ts) runs the same engine; this endpoint lets an
 * admin run it on demand and see the per-user summary. Idempotent per day.
 */
export async function POST() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminCronDailyEarnings();
    }

    await requireAdmin();
    const summary: DailyEarningsSummaryDTO = await db.$transaction((tx) => runDailyEarnings(tx));
    return NextResponse.json(summary);
  });
}
