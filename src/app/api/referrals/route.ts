import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { getRenderedInviteConfig } from "@/lib/invite";
import { getSettings } from "@/lib/settings";
import type { ReferralsResponseDTO } from "@/lib/types";
import { supabaseReferrals } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseReferrals();
    }

    const user = await requireAuth();

    const referred = await db.user.findMany({
      where: { referredById: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    });
    const referredIds = referred.map((r) => r.id);

    const userPlans = referredIds.length
      ? await db.userPlan.findMany({
          where: { userId: { in: referredIds } },
          include: { plan: { select: { name: true } } },
          orderBy: { startedAt: "desc" },
        })
      : [];

    // Latest plan per referred user
    const latestPlanByUser = new Map<string, string>();
    for (const up of userPlans) {
      if (!latestPlanByUser.has(up.userId)) latestPlanByUser.set(up.userId, up.plan.name);
    }

    const [unlockedAgg, settings, qualifyingTeamTxns] = await Promise.all([
      db.transaction.aggregate({
        _sum: { amount: true },
        where: { userId: user.id, type: "referral_unlock", status: "completed" },
      }),
      getSettings(),
      // Total Team Deposits — the EXISTING team-investment business definition
      // (the same qualifying rules the Home Team Leader widget uses): package /
      // VIP-plan purchases (completed or approved) + approved plan-purpose
      // deposits by referred members. Per-row abs() so external payments
      // (positive) and balance purchases (negative) both count once.
      referredIds.length
        ? db.transaction.findMany({
            where: {
              userId: { in: referredIds },
              status: { in: ["completed", "approved"] },
              OR: [
                // package engine ledger rows (balance purchases are completed)
                { type: { in: ["plan_purchase", "package_purchase"] } },
                // VIP plan purchases are recorded as approved plan-purpose deposits
                { type: "deposit", meta: { contains: '"purpose":"plan"' } },
              ],
            },
            select: { amount: true },
          })
        : Promise.resolve([] as { amount: number }[]),
    ]);

    const total = referredIds.length;
    const activated = latestPlanByUser.size;
    const unlockedTotal = unlockedAgg._sum.amount ?? 0;
    const teamDeposits = qualifyingTeamTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const inviteConfig = getRenderedInviteConfig(settings);

    const response: ReferralsResponseDTO = {
      code: user.referralCode,
      stats: {
        total,
        activated,
        pending: total - activated,
        unlockedTotal,
      },
      list: referred.map((r) => ({
        id: r.id,
        name: r.name,
        joinedAt: r.createdAt.toISOString(),
        planActivated: latestPlanByUser.has(r.id),
        planName: latestPlanByUser.get(r.id) ?? null,
      })),
      invite: {
        commissionPercent: inviteConfig.commissionPercent,
        commissionText: inviteConfig.commissionText,
        teamMembers: total,
        teamDeposits,
        referralCommission: unlockedTotal,
        levels: inviteConfig.levels,
        howItWorks: inviteConfig.howItWorks,
        policy: inviteConfig.policy,
      },
    };
    return NextResponse.json(response);
  });
}
