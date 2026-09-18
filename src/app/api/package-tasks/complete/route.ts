import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { today } from "@/lib/business";
import { toWalletData } from "../../_lib/helpers";
import { supabasePackageTaskComplete } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

interface CompleteBody {
  userPackageId?: string;
}

/**
 * POST /api/package-tasks/complete — the CLAIM. Security, in order:
 *   a. authenticated user
 *   b. the instance exists, BELONGS to the user, is active and not expired
 *   c. the admin-configured task content exists and is active
 *   d. the member has not claimed ANY daily task today (member-level guard —
 *      ONE claim per day, enforced in the database, never just hidden in
 *      the frontend)
 *   e. today's earning has not been collected (lastEarningDate — the same
 *      marker the nightly earnings engine uses, so a claim and a cron run can
 *      never double-credit the same instance on the same day)
 *   f. the task was started today (server-registered startedAt)
 *   g. the countdown has actually elapsed (server-side timer check — the
 *      frontend countdown alone is never trusted)
 * Then, atomically inside db.$transaction:
 *   - wallets.task_balance += reward  (task earnings belong to the MAIN /
 *     dashboard balance — they are NOT automatically withdrawable; they
 *     become withdrawable only through the existing referral-unlock rule)
 *   - package_task_logs row: completed_at + reward paid
 *   - user_packages.last_earning_date = today (idempotency marker)
 *   - immutable daily_earning ledger row
 * The reward is ALWAYS the package's CURRENT admin-configured dailyEarning
 * from the database (so Admin edits apply instantly) — never a client-
 * supplied value and never hardcoded.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePackageTaskComplete(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<CompleteBody>(req);
    const userPackageId = (body.userPackageId ?? "").trim();

    // 1-2. Instance exists, belongs to the caller, active, not expired.
    const instance = userPackageId
      ? await db.userPackage.findUnique({
          where: { id: userPackageId },
          include: { pkg: { select: { id: true, title: true, dailyEarning: true } } },
        })
      : null;
    if (!instance || instance.userId !== user.id) throw new ApiError("Package not found.", 400);
    if (instance.status !== "active" || instance.endsAt <= new Date()) {
      throw new ApiError("This package is no longer active.", 400);
    }

    // 3. Task content + countdown duration from the admin configuration.
    const content = await db.task.findFirst({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (!content) throw new ApiError("Task content is not available. Please try again later.", 400);

    const date = today();

    // 4. Same-day duplicate guard (claim OR nightly cron credit).
    if (instance.lastEarningDate === date) {
      throw new ApiError("You already claimed this task today.", 400);
    }

    // 4b. Member-level daily guard — ONE claim per day across ALL packages
    //    (duplicate requests on the same day are rejected here, server-side).
    const claimedAnyToday = await db.packageTaskLog.findFirst({
      where: { userId: user.id, date, completedAt: { not: null } },
      select: { id: true },
    });
    if (claimedAnyToday) throw new ApiError("You already claimed today's task.", 400);

    // 5. Must have started the task today.
    const log = await db.packageTaskLog.findUnique({
      where: { userId_userPackageId_date: { userId: user.id, userPackageId: instance.id, date } },
    });
    if (!log || !log.startedAt) throw new ApiError("Start the task first.", 400);
    if (log.completedAt) throw new ApiError("You already claimed this task today.", 400);

    // 6. Server-side timer check (1s grace, same as the task engine).
    const elapsedSeconds = (Date.now() - log.startedAt.getTime()) / 1000;
    if (elapsedSeconds < content.durationSeconds - 1) {
      throw new ApiError("Please wait for the timer to finish.", 400);
    }

    // The LIVE admin-configured daily earning of the package (falls back to
    // the purchase snapshot only if the package row vanished) — an Admin edit
    // (Rs.100 → Rs.150) is paid out immediately, no code change needed.
    const reward = instance.pkg?.dailyEarning ?? instance.dailyEarning;
    const packageTitle = instance.pkg?.title ?? "Package";
    const now = new Date();

    const wallet = await db.$transaction(async (tx) => {
      const w = await tx.wallet.update({
        where: { userId: user.id },
        data: { taskBalance: { increment: reward } },
      });
      await tx.packageTaskLog.update({
        where: { id: log.id },
        data: { completedAt: now, rewardAmount: reward },
      });
      await tx.userPackage.update({
        where: { id: instance.id },
        data: { lastEarningDate: date },
      });
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "daily_earning",
          amount: reward,
          status: "completed",
          description: `Daily task reward — ${packageTitle}`,
          meta: JSON.stringify({
            userPackageId: instance.id,
            packageId: instance.packageId,
            packageTitle,
            dailyEarning: reward,
            date,
            viaTask: true,
          }),
          processedAt: now,
        },
      });
      return w;
    });

    return NextResponse.json({
      wallet: toWalletData(wallet),
      reward,
    });
  });
}
