import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { today } from "@/lib/business";
import { supabasePackageTaskStart } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

interface StartBody {
  userPackageId?: string;
}

/**
 * POST /api/package-tasks/start — registers the server-authoritative start of
 * the member's ONE daily task (the countdown anchor). Validations:
 *   a. authenticated user
 *   b. the instance exists, BELONGS to the user, is active and not expired
 *   c. the admin has an active task content configured
 *   d. the member has not claimed ANY daily task today (member-level guard —
 *      ONE claim per day, no matter how many packages are active)
 *   e. today's earning has not been collected yet (lastEarningDate guard)
 *   f. idempotent — an existing uncompleted start returns its original
 *      startedAt (the timer keeps running across close/resume/refresh)
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePackageTaskStart(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<StartBody>(req);
    const userPackageId = (body.userPackageId ?? "").trim();

    const instance = userPackageId
      ? await db.userPackage.findUnique({ where: { id: userPackageId } })
      : null;
    if (!instance || instance.userId !== user.id) throw new ApiError("Package not found.", 400);
    if (instance.status !== "active" || instance.endsAt <= new Date()) {
      throw new ApiError("This package is no longer active.", 400);
    }

    // The countdown duration comes from the admin-configured task content.
    const content = await db.task.findFirst({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    if (!content) throw new ApiError("Task content is not available. Please try again later.", 400);

    const date = today();
    if (instance.lastEarningDate === date) {
      throw new ApiError("This task is already completed today.", 400);
    }

    // Member-level daily guard — ONE task claim per day across all packages.
    const claimedAnyToday = await db.packageTaskLog.findFirst({
      where: { userId: user.id, date, completedAt: { not: null } },
      select: { id: true },
    });
    if (claimedAnyToday) throw new ApiError("You already claimed today's task.", 400);

    const existing = await db.packageTaskLog.findUnique({
      where: { userId_userPackageId_date: { userId: user.id, userPackageId: instance.id, date } },
    });
    if (existing?.completedAt) throw new ApiError("This task is already completed today.", 400);
    if (existing?.startedAt) {
      // Idempotent — already started today (the timer is still running).
      return NextResponse.json({ startedAt: existing.startedAt.toISOString() });
    }

    try {
      const created = await db.packageTaskLog.create({
        data: {
          userId: user.id,
          userPackageId: instance.id,
          date,
          startedAt: new Date(),
        },
      });
      return NextResponse.json({ startedAt: created.startedAt.toISOString() });
    } catch {
      // Unique-key race (double tap): fall back to the winner's row.
      const raced = await db.packageTaskLog.findUnique({
        where: { userId_userPackageId_date: { userId: user.id, userPackageId: instance.id, date } },
      });
      if (raced?.startedAt) return NextResponse.json({ startedAt: raced.startedAt.toISOString() });
      throw new ApiError("Couldn't start the task. Please try again.", 400);
    }
  });
}
