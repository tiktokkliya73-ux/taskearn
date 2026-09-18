import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { buildWelcomePopupDTO } from "@/lib/home-data";
import { getSettings } from "@/lib/settings";
import { supabaseWelcomePopup } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/home/welcome-popup — the Login Welcome Popup config for the member
 * Home screen (shown right after login/signup).
 *
 * Authenticated members only ever receive the sanitized DTO — never the raw
 * settings rows — and the popup is forced off server-side unless a valid
 * admin-uploaded image exists. Normal users can never influence the config;
 * only admins can change it through the admin Home Settings routes.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseWelcomePopup();
    }
    await requireAuth();
    const settings = await getSettings();
    return NextResponse.json(buildWelcomePopupDTO(settings));
  });
}
