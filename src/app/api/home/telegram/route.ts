import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { claimTelegramReward } from "@/lib/home-data";
import { supabaseHomeTelegram } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * POST /api/home/telegram — claim the one-time "join Telegram" reward.
 * Amount comes from the home_telegram_reward setting at claim time.
 */
export async function POST() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseHomeTelegram();
    }
    const user = await requireAuth();
    const result = await claimTelegramReward(user.id);
    return NextResponse.json(result);
  });
}
