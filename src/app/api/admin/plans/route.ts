import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toIntOrNull, toPlanDTO } from "../../_lib/helpers";
import { supabaseAdminPlansGet, supabaseAdminPlansPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface PlanPostBody {
  action?: string;
  id?: string;
  name?: string;
  description?: string;
  price?: number | string;
  rewardPerTask?: number | string;
  dailyTaskLimit?: number | string;
  durationDays?: number | string;
  isActive?: boolean;
}

const NUMERIC_PLAN_FIELDS = ["price", "rewardPerTask", "dailyTaskLimit", "durationDays"] as const;

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPlansGet();
    }

    await requireAdmin();
    const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ plans: plans.map(toPlanDTO) });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPlansPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<PlanPostBody>(req);
    const action = (body.action ?? "").trim();

    if (action === "create") {
      const name = (body.name ?? "").trim();
      if (name.length < 2) throw new ApiError("Plan name must be at least 2 characters.", 400);

      const nums: Record<string, number> = {};
      for (const field of NUMERIC_PLAN_FIELDS) {
        const n = toIntOrNull(body[field]);
        if (n === null || n < 1) {
          throw new ApiError("Price, reward per task, daily limit and duration must be positive integers.", 400);
        }
        nums[field] = n;
      }
      const description = body.description == null ? null : String(body.description).trim() || null;
      const maxOrder = await db.plan.aggregate({ _max: { sortOrder: true } });

      await db.plan.create({
        data: {
          name,
          description,
          price: nums.price,
          rewardPerTask: nums.rewardPerTask,
          dailyTaskLimit: nums.dailyTaskLimit,
          durationDays: nums.durationDays,
          isActive: body.isActive === undefined ? true : Boolean(body.isActive),
          sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
        },
      });
    } else if (action === "update") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.plan.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Plan not found.", 400);

      const data: Record<string, number | string | boolean | null> = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (name.length < 2) throw new ApiError("Plan name must be at least 2 characters.", 400);
        data.name = name;
      }
      if (body.description !== undefined) {
        const d = String(body.description ?? "").trim();
        data.description = d.length ? d : null;
      }
      for (const field of NUMERIC_PLAN_FIELDS) {
        if (body[field] !== undefined) {
          const n = toIntOrNull(body[field]);
          if (n === null || n < 1) {
            throw new ApiError(`${field} must be a positive integer.`, 400);
          }
          data[field] = n;
        }
      }
      if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

      await db.plan.update({ where: { id }, data });
    } else if (action === "toggle") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.plan.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Plan not found.", 400);
      await db.plan.update({ where: { id }, data: { isActive: !existing.isActive } });
    } else {
      throw new ApiError("Unknown action. Use create, update or toggle.", 400);
    }

    const plans = await db.plan.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json({ plans: plans.map(toPlanDTO) });
  });
}
