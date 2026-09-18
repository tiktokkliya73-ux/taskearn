import { NextResponse } from "next/server";
import { handleRoute, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { supabaseAdminStats } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminStats();
    }

    await requireAdmin();

    const [
      totalDepositedAgg,
      totalWithdrawnAgg,
      pendingPayoutsCount,
      pendingPayoutsAgg,
      activeUsers,
      bannedUsers,
      totalUsers,
      taskRewardsAgg,
      recentTransactions,
      pendingDepositsCount,
      pendingDepositsAgg,
      activePackages,
      activeTasks,
      openSupportCount,
      unseenSupportCount,
    ] = await Promise.all([
      db.transaction.aggregate({ _sum: { amount: true }, where: { type: "deposit", status: "approved" } }),
      db.transaction.aggregate({ _sum: { amount: true }, where: { type: "withdrawal", status: "approved" } }),
      db.transaction.count({ where: { type: "withdrawal", status: "pending" } }),
      db.transaction.aggregate({ _sum: { amount: true }, where: { type: "withdrawal", status: "pending" } }),
      db.user.count({ where: { isBanned: false } }),
      db.user.count({ where: { isBanned: true } }),
      db.user.count(),
      db.transaction.aggregate({ _sum: { amount: true }, where: { type: "task_reward", status: "completed" } }),
      db.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { user: { select: { name: true, email: true } } },
      }),
      // Payment submissions awaiting review — mirrors the admin Deposits list
      // (deposit + plan_purchase + package_purchase money-in purposes).
      db.transaction.count({
        where: {
          type: { in: ["deposit", "plan_purchase", "package_purchase"] },
          status: "pending",
        },
      }),
      db.transaction.aggregate({
        _sum: { amount: true },
        where: {
          type: { in: ["deposit", "plan_purchase", "package_purchase"] },
          status: "pending",
        },
      }),
      db.investmentPackage.count({ where: { isActive: true } }),
      db.task.count({ where: { isActive: true } }),
      // Member support requests awaiting an admin reply.
      db.supportTicket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      // Individual member messages an admin has NOT opened yet (null
      // adminSeenAt = unseen). Drives the sidebar Support badge: it counts
      // per message, decrements each time the admin opens one and hides at 0.
      db.supportTicket.count({ where: { adminSeenAt: null } }),
    ]);

    // 7-day series (oldest → newest), grouped by UTC date.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const seriesStart = new Date(todayStart.getTime() - 6 * DAY_MS);

    const seriesTxns = await db.transaction.findMany({
      where: {
        createdAt: { gte: seriesStart },
        OR: [
          { type: "deposit", status: "approved" },
          { type: "withdrawal", status: "approved" },
          { type: "task_reward", status: "completed" },
        ],
      },
      select: { type: true, amount: true, createdAt: true },
    });

    const dayMap = new Map<string, { deposits: number; withdrawals: number; rewards: number }>();
    for (let i = 6; i >= 0; i--) {
      const key = new Date(todayStart.getTime() - i * DAY_MS).toISOString().slice(0, 10);
      dayMap.set(key, { deposits: 0, withdrawals: 0, rewards: 0 });
    }
    for (const t of seriesTxns) {
      const entry = dayMap.get(t.createdAt.toISOString().slice(0, 10));
      if (!entry) continue;
      if (t.type === "deposit") entry.deposits += t.amount;
      else if (t.type === "withdrawal") entry.withdrawals += t.amount;
      else if (t.type === "task_reward") entry.rewards += t.amount;
    }

    return NextResponse.json({
      totalDeposited: totalDepositedAgg._sum.amount ?? 0,
      totalWithdrawn: totalWithdrawnAgg._sum.amount ?? 0,
      pendingPayoutsCount,
      pendingPayoutsAmount: pendingPayoutsAgg._sum.amount ?? 0,
      pendingDepositsCount,
      pendingDepositsAmount: pendingDepositsAgg._sum.amount ?? 0,
      activeUsers,
      bannedUsers,
      totalUsers,
      taskRewardsPaid: taskRewardsAgg._sum.amount ?? 0,
      activePackages,
      activeTasks,
      openSupportCount,
      unseenSupportCount,
      series: [...dayMap.entries()].map(([date, v]) => ({ date, ...v })),
      recentTransactions: recentTransactions.map(toTransactionDTO),
    });
  });
}
