import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { getActiveUserPlan, today } from "@/lib/business";
import { daysLeft, toTaskDTO } from "../_lib/helpers";
import type { TasksResponseDTO } from "@/lib/types";
import { supabaseTasksList } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseTasksList();
    }

    const user = await requireAuth();
    const date = today();

    const activeUserPlan = await getActiveUserPlan(user.id);
    // Ads Execution Engine: a task with a target plan (planId) is only served
    // to members whose ACTIVE plan matches; planId=null → available to all.
    const [tasks, userTasks] = await Promise.all([
      db.task.findMany({
        where: {
          isActive: true,
          OR: [{ planId: null }, ...(activeUserPlan ? [{ planId: activeUserPlan.planId }] : [])],
        },
        orderBy: { sortOrder: "asc" },
      }),
      db.userTask.findMany({ where: { userId: user.id, date } }),
    ]);

    const byTaskId = new Map(userTasks.map((ut) => [ut.taskId, ut]));
    const completedToday = userTasks.filter((ut) => ut.completedAt !== null).length;

    let plan: TasksResponseDTO["plan"] = null;
    if (activeUserPlan) {
      plan = {
        name: activeUserPlan.plan.name,
        rewardPerTask: activeUserPlan.plan.rewardPerTask,
        dailyLimit: activeUserPlan.plan.dailyTaskLimit,
        completedToday,
        daysLeft: daysLeft(activeUserPlan.expiresAt),
      };
    }

    const canCompleteMore =
      !!activeUserPlan && completedToday < activeUserPlan.plan.dailyTaskLimit;

    return NextResponse.json({
      plan,
      tasks: tasks.map((t) => {
        const ut = byTaskId.get(t.id);
        return {
          task: toTaskDTO(t),
          startedAt: ut?.startedAt ? ut.startedAt.toISOString() : null,
          completedAt: ut?.completedAt ? ut.completedAt.toISOString() : null,
        };
      }),
      canCompleteMore,
    });
  });
}
