import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { getSettings, SETTING_DEFAULTS } from "@/lib/settings";
import { isHttpUrl, isPopupImageSourceUrl } from "@/app/api/_lib/helpers";
import { WELCOME_POPUP_FREQUENCIES } from "@/lib/types";
import type { WelcomePopupDTO, WelcomePopupFrequency } from "@/lib/types";

type Tx = Prisma.TransactionClient;

/**
 * DYNAMIC HOME PAGE ENGINE — every widget on the member Home screen is driven
 * by `system_settings` (admin-editable in real time) plus the promo-code
 * claim engine below.
 *
 * Kept free of any next/server imports so standalone Bun scripts can run it.
 *
 * Money rules (mirror of the daily-earnings engine):
 * - promo / telegram rewards are credited to the WITHDRAWABLE balance
 *   (free rewards are instantly cashable, like daily package income)
 * - every credit is logged as an immutable `promo_reward` transaction
 * - one claim per user per code (unique constraint backs this up)
 */

/** Fixed system codes backing the channel visit-reward widgets. */
export const TELEGRAM_PROMO_CODE = "TELEGRAM";
export const WHATSAPP_PROMO_CODE = "WHATSAPP";

const EARNING_TYPES = [
  "task_reward",
  "referral_unlock",
  "referral_commission",
  "daily_earning",
  "promo_reward",
] as const;

interface ChannelSystemRow {
  code: string;
  title: string;
}

/** System promo rows that pay the LIVE setting amount at claim time. */
const CHANNEL_SYSTEM_ROWS: ChannelSystemRow[] = [
  { code: TELEGRAM_PROMO_CODE, title: "Telegram join reward" },
  { code: WHATSAPP_PROMO_CODE, title: "WhatsApp join reward" },
];

/**
 * Get-or-create the system channel rows (app config — always present).
 * Backward-compatible single-code accessor kept for existing callers.
 */
export async function ensureSystemPromoRows(tx: Tx = db) {
  const settings = await getSettings(tx);
  for (const row of CHANNEL_SYSTEM_ROWS) {
    const rewardKey =
      row.code === TELEGRAM_PROMO_CODE ? "home_telegram_reward" : "home_whatsapp_reward";
    const reward = parsePositiveInt(settings[rewardKey]) ?? 50;
    const existing = await tx.promoCode.findUnique({ where: { code: row.code } });
    if (existing) continue;
    await tx.promoCode.create({
      data: {
        code: row.code,
        title: row.title,
        rewardAmount: reward,
        maxUses: null, // unlimited members, one claim each
        isActive: true,
        isSystem: true,
      },
    });
  }
}

/** @deprecated use ensureSystemPromoRows (ensures every channel row). */
export async function ensureTelegramPromoRow(tx: Tx = db) {
  await ensureSystemPromoRows(tx);
}

function parsePositiveInt(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseBool(raw: string | undefined): boolean {
  return raw === "true" || raw === "1";
}

/* ------------------------------------------------------------------ */
/* Home header payload                                                 */
/* ------------------------------------------------------------------ */

/** Title/tagline caps shared by the admin validation + this builder. */
export const HOME_HEADER_TITLE_MAX = 60;
export const HOME_HEADER_TAGLINE_MAX = 120;

/**
 * Build the member-facing Home header brand block from raw settings.
 * Empty or over-cap admin values fall back to the safe defaults, so the
 * header always renders a strong title + muted tagline (never blank).
 */
export function buildHomeHeaderDTO(settings: Record<string, string>): {
  title: string;
  tagline: string;
} {
  const title = (settings.home_header_title ?? "").trim().slice(0, HOME_HEADER_TITLE_MAX);
  const tagline = (settings.home_header_tagline ?? "").trim().slice(0, HOME_HEADER_TAGLINE_MAX);
  return {
    title: title || SETTING_DEFAULTS.home_header_title,
    tagline: tagline || SETTING_DEFAULTS.home_header_tagline,
  };
}

/* ------------------------------------------------------------------ */
/* Login welcome popup payload                                         */
/* ------------------------------------------------------------------ */

/**
 * Build the member-facing Login Welcome Popup config from raw settings.
 * Server-side safety rules (mirrored on both data backends):
 * - the popup is NEVER enabled without a valid image source — members never
 *   see an empty or broken popup;
 * - an unknown display frequency falls back to "once_per_session";
 * - the button link only survives as an internal /… route or an http(s) URL
 *   (javascript:/data: style values can never reach the client).
 */
export function buildWelcomePopupDTO(settings: Record<string, string>): WelcomePopupDTO {
  const image = (settings.home_welcome_popup_image ?? "").trim();
  const imageOk = isPopupImageSourceUrl(image);
  const rawFrequency = (settings.home_welcome_popup_frequency ?? "").trim();
  const frequency = (WELCOME_POPUP_FREQUENCIES as readonly string[]).includes(rawFrequency)
    ? (rawFrequency as WelcomePopupFrequency)
    : "once_per_session";
  const rawLink = (settings.home_welcome_popup_button_link ?? "").trim();
  const buttonLink =
    isHttpUrl(rawLink) || (rawLink.startsWith("/") && !rawLink.startsWith("//")) ? rawLink : "";
  return {
    enabled: parseBool(settings.home_welcome_popup_enabled) && imageOk,
    imageUrl: imageOk ? image : "",
    title: (settings.home_welcome_popup_title ?? "").trim().slice(0, 120),
    description: (settings.home_welcome_popup_description ?? "").trim().slice(0, 600),
    buttonText: (settings.home_welcome_popup_button_text ?? "").trim().slice(0, 60),
    buttonLink,
    frequency,
  };
}

/* ------------------------------------------------------------------ */
/* Home payload                                                        */
/* ------------------------------------------------------------------ */

export interface HomeData {
  header: {
    title: string;
    tagline: string;
  };
  announcementUr: string;
  announcementEn: string;
  luckyDrawDate: string | null; // YYYY-MM-DD
  teamLeader: {
    targetAmount: number;
    applyEnabled: boolean;
    teamInvestment: number; // total invested by this member's referrals
  };
  teamSalary: { text: string; link: string; image: string };
  stats: {
    totalEarnings: number;
    todayTaskEarning: number;
    referralEarnings: number;
  };
  promo: { activePromoAvailable: boolean };
  social: { whatsappUrl: string; telegramUrl: string };
  whatsapp: { rewardAmount: number; claimed: boolean; enabled: boolean };
  telegram: { rewardAmount: number; claimed: boolean; enabled: boolean };
}

export async function getHomeData(userId: string, tx: Tx = db): Promise<HomeData> {
  const settings = await getSettings(tx);
  await ensureSystemPromoRows(tx);

  const today = new Date().toISOString().slice(0, 10);
  const todayStart = new Date(`${today}T00:00:00.000Z`);

  const referralIds = await tx.user.findMany({
    where: { referredById: userId },
    select: { id: true },
  });

  const [totalAgg, todayAgg, referralAgg, teamAgg, telegramClaim, whatsappClaim, activePromos] = await Promise.all([
    tx.transaction.aggregate({
      where: { userId, type: { in: [...EARNING_TYPES] }, status: { in: ["completed", "approved"] } },
      _sum: { amount: true },
    }),
    tx.transaction.aggregate({
      where: {
        userId,
        type: "task_reward",
        status: { in: ["completed", "approved"] },
        createdAt: { gte: todayStart },
      },
      _sum: { amount: true },
    }),
    tx.transaction.aggregate({
      where: {
        userId,
        type: { in: ["referral_unlock", "referral_commission"] },
        status: { in: ["completed", "approved"] },
      },
      _sum: { amount: true },
    }),
    referralIds.length > 0
      ? tx.transaction.aggregate({
          where: {
            userId: { in: referralIds.map((r) => r.id) },
            status: { in: ["completed", "approved"] },
            OR: [
              // package engine ledger rows (status completed)
              { type: { in: ["plan_purchase", "package_purchase"] } },
              // VIP plan purchases are recorded as approved plan-purpose deposits
              { type: "deposit", meta: { contains: '"purpose":"plan"' } },
            ],
          },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: null as number | null } }),
    tx.promoClaim.findFirst({
      where: { userId, promoCode: { code: TELEGRAM_PROMO_CODE } },
      select: { id: true },
    }),
    tx.promoClaim.findFirst({
      where: { userId, promoCode: { code: WHATSAPP_PROMO_CODE } },
      select: { id: true },
    }),
    tx.promoCode.findMany({
      where: { isActive: true, isSystem: false },
      select: { maxUses: true, usedCount: true },
    }),
  ]);

  // "Available" promo = active, non-system, with remaining uses.
  // (Prisma can't compare two columns in a where filter, so finish in JS.)
  const promoAvailable = activePromos.some((p) => p.maxUses == null || p.usedCount < p.maxUses);

  const luckyDrawRaw = (settings.home_lucky_draw_date ?? "").trim();
  const luckyDrawDate = /^\d{4}-\d{2}-\d{2}$/.test(luckyDrawRaw) ? luckyDrawRaw : null;

  return {
    header: buildHomeHeaderDTO(settings),
    announcementUr: (settings.home_announcement_ur ?? "").trim(),
    announcementEn: (settings.home_announcement_en ?? "").trim(),
    luckyDrawDate,
    teamLeader: {
      targetAmount: parsePositiveInt(settings.home_team_leader_target) ?? 50000,
      applyEnabled: parseBool(settings.home_team_leader_apply_enabled),
      teamInvestment: Math.abs(teamAgg._sum.amount ?? 0),
    },
    teamSalary: {
      text: (settings.home_team_salary_text ?? "").trim(),
      link: (settings.home_team_salary_link ?? "").trim(),
      image: (settings.home_team_salary_image ?? "").trim(),
    },
    stats: {
      totalEarnings: totalAgg._sum.amount ?? 0,
      todayTaskEarning: todayAgg._sum.amount ?? 0,
      referralEarnings: referralAgg._sum.amount ?? 0,
    },
    promo: { activePromoAvailable: promoAvailable },
    social: {
      whatsappUrl: (settings.home_whatsapp_url ?? "").trim(),
      telegramUrl: (settings.home_telegram_url ?? "").trim(),
    },
    whatsapp: {
      rewardAmount: parsePositiveInt(settings.home_whatsapp_reward) ?? 50,
      claimed: Boolean(whatsappClaim),
      enabled: parseBool(settings.home_whatsapp_enabled),
    },
    telegram: {
      rewardAmount: parsePositiveInt(settings.home_telegram_reward) ?? 50,
      claimed: Boolean(telegramClaim),
      enabled: parseBool(settings.home_telegram_enabled),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Claim engine                                                        */
/* ------------------------------------------------------------------ */

export interface ClaimResult {
  reward: number;
  title: string;
  code: string;
}

/** Friendly ledger description for a system channel code. */
function channelCodeDescription(code: string): string | null {
  if (code === TELEGRAM_PROMO_CODE) return "Telegram join reward";
  if (code === WHATSAPP_PROMO_CODE) return "WhatsApp join reward";
  return null;
}

/**
 * Redeem a promo code for a user. Atomic: claim row + used counter + wallet
 * credit + ledger row, or nothing. `rewardOverride` lets the channel widgets
 * pay the live setting amount instead of the row snapshot.
 *
 * Duplicate protection is layered:
 *  1. findFirst pre-check (fast, friendly message)
 *  2. PromoClaim `@@unique([promoCodeId, userId])` — a genuine database
 *     constraint, so double-clicks / multi-tab races / replayed requests can
 *     never create a second reward (P2002 is caught and mapped to a clean
 *     "already claimed" error, and the transaction rolls back untouched).
 */
async function redeemCode(
  tx: Tx,
  userId: string,
  code: string,
  rewardOverride?: number
): Promise<ClaimResult> {
  const promo = await tx.promoCode.findUnique({ where: { code } });
  if (!promo) throw new ApiError("Invalid promo code.", 400);
  if (!promo.isActive) throw new ApiError("This promo code is no longer active.", 400);
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) {
    throw new ApiError("This promo code has reached its usage limit.", 400);
  }

  const already = await tx.promoClaim.findFirst({ where: { userId, promoCodeId: promo.id } });
  if (already) {
    throw new ApiError("You have already claimed this code.", 400);
  }

  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new ApiError("Wallet not found for this account.", 400);

  const reward = rewardOverride != null ? Math.max(0, rewardOverride) : promo.rewardAmount;
  if (reward <= 0) throw new ApiError("This reward is currently unavailable.", 400);

  try {
    await tx.promoClaim.create({ data: { userId, promoCodeId: promo.id } });
  } catch (err) {
    // P2002 = unique-constraint violation: another request (double click,
    // second tab, replay) inserted the claim first — exactly one reward wins.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new ApiError("You have already claimed this code.", 400);
    }
    throw err;
  }
  await tx.promoCode.update({
    where: { id: promo.id },
    data: { usedCount: { increment: 1 } },
  });
  await tx.wallet.update({
    where: { userId },
    data: { withdrawableBalance: { increment: reward } },
  });
  await tx.transaction.create({
    data: {
      userId,
      type: "promo_reward",
      amount: reward,
      status: "completed",
      description:
        channelCodeDescription(promo.code) ?? `Promo reward: ${promo.code}`,
      meta: JSON.stringify({
        code: promo.code,
        title: promo.title,
        source: promo.isSystem
          ? promo.code === TELEGRAM_PROMO_CODE
            ? "telegram"
            : "whatsapp"
          : "promo",
        reward,
      }),
      processedAt: new Date(),
    },
  });

  return { reward, title: promo.title || "Promo reward", code: promo.code };
}

/** POST /api/home/promo — member redeems an admin-issued code. */
export async function claimPromoCode(userId: string, rawCode: string): Promise<ClaimResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new ApiError("Invalid promo code.", 400);
  if (code === TELEGRAM_PROMO_CODE) {
    throw new ApiError("Use the Telegram reward box to claim this one.", 400);
  }
  if (code === WHATSAPP_PROMO_CODE) {
    throw new ApiError("Use the WhatsApp reward box to claim this one.", 400);
  }
  return db.$transaction((tx) => redeemCode(tx, userId, code));
}

/* ------------------------------------------------------------------ */
/* Channel visit rewards (WhatsApp / Telegram)                         */
/* ------------------------------------------------------------------ */

interface ChannelClaimConfig {
  code: string;
  rewardKey: "home_whatsapp_reward" | "home_telegram_reward";
  enabledKey: "home_whatsapp_enabled" | "home_telegram_enabled";
  label: string;
}

/**
 * Per user+task claim queue (in-process). Concurrent attempts — double
 * clicks, multiple tabs, replayed requests hitting this server — run one
 * after another instead of racing on SQLite's single write lock, so the
 * loser gets the clean "already claimed" answer from the pre-check. The
 * `PromoClaim` unique constraint stays the final authority across
 * processes and restarts (P2002 is mapped to the same clean error).
 */
const claimQueues = new Map<string, Promise<unknown>>();

function withClaimLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const tail: Promise<unknown> = claimQueues.get(key) ?? Promise.resolve();
  const run = tail.catch(() => undefined).then(fn);
  const settle = run.catch(() => undefined);
  claimQueues.set(key, settle);
  void settle.then(() => {
    if (claimQueues.get(key) === settle) claimQueues.delete(key);
  });
  return run;
}

/**
 * Claim a channel visit reward. Server-side source of truth only:
 * authenticated user (route layer), task enabled, reward amount read from
 * the live admin setting, one claim per user per task (unique constraint).
 * Nothing about the amount or eligibility is accepted from the frontend.
 */
async function claimChannelReward(
  userId: string,
  config: ChannelClaimConfig,
): Promise<ClaimResult> {
  return withClaimLock(`${userId}:${config.code}`, () =>
    db.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      if (!parseBool(settings[config.enabledKey])) {
        throw new ApiError(`The ${config.label} reward is currently disabled.`, 400);
      }
      const reward = parsePositiveInt(settings[config.rewardKey]) ?? 50;
      await ensureSystemPromoRows(tx);
      return redeemCode(tx, userId, config.code, reward);
    }),
  );
}

/** POST /api/home/telegram — member claims the visit-Telegram reward (once). */
export async function claimTelegramReward(userId: string): Promise<ClaimResult> {
  return claimChannelReward(userId, {
    code: TELEGRAM_PROMO_CODE,
    rewardKey: "home_telegram_reward",
    enabledKey: "home_telegram_enabled",
    label: "Telegram",
  });
}

/** POST /api/home/whatsapp — member claims the visit-WhatsApp reward (once). */
export async function claimWhatsappReward(userId: string): Promise<ClaimResult> {
  return claimChannelReward(userId, {
    code: WHATSAPP_PROMO_CODE,
    rewardKey: "home_whatsapp_reward",
    enabledKey: "home_whatsapp_enabled",
    label: "WhatsApp",
  });
}
