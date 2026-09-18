-- ============================================================================
-- TaskEarn × Supabase — INCREMENTAL UPGRADE (Withdrawal payment-details
--                        workflow + Member Support system + media/logo slots)
-- ============================================================================
-- WHAT THIS IS: the exact SQL required to bring an EXISTING TaskEarn Supabase
-- database (already provisioned with an earlier version of
-- db/supabase-schema.sql) up to the state the current codebase expects for:
--   1. The member Support system (support_tickets table + 4 RPCs + the
--      api_admin_stats openSupportCount badge).
--   2. The team-salary banner media slot (home_team_salary_image setting +
--      the api_home_data 'image' field).
--   3. Safety-ensures for the withdrawal/payment method tables that the
--      payout-logo + payment-destination workflow depends on
--      (withdrawal_methods / payment_methods with logo_url — no-ops if the
--      tables already exist).
--
-- WHAT THIS IS NOT: it does NOT touch wallets, transactions, commission,
-- referral, package or withdrawal-processing business logic. The withdrawal
-- payment-destination snapshot (meta.paymentMethod + meta.accountDetails)
-- ALREADY exists in every version of api_request_withdrawal — the reported
-- issue was fixed in the application layer (Admin UI + server-side approval
-- guard), so NO change to those functions is included here.
--
-- SAFETY: every statement is idempotent —
--   * create table if not exists  /  create index if not exists
--   * create or replace function  (supersedes older definitions)
--   * drop trigger if exists → create trigger
--   * insert ... on conflict do nothing  (never overwrites admin-edited rows)
-- Running this script on a database that is ALREADY up to date changes
-- nothing. It never deletes data and never drops a table.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → New query → paste this ENTIRE
-- file → Run. (~5 seconds.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- STEP 0 — Session guard + shared helpers
--
-- PURPOSE: several functions below are LANGUAGE sql, and PostgreSQL validates
-- SQL-function bodies (including table references) at CREATE time. The guard
-- disables that creation-time check for this run (standard Supabase migration
-- practice — bodies are fully parsed at first execution, when every table
-- exists). The two shared helpers are re-declared defensively: every
-- deployment already has them, but support_tickets' DEFAULT references
-- public.app_id(), so the script is self-sufficient this way.
-- ---------------------------------------------------------------------------
set check_function_bodies = off;

-- 25-char lowercase alphanumeric id (cuid-like, same shape as the app uses)
create or replace function public.app_id() returns text
language sql volatile as $$
  select string_agg(
    substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + (random() * 35)::int, 1), '')
  from generate_series(1, 25)
$$;

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 1 — Tables
--
-- PURPOSE:
--   * support_tickets — the ONLY genuinely new table (Member Support system).
--     One row per member help request: subject + message + status workflow
--     (open / in_progress / resolved / closed) + a single admin reply.
--   * withdrawal_methods — SAFETY ENSURE (no-op if it already exists): the
--     admin-managed payout channels the member picks on the Withdraw page;
--     logo_url carries the channel logo. The withdrawal payment-destination
--     workflow depends on this table.
--   * payment_methods — SAFETY ENSURE (no-op if it already exists): the
--     admin-managed deposit/checkout channels, with their logo_url column.
-- ---------------------------------------------------------------------------

-- 1a. support_tickets (NEW — Task 40)
create table if not exists public.support_tickets (
  id         text primary key default public.app_id(),
  user_id    text not null references public.users(id) on delete cascade,
  subject    text not null,
  message    text not null,
  status     text not null default 'open',
  reply      text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1b. withdrawal_methods (ensure — no-op when present)
create table if not exists public.withdrawal_methods (
  id         text primary key default public.app_id(),
  name       text not null unique,
  kind       text not null default 'wallet' check (kind in ('wallet', 'bank')),
  logo_url   text,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1c. payment_methods (ensure — no-op when present)
create table if not exists public.payment_methods (
  id             text primary key default public.app_id(),
  name           text not null unique,
  account_number text not null check (char_length(btrim(account_number)) between 4 and 100),
  account_title  text,
  instructions   text,
  logo_url       text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- STEP 2 — Indexes
--
-- PURPOSE: the two support-ticket query paths (admin status filter, member
-- own-history) + the display-order indexes for the two method tables
-- (no-ops when they already exist).
-- ---------------------------------------------------------------------------
create index if not exists idx_support_tickets_status_created
  on public.support_tickets (status, created_at desc);
create index if not exists idx_support_tickets_user_created
  on public.support_tickets (user_id, created_at desc);
create index if not exists withdrawal_methods_order_idx on public.withdrawal_methods (sort_order);
create index if not exists payment_methods_order_idx on public.payment_methods (sort_order);

-- ---------------------------------------------------------------------------
-- STEP 3 — Triggers
--
-- PURPOSE: keep updated_at fresh on row updates (same mechanism as every
-- other table). drop-if-exists + create makes re-runs safe.
-- ---------------------------------------------------------------------------
drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

drop trigger if exists withdrawal_methods_touch on public.withdrawal_methods;
create trigger withdrawal_methods_touch before update on public.withdrawal_methods
  for each row execute function public.touch_updated_at();

drop trigger if exists payment_methods_touch on public.payment_methods;
create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- STEP 4 — Functions / RPCs
--
-- PURPOSE (in order):
--   4a–4d  The four Member Support RPCs. api_support_list/api_support_create
--          are scoped to p_user_id so a member can only ever read or create
--          THEIR OWN requests; api_admin_support_list/api_admin_support_update
--          serve the Admin Panel. All SECURITY DEFINER, service-role-only.
--   4e     api_admin_stats — LATEST definition, adds openSupportCount (admin
--          nav badge + Needs-Your-Attention). Supersedes any older version.
--   4f     api_home_data — LATEST definition, adds the teamSalary.image
--          banner media slot. Supersedes any older version.
--   4g     api_withdrawal_methods_list — the Withdraw-page channel list
--          (ensure; no-op when already present).
--   4h     ensure_payment_methods_seeded + api_payment_methods_list —
--          deposit/checkout channel list (ensure; no-op when present).
-- ---------------------------------------------------------------------------

-- 4a. member: list OWN tickets (newest first)
create or replace function public.api_support_list(p_user_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'userId', t.user_id, 'subject', t.subject, 'message', t.message,
      'status', t.status, 'reply', t.reply, 'repliedAt', t.replied_at,
      'createdAt', t.created_at, 'updatedAt', t.updated_at
    ) order by t.created_at desc), '[]'::jsonb)
  from public.support_tickets t
  where t.user_id = p_user_id;
$$;

-- 4b. member: submit a new request (same validation as the local route)
create or replace function public.api_support_create(
  p_user_id text,
  p_subject text,
  p_message text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_subject text := btrim(coalesce(p_subject, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_row public.support_tickets;
begin
  if length(v_subject) < 3 or length(v_subject) > 120 then
    return jsonb_build_object('error', 'Subject must be 3–120 characters.');
  end if;
  if length(v_message) < 5 or length(v_message) > 2000 then
    return jsonb_build_object('error', 'Message must be 5–2000 characters.');
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    return jsonb_build_object('error', 'Account not found.');
  end if;

  insert into public.support_tickets (user_id, subject, message)
    values (p_user_id, v_subject, v_message)
    returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'userId', v_row.user_id, 'subject', v_row.subject, 'message', v_row.message,
    'status', v_row.status, 'reply', v_row.reply, 'repliedAt', v_row.replied_at,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at
  );
end $$;

-- 4c. admin: every ticket with the member's name/email
create or replace function public.api_admin_support_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'userId', t.user_id,
      'userName', u.name, 'userEmail', u.email,
      'subject', t.subject, 'message', t.message, 'status', t.status,
      'reply', t.reply, 'repliedAt', t.replied_at,
      'createdAt', t.created_at, 'updatedAt', t.updated_at
    ) order by t.created_at desc), '[]'::jsonb)
  from public.support_tickets t
  join public.users u on u.id = t.user_id;
$$;

-- 4d. admin: update a ticket's status and/or the admin reply
create or replace function public.api_admin_support_update(
  p_id text,
  p_status text,
  p_reply text,
  p_has_reply boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.support_tickets;
  v_status text;
  v_reply_len integer;
begin
  select * into v_row from public.support_tickets where id = p_id;
  if not found then
    return jsonb_build_object('error', 'Support request not found.');
  end if;

  if coalesce(p_status, '') <> '' then
    if p_status not in ('open', 'in_progress', 'resolved', 'closed') then
      return jsonb_build_object('error', 'Unknown status.');
    end if;
    v_status := p_status;
  else
    v_status := v_row.status;
  end if;

  if coalesce(p_has_reply, false) then
    v_reply_len := length(btrim(coalesce(p_reply, '')));
    if v_reply_len < 1 or v_reply_len > 2000 then
      return jsonb_build_object('error', 'Reply must be 1–2000 characters.');
    end if;
    update public.support_tickets set
      status = v_status,
      reply = case when v_reply_len = 0 then null else btrim(p_reply) end,
      replied_at = case when v_reply_len = 0 then null else now() end,
      updated_at = now()
    where id = p_id
    returning * into v_row;
  else
    update public.support_tickets set
      status = v_status,
      updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id, 'userId', v_row.user_id,
    'userName', (select name from public.users where id = v_row.user_id),
    'userEmail', (select email from public.users where id = v_row.user_id),
    'subject', v_row.subject, 'message', v_row.message, 'status', v_row.status,
    'reply', v_row.reply, 'repliedAt', v_row.replied_at,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at
  );
end $$;

-- 4e. api_admin_stats — LATEST definition (adds openSupportCount; identical
--     to the previous definition otherwise). Supersedes older versions.
create or replace function public.api_admin_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'totalDeposited', (select coalesce(sum(amount), 0) from public.transactions
                        where type = 'deposit' and status = 'approved'),
    'totalWithdrawn', (select coalesce(sum(amount), 0) from public.transactions
                        where type = 'withdrawal' and status = 'approved'),
    'pendingPayoutsCount', (select count(*) from public.transactions
                        where type = 'withdrawal' and status = 'pending'),
    'pendingPayoutsAmount', (select coalesce(sum(amount), 0) from public.transactions
                        where type = 'withdrawal' and status = 'pending'),
    'activeUsers', (select count(*) from public.users where is_banned = false),
    'bannedUsers', (select count(*) from public.users where is_banned = true),
    'totalUsers', (select count(*) from public.users),
    'taskRewardsPaid', (select coalesce(sum(amount), 0) from public.transactions
                        where type = 'task_reward' and status = 'completed'),
    'pendingDepositsCount', (select count(*) from public.transactions
                        where type in ('deposit', 'plan_purchase', 'package_purchase')
                          and status = 'pending'),
    'pendingDepositsAmount', (select coalesce(sum(amount), 0) from public.transactions
                        where type in ('deposit', 'plan_purchase', 'package_purchase')
                          and status = 'pending'),
    'activePackages', (select count(*) from public.investment_packages where is_active = true),
    'activeTasks', (select count(*) from public.tasks where is_active = true),
    'openSupportCount', (select count(*) from public.support_tickets
                        where status in ('open', 'in_progress')),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'deposits', (select coalesce(sum(amount), 0) from public.transactions t
                      where t.type = 'deposit' and t.status = 'approved'
                        and (t.processed_at)::date = d.day),
        'withdrawals', (select coalesce(sum(amount), 0) from public.transactions t
                      where t.type = 'withdrawal' and t.status = 'approved'
                        and (t.processed_at)::date = d.day),
        'rewards', (select coalesce(sum(amount), 0) from public.transactions t
                      where t.type = 'task_reward' and t.status = 'completed'
                        and t.created_at::date = d.day)
      ) order by d.day), '[]'::jsonb)
      from (select generate_series((now() at time zone 'utc')::date - interval '6 days',
                                   (now() at time zone 'utc')::date,
                                   interval '1 day')::date as day) d),
    'recentTransactions', coalesce((select jsonb_agg(public.tx_dto(t) order by t.created_at desc)
      from (select * from public.transactions order by created_at desc limit 10) t), '[]'::jsonb)
  )
$$;

-- 4f. api_home_data — LATEST definition (adds the teamSalary 'image' media
--     slot; identical to the previous definition otherwise).
create or replace function public.api_home_data(p_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_target integer;
  v_tg_reward integer;
  v_wa_reward integer;
  v_team_invest integer := 0;
  v_total   integer;
  v_today   integer;
  v_ref     integer;
begin
  v_target := coalesce(nullif(public.get_setting('home_team_leader_target'), '')::integer, 50000);
  v_tg_reward := case when coalesce(public.get_setting('home_telegram_reward'), '') ~ '^\d+$'
                      then public.get_setting('home_telegram_reward')::int else 50 end;
  v_wa_reward := case when coalesce(public.get_setting('home_whatsapp_reward'), '') ~ '^\d+$'
                      then public.get_setting('home_whatsapp_reward')::int else 50 end;

  select coalesce(sum(abs(t.amount)), 0)::integer into v_team_invest
  from public.transactions t
  join public.users u on u.id = t.user_id
  where u.referred_by_id = p_user_id
    and (
      (t.type in ('plan_purchase', 'package_purchase') and t.status in ('completed', 'approved'))
      or (t.type = 'deposit' and t.meta->>'purpose' = 'plan' and t.status = 'approved')
    );

  select coalesce(sum(t.amount), 0)::integer into v_total
  from public.transactions t
  where t.user_id = p_user_id
    and t.type in ('task_reward', 'referral_unlock', 'referral_commission', 'daily_earning', 'promo_reward')
    and t.status in ('completed', 'approved');

  select coalesce(sum(t.amount), 0)::integer into v_today
  from public.transactions t
  where t.user_id = p_user_id
    and t.type = 'task_reward'
    and t.status in ('completed', 'approved')
    and t.created_at >= date_trunc('day', now());

  select coalesce(sum(t.amount), 0)::integer into v_ref
  from public.transactions t
  where t.user_id = p_user_id
    and t.type in ('referral_unlock', 'referral_commission')
    and t.status in ('completed', 'approved');

  return jsonb_build_object(
    'announcementUr', coalesce(public.get_setting('home_announcement_ur'), ''),
    'announcementEn', coalesce(public.get_setting('home_announcement_en'), ''),
    'luckyDrawDate', case
      when coalesce(public.get_setting('home_lucky_draw_date'), '') ~ '^\d{4}-\d{2}-\d{2}$'
        then public.get_setting('home_lucky_draw_date')
      else null end,
    'teamLeader', jsonb_build_object(
      'targetAmount', v_target,
      'applyEnabled', coalesce(public.get_setting('home_team_leader_apply_enabled'), 'true') = 'true',
      'teamInvestment', v_team_invest
    ),
    'teamSalary', jsonb_build_object(
      'text', coalesce(public.get_setting('home_team_salary_text'), ''),
      'image', coalesce(public.get_setting('home_team_salary_image'), ''),
      'link', coalesce(public.get_setting('home_team_salary_link'), '')
    ),
    'stats', jsonb_build_object(
      'totalEarnings', v_total,
      'todayTaskEarning', v_today,
      'referralEarnings', v_ref
    ),
    'promo', jsonb_build_object(
      'activePromoAvailable', exists (
        select 1 from public.promo_codes
        where is_active and not is_system
          and (max_uses is null or used_count < max_uses)
      )
    ),
    'social', jsonb_build_object(
      'whatsappUrl', coalesce(public.get_setting('home_whatsapp_url'), ''),
      'telegramUrl', coalesce(public.get_setting('home_telegram_url'), '')
    ),
    'whatsapp', jsonb_build_object(
      'rewardAmount', v_wa_reward,
      'claimed', exists (
        select 1 from public.promo_claims pc
        join public.promo_codes p on p.id = pc.promo_code_id
        where pc.user_id = p_user_id and p.code = 'WHATSAPP'
      ),
      'enabled', coalesce(public.get_setting('home_whatsapp_enabled'), 'true') in ('true', '1')
    ),
    'telegram', jsonb_build_object(
      'rewardAmount', v_tg_reward,
      'claimed', exists (
        select 1 from public.promo_claims pc
        join public.promo_codes p on p.id = pc.promo_code_id
        where pc.user_id = p_user_id and p.code = 'TELEGRAM'
      ),
      'enabled', coalesce(public.get_setting('home_telegram_enabled'), 'true') in ('true', '1')
    )
  );
end $$;

-- 4g. Public Withdraw-page list: active payout channels in the admin's order.
create or replace function public.api_withdrawal_methods_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'kind', m.kind, 'logoUrl', m.logo_url,
        'sortOrder', m.sort_order, 'isActive', m.is_active
      ) order by m.sort_order asc, m.name asc)
      from public.withdrawal_methods m
      where m.is_active
    ), '[]'::jsonb)
  );
end $$;

-- 4h. One-time backfill seed from the legacy gateway settings keys.
--     Splits legacy "number (Title)" strings so title + number land clean.
create or replace function public.ensure_payment_methods_seeded() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
  v_ep    text := coalesce(public.get_setting('easypaisa_account'), '');
  v_jc    text := coalesce(public.get_setting('jazzcash_account'), '');
  v_epm   text[];
  v_jcm   text[];
  v_instr text := coalesce(public.get_setting('payment_instructions'), '');
begin
  select count(*) into v_count from public.payment_methods;
  if v_count > 0 then
    return jsonb_build_object('ok', true, 'seeded', false);
  end if;

  v_epm := coalesce(regexp_match(v_ep, '^(.*?)\s*\(([^()]*)\)\s*$'), array[v_ep]);
  v_jcm := coalesce(regexp_match(v_jc, '^(.*?)\s*\(([^()]*)\)\s*$'), array[v_jc]);

  insert into public.payment_methods (name, account_number, account_title, instructions, logo_url, sort_order)
  values
    ('EasyPaisa',
     btrim(coalesce(v_epm[1], v_ep)),
     nullif(btrim(coalesce(public.get_setting('easypaisa_title'), coalesce(v_epm[2], ''))), ''),
     nullif(btrim(v_instr), ''),
     null,
     1),
    ('JazzCash',
     btrim(coalesce(v_jcm[1], v_jc)),
     nullif(btrim(coalesce(public.get_setting('jazzcash_title'), coalesce(v_jcm[2], ''))), ''),
     nullif(btrim(v_instr), ''),
     null,
     2),
    ('USDT (TRC20)',
     coalesce(nullif(btrim(coalesce(public.get_setting('usdt_address'), '')), ''), 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'),
     null,
     nullif(btrim(v_instr), ''),
     nullif(btrim(coalesce(public.get_setting('usdt_qr_url'), '')), ''),
     3)
  on conflict (name) do nothing;

  return jsonb_build_object('ok', true, 'seeded', true);
end $$;

-- 4i. Public checkout list: active deposit methods in the admin's order +
--     the require_proof policy flag.
create or replace function public.api_payment_methods_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_payment_methods_seeded();
  return jsonb_build_object(
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'accountNumber', m.account_number,
        'accountTitle', m.account_title, 'instructions', m.instructions,
        'logoUrl', m.logo_url, 'sortOrder', m.sort_order, 'isActive', m.is_active
      ) order by m.sort_order asc, m.name asc)
      from public.payment_methods m
      where m.is_active
    ), '[]'::jsonb),
    'requireProof', coalesce(public.get_setting('require_payment_proof'), 'false') = 'true'
  );
end $$;

-- ---------------------------------------------------------------------------
-- STEP 5 — Row Level Security + function EXECUTE privileges
--
-- PURPOSE: support_tickets gets EXACTLY the same security model as every
-- other TaskEarn table: RLS enabled with NO policies → default deny for
-- anon/authenticated keys (they can neither read nor write anything). All
-- access flows through the website's server (service role key) calling the
-- SECURITY DEFINER RPCs above. Member isolation ("a member sees only their
-- own requests") is enforced INSIDE api_support_list/api_support_create via
-- the p_user_id parameter — the server passes the session user's id; Admin
-- authorization is enforced by the website server (requireAdmin) before it
-- calls api_admin_support_list/api_admin_support_update. This matches the
-- project's actual auth architecture — no new policy pattern is introduced.
-- ---------------------------------------------------------------------------

-- 5a. RLS: hard lock for everything except the service role.
--     (No policies are created on purpose — same as all existing tables.)
alter table public.support_tickets enable row level security;
alter table public.withdrawal_methods enable row level security;
alter table public.payment_methods enable row level security;

-- 5b. EXECUTE privileges — service-role only (same model as every RPC).
revoke execute on function public.api_support_list(text) from public, anon, authenticated;
revoke execute on function public.api_support_create(text, text, text) from public, anon, authenticated;
revoke execute on function public.api_admin_support_list() from public, anon, authenticated;
revoke execute on function public.api_admin_support_update(text, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.api_admin_stats() from public, anon, authenticated;
revoke execute on function public.api_home_data(text) from public, anon, authenticated;
revoke execute on function public.api_withdrawal_methods_list() from public, anon, authenticated;
revoke execute on function public.ensure_payment_methods_seeded() from public, anon, authenticated;
revoke execute on function public.api_payment_methods_list() from public, anon, authenticated;

grant execute on function public.api_support_list(text) to service_role;
grant execute on function public.api_support_create(text, text, text) to service_role;
grant execute on function public.api_admin_support_list() to service_role;
grant execute on function public.api_admin_support_update(text, text, text, boolean) to service_role;
grant execute on function public.api_admin_stats() to service_role;
grant execute on function public.api_home_data(text) to service_role;
grant execute on function public.api_withdrawal_methods_list() to service_role;
grant execute on function public.ensure_payment_methods_seeded() to service_role;
grant execute on function public.api_payment_methods_list() to service_role;

-- ---------------------------------------------------------------------------
-- STEP 6 — Seed data (all ON CONFLICT DO NOTHING → never overwrites the
--          admin's live edits; only inserts what is missing)
--
-- PURPOSE:
--   * Home-page settings — includes the NEW banner media slot key
--     home_team_salary_image ('' = old design, exactly).
--   * Branding / media-slot settings (site logo, favicon, wallet image,
--     welcome-popup image, channel enable flags).
--   * Checkout policy flag.
--   * The seven fixed payout channels (admin edits to order/logo/enable
--     state are preserved by on conflict do nothing).
--   * Explicit call to ensure_payment_methods_seeded() so the deposit
--     channels exist deterministically (no-op when rows already exist).
-- ---------------------------------------------------------------------------
insert into public.system_settings (key, value) values
  ('home_announcement_ur', 'السلام علیکم! ہماری ٹیم کے لیے فعال ممبران کی شدید ضرورت ہے۔ اپنے دوستوں کو ریفرل کوڈ کے ساتھ رجسٹر کروائیں، انویسٹمنٹ پیکج فعال کریں اور روزانہ کمائیں۔ روزانہ واپسی (Daily Withdrawal) کی مکمل سہولت دستیاب ہے۔'),
  ('home_announcement_en', 'Assalam-o-Alaikum! We need active members for our team. Register friends with your referral code, activate an investment package and earn daily — daily withdrawal available.'),
  ('home_lucky_draw_date', '2026-09-25'),
  ('home_team_leader_target', '50000'),
  ('home_team_leader_apply_enabled', 'true'),
  ('home_team_salary_text', 'Team Salary System — Earn up to PKR 13,000 every week'),
  ('home_team_salary_link', '/dashboard/referrals'),
  ('home_team_salary_image', ''),
  ('home_whatsapp_url', 'https://whatsapp.com/channel/TaskEarnHub'),
  ('home_telegram_url', 'https://t.me/TaskEarnHub'),
  ('home_telegram_reward', '50')
on conflict (key) do nothing;

insert into public.system_settings (key, value) values
  ('home_whatsapp_reward', '50'),
  ('home_whatsapp_enabled', 'true'),
  ('home_telegram_enabled', 'true'),
  ('home_header_title', 'Task Earn Hub'),
  ('home_header_tagline', 'Earn daily, withdraw anytime'),
  ('home_welcome_popup_enabled', 'false'),
  ('home_welcome_popup_image', ''),
  ('home_welcome_popup_frequency', 'once_per_session'),
  ('home_welcome_popup_title', ''),
  ('home_welcome_popup_description', ''),
  ('home_welcome_popup_button_text', ''),
  ('home_welcome_popup_button_link', ''),
  ('site_logo_url', ''),
  ('site_favicon_url', ''),
  ('wallet_method_image_url', '')
on conflict (key) do nothing;

insert into public.system_settings (key, value) values
  ('require_payment_proof', 'false')
on conflict (key) do nothing;

insert into public.withdrawal_methods (name, kind, sort_order) values
  ('EasyPaisa', 'wallet', 1),
  ('JazzCash', 'wallet', 2),
  ('UPaisa', 'wallet', 3),
  ('SadaPay', 'wallet', 4),
  ('NayaPay', 'wallet', 5),
  ('UBL Bank', 'bank', 6),
  ('Bank Al Habib', 'bank', 7)
on conflict (name) do nothing;

select public.ensure_payment_methods_seeded();

-- ---------------------------------------------------------------------------
-- STEP 7 — Restore the session default (see STEP 0)
-- ---------------------------------------------------------------------------
set check_function_bodies = on;

-- ============================================================================
-- Done. Verification queries are listed in the delivery notes.
-- ============================================================================
