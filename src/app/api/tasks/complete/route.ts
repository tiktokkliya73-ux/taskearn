import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { claimedWithin24h, getActiveUserPlan, today } from "@/lib/business";
import { toWalletData } from "../../_lib/helpers";
import { supabaseCompleteTask } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * complete_task_transaction() RPC equivalent — the Ads Execution Engine claim:
 * active-plan gate, target-plan gate, same-day + rolling-24h duplicate guard,
 * daily limit, server-side timer check, then atomically (in $transaction):
 * task_balance += reward, user_tasks completion log (with the paid reward),
 * and an immutable task_reward ledger row.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseCompleteTask(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<{ taskId?: string }>(req);
    const taskId = (body.taskId ?? "").trim();

    // 1. Task exists & is active
    const task = taskId ? await db.task.findUnique({ where: { id: taskId } }) : null;
    if (!task || !task.isActive) throw new ApiError("Task not found.", 400);

    // 2. Active plan required
    const activeUserPlan = await getActiveUserPlan(user.id);
    if (!activeUserPlan) throw new ApiError("You need an active plan to earn rewards.", 400);
    const plan = activeUserPlan.plan;

    // 2b. Target-plan gate: tasks pinned to another plan pay nothing here.
    if (task.planId && task.planId !== activeUserPlan.planId) {
      throw new ApiError("This task is not available for your current plan.", 400);
    }

    // 2c. Rolling 24-hour guard (stricter than the midnight reset)
    if (await claimedWithin24h(user.id, task.id)) {
      throw new ApiError("You can claim each task once every 24 hours.", 400);
    }

    // 3. Must have started the task today
    const date = today();
    const userTask = await db.userTask.findUnique({
      where: { userId_taskId_date: { userId: user.id, taskId: task.id, date } },
    });
    if (!userTask || !userTask.startedAt) throw new ApiError("Start the task first.", 400);

    // 4. Not already completed today
    if (userTask.completedAt) throw new ApiError("You already completed this task today.", 400);

    // 5. Daily limit
    const completedToday = await db.userTask.count({
      where: { userId: user.id, date, completedAt: { not: null } },
    });
    if (completedToday >= plan.dailyTaskLimit) {
      throw new ApiError("Daily task limit reached — come back tomorrow.", 400);
    }

    // 6. Timer elapsed (1s grace)
    const elapsedSeconds = (Date.now() - userTask.startedAt.getTime()) / 1000;
    if (elapsedSeconds < task.durationSeconds - 1) {
      throw new ApiError("Please wait for the timer to finish.", 400);
    }

    const now = new Date();
    // Ads Execution Engine reward: the task's admin-set override, falling back
    // to the member's plan reward (platform default).
    const reward = task.rewardAmount ?? plan.rewardPerTask;

    const wallet = await db.$transaction(async (tx) => {
      const w = await tx.wallet.update({
        where: { userId: user.id },
        data: { taskBalance: { increment: reward } },
      });
      await tx.userTask.update({
        where: { id: userTask.id },
        data: { completedAt: now, rewardAmount: reward },
      });
      await tx.transaction.create({
        data: {
          userId: user.id,
          type: "task_reward",
          amount: reward,
          status: "completed",
          description: `Daily task reward — ${task.title}`,
          meta: JSON.stringify({ taskId: task.id, planId: plan.id }),
          processedAt: now,
        },
      });
      return w;
    });

    return NextResponse.json({
      wallet: toWalletData(wallet),
      reward,
      completedToday: completedToday + 1,
    });
  });
}
