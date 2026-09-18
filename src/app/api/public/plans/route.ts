import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toPlanDTO } from "../../_lib/helpers";
import { supabasePublicPlans } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicPlans();
    }

    const plans = await db.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    return NextResponse.json({ plans: plans.map(toPlanDTO) });
  });
}
