import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { isHttpUrl, toIntOrNull, toTaskDTO } from "../../_lib/helpers";
import { supabaseAdminTasksGet, supabaseAdminTasksPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface TaskPostBody {
  action?: string;
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  durationSeconds?: number | string;
  rewardAmount?: number | string | null; // PKR override — null/"" = plan default
  planId?: string | null; // target plan — null/"" = all plans
  isActive?: boolean;
}

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminTasksGet();
    }

    await requireAdmin();
    const tasks = await db.task.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ tasks: tasks.map(toTaskDTO) });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminTasksPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<TaskPostBody>(req);
    const action = (body.action ?? "").trim();

    // ── Ads Execution Engine fields ──
    // rewardAmount: optional PKR override (0–100,000); null → plan default.
    const parseReward = (v: TaskPostBody["rewardAmount"]): number | null => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const n = toIntOrNull(v);
      if (n === null || n < 0 || n > 100_000) {
        throw new ApiError("Reward must be a whole number between 0 and 100,000 PKR.", 400);
      }
      return n;
    };
    // planId: optional target plan; empty → all plans; must exist when set.
    const parsePlanId = async (v: TaskPostBody["planId"]): Promise<string | null> => {
      const p = v === null || v === undefined ? "" : String(v).trim();
      if (!p) return null;
      const plan = await db.plan.findUnique({ where: { id: p }, select: { id: true } });
      if (!plan) throw new ApiError("Target plan not found.", 400);
      return plan.id;
    };

    if (action === "create") {
      const title = (body.title ?? "").trim();
      if (title.length < 2) throw new ApiError("Task title must be at least 2 characters.", 400);
      if (!isHttpUrl(body.url)) throw new ApiError("Task URL must start with http:// or https://.", 400);
      const durationSeconds = toIntOrNull(body.durationSeconds);
      if (durationSeconds === null || durationSeconds < 5 || durationSeconds > 600) {
        throw new ApiError("Duration must be between 5 and 600 seconds.", 400);
      }
      const description = body.description == null ? null : String(body.description).trim() || null;
      const maxOrder = await db.task.aggregate({ _max: { sortOrder: true } });

      await db.task.create({
        data: {
          title,
          description,
          url: String(body.url).trim(),
          durationSeconds,
          rewardAmount: parseReward(body.rewardAmount),
          planId: await parsePlanId(body.planId),
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
          sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        },
      });
    } else if (action === "update") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.task.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Task not found.", 400);

      const data: Record<string, string | number | boolean | null> = {};
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (title.length < 2) throw new ApiError("Task title must be at least 2 characters.", 400);
        data.title = title;
      }
      if (body.description !== undefined) {
        const d = String(body.description ?? "").trim();
        data.description = d.length ? d : null;
      }
      if (body.url !== undefined) {
        if (!isHttpUrl(body.url)) throw new ApiError("Task URL must start with http:// or https://.", 400);
        data.url = String(body.url).trim();
      }
      if (body.durationSeconds !== undefined) {
        const n = toIntOrNull(body.durationSeconds);
        if (n === null || n < 5 || n > 600) {
          throw new ApiError("Duration must be between 5 and 600 seconds.", 400);
        }
        data.durationSeconds = n;
      }
      if (body.rewardAmount !== undefined) data.rewardAmount = parseReward(body.rewardAmount);
      if (body.planId !== undefined) data.planId = await parsePlanId(body.planId);
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

      await db.task.update({ where: { id }, data });
    } else if (action === "toggle") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.task.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Task not found.", 400);
      await db.task.update({ where: { id }, data: { isActive: !existing.isActive } });
    } else {
      throw new ApiError("Unknown action. Use create, update or toggle.", 400);
    }

    const tasks = await db.task.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ tasks: tasks.map(toTaskDTO) });
  });
}
