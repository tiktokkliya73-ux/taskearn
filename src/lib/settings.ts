import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const SETTING_DEFAULTS = {
  site_title: "TaskEarn",
  // ─── Branding (admin-managed via /admin/branding) ──
  // Custom website logo / favicon / Wallet-Balance method image. Empty = the
  // default built-in marks are shown. Values are http(s) URLs or compressed
  // data:image URLs uploaded from the admin's device (validated server-side).
  site_logo_url: "",
  site_favicon_url: "",
  wallet_method_image_url: "",
  unlock_amount_per_ref: "300",
  // Withdrawal policy (Task 38): the minimum is FIXED at Rs 20 (enforced in
  // the withdraw route — no higher minimum may be introduced) and there is no
  // fixed platform maximum: the per-request cap is the member's own
  // MIN(task_balance, withdrawable_balance). These keys are kept only as the
  // informational values served by /api/public/gateways.
  min_withdrawal: "20",
  max_withdrawal: "0",
  auto_approve_deposits: "true",
  easypaisa_account: "0300-1234567",
  jazzcash_account: "0301-7654321",
  usdt_address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  // ─── Payment Gateways manager (admin-managed via /admin/settings/gateways) ──
  easypaisa_title: "TaskEarn Pvt Ltd",
  jazzcash_title: "TaskEarn Pvt Ltd",
  usdt_qr_url: "",
  payment_instructions:
    "Send the exact amount to the account above, then paste the Transaction ID (TID) from your payment app receipt. Your plan activates after admin approval — usually within a few hours.",
  // ─── Payment checkout policy (admin-managed via System Settings) ──
  // When "true", the payment screenshot is REQUIRED on package/plan checkout.
  require_payment_proof: "false",
  support_email: "support@taskearn.app",
  // ─── Dynamic Home Page widgets (admin-managed via Home Settings) ──
  home_announcement_ur:
    "السلام علیکم! ہماری ٹیم کے لیے فعال ممبران کی شدید ضرورت ہے۔ اپنے دوستوں کو ریفرل کوڈ کے ساتھ رجسٹر کروائیں، انویسٹمنٹ پیکج فعال کریں اور روزانہ کمائیں۔ روزانہ واپسی (Daily Withdrawal) کی مکمل سہولت دستیاب ہے۔",
  home_announcement_en:
    "Assalam-o-Alaikum! We need active members for our team. Register friends with your referral code, activate an investment package and earn daily — daily withdrawal available.",
  home_lucky_draw_date: "2026-09-25",
  home_team_leader_target: "50000",
  home_team_leader_apply_enabled: "true",
  home_team_salary_text: "Team Salary System — Earn up to PKR 13,000 every week",
  home_team_salary_link: "/dashboard/referrals",
  // Optional admin-uploaded visual for the existing team salary promo banner
  // (data URL or http(s) URL; empty → the default gradient banner renders).
  home_team_salary_image: "",
  home_whatsapp_url: "https://whatsapp.com/channel/TaskEarnHub",
  home_telegram_url: "https://t.me/TaskEarnHub",
  // ─── Channel visit rewards (admin-managed via Home Settings) ──
  // Visit-task flow: open channel → return to the site → claim once.
  // Amounts are server-side only (never trusted from the frontend) and the
  // one-per-user guarantee is backed by the PromoClaim unique constraint.
  home_whatsapp_reward: "50",
  home_whatsapp_enabled: "true",
  home_telegram_reward: "50",
  home_telegram_enabled: "true",
  // ─── Home header (admin-managed via Home Settings) ──
  // The premium brand block at the top of the member Home screen (mobile
  // topbar + desktop home header): strong title + muted tagline next to the
  // admin-uploaded logo. Empty values fall back to these defaults.
  home_header_title: "Task Earn Hub",
  home_header_tagline: "Earn daily, withdraw anytime",
  // ─── Login Welcome Popup (admin-managed via Home Settings) ──
  // Promotional image popup shown on the member Home screen right after
  // login/signup. The image is an admin upload (canvas-re-encoded data URL,
  // validated server-side) or an http(s) URL — never hardcoded client-side.
  // Members only ever see it when an image is uploaded AND enabled.
  home_welcome_popup_enabled: "false",
  home_welcome_popup_image: "",
  home_welcome_popup_frequency: "once_per_session",
  home_welcome_popup_title: "",
  home_welcome_popup_description: "",
  home_welcome_popup_button_text: "",
  home_welcome_popup_button_link: "",
  // ─── Promotional Banners (admin-managed via /admin/promo-banners) ──
  // Multiple admin-uploaded promotional banners members see in a premium
  // overlay carousel. Stored as ONE JSON array in a single system_settings
  // row — exactly the storage pattern of the welcome popup / branding
  // features (data URLs or http(s) URLs, validated server-side), so no new
  // tables or database objects are ever needed. No artificial count limit:
  // every banner the admin adds is supported automatically.
  promo_banners: "[]",
  // ─── Animation & User Experience (admin-managed via System Settings) ──
  // Admin control for the premium SUCCESS presentations (visual layer
  // ONLY). The master switch disables every success animation at once;
  // the individual switches gate each existing presentation. Turning any
  // of these OFF never disables the underlying feature — plan activation,
  // referral commissions, deposits, withdrawals and task claims all keep
  // working exactly as before. Parsed via getAnimationSettings()
  // (src/lib/animations.ts) and served to members in the session response.
  success_animations_enabled: "true",
  success_animation_plan_activation: "true",
  success_animation_referral_commission: "true",
  success_animation_deposit: "true",
  success_animation_withdrawal: "true",
  success_animation_task_claim: "true",
  // ─── Invite / Referral page (admin-managed via /admin/invite) ──
  // The Invite tab's commission display + Cash Rewards Levels + editable
  // "How it works" / "Referral Policy" texts. Text templates may contain the
  // {percent} placeholder — it is replaced with invite_commission_percent
  // before the text reaches the member Invite page.
  invite_commission_percent: "50",
  invite_commission_text: "Earn {percent}% commission on every referral's package purchase",
  invite_reward_levels: JSON.stringify([
    { required: 5000, reward: 1500 },
    { required: 10000, reward: 3000 },
    { required: 20000, reward: 6000 },
    { required: 30000, reward: 9000 },
    { required: 50000, reward: 15000 },
  ]),
  invite_how_it_works: JSON.stringify([
    "Share your referral link with friends",
    "They sign up and buy a package",
    "You earn {percent}% commission on their package purchase",
    "Unlock Cash Rewards as your team grows!",
  ]),
  invite_referral_policy: JSON.stringify([
    "You earn only when your referred user purchases a package.",
    "On every paid package purchase, you receive {percent}% commission of the package amount.",
    "Free package users do not generate package purchase commission.",
    "Each referral is counted once, according to the existing referral rules.",
  ]),
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

type DbOrTx = Prisma.TransactionClient | typeof db;

/** Read all settings (merged with defaults) as Record<string,string>. */
export async function getSettings(tx: DbOrTx = db): Promise<Record<string, string>> {
  const rows = await tx.systemSetting.findMany();
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
}

export async function getSettingInt(key: SettingKey, tx: DbOrTx = db): Promise<number> {
  const settings = await getSettings(tx);
  const n = parseInt(settings[key], 10);
  return Number.isFinite(n) ? n : parseInt(SETTING_DEFAULTS[key], 10);
}
