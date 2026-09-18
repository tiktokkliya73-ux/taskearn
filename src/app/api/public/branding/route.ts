import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { getSettings } from "@/lib/settings";
import { supabasePublicBranding } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/branding — the centralized branding configuration rendered
 * by every shell (landing header, auth pages, member + admin sidebars, mobile
 * topbar) and the dynamic favicon. Values come 100% from the admin's
 * /admin/branding settings — nothing hardcoded.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicBranding();
    }

    const s = await getSettings();
    return NextResponse.json({
      siteTitle: s.site_title,
      logoUrl: s.site_logo_url || null,
      faviconUrl: s.site_favicon_url || null,
    });
  });
}
