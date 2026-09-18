import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { getActiveUserPlan, today, toTransactionDTO } from "@/lib/business";
import { daysLeft, fetchRecentNotifications, toSessionUser, toWalletData } from "../_lib/helpers";
import type { ActivePlanDTO } from "@/lib/types";
import { supabaseDashboard } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseDashboard();
    }

    const user = await requireAuth();

    const wallet = await db.wallet.findUnique({ where: { userId: user.id } });

    // Active plan summary (with completed-today count)
    const activeUserPlan = await getActiveUserPlan(user.id);
    let activePlan: ActivePlanDTO | null = null;
    if (activeUserPlan) {
      const completedToday = await db.userTask.count({
        where: { userId: user.id, date: today(), completedAt: { not: null } },
      });
      activePlan = {
        name: activeUserPlan.plan.name,
        rewardPerTask: activeUserPlan.plan.rewardPerTask,
        dailyLimit: activeUserPlan.plan.dailyTaskLimit,
        completedToday,
        daysLeft: daysLeft(activeUserPlan.expiresAt),
        startedAt: activeUserPlan.startedAt.toISOString(),
        expiresAt: activeUserPlan.expiresAt.toISOString(),
      };
    }

    // Referral stats
    const referred = await db.user.findMany({
      where: { referredById: user.id },
      select: { id: true },
    });
    const referredIds = referred.map((r) => r.id);
    let activated = 0;
    if (referredIds.length > 0) {
      const distinct = await db.userPlan.findMany({
        where: { userId: { in: referredIds } },
        select: { userId: true },
        distinct: ["userId"],
      });
      activated = distinct.length;
    }
    const unlockedAgg = await db.transaction.aggregate({
      _sum: { amount: true },
      where: { userId: user.id, type: "referral_unlock", status: "completed" },
    });

    const [pendingWithdrawals, recentTransactions, notifications] = await Promise.all([
      db.transaction.count({
        where: { userId: user.id, type: "withdrawal", status: "pending" },
      }),
      db.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      // Latest admin broadcasts — surfaced through the notification bell.
      fetchRecentNotifications(5),
    ]);

    return NextResponse.json({
      user: toSessionUser(user),
      wallet: wallet
        ? toWalletData(wallet)
        : { taskBalance: 0, withdrawableBalance: 0 },
      activePlan,
      referrals: {
        total: referredIds.length,
        activated,
        unlockedTotal: unlockedAgg._sum.amount ?? 0,
      },
      pendingWithdrawals,
      recentTransactions: recentTransactions.map(toTransactionDTO),
      notifications,
    });
  });
}
