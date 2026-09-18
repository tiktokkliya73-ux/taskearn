import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { today } from "@/lib/business";
import { toTaskDTO } from "../_lib/helpers";
import type { PackageTasksResponseDTO } from "@/lib/types";
import { supabasePackageTasksList } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/package-tasks — the Ads → Daily Tasks page payload.
 *
 * ONE daily task for the member — NOT one card per active package. The
 * member's active packages determine the applicable DAILY EARNING AMOUNT:
 * the single applicable instance is the active one whose package carries the
 * highest admin-configured dailyEarning (newest purchase breaks ties). The
 * reward shown (and paid on claim) is the PACKAGE's current admin-configured
 * dailyEarning — the live value from the existing package manager, so an
 * Admin edit (e.g. Rs.100 → Rs.150) is reflected immediately without any
 * frontend change. It is never hardcoded and never client-supplied.
 *
 * `claimedToday` is the member-level daily marker, persisted in the database:
 * true once ANY package-task claim completed today, or when today's earning
 * was already credited by the nightly engine (lastEarningDate). It survives
 * refresh, logout/login and device changes.
 *
 * `content` is the admin-configured task content (the first ACTIVE Task row
 * from the existing Task manager: its URL renders in the task modal and its
 * durationSeconds drives the countdown). null when the admin has no active
 * task configured.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePackageTasksList();
    }

    const user = await requireAuth();
    const date = today();

    const [instances, logs, content] = await Promise.all([
      db.userPackage.findMany({
        where: { userId: user.id, status: "active", endsAt: { gt: new Date() } },
        include: { pkg: { select: { title: true, dailyEarning: true } } },
        orderBy: [{ pkg: { dailyEarning: "desc" } }, { startedAt: "desc" }],
      }),
      db.packageTaskLog.findMany({ where: { userId: user.id, date } }),
      db.task.findFirst({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    ]);

    // The ONE applicable task — the member's highest-value active package.
    const applicable = instances[0] ?? null;
    // Member-level daily guard: any completed claim today (any instance).
    const claimedAnyToday = logs.some((l) => Boolean(l.completedAt));

    const dto: PackageTasksResponseDTO = {
      tasks: applicable
        ? [
            {
              id: applicable.id,
              packageId: applicable.packageId,
              packageTitle: applicable.pkg?.title ?? "Package",
              // Live admin config (falls back to the purchase snapshot only
              // if the package row vanished).
              reward: applicable.pkg?.dailyEarning ?? applicable.dailyEarning,
              claimedToday:
                claimedAnyToday || applicable.lastEarningDate === date,
              startedAt:
                logs.find((l) => l.userPackageId === applicable.id)?.startedAt?.toISOString() ??
                null,
              endsAt: applicable.endsAt.toISOString(),
            },
          ]
        : [],
      content: content ? toTaskDTO(content) : null,
    };

    return NextResponse.json(dto);
  });
}
