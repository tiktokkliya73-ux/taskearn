import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { isImageSourceUrl } from "@/app/api/_lib/helpers";
import {
  supabaseAdminSettingsGet,
  supabaseAdminSettingsPost,
} from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

/** Branding keys that carry admin-uploaded images (http URL or data URL). */
const IMAGE_SETTING_KEYS = new Set([
  "site_logo_url",
  "site_favicon_url",
  "wallet_method_image_url",
  "home_team_salary_image",
]);

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminSettingsGet();
    }

    await requireAdmin();
    const settings = await getSettings();
    return NextResponse.json({ settings });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminSettingsPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<{ settings?: Record<string, unknown> }>(req);

    const incoming = body.settings;
    if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
      throw new ApiError("Invalid settings payload.", 400);
    }

    // Whitelist: only known setting keys are persisted.
    const updates = Object.entries(incoming)
      .filter(([key]) => key in SETTING_DEFAULTS)
      .map(([key, value]) => ({ key, value: String(value) }));

    // Branding image keys only accept real image sources (http URL or a
    // canvas-re-encoded data URL) — empty clears the custom image.
    for (const { key, value } of updates) {
      if (IMAGE_SETTING_KEYS.has(key) && value.trim() && !isImageSourceUrl(value)) {
        throw new ApiError(
          "Branding images must be uploaded image files (JPG, PNG or WEBP) or http(s) URLs.",
          400,
        );
      }
    }

    for (const { key, value } of updates) {
      await db.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    const settings = await getSettings();
    return NextResponse.json({ settings });
  });
}
