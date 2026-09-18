import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { buildPromoBannersDTO } from "@/lib/promo-banners";
import { getSettings } from "@/lib/settings";
import { supabasePromoBanners } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/home/promo-banners — the ACTIVE admin-managed promotional banners
 * for the member premium overlay carousel.
 *
 * Authenticated members only ever receive the sanitized DTO list — never the
 * raw settings row — and only banners the admin has set ACTIVE (with a valid
 * image) are included, in the admin's configured order. Normal users can
 * never influence the list; only admins change it through
 * /api/admin/promo-banners.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePromoBanners();
    }
    await requireAuth();
    const settings = await getSettings();
    return NextResponse.json({ banners: buildPromoBannersDTO(settings) });
  });
}
