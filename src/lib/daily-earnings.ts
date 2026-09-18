import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * NIGHTLY DAILY-EARNINGS DISTRIBUTION (cron engine) — investment packages.
 *
 * Kept free of any next/server imports so the standalone cron script
 * (scripts/daily-earnings.ts) can run it directly with Bun outside Next.js.
 *
 * For every active instance (status='active', ends_at > now) whose owning day
 * started before today and whose lastEarningDate is not today:
 *   Daily Total per user = SUM(active instances' LIVE package dailyEarning)
 *   -> credited to taskBalance (daily task earnings belong to the MAIN /
 *      dashboard balance — NOT automatically withdrawable; they become
 *      withdrawable only through the existing referral-unlock rule, exactly
 *      like manually-claimed daily tasks)
 *   -> logged as ONE `daily_earning` transaction per user
 *   -> each instance's lastEarningDate set to today (idempotent: a second run
 *      on the same calendar day credits nothing)
 * Instances whose earning period has fully elapsed are marked 'completed'.
 *
 * The PACKAGE is the single source of truth: the credited amount is the
 * package row's CURRENT admin-configured dailyEarning (the purchase snapshot
 * on the instance is only a fallback for deleted packages) — exactly like
 * the manual claim route, so an Admin edit applies to every holder of that
 * package on every earning path, with zero per-user updates.
 */
export async function runDailyEarnings(
  tx: Tx = db
): Promise<{
  date: string;
  usersCredited: number;
  packagesCredited: number;
  packagesCompleted: number;
  totalCredited: number;
  alreadyRan: boolean;
  details: { userId: string; userName: string; packages: number; total: number }[];
}> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayStart = new Date(`${today}T00:00:00.000Z`);

  // Eligible: active, not expired, earning period started before today,
  // and not already credited for today (idempotency).
  const eligible = await tx.userPackage.findMany({
    where: {
      status: "active",
      endsAt: { gt: now },
      startedAt: { lt: todayStart },
      OR: [{ lastEarningDate: null }, { lastEarningDate: { lt: today } }],
    },
    include: {
      user: { select: { id: true, name: true } },
      pkg: { select: { id: true, title: true, dailyEarning: true } },
    },
    orderBy: { userId: "asc" },
  });

  // Group per user so each user gets ONE wallet credit + ONE ledger row.
  // The reward per instance is the LIVE admin-configured dailyEarning from
  // the package row (snapshot fallback only for deleted packages) — Admin
  // edits a package once and every holder follows automatically.
  const perUser = new Map<
    string,
    { userId: string; userName: string; total: number; instances: typeof eligible }
  >();
  for (const inst of eligible) {
    const entry = perUser.get(inst.userId) ?? {
      userId: inst.userId,
      userName: inst.user.name,
      total: 0,
      instances: [] as typeof eligible,
    };
    entry.total += inst.pkg?.dailyEarning ?? inst.dailyEarning;
    entry.instances.push(inst);
    perUser.set(inst.userId, entry);
  }

  for (const entry of perUser.values()) {
    await tx.wallet.update({
      where: { userId: entry.userId },
      data: { taskBalance: { increment: entry.total } },
    });

    await tx.transaction.create({
      data: {
        userId: entry.userId,
        type: "daily_earning",
        amount: entry.total,
        status: "completed",
        description: `Daily earnings from ${entry.instances.length} active package${
          entry.instances.length === 1 ? "" : "s"
        }`,
        meta: JSON.stringify({
          date: today,
          packages: entry.instances.map((i) => ({
            id: i.id,
            packageId: i.packageId,
            title: i.pkg?.title ?? "Package",
            // The amount actually credited — the LIVE package config.
            dailyEarning: i.pkg?.dailyEarning ?? i.dailyEarning,
          })),
        }),
        processedAt: now,
      },
    });

    for (const inst of entry.instances) {
      await tx.userPackage.update({
        where: { id: inst.id },
        data: { lastEarningDate: today },
      });
    }
  }

  // Close out finished earning periods.
  const completedCount = await tx.userPackage.updateMany({
    where: { status: "active", endsAt: { lte: now } },
    data: { status: "completed" },
  });

  const details = [...perUser.values()].map((e) => ({
    userId: e.userId,
    userName: e.userName,
    packages: e.instances.length,
    total: e.total,
  }));

  // Detect a prior same-day run (nothing eligible, but something was already
  // credited today) so callers can distinguish "done" from "nothing to do".
  let alreadyRan = false;
  if (perUser.size === 0) {
    const creditedToday = await tx.userPackage.findFirst({
      where: { lastEarningDate: today },
      select: { id: true },
    });
    alreadyRan = Boolean(creditedToday);
  }

  return {
    date: today,
    usersCredited: perUser.size,
    packagesCredited: eligible.length,
    packagesCompleted: completedCount.count,
    totalCredited: details.reduce((sum, d) => sum + d.total, 0),
    alreadyRan,
    details,
  };
}
