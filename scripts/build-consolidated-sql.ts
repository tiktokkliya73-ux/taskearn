/**
 * Build script — assembles the consolidated 10-step Supabase migration from
 * the canonical db/supabase-schema.sql by verbatim line-range extraction
 * (each object exactly once, always the LATEST definition). The output is
 * then validated by validate-consolidated.ts.
 * Run: bun scripts/build-consolidated-sql.ts
 */
import { readFileSync, writeFileSync } from "fs";

const canonicalSql = readFileSync("db/supabase-schema.sql", "utf8");
const src = canonicalSql.split("\n");

/** Extract inclusive 1-based line range, trimmed of leading/trailing blanks. */
function L(a: number, b: number): string {
  return src.slice(a - 1, b).join("\n").replace(/^\n+|\n+$/g, "") + "\n";
}

const out: string[] = [];

out.push(`-- ============================================================================
-- TaskEarn × Supabase — COMPLETE Database Migration & Setup (Consolidated)
-- ============================================================================
-- WHAT THIS IS: the complete, current, production-ready Supabase PostgreSQL
-- setup for the TaskEarn Hub codebase, consolidated into one script. It is
-- derived 1:1 from the project's canonical provisioning file
-- (db/supabase-schema.sql) — every function body is verbatim.
--
-- HOW TO USE (one time, ~10 seconds):
--   1. Open your Supabase project dashboard
--   2. Go to  SQL Editor  →  New query
--   3. Paste this ENTIRE file and click "Run"
--   4. Come back to the TaskEarn website → Admin → Supabase → "Migrate & Activate"
--
-- WHAT THIS CREATES:
--   * All 17 TaskEarn tables (users, wallets, plans, tasks, user_plans,
--     user_tasks, transactions, system_settings, password_reset_tokens,
--     notifications, investment_packages, user_packages, promo_codes,
--     promo_claims, payment_methods, withdrawal_methods, package_task_logs,
--     support_tickets)
--   * Row Level Security: every table is locked so clients using the
--     publishable (anon/authenticated) keys can read/write NOTHING. All
--     data access happens through the website's server (service role key)
--     and the SECURITY DEFINER RPC functions below.
--   * SECURITY DEFINER RPC functions that implement the core financial rules
--     atomically inside PostgreSQL:
--       - atomic referral unlock  (LEAST(inviter.task_balance, unlock_amount))
--       - referral package commission → inviter's WITHDRAWABLE balance
--         (50% by default, admin-tunable via invite_commission_percent),
--         credited exactly once per activation instance (both activation
--         paths: wallet-balance purchase AND admin-approved payment)
--       - withdrawal policy: fixed Rs 20 minimum; NO fixed platform maximum
--         — the per-request cap is the member's own
--         MIN(task_balance, withdrawable_balance) (task balance = eligibility
--         cap only, never deducted; just the withdrawable pocket pays out)
--       - task rewards credited to the non-withdrawable task (main) balance
--       - package daily-task claim + nightly earnings engine (idempotent
--         per day, live package config as the source of truth)
--       - withdrawal deduct-and-hold, refund on reject
--       - deposit / plan / package payment approval, plan activation,
--         admin balance adjustments, channel visit rewards (Telegram +
--         WhatsApp), promo codes
--   * Seed data: platform settings, 4 VIP plans, 6 tasks, 4 investment
--     packages, the 7 payout channels, TELEGRAM/WHATSAPP system reward rows
--     and the temporary demo admin account  admin@taskearn.com
--     (password  Admin@123  — change it on the website before going live).
--
-- The script is IDEMPOTENT — running it twice changes nothing. It is safe
-- on a FRESH project AND on a project provisioned with an earlier version
-- of the provisioning script (conditional ALTERs + create-if-not-exists +
-- on-conflict-do-nothing seeds upgrade older deployments in place).
-- ============================================================================

-- ############################################################################
-- STEP 1 — Extensions / Types
-- ############################################################################
-- No PostgreSQL extensions and no custom ENUM types are required by this
-- project: row ids are app-generated cuid-style TEXT, uuid is a built-in
-- type, and every status/type column is TEXT (matching the app's TS unions).
--
-- Two base helper functions are created HERE because the table definitions
-- in STEP 2 reference public.app_id() in their column DEFAULTS, and the
-- triggers in STEP 5 reference public.touch_updated_at().
--
-- check_function_bodies is disabled for this provisioning run (standard
-- Supabase migration practice): several read RPCs are LANGUAGE sql and
-- Postgres would otherwise validate their bodies — including table
-- references — at CREATE time, before later steps create those tables.
-- Bodies are fully parsed + planned at first execution. The session default
-- is restored at the end of this script.
set check_function_bodies = off;

-- 25-char lowercase alphanumeric id (cuid-like, same shape as the app uses)
`);

out.push(L(46, 51));
out.push(`
-- keep updated_at fresh on every UPDATE
`);
out.push(L(54, 59));

out.push(`
-- ############################################################################
-- STEP 2 — Tables
-- ############################################################################
`);

const tables: [string, number, number][] = [
  ["users", 65, 81],
  ["wallets", 83, 89],
  ["plans", 91, 103],
  ["tasks", 105, 115],
  ["user_plans", 117, 124],
  ["user_tasks", 127, 136],
  ["transactions", 139, 150],
  ["system_settings", 154, 159],
  ["password_reset_tokens", 160, 169],
  ["notifications", 171, 178],
  ["investment_packages", 1457, 1469],
  ["user_packages", 1471, 1483],
  ["promo_codes", 1738, 1750],
  ["promo_claims", 1751, 1757],
  ["payment_methods", 2435, 2446],
  ["withdrawal_methods", 2848, 2857],
  ["package_task_logs", 2922, 2932],
  ["support_tickets", 3819, 3829],
];
for (const [name, a, b] of tables) {
  out.push(`-- ── ${name} ──\n`);
  out.push(L(a, b));
  out.push("\n");
}

out.push(`-- ############################################################################
-- STEP 3 — Relationships & Constraints
-- ############################################################################
-- Foreign keys are declared inline in STEP 2. This step contains the
-- CONDITIONAL upgrades for deployments provisioned with an older version of
-- the provisioning script (Ads Execution Engine task columns + the
-- admin-editable package description) so the schema converges in place.
`);

out.push(L(2000, 2001));
out.push("\n");
out.push(L(2003, 2009));
out.push("\n");
out.push(L(2011, 2011));
out.push("\n");
out.push(L(2431, 2431));
out.push("\n");

out.push(`-- ############################################################################
-- STEP 4 — Functions (helpers + SECURITY DEFINER RPCs) and seed data
-- ############################################################################
`);

const fnBlocks: [string, number, number][] = [
  ["get_setting — read a platform setting", 218, 221],
  ["tx_dto — serialize a transaction row to the app's TransactionDTO json (payment-proof data URL stripped; hasProof flags it)", 226, 243],
  ["process_referral_unlock — atomic referral unlock (the PRD's core rule)", 246, 305],
  ["api_signup_user — handle_new_user() equivalent: user + wallet atomically", 308, 357],
  ["api_start_task — countdown registration with plan-target gate + rolling 24h guard", 2066, 2117],
  ["complete_task_transaction — THE task claim RPC (spec-named)", 2133, 2223],
  ["api_complete_task — backward-compatible delegate", 2226, 2231],
  ["api_activate_plan — plan payment checkout submission (TID + optional proof; auto-approve aware)", 473, 540],
  ["activate_plan_and_unlock_referral — spec-named admin approval helper", 2259, 2283],
  ["api_topup_deposit — wallet top-up deposit request", 543, 576],
  ["api_process_deposit — admin approve/reject money-in (plan activation + referral unlock / package instance + commission / top-up credit / reject with note)", 3545, 3649],
  ["api_request_withdrawal — validates, deducts (hold), inserts pending transaction", 649, 694],
  ["api_process_withdrawal — admin approve (marks paid) or reject (auto-refund)", 697, 729],
  ["api_adjust_balance — signed admin balance adjustment with ledger entry", 732, 776],
  ["api_public_stats — landing-page counters", 782, 793],
  ["api_public_payouts — latest approved payouts (masked names)", 795, 813],
  ["api_dashboard — member dashboard aggregate incl. notification bell", 815, 886],
  ["api_tasks_list — member task list with plan-targeted filtering + per-task reward", 2014, 2063],
  ["api_referrals — invite list + team stats + admin-configured invite page payload", 934, 1094],
  ["api_wallet_txns — wallet + latest transactions", 1096, 1106],
  ["api_admin_stats — admin dashboard aggregate (latest: adds openSupportCount)", 3960, 4004],
  ["api_admin_users — paginated server-side user management (search + status filter)", 1152, 1215],
  ["api_admin_notifications — paginated broadcast history", 1218, 1249],
  ["api_admin_notification_create — send one broadcast", 1251, 1275],
  ["api_support_list — member's own support tickets (p_user_id-scoped)", 3843, 3852],
  ["api_support_create — submit a new support request (validated)", 3855, 3885],
  ["api_admin_support_list — every ticket with member name/email", 3888, 3899],
  ["api_admin_support_update — set status and/or the admin reply", 3902, 3956],
  ["api_admin_txns — pending-first admin money lists (withdrawals / deposits incl. plan + package requests)", 2740, 2761],
  ["api_admin_transactions — read-only searchable ledger view (Admin Control Center)", 1302, 1343],
  ["ensure_payment_methods_seeded — one-time backfill from legacy gateway settings", 2461, 2502],
  ["api_payment_methods_list — active checkout channels + require_proof flag", 2506, 2522],
  ["api_submit_package_payment — pending package payment request with every guard server-side", 2527, 2614],
  ["api_payment_history — the member's own payment requests", 2723, 2735],
  ["api_withdrawal_methods_list — active payout channels for the Withdraw dropdown", 2878, 2891],
  ["api_packages_list — member catalogue + live-config holdings + portfolio totals", 2764, 2812],
  ["api_purchase_package — balance purchase (task-first deduction) + inviter commission, atomic", 3459, 3540],
  ["api_run_daily_earnings — nightly distribution engine (idempotent per day, LIVE package config)", 1633, 1713],
  ["api_package_tasks_list — THE one applicable daily task card + content task", 2937, 2995],
  ["api_start_package_task — countdown registration (ownership + daily guards, idempotent)", 3000, 3048],
  ["api_complete_package_task — THE daily claim (timer check, live package earning, no double credit with the nightly engine)", 3067, 3154],
  ["fn_redeem_promo — shared atomic redeem engine (claim + counter + withdrawable credit + ledger row)", 3233, 3304],
  ["fn_claim_channel — shared channel visit-reward claim (enabled gate → live amount → row self-heal → redeem)", 3310, 3344],
  ["fn_credit_referral_commission — inviter's withdrawable commission, exactly once per activation instance", 3373, 3455],
  ["api_claim_promo — member promo redeem + WHATSAPP channel routing", 3348, 3358],
  ["api_claim_telegram — telegram channel claim (enabled gate enforced)", 3360, 3364],
  ["api_home_data — member Home payload (widgets config + stats + channel claim states)", 3654, 3751],
  ["set_system_setting — service-role settings upsert", 2286, 2297],
];

for (const [label, a, b] of fnBlocks) {
  out.push(`-- ── ${label} ──\n`);
  if (label.startsWith("api_process_deposit")) {
    // exactly ONE signature: drop any legacy 3-arg version first
    out.push(L(2619, 2619));
    out.push("\n");
  }
  out.push(L(a, b));
  out.push("\n");
}

out.push(`-- ── Seed data (idempotent — merge on conflict, never overwrite live edits) ──
`);

// system_settings: generate the merged seed INSERT from the canonical file's
// ACTUAL seeded rows (runs it through PGlite — deterministic, no parsing).
{
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
  );
  await db.exec(canonicalSql);
  const rows = (await db.query("select key, value from system_settings order by key")).rows as {
    key: string;
    value: string;
  }[];
  const esc = (s: string) => s.replace(/'/g, "''");
  out.push("insert into public.system_settings (key, value) values\n");
  out.push(rows.map((r) => `  ('${esc(r.key)}', '${esc(r.value)}')`).join(",\n"));
  out.push("\non conflict (key) do nothing;\n\n");
  console.log("settings seed rows:", rows.length);
}

// Task 38 policy sync — brings EXISTING deployments (whose system_settings
// rows already exist, so the on-conflict-do-nothing seeds above were no-ops)
// to the new withdrawal/commission policy values. Idempotent by nature.
out.push(`-- Task 38 policy sync — applies the withdrawal & commission policy to
-- deployments that already hold older system_settings rows (the seeds above
-- are on-conflict-do-nothing, so existing rows keep their old values without
-- this). The admin can still tune invite_commission_percent from the
-- website's Admin → Invite page afterwards.
update public.system_settings set value = '50' where key = 'invite_commission_percent';
update public.system_settings set value = '20' where key = 'min_withdrawal';
update public.system_settings set value = '0'  where key = 'max_withdrawal';

`);

out.push(L(1415, 1420)); // plans seed
out.push("\n");
out.push(L(1422, 1430)); // tasks seed
out.push("\n");
out.push(L(1432, 1446)); // admin user + wallet
out.push("\n");
out.push(L(1723, 1736)); // investment packages seed
out.push("\n");
// promo seeds: TELEGRAM + WHATSAPP system rows + WELCOME50 demo code
out.push(
`insert into public.promo_codes (code, title, reward_amount, max_uses, is_active, is_system) values
  ('TELEGRAM', 'Telegram join reward', 50, null, true, true),
  ('WHATSAPP', 'WhatsApp join reward', 50, null, true, true),
  ('WELCOME50', 'Welcome bonus', 50, 100, true, false)
on conflict (code) do nothing;

`);
out.push(L(2867, 2875)); // withdrawal methods seed
out.push("\n");

out.push(`-- ############################################################################
-- STEP 5 — Triggers
-- ############################################################################
-- updated_at maintenance on every mutable table.
`);

const triggers: [number, number][] = [
  [180, 182],
  [183, 185],
  [186, 188],
  [189, 191],
  [1490, 1492],
  [1493, 1495],
  [1764, 1766],
  [2450, 2452],
  [2861, 2863],
  [3838, 3840],
];
for (const [a, b] of triggers) {
  out.push(L(a, b));
  out.push("\n");
}

out.push(`-- ############################################################################
-- STEP 6 — Indexes
-- ############################################################################
`);

const indexes: [number, number][] = [
  [125, 125],
  [137, 137],
  [151, 152],
  [1484, 1485],
  [1758, 1758],
  [2448, 2448],
  [2859, 2859],
  [2934, 2934],
  [3833, 3834],
  [3835, 3836],
];
for (const [a, b] of indexes) {
  out.push(L(a, b));
  out.push("\n");
}

out.push(`-- ############################################################################
-- STEP 7 — Row Level Security
-- ############################################################################
-- RLS is ENABLED on every table with NO policies created on purpose:
-- with no permissive policy, anon and authenticated keys get zero rows and
-- zero writes (PostgreSQL default-deny). The website's server uses the
-- service role key, which bypasses RLS entirely.
`);

const rlsLines: string[] = [];
for (const l of src) {
  if (/^alter table public\.[a-z_]+ enable row level security;/.test(l)) {
    if (!rlsLines.includes(l)) rlsLines.push(l);
  }
}
out.push(rlsLines.join("\n"));
out.push("\n\n");

out.push(`-- ############################################################################
-- STEP 8 — RLS Policies & function EXECUTE privileges
-- ############################################################################
-- Table policies: deliberately NONE (see STEP 7) — every table is default
-- deny for anon/authenticated; the service role bypasses RLS. This is the
-- project's established security model: ALL data access goes through the
-- website's server (service role key) and the SECURITY DEFINER RPCs.
--
-- Function privileges: EXECUTE revoked from public/anon/authenticated and
-- granted ONLY to service_role for every RPC below. Internal helper
-- functions (app_id, tx_dto, process_referral_unlock, fn_redeem_promo,
-- fn_claim_channel, fn_credit_referral_commission) are revoked from
-- public/anon/authenticated and NOT granted to service_role — they are
-- callable only from inside the wrapping SECURITY DEFINER RPCs.
`);

const revokes = `
revoke execute on function public.app_id() from public, anon, authenticated;
revoke execute on function public.get_setting(text) from public, anon, authenticated;
revoke execute on function public.tx_dto(public.transactions) from public, anon, authenticated;
revoke execute on function public.process_referral_unlock(public.users) from public, anon, authenticated;
revoke execute on function public.api_signup_user(text, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.api_start_task(text, text) from public, anon, authenticated;
revoke execute on function public.api_complete_task(text, text) from public, anon, authenticated;
revoke execute on function public.complete_task_transaction(text, text) from public, anon, authenticated;
revoke execute on function public.api_activate_plan(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.activate_plan_and_unlock_referral(text, text) from public, anon, authenticated;
revoke execute on function public.api_topup_deposit(text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.api_process_deposit(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.api_request_withdrawal(text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.api_process_withdrawal(text, text, text) from public, anon, authenticated;
revoke execute on function public.api_adjust_balance(text, text, integer, text, text) from public, anon, authenticated;
revoke execute on function public.api_public_stats() from public, anon, authenticated;
revoke execute on function public.api_public_payouts() from public, anon, authenticated;
revoke execute on function public.api_dashboard(text) from public, anon, authenticated;
revoke execute on function public.api_tasks_list(text) from public, anon, authenticated;
revoke execute on function public.api_referrals(text) from public, anon, authenticated;
revoke execute on function public.api_wallet_txns(text) from public, anon, authenticated;
revoke execute on function public.api_admin_stats() from public, anon, authenticated;
revoke execute on function public.api_admin_users(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.api_admin_notifications(integer, integer) from public, anon, authenticated;
revoke execute on function public.api_admin_notification_create(text, text, text) from public, anon, authenticated;
revoke execute on function public.api_admin_txns(text, integer) from public, anon, authenticated;
revoke execute on function public.api_admin_transactions(text, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.ensure_payment_methods_seeded() from public, anon, authenticated;
revoke execute on function public.api_payment_methods_list() from public, anon, authenticated;
revoke execute on function public.api_submit_package_payment(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.api_payment_history(text) from public, anon, authenticated;
revoke execute on function public.api_withdrawal_methods_list() from public, anon, authenticated;
revoke execute on function public.api_packages_list(text) from public, anon, authenticated;
revoke execute on function public.api_purchase_package(text, text) from public, anon, authenticated;
revoke execute on function public.api_run_daily_earnings() from public, anon, authenticated;
revoke execute on function public.api_package_tasks_list(text) from public, anon, authenticated;
revoke execute on function public.api_start_package_task(text, text) from public, anon, authenticated;
revoke execute on function public.api_complete_package_task(text, text) from public, anon, authenticated;
revoke execute on function public.fn_redeem_promo(text, text, integer) from public, anon, authenticated;
revoke execute on function public.fn_claim_channel(text, text) from public, anon, authenticated;
revoke execute on function public.fn_credit_referral_commission(text, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.api_claim_promo(text, text) from public, anon, authenticated;
revoke execute on function public.api_claim_telegram(text) from public, anon, authenticated;
revoke execute on function public.api_home_data(text) from public, anon, authenticated;
revoke execute on function public.set_system_setting(text, text) from public, anon, authenticated;
revoke execute on function public.api_support_list(text) from public, anon, authenticated;
revoke execute on function public.api_support_create(text, text, text) from public, anon, authenticated;
revoke execute on function public.api_admin_support_list() from public, anon, authenticated;
revoke execute on function public.api_admin_support_update(text, text, text, boolean) from public, anon, authenticated;
`;
out.push(revokes);

const grants = `
grant execute on function public.get_setting(text) to service_role;
grant execute on function public.api_signup_user(text, text, text, text, text, text, uuid) to service_role;
grant execute on function public.api_start_task(text, text) to service_role;
grant execute on function public.api_complete_task(text, text) to service_role;
grant execute on function public.complete_task_transaction(text, text) to service_role;
grant execute on function public.api_activate_plan(text, text, text, text, text) to service_role;
grant execute on function public.activate_plan_and_unlock_referral(text, text) to service_role;
grant execute on function public.api_topup_deposit(text, text, text, integer) to service_role;
grant execute on function public.api_process_deposit(text, text, text, text) to service_role;
grant execute on function public.api_request_withdrawal(text, integer, text, text) to service_role;
grant execute on function public.api_process_withdrawal(text, text, text) to service_role;
grant execute on function public.api_adjust_balance(text, text, integer, text, text) to service_role;
grant execute on function public.api_public_stats() to service_role;
grant execute on function public.api_public_payouts() to service_role;
grant execute on function public.api_dashboard(text) to service_role;
grant execute on function public.api_tasks_list(text) to service_role;
grant execute on function public.api_referrals(text) to service_role;
grant execute on function public.api_wallet_txns(text) to service_role;
grant execute on function public.api_admin_stats() to service_role;
grant execute on function public.api_admin_users(text, text, integer, integer) to service_role;
grant execute on function public.api_admin_notifications(integer, integer) to service_role;
grant execute on function public.api_admin_notification_create(text, text, text) to service_role;
grant execute on function public.api_support_list(text) to service_role;
grant execute on function public.api_support_create(text, text, text) to service_role;
grant execute on function public.api_admin_support_list() to service_role;
grant execute on function public.api_admin_support_update(text, text, text, boolean) to service_role;
grant execute on function public.api_admin_txns(text, integer) to service_role;
grant execute on function public.api_admin_transactions(text, text, text, integer, integer) to service_role;
grant execute on function public.ensure_payment_methods_seeded() to service_role;
grant execute on function public.api_payment_methods_list() to service_role;
grant execute on function public.api_submit_package_payment(text, text, text, text, text) to service_role;
grant execute on function public.api_payment_history(text) to service_role;
grant execute on function public.api_withdrawal_methods_list() to service_role;
grant execute on function public.api_packages_list(text) to service_role;
grant execute on function public.api_purchase_package(text, text) to service_role;
grant execute on function public.api_run_daily_earnings() to service_role;
grant execute on function public.api_package_tasks_list(text) to service_role;
grant execute on function public.api_start_package_task(text, text) to service_role;
grant execute on function public.api_complete_package_task(text, text) to service_role;
grant execute on function public.api_claim_promo(text, text) to service_role;
grant execute on function public.api_claim_telegram(text) to service_role;
grant execute on function public.api_home_data(text) to service_role;
grant execute on function public.set_system_setting(text, text) to service_role;
`;
out.push(grants);

out.push(`
-- ############################################################################
-- STEP 9 — Storage Policies
-- ############################################################################
-- NOT REQUIRED. This project does not use Supabase Storage: branding
-- images, payment-method logos, payout-channel logos and payment-proof
-- screenshots are stored as validated http(s)/data URLs inside
-- system_settings values and transactions.meta (jsonb). No buckets, no
-- storage policies.

-- restore the session default (see STEP 1)
set check_function_bodies = on;

-- ============================================================================
-- Done! Go to the website → Admin → Supabase → "Migrate & Activate".
-- ============================================================================
`);

writeFileSync("db/supabase-migration.sql", out.join(""));
console.log("written /tmp/supabase-consolidated.sql:", out.join("").split("\n").length, "lines");
