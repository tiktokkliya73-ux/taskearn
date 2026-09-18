import { SETTING_DEFAULTS } from "@/lib/settings";

/**
 * Invite / Referral page configuration (Task 25).
 *
 * Pure TS — shared by the local API routes AND the Supabase wrappers (no
 * next/server imports). Everything here reads the admin-managed invite_*
 * system settings; the member Invite page never hardcodes amounts or texts.
 *
 * Text templates may contain the `{percent}` placeholder — replaced with the
 * configured commission percentage before the text is returned to the client.
 */

export const INVITE_LEVELS_MAX = 8;
export const INVITE_TEXT_LIST_MAX = 10;
export const INVITE_TEXT_MAX_CHARS = 300;

export interface InviteRewardLevel {
  /** 1-based display order (ascending by required amount). */
  level: number;
  /** Team investment (PKR) required to unlock the level. */
  required: number;
  /** Cash reward amount (PKR) shown for the level. */
  reward: number;
}

/** The admin-facing editable config (RAW templates, {percent} NOT rendered). */
export interface InviteRawConfig {
  commissionPercent: number;
  commissionText: string;
  levels: InviteRewardLevel[];
  howItWorks: string[];
  policy: string[];
}

/** The member-facing config (texts rendered with the live percentage). */
export interface InviteRenderedConfig {
  commissionPercent: number;
  commissionText: string;
  levels: InviteRewardLevel[];
  howItWorks: string[];
  policy: string[];
}

const DEFAULT_LEVEL_PAIRS: { required: number; reward: number }[] = [
  { required: 5000, reward: 1500 },
  { required: 10000, reward: 3000 },
  { required: 20000, reward: 6000 },
  { required: 30000, reward: 9000 },
  { required: 50000, reward: 15000 },
];

const DEFAULT_HOW_IT_WORKS = safeParseList(SETTING_DEFAULTS.invite_how_it_works);
const DEFAULT_POLICY = safeParseList(SETTING_DEFAULTS.invite_referral_policy);

function safeParseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  } catch {
    /* fall through */
  }
  return [];
}

function parsePercent(raw: string | undefined): number {
  const n = parseInt((raw ?? "").trim(), 10);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  const fallback = parseInt(SETTING_DEFAULTS.invite_commission_percent, 10);
  return Number.isFinite(fallback) ? fallback : 10;
}

/** Parse + normalize the invite_reward_levels JSON setting (defensive). */
export function parseInviteLevels(raw: string | undefined): InviteRewardLevel[] {
  let pairs: { required: number; reward: number }[] = [];
  try {
    const parsed = JSON.parse((raw ?? "").trim());
    if (Array.isArray(parsed)) {
      pairs = parsed
        .map((v): { required: number; reward: number } | null => {
          if (typeof v !== "object" || v === null) return null;
          const required = Number((v as { required?: unknown }).required);
          const reward = Number((v as { reward?: unknown }).reward);
          if (!Number.isInteger(required) || required <= 0) return null;
          if (!Number.isInteger(reward) || reward <= 0) return null;
          return { required, reward };
        })
        .filter((v): v is { required: number; reward: number } => v !== null)
        .sort((a, b) => a.required - b.required)
        .slice(0, INVITE_LEVELS_MAX);
    }
  } catch {
    /* fall through to defaults */
  }
  if (pairs.length === 0) pairs = DEFAULT_LEVEL_PAIRS;
  return pairs.map((p, i) => ({ level: i + 1, ...p }));
}

/** Parse a JSON string-array setting (defensive, capped, fallback defaults). */
export function parseInviteTextList(raw: string | undefined, fallback: string[]): string[] {
  const list = safeParseList((raw ?? "").trim()).slice(0, INVITE_TEXT_LIST_MAX);
  return list.length > 0 ? list : fallback;
}

/** Replace the {percent} placeholder in an admin text template. */
export function renderInviteText(template: string, percent: number): string {
  return template.replaceAll("{percent}", String(percent));
}

/** The RAW admin-editable config (templates unrendered) from a settings map. */
export function getRawInviteConfig(settings: Record<string, string>): InviteRawConfig {
  const commissionPercent = parsePercent(settings.invite_commission_percent);
  const commissionText = (settings.invite_commission_text ?? "").trim() || SETTING_DEFAULTS.invite_commission_text;
  return {
    commissionPercent,
    commissionText,
    levels: parseInviteLevels(settings.invite_reward_levels),
    howItWorks: parseInviteTextList(settings.invite_how_it_works, DEFAULT_HOW_IT_WORKS),
    policy: parseInviteTextList(settings.invite_referral_policy, DEFAULT_POLICY),
  };
}

/** The member-facing config (texts rendered with the live percentage). */
export function getRenderedInviteConfig(settings: Record<string, string>): InviteRenderedConfig {
  const raw = getRawInviteConfig(settings);
  return {
    commissionPercent: raw.commissionPercent,
    commissionText: renderInviteText(raw.commissionText, raw.commissionPercent),
    levels: raw.levels,
    howItWorks: raw.howItWorks.map((t) => renderInviteText(t, raw.commissionPercent)),
    policy: raw.policy.map((t) => renderInviteText(t, raw.commissionPercent)),
  };
}

/* ------------------------------------------------------------------ */
/* Admin POST validation (shared by the local + Supabase routes)       */
/* ------------------------------------------------------------------ */

/**
 * Validate + normalize an incoming { settings } payload for
 * POST /api/admin/invite. Returns the canonical key→value map to persist,
 * or an error message the route converts into a 400 ApiError.
 *
 * Normalization: levels are sorted ascending by required amount; text lists
 * are trimmed and empties dropped — so the saved value is always canonical.
 */
export function validateInviteSettings(
  incoming: unknown
): { ok: true; settings: Record<string, string> } | { ok: false; error: string } {
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    return { ok: false, error: "Invalid settings payload." };
  }
  const obj = incoming as Record<string, unknown>;
  const out: Record<string, string> = {};

  // invite_commission_percent
  if ("invite_commission_percent" in obj) {
    const n = Number(obj.invite_commission_percent);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      return { ok: false, error: "Commission percentage must be a whole number between 0 and 100." };
    }
    out.invite_commission_percent = String(n);
  }

  // invite_commission_text
  if ("invite_commission_text" in obj) {
    const text = String(obj.invite_commission_text ?? "").trim();
    if (text.length < 3 || text.length > 200) {
      return { ok: false, error: "The referral code card text must be between 3 and 200 characters." };
    }
    out.invite_commission_text = text;
  }

  // invite_reward_levels
  if ("invite_reward_levels" in obj) {
    let pairs: { required: number; reward: number }[] = [];
    const rawVal = obj.invite_reward_levels;
    if (typeof rawVal === "string") {
      try {
        const parsed = JSON.parse(rawVal);
        if (Array.isArray(parsed)) pairs = parsed as { required: number; reward: number }[];
        else return { ok: false, error: "Cash Reward Levels must be a list of levels." };
      } catch {
        return { ok: false, error: "Cash Reward Levels must be a valid list." };
      }
    } else if (Array.isArray(rawVal)) {
      pairs = rawVal as { required: number; reward: number }[];
    } else {
      return { ok: false, error: "Cash Reward Levels must be a list of levels." };
    }

    const cleaned: { required: number; reward: number }[] = [];
    for (const p of pairs) {
      const required = Number(p?.required);
      const reward = Number(p?.reward);
      if (!Number.isInteger(required) || required <= 0) {
        return { ok: false, error: "Every level's joining amount must be a whole number of PKR 1 or more." };
      }
      if (!Number.isInteger(reward) || reward <= 0) {
        return { ok: false, error: "Every level's reward must be a whole number of PKR 1 or more." };
      }
      cleaned.push({ required, reward });
    }
    if (cleaned.length < 1 || cleaned.length > INVITE_LEVELS_MAX) {
      return { ok: false, error: `Keep between 1 and ${INVITE_LEVELS_MAX} reward levels.` };
    }
    cleaned.sort((a, b) => a.required - b.required);
    out.invite_reward_levels = JSON.stringify(cleaned);
  }

  // text lists (how it works / policy)
  for (const [key, label] of [
    ["invite_how_it_works", "How it works"],
    ["invite_referral_policy", "Referral Policy"],
  ] as const) {
    if (!(key in obj)) continue;
    let lines: string[] = [];
    const rawVal = obj[key];
    if (typeof rawVal === "string") {
      try {
        const parsed = JSON.parse(rawVal);
        if (Array.isArray(parsed)) lines = parsed.map(String);
        else return { ok: false, error: `${label} must be a list of lines.` };
      } catch {
        return { ok: false, error: `${label} must be a valid list.` };
      }
    } else if (Array.isArray(rawVal)) {
      lines = rawVal.map(String);
    } else {
      return { ok: false, error: `${label} must be a list of lines.` };
    }
    const cleaned = lines.map((l) => l.trim()).filter(Boolean);
    if (cleaned.length < 1 || cleaned.length > INVITE_TEXT_LIST_MAX) {
      return { ok: false, error: `${label} needs between 1 and ${INVITE_TEXT_LIST_MAX} lines.` };
    }
    if (cleaned.some((l) => l.length > INVITE_TEXT_MAX_CHARS)) {
      return { ok: false, error: `${label} lines must be ${INVITE_TEXT_MAX_CHARS} characters or fewer.` };
    }
    out[key] = JSON.stringify(cleaned);
  }

  // Unknown keys are dropped (only the five invite_* keys are writable).
  const allowed = Object.keys(out).every((k) => k.startsWith("invite_") && k in SETTING_DEFAULTS);
  if (!allowed) return { ok: false, error: "Unknown invite setting." };

  return { ok: true, settings: out };
}
