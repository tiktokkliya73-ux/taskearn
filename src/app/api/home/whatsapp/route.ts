import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { claimWhatsappReward } from "@/lib/home-data";
import { supabaseHomeWhatsapp } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * POST /api/home/whatsapp — claim the one-time "visit WhatsApp channel" reward.
 * Amount comes from the home_whatsapp_reward setting at claim time
 * (server-side only — never accepted from the frontend).
 */
export async function POST() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseHomeWhatsapp();
    }
    const user = await requireAuth();
    const result = await claimWhatsappReward(user.id);
    return NextResponse.json(result);
  });
}
