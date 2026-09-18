import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { supabasePublicStats } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicStats();
    }

    const [users, paidOutAgg, tasksCompleted, activePlans] = await Promise.all([
      db.user.count(),
      db.transaction.aggregate({
        _sum: { amount: true },
        where: { type: "withdrawal", status: "approved" },
      }),
      db.transaction.count({ where: { type: "task_reward" } }),
      db.userPlan.count({ where: { status: "active", expiresAt: { gt: new Date() } } }),
    ]);

    return NextResponse.json({
      users,
      paidOut: paidOutAgg._sum.amount ?? 0,
      tasksCompleted,
      activePlans,
    });
  });
}
