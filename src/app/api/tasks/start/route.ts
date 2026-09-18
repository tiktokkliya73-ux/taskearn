import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { claimedWithin24h, getActiveUserPlan, today } from "@/lib/business";
import { supabaseStartTask } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseStartTask(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<{ taskId?: string }>(req);
    const taskId = (body.taskId ?? "").trim();

    const task = taskId ? await db.task.findUnique({ where: { id: taskId } }) : null;
    if (!task || !task.isActive) throw new ApiError("Task not found.", 400);

    const activeUserPlan = await getActiveUserPlan(user.id);
    if (!activeUserPlan) throw new ApiError("You need an active plan to start tasks.", 400);

    // Target-plan gate (Ads Execution Engine): a task pinned to another plan
    // cannot be started even if its id is known.
    if (task.planId && task.planId !== activeUserPlan.planId) {
      throw new ApiError("This task is not available for your current plan.", 400);
    }

    // 24-hour same-task guard — blocks the midnight-rollover double claim.
    if (await claimedWithin24h(user.id, task.id)) {
      throw new ApiError("You can claim each task once every 24 hours.", 400);
    }

    const existing = await db.userTask.findUnique({
      where: { userId_taskId_date: { userId: user.id, taskId: task.id, date: today() } },
    });
    if (existing?.completedAt) throw new ApiError("This task is already completed today.", 400);
    if (existing?.startedAt) {
      // Idempotent — already started today.
      return NextResponse.json({ startedAt: existing.startedAt.toISOString() });
    }

    const created = await db.userTask.create({
      data: { userId: user.id, taskId: task.id, date: today(), startedAt: new Date() },
    });
    return NextResponse.json({ startedAt: created.startedAt!.toISOString() });
  });
}
