import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { getRawInviteConfig, validateInviteSettings } from "@/lib/invite";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { supabaseAdminInviteGet, supabaseAdminInvitePost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

/** The Invite-page settings keys (invite_* whitelist). */
export const INVITE_SETTING_KEYS = Object.keys(SETTING_DEFAULTS).filter((k) => k.startsWith("invite_"));

function inviteSettingsSlice(settings: Record<string, string>): Record<string, string> {
  const slice: Record<string, string> = {};
  for (const key of INVITE_SETTING_KEYS) slice[key] = settings[key] ?? "";
  return slice;
}

/**
 * GET /api/admin/invite — the raw (unrendered) Invite page configuration:
 * commission percentage, referral code card text, Cash Rewards Levels,
 * "How it works" and "Referral Policy" text templates ({percent} placeholders
 * intact so the admin can edit them).
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminInviteGet();
    }

    await requireAdmin();
    const settings = await getSettings();

    // Sanity check: the parsed/normalized view of the current values (levels
    // sorted + numbered) so the admin form always starts canonical.
    const raw = getRawInviteConfig(settings);
    const normalized: Record<string, string> = {
      ...inviteSettingsSlice(settings),
      invite_commission_percent: String(raw.commissionPercent),
      invite_commission_text: raw.commissionText,
      invite_reward_levels: JSON.stringify(raw.levels.map(({ required, reward }) => ({ required, reward }))),
      invite_how_it_works: JSON.stringify(raw.howItWorks),
      invite_referral_policy: JSON.stringify(raw.policy),
    };
    return NextResponse.json({ settings: normalized });
  });
}

/**
 * POST /api/admin/invite — validate + persist the Invite page configuration.
 * Server-side validation only (never trust the browser): commission percent
 * 0–100, 1–8 strictly-positive reward levels (sorted ascending), 1–10 text
 * lines each. Values go live on the member Invite page immediately.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminInvitePost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<{ settings?: Record<string, unknown> }>(req);

    const result = validateInviteSettings(body.settings);
    if (!result.ok) throw new ApiError(result.error, 400);

    for (const [key, value] of Object.entries(result.settings)) {
      await db.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    const settings = await getSettings();
    return NextResponse.json({ settings: inviteSettingsSlice(settings) });
  });
}
