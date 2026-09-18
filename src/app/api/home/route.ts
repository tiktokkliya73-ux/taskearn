import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { getHomeData } from "@/lib/home-data";
import { supabaseHome } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/home — everything the dynamic Home page widgets need:
 * announcement (Urdu/EN) + lucky draw date, team leader offer + live team
 * investment progress, team salary banner, quick stats, promo availability,
 * social URLs and the Telegram reward state.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseHome();
    }
    const user = await requireAuth();
    const data = await getHomeData(user.id);
    return NextResponse.json(data);
  });
}
