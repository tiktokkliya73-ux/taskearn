import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  validateChannelLinkSettingValue,
  validateHomeHeaderSettingValue,
  validateWelcomePopupSettingValue,
} from "@/app/api/_lib/helpers";
import { ensureSystemPromoRows } from "@/lib/home-data";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { supabaseAdminHomeGet, supabaseAdminHomePost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

export const HOME_SETTING_KEYS = Object.keys(SETTING_DEFAULTS).filter((k) =>
  k.startsWith("home_")
);

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminHomeGet();
    }

    await requireAdmin();
    await ensureSystemPromoRows();

    const [settings, promoCodes, claimCounts] = await Promise.all([
      getSettings(),
      db.promoCode.findMany({ orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }] }),
      db.promoClaim.groupBy({ by: ["promoCodeId"], _count: { _all: true } }),
    ]);
    const claimsByCode = new Map(claimCounts.map((c) => [c.promoCodeId, c._count._all]));
    const telegramReward = parseInt(settings.home_telegram_reward, 10) || 50;
    const whatsappReward = parseInt(settings.home_whatsapp_reward, 10) || 50;

    const homeSettings: Record<string, string> = {};
    for (const key of HOME_SETTING_KEYS) homeSettings[key] = settings[key] ?? "";

    return NextResponse.json({
      settings: homeSettings,
      telegramReward,
      whatsappReward,
      promoCodes: promoCodes.map((p) => ({
        id: p.id,
        code: p.code,
        title: p.title,
        // The system rows pay the LIVE setting amount — show that.
        rewardAmount: p.isSystem
          ? p.code === "TELEGRAM"
            ? telegramReward
            : whatsappReward
          : p.rewardAmount,
        maxUses: p.maxUses,
        usedCount: p.usedCount,
        claimsCount: claimsByCode.get(p.id) ?? 0,
        isActive: p.isActive,
        isSystem: p.isSystem,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminHomePost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<{ settings?: Record<string, unknown> }>(req);
    const incoming = body.settings;
    if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
      throw new ApiError("Invalid settings payload.", 400);
    }

    const updates = Object.entries(incoming)
      .filter(([key]) => key in SETTING_DEFAULTS && key.startsWith("home_"))
      .map(([key, value]) => ({ key, value: String(value) }));

    // Login Welcome Popup values are validated BEFORE anything is persisted
    // (image source, frequency, link format and text length caps) — the Home
    // header title/tagline get the same treatment (length caps), and the
    // WhatsApp/Telegram channel links are format-checked (official hosts,
    // http(s) only — javascript:/data: style values can never be saved).
    for (const { key, value } of updates) {
      if (key.startsWith("home_welcome_popup_")) {
        const err = validateWelcomePopupSettingValue(key, value);
        if (err) throw new ApiError(err, 400);
      }
      if (key.startsWith("home_header_")) {
        const err = validateHomeHeaderSettingValue(key, value);
        if (err) throw new ApiError(err, 400);
      }
      if (key === "home_whatsapp_url" || key === "home_telegram_url") {
        const err = validateChannelLinkSettingValue(key, value);
        if (err) throw new ApiError(err, 400);
      }
    }

    for (const { key, value } of updates) {
      await db.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }

    // Keep the system channel rows' display amounts in sync with the settings.
    if (
      updates.some(
        (u) => u.key === "home_telegram_reward" || u.key === "home_whatsapp_reward"
      )
    ) {
      const settings = await getSettings();
      const telegramReward = parseInt(settings.home_telegram_reward, 10) || 50;
      const whatsappReward = parseInt(settings.home_whatsapp_reward, 10) || 50;
      await db.promoCode.updateMany({
        where: { code: "TELEGRAM", isSystem: true },
        data: { rewardAmount: telegramReward },
      });
      await db.promoCode.updateMany({
        where: { code: "WHATSAPP", isSystem: true },
        data: { rewardAmount: whatsappReward },
      });
    }

    const settings = await getSettings();
    const homeSettings: Record<string, string> = {};
    for (const key of HOME_SETTING_KEYS) homeSettings[key] = settings[key] ?? "";

    return NextResponse.json({ settings: homeSettings });
  });
}
