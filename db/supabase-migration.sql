-- ============================================================================
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
create or replace function public.app_id() returns text
language sql volatile as $$
  select string_agg(
    substr('abcdefghijklmnopqrstuvwxyz0123456789', 1 + (random() * 35)::int, 1), '')
  from generate_series(1, 25)
$$;

-- keep updated_at fresh on every UPDATE
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ############################################################################
-- STEP 2 — Tables
-- ############################################################################
-- ── users ──
create table if not exists public.users (
  id              text primary key,
  name            text not null,
  email           text not null unique,
  password_hash   text not null,
  role            text not null default 'user',
  referral_code   text not null unique,
  referred_by_id  text references public.users(id) on delete set null,
  is_banned       boolean not null default false,
  ip_address      text,
  fingerprint     text,
  supabase_auth_id uuid,
  recovery_email  text,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── wallets ──
create table if not exists public.wallets (
  id                   text primary key default public.app_id(),
  user_id              text not null unique references public.users(id) on delete cascade,
  task_balance         integer not null default 0 check (task_balance >= 0),
  withdrawable_balance integer not null default 0 check (withdrawable_balance >= 0),
  updated_at           timestamptz not null default now()
);

-- ── plans ──
create table if not exists public.plans (
  id              text primary key default public.app_id(),
  name            text not null,
  description     text,
  price           integer not null check (price >= 0),
  reward_per_task integer not null check (reward_per_task >= 0),
  daily_task_limit integer not null check (daily_task_limit >= 0),
  duration_days   integer not null check (duration_days > 0),
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── tasks ──
create table if not exists public.tasks (
  id               text primary key default public.app_id(),
  title            text not null,
  description      text,
  url              text not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── user_plans ──
create table if not exists public.user_plans (
  id         text primary key default public.app_id(),
  user_id    text not null references public.users(id) on delete cascade,
  plan_id    text not null references public.plans(id) on delete cascade,
  status     text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ── user_tasks ──
create table if not exists public.user_tasks (
  id           text primary key default public.app_id(),
  user_id      text not null references public.users(id) on delete cascade,
  task_id      text not null references public.tasks(id) on delete cascade,
  date         text not null,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, task_id, date)
);

-- ── transactions ──
create table if not exists public.transactions (
  id              text primary key default public.app_id(),
  user_id         text not null references public.users(id) on delete cascade,
  related_user_id text references public.users(id) on delete set null,
  type            text not null,
  amount          integer not null,
  status          text not null,
  description     text not null,
  meta            jsonb not null default '{}'::jsonb,
  processed_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ── system_settings ──
create table if not exists public.system_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- ── password_reset_tokens ──
create table if not exists public.password_reset_tokens (
  id         text primary key default public.app_id(),
  user_id    text not null references public.users(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Admin broadcast notifications: one row per broadcast, NO per-user read

-- ── notifications ──
create table if not exists public.notifications (
  id         text primary key default public.app_id(),
  title      text not null,
  message    text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- ── investment_packages ──
create table if not exists public.investment_packages (
  id            text primary key default public.app_id(),
  title         text not null,
  price         integer not null check (price >= 1),
  daily_earning integer not null check (daily_earning >= 1),
  duration_days integer not null check (duration_days >= 1),
  total_return  integer not null check (total_return >= 1),
  net_profit    integer not null,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── user_packages ──
create table if not exists public.user_packages (
  id               text primary key default public.app_id(),
  user_id          text not null references public.users(id) on delete cascade,
  package_id       text not null references public.investment_packages(id) on delete cascade,
  invest_amount    integer not null check (invest_amount >= 0),
  daily_earning    integer not null check (daily_earning >= 0),
  status           text not null default 'active',
  last_earning_date text,
  started_at       timestamptz not null default now(),
  ends_at          timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── promo_codes ──
create table if not exists public.promo_codes (
  id            text primary key default public.app_id(),
  code          text not null unique,
  title         text not null default '',
  reward_amount integer not null check (reward_amount >= 0),
  max_uses      integer check (max_uses is null or max_uses >= 1),
  used_count    integer not null default 0 check (used_count >= 0),
  is_active     boolean not null default true,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── promo_claims ──
create table if not exists public.promo_claims (
  id            text primary key default public.app_id(),
  promo_code_id text not null references public.promo_codes(id) on delete cascade,
  user_id       text not null references public.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (promo_code_id, user_id)
);

-- ── payment_methods ──
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

-- ── withdrawal_methods ──
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

-- ── package_task_logs ──
create table if not exists public.package_task_logs (
  id              text primary key default public.app_id(),
  user_id         text not null references public.users(id) on delete cascade,
  user_package_id text not null references public.user_packages(id) on delete cascade,
  date            text not null,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  reward_amount   integer,
  created_at      timestamptz not null default now(),
  unique (user_id, user_package_id, date)
);

-- ── support_tickets ──
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

-- ############################################################################
-- STEP 3 — Relationships & Constraints
-- ############################################################################
-- Foreign keys are declared inline in STEP 2. This step contains the
-- CONDITIONAL upgrades for deployments provisioned with an older version of
-- the provisioning script (Ads Execution Engine task columns + the
-- admin-editable package description) so the schema converges in place.
alter table public.tasks add column if not exists reward_amount integer;
alter table public.tasks add column if not exists plan_id text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_plan_id_fkey') then
    alter table public.tasks
      add constraint tasks_plan_id_fkey foreign key (plan_id) references public.plans(id) on delete set null;
  end if;
end $$;

alter table public.user_tasks add column if not exists reward_amount integer;

alter table public.investment_packages add column if not exists description text;

-- ############################################################################
-- STEP 4 — Functions (helpers + SECURITY DEFINER RPCs) and seed data
-- ############################################################################
-- ── get_setting — read a platform setting ──
create or replace function public.get_setting(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select value from public.system_settings where key = p_key
$$;

-- ── tx_dto — serialize a transaction row to the app's TransactionDTO json (payment-proof data URL stripped; hasProof flags it) ──
create or replace function public.tx_dto(t public.transactions) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', t.id,
    'userId', t.user_id,
    'userName', (select name from public.users where id = t.user_id),
    'userEmail', (select email from public.users where id = t.user_id),
    'relatedUserId', t.related_user_id,
    'type', t.type,
    'amount', t.amount,
    'status', t.status,
    'description', t.description,
    'meta', coalesce(t.meta, '{}'::jsonb) - 'proof',
    'hasProof', coalesce(t.meta ? 'proof', false),
    'createdAt', t.created_at,
    'processedAt', t.processed_at
  )
$$;

-- ── process_referral_unlock — atomic referral unlock (the PRD's core rule) ──
create or replace function public.process_referral_unlock(p_invitee public.users)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inviter public.users;
  v_wallet  public.wallets;
  v_unlock  integer;
  v_actual  integer;
begin
  if p_invitee.referred_by_id is null then return null; end if;

  select * into v_inviter from public.users where id = p_invitee.referred_by_id;
  if not found then return null; end if;

  select * into v_wallet from public.wallets where user_id = v_inviter.id for update;
  if not found then return null; end if;

  -- at most one unlock per invitee
  if exists (
    select 1 from public.transactions
    where type = 'referral_unlock' and related_user_id = p_invitee.id and status = 'completed'
  ) then
    return null;
  end if;

  -- anti self-referral: matching IP or device fingerprint blocks the unlock
  if (v_inviter.ip_address is not null and p_invitee.ip_address is not null
        and v_inviter.ip_address = p_invitee.ip_address)
     or (v_inviter.fingerprint is not null and p_invitee.fingerprint is not null
        and v_inviter.fingerprint = p_invitee.fingerprint) then
    insert into public.transactions
      (user_id, related_user_id, type, amount, status, description, meta, processed_at)
    values
      (v_inviter.id, p_invitee.id, 'referral_unlock', 0, 'blocked',
       'Referral unlock blocked (matching IP/device): invitee ' || p_invitee.name,
       jsonb_build_object('inviteeId', p_invitee.id, 'reason', 'anti_fraud_ip_fingerprint_match'),
       now());
    return jsonb_build_object('amount', 0, 'blocked', true, 'inviterName', v_inviter.name);
  end if;

  v_unlock := coalesce(public.get_setting('unlock_amount_per_ref'), '0')::int;
  v_actual := least(v_wallet.task_balance, v_unlock);

  if v_actual > 0 then
    update public.wallets
      set task_balance = task_balance - v_actual,
          withdrawable_balance = withdrawable_balance + v_actual
      where user_id = v_inviter.id;
  end if;

  insert into public.transactions
    (user_id, related_user_id, type, amount, status, description, meta, processed_at)
  values
    (v_inviter.id, p_invitee.id, 'referral_unlock', v_actual, 'completed',
     'Referral unlock from ' || p_invitee.name || '''s plan activation',
     jsonb_build_object('inviteeId', p_invitee.id, 'unlockAmount', v_unlock, 'actualUnlock', v_actual),
     now());

  return jsonb_build_object('amount', v_actual, 'blocked', false, 'inviterName', v_inviter.name);
end $$;

-- ── api_signup_user — handle_new_user() equivalent: user + wallet atomically ──
create or replace function public.api_signup_user(
  p_name text, p_email text, p_password_hash text,
  p_referred_by_code text, p_ip text, p_fingerprint text, p_supabase_auth_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id       text := public.app_id();
  v_code     text;
  v_referrer public.users;
  v_user     public.users;
begin
  if exists (select 1 from public.users where lower(email) = lower(p_email)) then
    return jsonb_build_object('error', 'An account with this email already exists.');
  end if;

  if p_referred_by_code is not null and btrim(p_referred_by_code) <> '' then
    select * into v_referrer from public.users
      where upper(referral_code) = upper(btrim(p_referred_by_code));
    if not found then
      return jsonb_build_object('error', 'Invalid referral code.');
    end if;
  end if;

  for i in 1..10 loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into public.users
        (id, name, email, password_hash, role, referral_code, referred_by_id,
         ip_address, fingerprint, supabase_auth_id)
      values
        (v_id, p_name, lower(p_email), p_password_hash, 'user', v_code,
         v_referrer.id, p_ip, p_fingerprint, p_supabase_auth_id);
      exit;
    exception when unique_violation then
      if i = 10 then return jsonb_build_object('error', 'Could not generate referral code.'); end if;
    end;
  end loop;

  insert into public.wallets (user_id) values (v_id);

  select * into v_user from public.users where id = v_id;
  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object(
      'id', v_user.id, 'name', v_user.name, 'email', v_user.email,
      'role', v_user.role, 'isBanned', v_user.is_banned,
      'referralCode', v_user.referral_code, 'createdAt', v_user.created_at
    )
  );
end $$;

-- ── api_start_task — countdown registration with plan-target gate + rolling 24h guard ──
create or replace function public.api_start_task(p_user_id text, p_task_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_task    public.tasks;
  v_plan_id text;
  v_started timestamptz;
begin
  select * into v_task from public.tasks where id = p_task_id and is_active;
  if not found then
    return jsonb_build_object('error', 'Task not found.');
  end if;

  select up.plan_id into v_plan_id
    from public.user_plans up
    where up.user_id = p_user_id and up.status = 'active' and up.expires_at > now()
    order by up.started_at desc limit 1;
  if v_plan_id is null then
    return jsonb_build_object('error', 'You need an active plan to start tasks.');
  end if;

  -- target-plan gate
  if v_task.plan_id is not null and v_task.plan_id <> v_plan_id then
    return jsonb_build_object('error', 'This task is not available for your current plan.');
  end if;

  if exists (
    select 1 from public.user_tasks
    where user_id = p_user_id and task_id = p_task_id
      and completed_at is not null
      and completed_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('error', 'You can claim each task once every 24 hours.');
  end if;

  if exists (
    select 1 from public.user_tasks
    where user_id = p_user_id and task_id = p_task_id
      and date = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
      and completed_at is not null
  ) then
    return jsonb_build_object('error', 'You already completed this task today.');
  end if;

  insert into public.user_tasks (user_id, task_id, date, started_at)
  values (p_user_id, p_task_id, to_char(now() at time zone 'utc', 'YYYY-MM-DD'), now())
  on conflict (user_id, task_id, date)
    do update set started_at = coalesce(public.user_tasks.started_at, now())
  returning started_at into v_started;

  return jsonb_build_object('ok', true, 'startedAt', v_started);
end $$;

-- ── complete_task_transaction — THE task claim RPC (spec-named) ──
create or replace function public.complete_task_transaction(p_user_id text, p_task_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_task            public.tasks;
  v_plan            record;
  v_ut              public.user_tasks;
  v_completed_today integer;
  v_wallet          public.wallets;
  v_reward          integer;
begin
  select * into v_task from public.tasks where id = p_task_id and is_active;
  if not found then
    return jsonb_build_object('error', 'Task not found or inactive.');
  end if;

  select p.id, p.name, p.reward_per_task, p.daily_task_limit, up.started_at as plan_started_at, up.expires_at
    into v_plan
    from public.user_plans up join public.plans p on p.id = up.plan_id
    where up.user_id = p_user_id and up.status = 'active' and up.expires_at > now()
    order by up.started_at desc
    limit 1;
  if not found then
    return jsonb_build_object('error', 'You need an active plan to earn task rewards.');
  end if;

  if v_task.plan_id is not null and v_task.plan_id <> v_plan.id then
    return jsonb_build_object('error', 'This task is not available for your current plan.');
  end if;

  select * into v_ut from public.user_tasks
    where user_id = p_user_id and task_id = p_task_id
      and date = to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  if not found or v_ut.started_at is null then
    return jsonb_build_object('error', 'Start the task before submitting.');
  end if;
  if v_ut.completed_at is not null then
    return jsonb_build_object('error', 'You already completed this task today.');
  end if;

  -- strict rolling 24h guard (in addition to the same-day check above)
  if exists (
    select 1 from public.user_tasks
    where user_id = p_user_id and task_id = p_task_id
      and completed_at is not null
      and completed_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('error', 'You can claim each task once every 24 hours.');
  end if;

  select count(*) into v_completed_today from public.user_tasks
    where user_id = p_user_id
      and date = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
      and completed_at is not null;
  if v_completed_today >= v_plan.daily_task_limit then
    return jsonb_build_object('error', 'Daily task limit reached for your plan.');
  end if;

  -- countdown timer (with the same 1-second grace the app uses)
  if now() < v_ut.started_at + make_interval(secs => v_task.duration_seconds) - interval '1 second' then
    return jsonb_build_object('error', 'Please wait for the timer to finish before submitting.');
  end if;

  -- Ads Execution Engine reward: per-task override, else plan default
  v_reward := coalesce(v_task.reward_amount, v_plan.reward_per_task);

  select * into v_wallet from public.wallets where user_id = p_user_id for update;

  update public.user_tasks
    set completed_at = now(), reward_amount = v_reward
    where id = v_ut.id;

  update public.wallets
    set task_balance = task_balance + v_reward
    where user_id = p_user_id
    returning * into v_wallet;

  insert into public.transactions
    (user_id, type, amount, status, description, meta, processed_at)
  values
    (p_user_id, 'task_reward', v_reward, 'completed',
     'Daily task reward', jsonb_build_object('taskId', p_task_id), now());

  return jsonb_build_object(
    'ok', true,
    'reward', v_reward,
    'completedToday', v_completed_today + 1,
    'wallet', jsonb_build_object('taskBalance', v_wallet.task_balance,
                                 'withdrawableBalance', v_wallet.withdrawable_balance)
  );
end $$;

-- ── api_complete_task — backward-compatible delegate ──
create or replace function public.api_complete_task(p_user_id text, p_task_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.complete_task_transaction(p_user_id, p_task_id);
end $$;

-- ── api_activate_plan — plan payment checkout submission (TID + optional proof; auto-approve aware) ──
create or replace function public.api_activate_plan(
  p_user_id text, p_plan_id text, p_payment_method text, p_tx_id text,
  p_proof text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan   public.plans;
  v_user   public.users;
  v_txn    public.transactions;
  v_unlock jsonb;
  v_auto   boolean;
  v_exp    timestamptz;
  v_meta   jsonb;
begin
  select * into v_user from public.users where id = p_user_id;
  if not found then return jsonb_build_object('error', 'User not found.'); end if;

  select * into v_plan from public.plans where id = p_plan_id and is_active;
  if not found then return jsonb_build_object('error', 'Plan not found or inactive.'); end if;

  if p_tx_id is null or p_tx_id !~ '^[0-9]{11,12}$' then
    return jsonb_build_object('error', 'Enter the 11 or 12-digit Transaction ID (TID) from your payment app.');
  end if;

  if exists (
    select 1 from public.user_plans
    where user_id = p_user_id and status = 'active' and expires_at > now()
  ) then
    return jsonb_build_object('error', 'You already have an active plan.');
  end if;

  v_auto := coalesce(public.get_setting('auto_approve_deposits'), 'false') = 'true';

  v_meta := jsonb_build_object('planId', p_plan_id, 'planName', v_plan.name,
                               'purpose', 'plan',
                               'paymentMethod', p_payment_method, 'txId', p_tx_id);
  if p_proof is not null and p_proof <> '' and left(p_proof, 11) = 'data:image/' then
    v_meta := v_meta || jsonb_build_object('proof', p_proof);
  end if;

  insert into public.transactions
    (user_id, type, amount, status, description, meta)
  values
    (p_user_id, 'plan_purchase', v_plan.price,
     case when v_auto then 'approved' else 'pending' end,
     case when v_auto then 'Payment approved — ' || v_plan.name || ' plan activated'
          else 'Payment for ' || v_plan.name || ' plan — awaiting admin approval' end,
     v_meta)
  returning * into v_txn;

  if v_auto then
    update public.transactions set processed_at = now() where id = v_txn.id
      returning * into v_txn;
    v_exp := now() + make_interval(days => v_plan.duration_days);
    insert into public.user_plans (user_id, plan_id, status, started_at, expires_at)
    values (p_user_id, p_plan_id, 'active', now(), v_exp);
    v_unlock := public.process_referral_unlock(v_user);
    return jsonb_build_object(
      'ok', true, 'activated', true,
      'transaction', public.tx_dto(v_txn), 'unlock', v_unlock
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'activated', false,
    'transaction', public.tx_dto(v_txn), 'unlock', null
  );
end $$;

-- ── activate_plan_and_unlock_referral — spec-named admin approval helper ──
create or replace function public.activate_plan_and_unlock_referral(
  p_user_id text, p_plan_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn public.transactions;
begin
  select * into v_txn from public.transactions t
  where t.user_id = p_user_id
    and t.meta->>'planId' = p_plan_id
    and t.status = 'pending'
    and (t.type = 'plan_purchase' or (t.type = 'deposit' and t.meta->>'purpose' = 'plan'))
  order by t.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'error', 'No pending plan payment found for this member and plan.'
    );
  end if;

  -- Approve path: marks the payment approved, activates the plan in
  -- user_plans and unlocks the inviter's referral reward atomically.
  return public.api_process_deposit(v_txn.id, 'approve', null);
end $$;

-- ── api_topup_deposit — wallet top-up deposit request ──
create or replace function public.api_topup_deposit(
  p_user_id text, p_payment_method text, p_tx_id text, p_amount integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn  public.transactions;
  v_auto boolean;
  v_wallet public.wallets;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('error', 'Enter a valid deposit amount.');
  end if;
  v_auto := coalesce(public.get_setting('auto_approve_deposits'), 'false') = 'true';

  insert into public.transactions
    (user_id, type, amount, status, description, meta, processed_at)
  values
    (p_user_id, 'deposit', p_amount,
     case when v_auto then 'approved' else 'pending' end,
     case when v_auto then 'Deposit approved — balance credited' else 'Wallet top-up deposit' end,
     jsonb_build_object('purpose', 'topup', 'paymentMethod', p_payment_method, 'txId', p_tx_id),
     case when v_auto then now() else null end)
  returning * into v_txn;

  if v_auto then
    select * into v_wallet from public.wallets where user_id = p_user_id for update;
    update public.wallets
      set withdrawable_balance = withdrawable_balance + p_amount
      where user_id = p_user_id
      returning * into v_wallet;
  end if;

  return jsonb_build_object('ok', true, 'transaction', public.tx_dto(v_txn));
end $$;

-- ── api_process_deposit — admin approve/reject money-in (plan activation + referral unlock / package instance + commission / top-up credit / reject with note) ──
drop function if exists public.api_process_deposit(text, text, text);

create or replace function public.api_process_deposit(
  p_transaction_id text, p_action text, p_note text default null, p_reviewed_by text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions;
  v_user public.users;
  v_plan public.plans;
  v_pkg  public.investment_packages;
  v_up   public.user_packages;
  v_unlock jsonb;
  v_wallet public.wallets;
  v_note jsonb;
  v_commission jsonb;
begin
  select * into t from public.transactions
  where id = p_transaction_id and type in ('deposit', 'plan_purchase', 'package_purchase');
  if not found then return jsonb_build_object('error', 'Payment request not found.'); end if;
  if t.status <> 'pending' then return jsonb_build_object('error', 'This payment request was already processed.'); end if;

  select * into v_user from public.users where id = t.user_id;

  if p_action = 'approve' then
    -- merged meta (audit trail) is precomputed — inline `t.meta ||` inside
    -- UPDATE SET misparses on this Postgres/PGlite path (reject branch style).
    v_note := t.meta || jsonb_build_object('reviewedBy', p_reviewed_by);
    if t.meta->>'purpose' = 'plan' and v_user.id is not null then
      select * into v_plan from public.plans where id = t.meta->>'planId';
      if v_plan.id is not null and not exists (
        select 1 from public.user_plans
        where user_id = t.user_id and status = 'active' and expires_at > now()
      ) then
        update public.transactions
          set status = 'approved', processed_at = now(), meta = v_note,
              description = 'Payment approved — ' || v_plan.name || ' plan activated'
          where id = t.id returning * into t;
        insert into public.user_plans (user_id, plan_id, status, started_at, expires_at)
        values (t.user_id, v_plan.id, 'active', now(), now() + make_interval(days => v_plan.duration_days));
        v_unlock := public.process_referral_unlock(v_user);
      else
        -- user already has an active plan — credit as top-up instead
        select * into v_wallet from public.wallets where user_id = t.user_id for update;
        update public.wallets set withdrawable_balance = withdrawable_balance + t.amount
          where user_id = t.user_id returning * into v_wallet;
        update public.transactions
          set status = 'approved', processed_at = now(), meta = v_note,
              description = 'Payment approved — balance credited'
          where id = t.id returning * into t;
      end if;
    elsif t.meta->>'purpose' = 'package' and t.meta->>'packageId' is not null then
      -- Package payment request: activate the investment instance WITHOUT
      -- touching the wallet (external money — the admin review IS the
      -- verification). Falls back to a top-up credit when the package was
      -- deleted since the submission.
      select * into v_pkg from public.investment_packages where id = t.meta->>'packageId';
      if v_pkg.id is not null then
        insert into public.user_packages
          (user_id, package_id, invest_amount, daily_earning, status, started_at, ends_at)
        values
          (t.user_id, v_pkg.id, v_pkg.price, v_pkg.daily_earning, 'active', now(),
           now() + make_interval(days => v_pkg.duration_days))
        returning * into v_up;
        v_note := t.meta || jsonb_build_object(
          'userPackageId', v_up.id, 'reviewedBy', p_reviewed_by);
        update public.transactions
          set status = 'approved', processed_at = now(), meta = v_note,
              description = 'Payment approved — ' || (t.meta->>'packageTitle') || ' activated'
          where id = t.id returning * into t;
        -- inviter's withdrawable commission — same transaction, idempotent
        v_commission := public.fn_credit_referral_commission(
          t.user_id, v_up.id, v_pkg.id, v_pkg.title, v_pkg.price);
      else
        select * into v_wallet from public.wallets where user_id = t.user_id for update;
        update public.wallets set withdrawable_balance = withdrawable_balance + t.amount
          where user_id = t.user_id returning * into v_wallet;
        update public.transactions
          set status = 'approved', processed_at = now(), meta = v_note,
              description = 'Payment approved — balance credited'
          where id = t.id returning * into t;
      end if;
    else
      select * into v_wallet from public.wallets where user_id = t.user_id for update;
      update public.wallets set withdrawable_balance = withdrawable_balance + t.amount
        where user_id = t.user_id returning * into v_wallet;
      update public.transactions
        set status = 'approved', processed_at = now(), meta = v_note,
            description = 'Payment approved — balance credited'
        where id = t.id returning * into t;
    end if;
  elsif p_action = 'reject' then
    v_note := case when p_note is not null and btrim(p_note) <> ''
                   then t.meta || jsonb_build_object('note', p_note) else t.meta end;
    v_note := v_note || jsonb_build_object('reviewedBy', p_reviewed_by);
    update public.transactions
      set status = 'rejected', processed_at = now(), meta = v_note,
          description = case when p_note is not null and btrim(p_note) <> ''
                             then 'Payment rejected — ' || btrim(p_note)
                             else 'Payment rejected' end
      where id = t.id returning * into t;
  else
    return jsonb_build_object('error', 'Invalid action.');
  end if;

  return jsonb_build_object('ok', true, 'transaction', public.tx_dto(t), 'unlock', v_unlock);
end $$;

-- ── api_request_withdrawal — validates, deducts (hold), inserts pending transaction ──
create or replace function public.api_request_withdrawal(
  p_user_id text, p_amount integer, p_payment_method text, p_account_details text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallets;
  v_min integer; -- fixed policy minimum (Task 38): Rs 20 per request
  -- (no v_max any more: the cap is the member's MIN(task, withdrawable))
  v_txn public.transactions;
begin
  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'Wallet not found.'); end if;

  v_min := 20; -- fixed policy: no settings-driven min/max any more (Task 38)
  if p_amount < v_min then
    return jsonb_build_object('error', 'Minimum withdrawal is Rs ' || v_min || '.');
  end if;
  if exists (
    select 1 from public.transactions
    where user_id = p_user_id and type = 'withdrawal' and status = 'pending'
  ) then
    return jsonb_build_object('error', 'You already have a pending withdrawal request.');
  end if;
  -- Eligibility cap: max request = MIN(task_balance, withdrawable_balance);
  -- the task balance is an eligibility mechanism ONLY — never deducted.
  if v_wallet.task_balance < p_amount then
    return jsonb_build_object('error', 'Withdrawal amount exceeds your Task Balance.');
  end if;
  if v_wallet.withdrawable_balance < p_amount then
    return jsonb_build_object('error', 'Insufficient withdrawable balance.');
  end if;

  update public.wallets
    set withdrawable_balance = withdrawable_balance - p_amount
    where user_id = p_user_id;

  insert into public.transactions
    (user_id, type, amount, status, description, meta)
  values
    (p_user_id, 'withdrawal', p_amount, 'pending',
     'Withdrawal requested via ' || initcap(p_payment_method),
     jsonb_build_object('paymentMethod', p_payment_method, 'accountDetails', p_account_details))
  returning * into v_txn;

  return jsonb_build_object('ok', true, 'transaction', public.tx_dto(v_txn));
end $$;

-- ── api_process_withdrawal — admin approve (marks paid) or reject (auto-refund) ──
create or replace function public.api_process_withdrawal(p_transaction_id text, p_action text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t public.transactions;
  v_wallet public.wallets;
  v_note jsonb;
begin
  select * into t from public.transactions where id = p_transaction_id and type = 'withdrawal';
  if not found then return jsonb_build_object('error', 'Withdrawal not found.'); end if;
  if t.status <> 'pending' then return jsonb_build_object('error', 'This withdrawal was already processed.'); end if;

  v_note := case when p_note is not null and btrim(p_note) <> ''
                 then t.meta || jsonb_build_object('note', p_note) else t.meta end;

  if p_action = 'approve' then
    update public.transactions
      set status = 'approved', processed_at = now(), meta = v_note
      where id = t.id returning * into t;
  elsif p_action = 'reject' then
    select * into v_wallet from public.wallets where user_id = t.user_id for update;
    update public.wallets
      set withdrawable_balance = withdrawable_balance + t.amount
      where user_id = t.user_id;
    update public.transactions
      set status = 'rejected', processed_at = now(), meta = v_note
      where id = t.id returning * into t;
  else
    return jsonb_build_object('error', 'Invalid action.');
  end if;

  return jsonb_build_object('ok', true, 'transaction', public.tx_dto(t));
end $$;

-- ── api_adjust_balance — signed admin balance adjustment with ledger entry ──
create or replace function public.api_adjust_balance(
  p_user_id text, p_balance_type text, p_amount integer, p_reason text, p_admin_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallets;
  v_new integer;
begin
  if p_balance_type not in ('task', 'withdrawable') then
    return jsonb_build_object('error', 'Invalid balance type.');
  end if;
  if p_amount = 0 or p_amount is null then
    return jsonb_build_object('error', 'Enter a non-zero amount.');
  end if;

  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if not found then return jsonb_build_object('error', 'Wallet not found.'); end if;

  v_new := case p_balance_type
             when 'task' then v_wallet.task_balance + p_amount
             else v_wallet.withdrawable_balance + p_amount
           end;
  if v_new < 0 then
    return jsonb_build_object('error', 'Insufficient balance for this adjustment.');
  end if;

  if p_balance_type = 'task' then
    update public.wallets set task_balance = v_new where user_id = p_user_id returning * into v_wallet;
  else
    update public.wallets set withdrawable_balance = v_new where user_id = p_user_id returning * into v_wallet;
  end if;

  insert into public.transactions
    (user_id, type, amount, status, description, meta, processed_at)
  values
    (p_user_id, 'adjustment', p_amount, 'completed',
     case when p_amount > 0 then 'Admin balance adjustment' else 'Admin balance deduction' end,
     jsonb_strip_nulls(jsonb_build_object('balanceType', p_balance_type,
                     'reason', p_reason, 'adminId', p_admin_id)),
     now());

  return jsonb_build_object('ok', true,
    'wallet', jsonb_build_object('taskBalance', v_wallet.task_balance,
                                 'withdrawableBalance', v_wallet.withdrawable_balance));
end $$;

-- ── api_public_stats — landing-page counters ──
create or replace function public.api_public_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'users', (select count(*) from public.users),
    'paidOut', (select coalesce(sum(amount), 0) from public.transactions
                 where type = 'withdrawal' and status = 'approved'),
    'tasksCompleted', (select count(*) from public.transactions
                 where type = 'task_reward' and status = 'completed'),
    'activePlans', (select count(*) from public.user_plans
                 where status = 'active' and expires_at > now())
  )
$$;

-- ── api_public_payouts — latest approved payouts (masked names) ──
create or replace function public.api_public_payouts() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', case when length(btrim(u.name)) <= 2
                 then btrim(u.name) || '***'
                 else left(btrim(u.name), 2) || '***' end,
    'amount', p.amount,
    'method', coalesce(p.meta->>'paymentMethod', 'easypaisa'),
    'at', coalesce(p.processed_at, p.created_at)
  ) order by coalesce(p.processed_at, p.created_at) desc), '[]'::jsonb)
  from (
    select * from public.transactions
    where type = 'withdrawal' and status = 'approved'
    order by coalesce(processed_at, created_at) desc
    limit 12
  ) p
  join public.users u on u.id = p.user_id
$$;

-- ── api_dashboard — member dashboard aggregate incl. notification bell ──
create or replace function public.api_dashboard(p_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user public.users;
  v_wallet public.wallets;
  v_plan record;
  v_completed_today integer;
  v_days_left integer;
  v_recent jsonb;
  v_notifications jsonb;
begin
  select * into v_user from public.users where id = p_user_id;
  if not found then return jsonb_build_object('error', 'User not found.'); end if;
  select * into v_wallet from public.wallets where user_id = p_user_id;

  select p.name, p.reward_per_task, p.daily_task_limit, up.started_at, up.expires_at
    into v_plan
    from public.user_plans up join public.plans p on p.id = up.plan_id
    where up.user_id = p_user_id and up.status = 'active' and up.expires_at > now()
    order by up.started_at desc limit 1;

  select count(*) into v_completed_today from public.user_tasks
    where user_id = p_user_id
      and date = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
      and completed_at is not null;

  select coalesce(jsonb_agg(public.tx_dto(t) order by t.created_at desc), '[]'::jsonb)
    into v_recent
    from (select * from public.transactions where user_id = p_user_id
          order by created_at desc limit 5) t;

  -- Latest admin broadcasts for the notification bell.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'message', n.message, 'createdAt', n.created_at
    ) order by n.created_at desc), '[]'::jsonb)
    into v_notifications
    from (select * from public.notifications order by created_at desc limit 5) n;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_user.id, 'name', v_user.name, 'email', v_user.email,
      'role', v_user.role, 'isBanned', v_user.is_banned,
      'referralCode', v_user.referral_code, 'createdAt', v_user.created_at),
    'wallet', jsonb_build_object(
      'taskBalance', coalesce(v_wallet.task_balance, 0),
      'withdrawableBalance', coalesce(v_wallet.withdrawable_balance, 0)),
    'activePlan', case when v_plan.name is null then null else
      jsonb_build_object(
        'name', v_plan.name,
        'rewardPerTask', v_plan.reward_per_task,
        'dailyLimit', v_plan.daily_task_limit,
        'completedToday', v_completed_today,
        'daysLeft', greatest(0, ceil(extract(epoch from (v_plan.expires_at - now())) / 86400))::int,
        'startedAt', v_plan.started_at,
        'expiresAt', v_plan.expires_at)
    end,
    'referrals', jsonb_build_object(
      'total', (select count(*) from public.users where referred_by_id = p_user_id),
      'activated', (select count(*) from public.users i
                      where i.referred_by_id = p_user_id
                        and exists (select 1 from public.user_plans up
                                    where up.user_id = i.id and up.status = 'active')),
      'unlockedTotal', (select coalesce(sum(amount), 0) from public.transactions
                          where user_id = p_user_id and type = 'referral_unlock'
                            and status = 'completed')),
    'pendingWithdrawals', (select count(*) from public.transactions
                             where user_id = p_user_id and type = 'withdrawal'
                               and status = 'pending'),
    'recentTransactions', v_recent,
    'notifications', v_notifications
  );
end $$;

-- ── api_tasks_list — member task list with plan-targeted filtering + per-task reward ──
create or replace function public.api_tasks_list(p_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_plan record;
  v_completed_today integer;
  v_days_left integer;
  v_tasks jsonb;
begin
  select p.id, p.name, p.reward_per_task, p.daily_task_limit, up.expires_at
    into v_plan
    from public.user_plans up join public.plans p on p.id = up.plan_id
    where up.user_id = p_user_id and up.status = 'active' and up.expires_at > now()
    order by up.started_at desc limit 1;

  select count(*) into v_completed_today from public.user_tasks
    where user_id = p_user_id
      and date = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
      and completed_at is not null;

  -- Ads Execution Engine: tasks pinned to another plan are hidden entirely.
  select coalesce(jsonb_agg(jsonb_build_object(
      'task', jsonb_build_object(
        'id', t.id, 'title', t.title, 'description', t.description, 'url', t.url,
        'durationSeconds', t.duration_seconds,
        'rewardAmount', t.reward_amount,
        'planId', t.plan_id,
        'isActive', t.is_active, 'sortOrder', t.sort_order),
      'startedAt', ut.started_at,
      'completedAt', ut.completed_at
    ) order by t.sort_order, t.created_at), '[]'::jsonb)
  into v_tasks
  from public.tasks t
  left join public.user_tasks ut
    on ut.task_id = t.id and ut.user_id = p_user_id
       and ut.date = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
  where t.is_active
    and (t.plan_id is null or (v_plan.id is not null and t.plan_id = v_plan.id));

  return jsonb_build_object(
    'plan', case when v_plan.name is null then null else jsonb_build_object(
        'name', v_plan.name,
        'rewardPerTask', v_plan.reward_per_task,
        'dailyLimit', v_plan.daily_task_limit,
        'completedToday', v_completed_today,
        'daysLeft', greatest(0, ceil(extract(epoch from (v_plan.expires_at - now())) / 86400))::int
      ) end,
    'tasks', v_tasks,
    'canCompleteMore', v_plan.name is not null and v_completed_today < v_plan.daily_task_limit
  );
end $$;

-- ── api_referrals — invite list + team stats + admin-configured invite page payload ──
create or replace function public.api_referrals(p_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_code text;
  v_list jsonb;
  -- Invite page payload (Task 25)
  v_percent integer;
  v_commission_text text;
  v_levels jsonb;
  v_how jsonb;
  v_policy jsonb;
  v_team_deposits integer := 0;
  v_team_members integer := 0;
  v_unlocked_total integer := 0;
begin
  select referral_code into v_code from public.users where id = p_user_id;
  if v_code is null then return jsonb_build_object('error', 'User not found.'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'joinedAt', i.created_at,
      'planActivated', exists (select 1 from public.user_plans up
                                where up.user_id = i.id and up.status = 'active'),
      'planName', (select p.name from public.user_plans up
                     join public.plans p on p.id = up.plan_id
                     where up.user_id = i.id and up.status = 'active'
                     order by up.started_at desc limit 1)
    ) order by i.created_at desc), '[]'::jsonb)
  into v_list
  from public.users i
  where i.referred_by_id = p_user_id;

  -- ── Team statistics (real data, EXISTING business definitions) ──
  -- Total Team Deposits = the team-investment rules the Home Team Leader
  -- widget uses: package / VIP-plan purchases (completed or approved) plus
  -- approved plan-purpose deposits by referred members; abs() per row so
  -- external payments (positive) and balance purchases (negative) both count.
  select coalesce(sum(abs(t.amount)), 0)::integer into v_team_deposits
  from public.transactions t
  join public.users i on i.id = t.user_id
  where i.referred_by_id = p_user_id
    and (
      (t.type in ('plan_purchase', 'package_purchase') and t.status in ('completed', 'approved'))
      or (t.type = 'deposit' and t.meta->>'purpose' = 'plan' and t.status = 'approved')
    );

  v_team_members := (select count(*) from public.users where referred_by_id = p_user_id);
  v_unlocked_total := (select coalesce(sum(amount), 0) from public.transactions
                        where user_id = p_user_id and type = 'referral_unlock'
                          and status = 'completed');

  -- ── Invite page configuration (admin-managed invite_* settings) ──
  v_percent := coalesce(nullif(public.get_setting('invite_commission_percent'), '')::integer, 50);
  v_percent := least(greatest(v_percent, 0), 100);

  v_commission_text := replace(
    coalesce(nullif(public.get_setting('invite_commission_text'), ''),
             'Earn {percent}% commission on every referral''s package purchase'),
    '{percent}', v_percent::text);

  -- Cash Reward Levels (defensive JSON parse + normalize + default fallback)
  begin
    v_levels := public.get_setting('invite_reward_levels')::jsonb;
    if jsonb_typeof(v_levels) <> 'array' then v_levels := null; end if;
  exception when others then v_levels := null; end;
  -- normalize: positive ints only, ascending by required, level numbers 1..N
  if v_levels is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'level', r.lvl,
        'required', r.required,
        'reward', r.reward
      ) order by r.required), '[]'::jsonb)
    into v_levels
    from (
      select row_number() over (order by (e->>'required')::int) as lvl,
             (e->>'required')::int as required,
             (e->>'reward')::int as reward
      from jsonb_array_elements(v_levels) e
      where (e->>'required') ~ '^\d+$' and (e->>'required')::int > 0
        and (e->>'reward') ~ '^\d+$' and (e->>'reward')::int > 0
    ) r;
  end if;
  -- unparseable OR empty (every entry invalid) → the default five levels
  if v_levels is null or v_levels = '[]'::jsonb then
    v_levels := '[
      {"level":1,"required":5000,"reward":1500},
      {"level":2,"required":10000,"reward":3000},
      {"level":3,"required":20000,"reward":6000},
      {"level":4,"required":30000,"reward":9000},
      {"level":5,"required":50000,"reward":15000}
    ]'::jsonb;
  end if;

  -- How it works / Referral Policy text lists ({percent} rendered per line)
  begin
    v_how := public.get_setting('invite_how_it_works')::jsonb;
    if jsonb_typeof(v_how) <> 'array' then v_how := null; end if;
  exception when others then v_how := null; end;
  if v_how is not null then
    select coalesce(jsonb_agg(replace(e#>>'{}', '{percent}', v_percent::text) order by ord), '[]'::jsonb)
    into v_how
    from jsonb_array_elements(v_how) with ordinality as t(e, ord)
    where jsonb_typeof(e) = 'string' and length(btrim(e#>>'{}')) > 0;
  end if;
  if v_how is null or v_how = '[]'::jsonb then
    v_how := jsonb_build_array(
      'Share your referral link with friends',
      'They sign up and buy a package',
      replace('You earn {percent}% commission on their package purchase', '{percent}', v_percent::text),
      'Unlock Cash Rewards as your team grows!'
    );
  end if;

  begin
    v_policy := public.get_setting('invite_referral_policy')::jsonb;
    if jsonb_typeof(v_policy) <> 'array' then v_policy := null; end if;
  exception when others then v_policy := null; end;
  if v_policy is not null then
    select coalesce(jsonb_agg(replace(e#>>'{}', '{percent}', v_percent::text) order by ord), '[]'::jsonb)
    into v_policy
    from jsonb_array_elements(v_policy) with ordinality as t(e, ord)
    where jsonb_typeof(e) = 'string' and length(btrim(e#>>'{}')) > 0;
  end if;
  if v_policy is null or v_policy = '[]'::jsonb then
    v_policy := jsonb_build_array(
      'You earn only when your referred user purchases a package.',
      replace('On every paid package purchase, you receive {percent}% commission of the package amount.', '{percent}', v_percent::text),
      'Free package users do not generate package purchase commission.',
      'Each referral is counted once, according to the existing referral rules.'
    );
  end if;

  return jsonb_build_object(
    'code', v_code,
    'stats', jsonb_build_object(
      'total', (select count(*) from public.users where referred_by_id = p_user_id),
      'activated', (select count(*) from public.users i
                      where i.referred_by_id = p_user_id
                        and exists (select 1 from public.user_plans up
                                    where up.user_id = i.id and up.status = 'active')),
      'pending', (select count(*) from public.users i
                    where i.referred_by_id = p_user_id
                      and not exists (select 1 from public.user_plans up
                                      where up.user_id = i.id and up.status = 'active')),
      'unlockedTotal', (select coalesce(sum(amount), 0) from public.transactions
                          where user_id = p_user_id and type = 'referral_unlock'
                            and status = 'completed')),
    'list', v_list,
    'invite', jsonb_build_object(
      'commissionPercent', v_percent,
      'commissionText', v_commission_text,
      'teamMembers', v_team_members,
      'teamDeposits', v_team_deposits,
      'referralCommission', v_unlocked_total,
      'levels', v_levels,
      'howItWorks', v_how,
      'policy', v_policy
    )
  );
end $$;

-- ── api_wallet_txns — wallet + latest transactions ──
create or replace function public.api_wallet_txns(p_user_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'wallet', jsonb_build_object(
      'taskBalance', coalesce((select task_balance from public.wallets where user_id = p_user_id), 0),
      'withdrawableBalance', coalesce((select withdrawable_balance from public.wallets where user_id = p_user_id), 0)),
    'transactions', coalesce((select jsonb_agg(public.tx_dto(t) order by t.created_at desc)
      from (select * from public.transactions where user_id = p_user_id
            order by created_at desc limit 30) t), '[]'::jsonb)
  )
$$;

-- ── api_admin_stats — admin dashboard aggregate (latest: adds openSupportCount) ──
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

-- ── api_admin_users — paginated server-side user management (search + status filter) ──
create or replace function public.api_admin_users(
  p_query text default null,
  p_status text default 'all',
  p_page integer default 1,
  p_page_size integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_query text := coalesce(nullif(btrim(p_query), ''), null);
  v_status text := case when p_status in ('active','banned') then p_status else 'all' end;
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_page_size integer := least(greatest(1, coalesce(p_page_size, 25)), 100);
  v_total integer;
  v_banned_total integer;
  v_rows jsonb;
begin
  select count(*) into v_total from public.users u
    where (v_query is null or u.name ilike '%' || v_query || '%' or u.email ilike '%' || v_query || '%')
      and (v_status = 'all' or u.is_banned = (v_status = 'banned'));

  -- banned count for the whole searched set (ignores the status filter)
  select count(*) into v_banned_total from public.users u
    where (v_query is null or u.name ilike '%' || v_query || '%' or u.email ilike '%' || v_query || '%')
      and u.is_banned;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.name, 'email', u.email, 'role', u.role,
      'isBanned', u.is_banned, 'ipAddress', u.ip_address, 'fingerprint', u.fingerprint,
      'taskBalance', coalesce(w.task_balance, 0),
      'withdrawableBalance', coalesce(w.withdrawable_balance, 0),
      'activePlanName', (select p.name from public.user_plans up
                           join public.plans p on p.id = up.plan_id
                           where up.user_id = u.id and up.status = 'active'
                             and up.expires_at > now()
                           order by up.started_at desc limit 1),
      'activePackages', coalesce((select jsonb_agg(ip.title)
        from (select pkg.title from public.user_packages upx
                join public.investment_packages pkg on pkg.id = upx.package_id
                where upx.user_id = u.id and upx.status = 'active'
                  and upx.ends_at > now()
                order by upx.started_at desc) ip), '[]'::jsonb),
      'referralCount', (select count(*) from public.users r where r.referred_by_id = u.id),
      'createdAt', u.created_at,
      'lastLoginAt', u.last_login_at
    ) order by u.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.users u
    where (v_query is null or u.name ilike '%' || v_query || '%' or u.email ilike '%' || v_query || '%')
      and (v_status = 'all' or u.is_banned = (v_status = 'banned'))
    order by u.created_at desc
    limit v_page_size offset (v_page - 1) * v_page_size
  ) u
  left join public.wallets w on w.user_id = u.id;

  return jsonb_build_object(
    'users', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(v_total::numeric / v_page_size))::int,
    'bannedTotal', v_banned_total
  );
end $$;

-- ── api_admin_notifications — paginated broadcast history ──
create or replace function public.api_admin_notifications(
  p_page integer default 1,
  p_page_size integer default 25
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_page integer := least(greatest(1, coalesce(p_page, 1)), 10000);
  v_page_size integer := least(greatest(1, coalesce(p_page_size, 25)), 100);
  v_total integer;
  v_rows jsonb;
begin
  select count(*) into v_total from public.notifications;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'message', n.message,
      'createdBy', n.created_by, 'createdAt', n.created_at
    ) order by n.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.notifications
    order by created_at desc
    limit v_page_size offset (v_page - 1) * v_page_size
  ) n;

  return jsonb_build_object(
    'notifications', v_rows,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil(v_total::numeric / v_page_size))::int
  );
end $$;

-- ── api_admin_notification_create — send one broadcast ──
create or replace function public.api_admin_notification_create(
  p_title text,
  p_message text,
  p_created_by text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_row public.notifications;
begin
  if v_title = '' then return jsonb_build_object('error', 'Enter a notification title.'); end if;
  if length(v_title) > 80 then return jsonb_build_object('error', 'Title must be 80 characters or fewer.'); end if;
  if v_message = '' then return jsonb_build_object('error', 'Enter a notification message.'); end if;
  if length(v_message) > 500 then return jsonb_build_object('error', 'Message must be 500 characters or fewer.'); end if;

  insert into public.notifications (title, message, created_by)
    values (v_title, v_message, coalesce(btrim(p_created_by), 'admin'))
    returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'title', v_row.title, 'message', v_row.message,
    'createdBy', v_row.created_by, 'createdAt', v_row.created_at
  );
end $$;

-- ── api_support_list — member's own support tickets (p_user_id-scoped) ──
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

-- ── api_support_create — submit a new support request (validated) ──
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

-- ── api_admin_support_list — every ticket with member name/email ──
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

-- ── api_admin_support_update — set status and/or the admin reply ──
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

-- ── api_admin_txns — pending-first admin money lists (withdrawals / deposits incl. plan + package requests) ──
create or replace function public.api_admin_txns(p_type text, p_limit integer default 60) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'userId', t.user_id,
      'userName', u.name, 'userEmail', u.email,
      'relatedUserId', t.related_user_id,
      'type', t.type, 'amount', t.amount, 'status', t.status,
      'description', t.description,
      'meta', coalesce(t.meta, '{}'::jsonb) - 'proof',
      'hasProof', coalesce(t.meta ? 'proof', false),
      'createdAt', t.created_at, 'processedAt', t.processed_at
    )), '[]'::jsonb)
  from (
    select t.* from public.transactions t
    -- 'deposit' listings include plan AND package payment requests
    where (t.type = p_type
           or (p_type = 'deposit' and t.type in ('plan_purchase', 'package_purchase')))
    order by (case when t.status = 'pending' then 0 else 1 end), t.created_at desc
    limit greatest(1, coalesce(p_limit, 60))
  ) t
  join public.users u on u.id = t.user_id
$$;

-- ── api_admin_transactions — read-only searchable ledger view (Admin Control Center) ──
create or replace function public.api_admin_transactions(
  p_query text default null,
  p_type text default null,
  p_status text default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns jsonb
language sql stable security definer set search_path = public as $$
  with filtered as (
    select t.id, t.user_id, t.related_user_id, t.type, t.amount, t.status,
           t.description, t.meta, t.created_at, t.processed_at
    from public.transactions t
    join public.users u on u.id = t.user_id
    where (p_type is null or btrim(p_type) = '' or t.type = btrim(p_type))
      and (p_status is null or btrim(p_status) = '' or t.status = btrim(p_status))
      and (p_query is null or btrim(p_query) = ''
           or u.name ilike '%' || btrim(p_query) || '%'
           or u.email ilike '%' || btrim(p_query) || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', f.id, 'userId', f.user_id,
          'userName', u.name, 'userEmail', u.email,
          'relatedUserId', f.related_user_id,
          'type', f.type, 'amount', f.amount, 'status', f.status,
          'description', f.description,
          'meta', coalesce(f.meta, '{}'::jsonb) - 'proof',
          'hasProof', coalesce(f.meta ? 'proof', false),
          'createdAt', f.created_at, 'processedAt', f.processed_at
        ) order by f.created_at desc)
      from (
        select * from filtered
        order by created_at desc
        offset greatest(0, coalesce(p_offset, 0))
        limit least(200, greatest(1, coalesce(p_limit, 25)))
      ) f
      join public.users u on u.id = f.user_id
    ), '[]'::jsonb)
  )
$$;

-- ── ensure_payment_methods_seeded — one-time backfill from legacy gateway settings ──
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

-- ── api_payment_methods_list — active checkout channels + require_proof flag ──
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

-- ── api_submit_package_payment — pending package payment request with every guard server-side ──
create or replace function public.api_submit_package_payment(
  p_user_id text, p_package_id text, p_payment_method_id text,
  p_tx_id text, p_proof text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pkg    public.investment_packages;
  v_method public.payment_methods;
  v_txn    public.transactions;
  v_meta   jsonb;
begin
  select * into v_pkg from public.investment_packages
  where id = p_package_id and is_active;
  if not found then
    return jsonb_build_object('error', 'Package not found or disabled.');
  end if;

  select * into v_method from public.payment_methods
  where id = p_payment_method_id and is_active;
  if not found then
    return jsonb_build_object('error', 'Select a valid payment method.');
  end if;

  if p_tx_id is null or p_tx_id !~ '^[A-Za-z0-9-]{6,40}$' then
    return jsonb_build_object('error', 'Enter the transaction ID from your payment app (e.g. TXN12345678).');
  end if;

  if p_proof is not null and p_proof <> ''
     and (left(p_proof, 11) <> 'data:image/' or length(p_proof) > 2000000) then
    return jsonb_build_object('error', 'Invalid payment screenshot — use a JPG, PNG or WEBP image.');
  end if;

  if coalesce(public.get_setting('require_payment_proof'), 'false') = 'true'
     and (p_proof is null or p_proof = '') then
    return jsonb_build_object('error', 'A payment screenshot is required — attach your receipt image.');
  end if;

  -- Duplicate pending request for the same package by the same member.
  if exists (
    select 1 from public.transactions
    where user_id = p_user_id and type = 'package_purchase' and status = 'pending'
      and meta->>'packageId' = p_package_id
  ) then
    return jsonb_build_object(
      'error',
      'You already have a pending payment request for this package — wait for the admin review before submitting again.'
    );
  end if;

  -- This member already used this TxID on a non-rejected submission.
  if exists (
    select 1 from public.transactions
    where user_id = p_user_id
      and type in ('deposit', 'plan_purchase', 'package_purchase')
      and status <> 'rejected'
      and meta->>'txId' = p_tx_id
  ) then
    return jsonb_build_object('error', 'You have already submitted this transaction ID.');
  end if;

  -- Another member's pending request carries the same TxID.
  if exists (
    select 1 from public.transactions
    where user_id <> p_user_id
      and type in ('deposit', 'plan_purchase', 'package_purchase')
      and status = 'pending'
      and meta->>'txId' = p_tx_id
  ) then
    return jsonb_build_object('error', 'This transaction ID is already under review.');
  end if;

  v_meta := jsonb_build_object(
    'packageId', v_pkg.id, 'packageTitle', v_pkg.title, 'purpose', 'package',
    'paymentMethod', v_method.name, 'paymentMethodId', v_method.id, 'txId', p_tx_id
  );
  if p_proof is not null and p_proof <> '' then
    v_meta := v_meta || jsonb_build_object('proof', p_proof);
  end if;

  -- Amount is ALWAYS the package price from the database row — the client
  -- never supplies money values.
  insert into public.transactions (user_id, type, amount, status, description, meta)
  values (p_user_id, 'package_purchase', v_pkg.price, 'pending',
          'Payment for ' || v_pkg.title || ' — awaiting admin review', v_meta)
  returning * into v_txn;

  return jsonb_build_object('ok', true, 'transaction', public.tx_dto(v_txn));
end $$;

-- ── api_payment_history — the member's own payment requests ──
create or replace function public.api_payment_history(p_user_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('payments', coalesce((
    select jsonb_agg(public.tx_dto(t) order by t.created_at desc)
    from (
      select * from public.transactions
      where user_id = p_user_id
        and type in ('deposit', 'plan_purchase', 'package_purchase')
      order by created_at desc
      limit 60
    ) t
  ), '[]'::jsonb))
$$;

-- ── api_withdrawal_methods_list — active payout channels for the Withdraw dropdown ──
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

-- ── api_packages_list — member catalogue + live-config holdings + portfolio totals ──
create or replace function public.api_packages_list(p_user_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return jsonb_build_object(
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'description', p.description, 'price', p.price,
        'dailyEarning', p.daily_earning, 'durationDays', p.duration_days,
        'totalReturn', p.total_return, 'netProfit', p.net_profit,
        'isActive', p.is_active, 'sortOrder', p.sort_order
      ) order by p.sort_order asc, p.price asc)
      from public.investment_packages p
      where p.is_active
    ), '[]'::jsonb),
    'myPackages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', up.id, 'packageId', up.package_id, 'packageTitle', ip.title,
        'investAmount', up.invest_amount,
        -- LIVE package config (the package row is the source of truth; admin
        -- edits are reflected here without any per-user update).
        'dailyEarning', ip.daily_earning,
        'status', up.status, 'lastEarningDate', up.last_earning_date,
        'startedAt', up.started_at, 'endsAt', up.ends_at
      ) order by up.started_at desc)
      from public.user_packages up
      join public.investment_packages ip on ip.id = up.package_id
      where up.user_id = p_user_id
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'activeCount', (
        select count(*) from public.user_packages
        where user_id = p_user_id and status = 'active' and ends_at > now()
      ),
      'dailyIncome', coalesce((
        select sum(ip.daily_earning)
        from public.user_packages up
        join public.investment_packages ip on ip.id = up.package_id
        where up.user_id = p_user_id and up.status = 'active' and up.ends_at > now()
      ), 0),
      'investedTotal', coalesce((
        select sum(up.invest_amount) from public.user_packages up where up.user_id = p_user_id
      ), 0),
      'earnedTotal', coalesce((
        select sum(t.amount) from public.transactions t
        where t.user_id = p_user_id and t.type = 'daily_earning' and t.status = 'completed'
      ), 0)
    )
  );
end $$;

-- ── api_purchase_package — balance purchase (task-first deduction) + inviter commission, atomic ──
create or replace function public.api_purchase_package(
  p_user_id text, p_package_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pkg     public.investment_packages;
  v_wallet  public.wallets;
  v_up      public.user_packages;
  v_txn     public.transactions;
  v_task    integer;
  v_w       integer;
  v_avail   integer;
  v_commission jsonb;
begin
  select * into v_pkg from public.investment_packages
  where id = p_package_id and is_active;
  if not found then
    return jsonb_build_object('error', 'Package not found or disabled.');
  end if;

  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if not found then
    return jsonb_build_object('error', 'Wallet not found.');
  end if;

  v_avail := v_wallet.task_balance + v_wallet.withdrawable_balance;
  if v_avail < v_pkg.price then
    return jsonb_build_object(
      'error',
      'Insufficient balance. You need ' || (v_pkg.price - v_avail) ||
      ' more to invest in ' || v_pkg.title || '.'
    );
  end if;

  v_task := least(v_wallet.task_balance, v_pkg.price);
  v_w := v_pkg.price - v_task;

  insert into public.user_packages
    (user_id, package_id, invest_amount, daily_earning, status, started_at, ends_at)
  values
    (p_user_id, p_package_id, v_pkg.price, v_pkg.daily_earning, 'active',
     now(), now() + make_interval(days => v_pkg.duration_days))
  returning * into v_up;

  update public.wallets
    set task_balance = task_balance - v_task,
        withdrawable_balance = withdrawable_balance - v_w
    where user_id = p_user_id
    returning * into v_wallet;

  insert into public.transactions
    (user_id, type, amount, status, description, meta, processed_at)
  values
    (p_user_id, 'package_purchase', -v_pkg.price, 'completed',
     'Invested in ' || v_pkg.title || ' — ' || v_pkg.daily_earning ||
       '/day for ' || v_pkg.duration_days || ' days',
     jsonb_build_object(
       'packageId', p_package_id, 'packageTitle', v_pkg.title, 'userPackageId', v_up.id,
       'durationDays', v_pkg.duration_days, 'dailyEarning', v_pkg.daily_earning,
       'deductedFrom', jsonb_build_object('task', v_task, 'withdrawable', v_w)
     ),
     now())
  returning * into v_txn;

  -- inviter's withdrawable commission — same transaction, idempotent per instance
  v_commission := public.fn_credit_referral_commission(
    p_user_id, v_up.id, v_pkg.id, v_pkg.title, v_pkg.price);

  return jsonb_build_object(
    'ok', true,
    'transaction', public.tx_dto(v_txn),
    'wallet', jsonb_build_object(
      'taskBalance', v_wallet.task_balance, 'withdrawableBalance', v_wallet.withdrawable_balance
    ),
    'userPackage', jsonb_build_object(
      'id', v_up.id, 'packageId', p_package_id, 'packageTitle', v_pkg.title,
      'investAmount', v_up.invest_amount, 'dailyEarning', v_up.daily_earning,
      'status', 'active', 'lastEarningDate', v_up.last_earning_date,
      'startedAt', v_up.started_at, 'endsAt', v_up.ends_at
    )
  );
end $$;

-- ── api_run_daily_earnings — nightly distribution engine (idempotent per day, LIVE package config) ──
create or replace function public.api_run_daily_earnings() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today      text := to_char(now(), 'YYYY-MM-DD');
  v_today_start timestamptz := date_trunc('day', now());
  v_users      integer := 0;
  v_packages   integer := 0;
  v_total      integer := 0;
  v_details    jsonb := '[]'::jsonb;
  v_completed  integer := 0;
  v_already    boolean := false;
  v_row        record;
begin
  for v_row in
    select up.user_id, u.name as user_name,
           sum(ip.daily_earning)::integer as total,
           count(*)::integer as pkg_count,
           jsonb_agg(jsonb_build_object(
             'id', up.id, 'packageId', up.package_id, 'title', ip.title,
             'dailyEarning', ip.daily_earning
           ) order by up.started_at) as pkgs
    from public.user_packages up
    join public.users u on u.id = up.user_id
    join public.investment_packages ip on ip.id = up.package_id
    where up.status = 'active'
      and up.ends_at > now()
      and up.started_at < v_today_start
      and (up.last_earning_date is null or up.last_earning_date < v_today)
    group by up.user_id, u.name
  loop
    update public.wallets
      set task_balance = task_balance + v_row.total
      where user_id = v_row.user_id;

    insert into public.transactions
      (user_id, type, amount, status, description, meta, processed_at)
    values
      (v_row.user_id, 'daily_earning', v_row.total, 'completed',
       'Daily earnings from ' || v_row.pkg_count || ' active package' ||
         case when v_row.pkg_count = 1 then '' else 's' end,
       jsonb_build_object('date', v_today, 'packages', v_row.pkgs),
       now());

    update public.user_packages
      set last_earning_date = v_today
      where user_id = v_row.user_id
        and status = 'active'
        and ends_at > now()
        and started_at < v_today_start
        and (last_earning_date is null or last_earning_date < v_today);

    v_users := v_users + 1;
    v_packages := v_packages + v_row.pkg_count;
    v_total := v_total + v_row.total;
    v_details := v_details || jsonb_build_object(
      'userId', v_row.user_id, 'userName', v_row.user_name,
      'packages', v_row.pkg_count, 'total', v_row.total
    );
  end loop;

  update public.user_packages
    set status = 'completed'
    where status = 'active' and ends_at <= now();
  get diagnostics v_completed = row_count;

  if v_users = 0 and exists (
    select 1 from public.user_packages where last_earning_date = v_today
  ) then
    v_already := true;
  end if;

  return jsonb_build_object(
    'date', v_today,
    'usersCredited', v_users,
    'packagesCredited', v_packages,
    'packagesCompleted', v_completed,
    'totalCredited', v_total,
    'alreadyRan', v_already,
    'details', v_details
  );
end $$;

-- ── api_package_tasks_list — THE one applicable daily task card + content task ──
create or replace function public.api_package_tasks_list(p_user_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_content record;
  v_task    record;
begin
  -- The admin-configured content: first ACTIVE task row (URL + countdown).
  select t.id, t.title, t.description, t.url, t.duration_seconds, t.reward_amount,
         t.plan_id, t.is_active, t.sort_order
    into v_content
    from public.tasks t
    where t.is_active
    order by t.sort_order asc, t.created_at asc
    limit 1;

  -- THE ONE applicable daily task: the active instance whose package carries
  -- the highest admin-configured daily_earning (newest purchase breaks ties).
  -- The reward is the package's CURRENT config — Admin edits apply instantly.
  select up.id, up.package_id, up.ends_at, up.last_earning_date,
         coalesce(p.title, 'Package') as package_title,
         p.daily_earning as live_earning,
         ptl.started_at
    into v_task
    from public.user_packages up
    join public.investment_packages p on p.id = up.package_id
    left join public.package_task_logs ptl
      on ptl.user_package_id = up.id and ptl.user_id = p_user_id and ptl.date = v_today
    where up.user_id = p_user_id
      and up.status = 'active'
      and up.ends_at > now()
    order by p.daily_earning desc, up.started_at desc
    limit 1;

  return jsonb_build_object(
    'tasks', case when v_task.id is null then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'id', v_task.id,
        'packageId', v_task.package_id,
        'packageTitle', v_task.package_title,
        'reward', v_task.live_earning,
        'claimedToday', coalesce(
          v_task.last_earning_date = v_today
          or exists (
            select 1 from public.package_task_logs l
            where l.user_id = p_user_id and l.date = v_today and l.completed_at is not null
          ), false),
        'startedAt', v_task.started_at,
        'endsAt', v_task.ends_at
      )
    ) end,
    'content', case when v_content.id is null then null else jsonb_build_object(
        'id', v_content.id, 'title', v_content.title, 'description', v_content.description,
        'url', v_content.url, 'durationSeconds', v_content.duration_seconds,
        'rewardAmount', v_content.reward_amount, 'planId', v_content.plan_id,
        'isActive', v_content.is_active, 'sortOrder', v_content.sort_order
      ) end
  );
end $$;

-- ── api_start_package_task — countdown registration (ownership + daily guards, idempotent) ──
create or replace function public.api_start_package_task(p_user_id text, p_user_package_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inst    public.user_packages;
  v_started timestamptz;
  v_today   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
begin
  select * into v_inst from public.user_packages
    where id = p_user_package_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'Package not found.');
  end if;
  if v_inst.status <> 'active' or v_inst.ends_at <= now() then
    return jsonb_build_object('error', 'This package is no longer active.');
  end if;

  if not exists (select 1 from public.tasks where is_active) then
    return jsonb_build_object('error', 'Task content is not available. Please try again later.');
  end if;

  if v_inst.last_earning_date = v_today then
    return jsonb_build_object('error', 'This task is already completed today.');
  end if;

  -- Member-level daily guard — ONE task claim per day across ALL packages.
  if exists (
    select 1 from public.package_task_logs
    where user_id = p_user_id and date = v_today and completed_at is not null
  ) then
    return jsonb_build_object('error', 'You already claimed today''s task.');
  end if;

  if exists (
    select 1 from public.package_task_logs
    where user_id = p_user_id and user_package_id = p_user_package_id
      and date = v_today and completed_at is not null
  ) then
    return jsonb_build_object('error', 'This task is already completed today.');
  end if;

  insert into public.package_task_logs (user_id, user_package_id, date, started_at)
  values (p_user_id, p_user_package_id, v_today, now())
  on conflict (user_id, user_package_id, date)
    do update set started_at = public.package_task_logs.started_at
  returning started_at into v_started;

  return jsonb_build_object('ok', true, 'startedAt', v_started);
end $$;

-- ── api_complete_package_task — THE daily claim (timer check, live package earning, no double credit with the nightly engine) ──
create or replace function public.api_complete_package_task(p_user_id text, p_user_package_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_inst    public.user_packages;
  v_pkg     public.investment_packages;
  v_task    public.tasks;
  v_log     public.package_task_logs;
  v_wallet  public.wallets;
  v_today   text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_reward  integer;
begin
  select * into v_inst from public.user_packages
    where id = p_user_package_id and user_id = p_user_id;
  if not found then
    return jsonb_build_object('error', 'Package not found.');
  end if;
  if v_inst.status <> 'active' or v_inst.ends_at <= now() then
    return jsonb_build_object('error', 'This package is no longer active.');
  end if;

  select * into v_task from public.tasks where is_active
    order by sort_order asc, created_at asc limit 1;
  if not found then
    return jsonb_build_object('error', 'Task content is not available. Please try again later.');
  end if;

  if v_inst.last_earning_date = v_today then
    return jsonb_build_object('error', 'You already claimed this task today.');
  end if;

  -- Member-level daily guard — ONE claim per day across ALL packages.
  if exists (
    select 1 from public.package_task_logs
    where user_id = p_user_id and date = v_today and completed_at is not null
  ) then
    return jsonb_build_object('error', 'You already claimed today''s task.');
  end if;

  select * into v_log from public.package_task_logs
    where user_id = p_user_id and user_package_id = p_user_package_id and date = v_today;
  if not found or v_log.started_at is null then
    return jsonb_build_object('error', 'Start the task first.');
  end if;
  if v_log.completed_at is not null then
    return jsonb_build_object('error', 'You already claimed this task today.');
  end if;

  -- countdown timer (same 1-second grace the app uses)
  if now() < v_log.started_at + make_interval(secs => v_task.duration_seconds) - interval '1 second' then
    return jsonb_build_object('error', 'Please wait for the timer to finish.');
  end if;

  -- The LIVE admin-configured daily earning of the package (falls back to
  -- the purchase snapshot only if the package row vanished).
  select * into v_pkg from public.investment_packages where id = v_inst.package_id;
  v_reward := coalesce(v_pkg.daily_earning, v_inst.daily_earning);

  select * into v_wallet from public.wallets where user_id = p_user_id for update;

  update public.package_task_logs
    set completed_at = now(), reward_amount = v_reward
    where id = v_log.id;

  update public.user_packages
    set last_earning_date = v_today
    where id = v_inst.id;

  update public.wallets
    set task_balance = task_balance + v_reward
    where user_id = p_user_id
    returning * into v_wallet;

  insert into public.transactions (user_id, type, amount, status, description, meta, processed_at)
  values (p_user_id, 'daily_earning', v_reward, 'completed',
          'Daily task reward — ' || coalesce(v_pkg.title, 'Package'),
          jsonb_build_object('userPackageId', v_inst.id, 'packageId', v_inst.package_id,
                             'packageTitle', coalesce(v_pkg.title, 'Package'),
                             'dailyEarning', v_reward, 'date', v_today, 'viaTask', true),
          now());

  return jsonb_build_object(
    'ok', true,
    'reward', v_reward,
    'wallet', jsonb_build_object('taskBalance', v_wallet.task_balance,
                                 'withdrawableBalance', v_wallet.withdrawable_balance)
  );
end $$;

-- ── fn_redeem_promo — shared atomic redeem engine (claim + counter + withdrawable credit + ledger row) ──
create or replace function public.fn_redeem_promo(
  p_user_id text,
  p_code text,
  p_reward_override integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_promo  public.promo_codes%rowtype;
  v_reward integer;
begin
  select * into v_promo from public.promo_codes where code = p_code for update;
  if not found then
    return jsonb_build_object('error', 'Invalid promo code.');
  end if;
  if not v_promo.is_active then
    return jsonb_build_object('error', 'This promo code is no longer active.');
  end if;
  if v_promo.max_uses is not null and v_promo.used_count >= v_promo.max_uses then
    return jsonb_build_object('error', 'This promo code has reached its usage limit.');
  end if;
  if exists (
    select 1 from public.promo_claims
    where promo_code_id = v_promo.id and user_id = p_user_id
  ) then
    return jsonb_build_object('error', 'You have already claimed this code.');
  end if;
  if not exists (select 1 from public.wallets where user_id = p_user_id) then
    return jsonb_build_object('error', 'Wallet not found for this account.');
  end if;

  v_reward := coalesce(p_reward_override, v_promo.reward_amount);
  if v_reward <= 0 then
    return jsonb_build_object('error', 'This reward is currently unavailable.');
  end if;

  insert into public.promo_claims (promo_code_id, user_id)
  values (v_promo.id, p_user_id);

  update public.promo_codes
    set used_count = used_count + 1
    where id = v_promo.id;

  update public.wallets
    set withdrawable_balance = withdrawable_balance + v_reward
    where user_id = p_user_id;

  insert into public.transactions
    (user_id, type, amount, status, description, meta, processed_at)
  values
    (p_user_id, 'promo_reward', v_reward, 'completed',
     case v_promo.code
       when 'TELEGRAM' then 'Telegram join reward'
       when 'WHATSAPP' then 'WhatsApp join reward'
       else 'Promo reward: ' || v_promo.code
     end,
     jsonb_build_object(
       'code', v_promo.code, 'title', v_promo.title,
       'source', case v_promo.code
                   when 'TELEGRAM' then 'telegram'
                   when 'WHATSAPP' then 'whatsapp'
                   else 'promo'
                 end,
       'reward', v_reward
     ),
     now());

  return jsonb_build_object(
    'reward', v_reward,
    'title', coalesce(nullif(v_promo.title, ''), 'Promo reward'),
    'code', v_promo.code
  );
end $$;

-- ── fn_claim_channel — shared channel visit-reward claim (enabled gate → live amount → row self-heal → redeem) ──
create or replace function public.fn_claim_channel(p_user_id text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_enabled_key text := case p_code when 'TELEGRAM' then 'home_telegram_enabled' else 'home_whatsapp_enabled' end;
  v_reward_key  text := case p_code when 'TELEGRAM' then 'home_telegram_reward' else 'home_whatsapp_reward' end;
  v_label       text := case p_code when 'TELEGRAM' then 'Telegram' else 'WhatsApp' end;
  v_title       text := case p_code when 'TELEGRAM' then 'Telegram join reward' else 'WhatsApp join reward' end;
  v_reward      integer;
begin
  if p_code not in ('TELEGRAM', 'WHATSAPP') then
    return jsonb_build_object('error', 'Invalid channel code.');
  end if;

  if not (coalesce(public.get_setting(v_enabled_key), 'true') in ('true', '1')) then
    return jsonb_build_object('error', 'The ' || v_label || ' reward is currently disabled.');
  end if;

  v_reward := case
    when coalesce(public.get_setting(v_reward_key), '') ~ '^\d+$'
      then public.get_setting(v_reward_key)::int
    else 50
  end;

  -- keep the system row's display amount in sync with the live setting
  update public.promo_codes
    set reward_amount = v_reward
    where code = p_code and is_system;

  -- self-heal: create the row if a fresh deployment somehow lacks it
  insert into public.promo_codes (code, title, reward_amount, max_uses, is_active, is_system)
  values (p_code, v_title, v_reward, null, true, true)
  on conflict (code) do nothing;

  return public.fn_redeem_promo(p_user_id, p_code, v_reward);
end $$;

-- ── fn_credit_referral_commission — inviter's withdrawable commission, exactly once per activation instance ──
create or replace function public.fn_credit_referral_commission(
  p_invitee_id text,
  p_user_package_id text,
  p_package_id text,
  p_package_title text,
  p_package_price integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_invitee public.users;
  v_inviter public.users;
  v_wallet  public.wallets;
  v_percent integer;
  v_amount  integer;
begin
  select * into v_invitee from public.users where id = p_invitee_id;
  if not found or v_invitee.referred_by_id is null then
    return null; -- not a referred member — no commission
  end if;

  select * into v_inviter from public.users where id = v_invitee.referred_by_id;
  if not found then return null; end if;

  select * into v_wallet from public.wallets where user_id = v_inviter.id for update;
  if not found then return null; end if;

  -- idempotency: exactly ONE commission per (invitee, activation instance)
  if exists (
    select 1 from public.transactions
    where type = 'referral_commission' and related_user_id = p_invitee_id
      and meta->>'userPackageId' = p_user_package_id
  ) then
    return null;
  end if;

  -- Task 38 policy: the commission is paid on EVERY approved referred
  -- activation — unconditionally. The previous same-IP/fingerprint
  -- suppression was REMOVED because mobile carriers place thousands of
  -- members behind one shared public IP (CGNAT) and inviter/invitee pairs
  -- routinely sign up from the same household or even the same phone, so
  -- that check silently zeroed out legitimate commissions (the reported
  -- "Withdrawable Rs 0" issue). Fraud control remains where it belongs:
  -- every external payment requires a manual ADMIN approval before any
  -- package (and therefore commission) can activate, and the idempotency
  -- guard above guarantees exactly ONE commission per approved investment
  -- no matter how many times the approval is retried, replayed or
  -- double-clicked. Wallet-balance purchases remain single-shot through
  -- the atomic api_purchase_package transaction (task-first deduction).
  -- The unlock flow (process_referral_unlock) keeps its own separate rules;
  -- this function NEVER touches task balances or unlock amounts.
  --

  -- percent from the live admin setting, clamped to 0..100 (invalid → 0)
  v_percent := case
    when btrim(coalesce(public.get_setting('invite_commission_percent'), '')) ~ '^\d+$'
      then least(100, greatest(0, btrim(public.get_setting('invite_commission_percent'))::int))
    else 0
  end;
  v_amount := floor(p_package_price * v_percent / 100)::int;
  if v_amount <= 0 then
    return null; -- commission disabled (0%) — nothing to credit
  end if;

  update public.wallets
    set withdrawable_balance = withdrawable_balance + v_amount
    where user_id = v_inviter.id
    returning * into v_wallet;

  insert into public.transactions
    (user_id, related_user_id, type, amount, status, description, meta, processed_at)
  values
    (v_inviter.id, p_invitee_id, 'referral_commission', v_amount, 'completed',
     'Referral commission — ' || v_percent || '% of ' || p_package_title ||
       ' activated by ' || v_invitee.name,
     jsonb_build_object(
       'inviteeId', p_invitee_id, 'userPackageId', p_user_package_id,
       'packageId', p_package_id, 'packageTitle', p_package_title,
       'packagePrice', p_package_price, 'percent', v_percent
     ),
     now());

  return jsonb_build_object('amount', v_amount, 'blocked', false);
end $$;

-- ── api_claim_promo — member promo redeem + WHATSAPP channel routing ──
create or replace function public.api_claim_promo(p_user_id text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if upper(p_code) = 'TELEGRAM' then
    return jsonb_build_object('error', 'Use the Telegram reward box to claim this one.');
  end if;
  if upper(p_code) = 'WHATSAPP' then
    return public.fn_claim_channel(p_user_id, 'WHATSAPP');
  end if;
  return public.fn_redeem_promo(p_user_id, upper(p_code));
end $$;

-- ── api_claim_telegram — telegram channel claim (enabled gate enforced) ──
create or replace function public.api_claim_telegram(p_user_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.fn_claim_channel(p_user_id, 'TELEGRAM');
end $$;

-- ── api_home_data — member Home payload (widgets config + stats + channel claim states) ──
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

-- ── set_system_setting — service-role settings upsert ──
create or replace function public.set_system_setting(p_key text, p_value text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object('error', 'Setting key is required.');
  end if;
  insert into public.system_settings (key, value)
  values (btrim(p_key), coalesce(p_value, ''))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'key', btrim(p_key));
end $$;

-- ── Seed data (idempotent — merge on conflict, never overwrite live edits) ──
insert into public.system_settings (key, value) values
  ('auto_approve_deposits', 'true'),
  ('easypaisa_account', '0300-1234567 (TaskEarn Pvt Ltd)'),
  ('easypaisa_title', 'TaskEarn Pvt Ltd'),
  ('home_announcement_en', 'Assalam-o-Alaikum! We need active members for our team. Register friends with your referral code, activate an investment package and earn daily — daily withdrawal available.'),
  ('home_announcement_ur', 'السلام علیکم! ہماری ٹیم کے لیے فعال ممبران کی شدید ضرورت ہے۔ اپنے دوستوں کو ریفرل کوڈ کے ساتھ رجسٹر کروائیں، انویسٹمنٹ پیکج فعال کریں اور روزانہ کمائیں۔ روزانہ واپسی (Daily Withdrawal) کی مکمل سہولت دستیاب ہے۔'),
  ('home_header_tagline', 'Earn daily, withdraw anytime'),
  ('home_header_title', 'Task Earn Hub'),
  ('home_lucky_draw_date', '2026-09-25'),
  ('home_team_leader_apply_enabled', 'true'),
  ('home_team_leader_target', '50000'),
  ('home_team_salary_image', ''),
  ('home_team_salary_link', '/dashboard/referrals'),
  ('home_team_salary_text', 'Team Salary System — Earn up to PKR 13,000 every week'),
  ('home_telegram_enabled', 'true'),
  ('home_telegram_reward', '50'),
  ('home_telegram_url', 'https://t.me/TaskEarnHub'),
  ('home_welcome_popup_button_link', ''),
  ('home_welcome_popup_button_text', ''),
  ('home_welcome_popup_description', ''),
  ('home_welcome_popup_enabled', 'false'),
  ('home_welcome_popup_frequency', 'once_per_session'),
  ('home_welcome_popup_image', ''),
  ('home_welcome_popup_title', ''),
  ('home_whatsapp_enabled', 'true'),
  ('home_whatsapp_reward', '50'),
  ('home_whatsapp_url', 'https://whatsapp.com/channel/TaskEarnHub'),
  ('invite_commission_percent', '50'),
  ('invite_commission_text', 'Earn {percent}% commission on every referral''s package purchase'),
  ('invite_how_it_works', '["Share your referral link with friends","They sign up and buy a package","You earn {percent}% commission on their package purchase","Unlock Cash Rewards as your team grows!"]'),
  ('invite_referral_policy', '["You earn only when your referred user purchases a package.","On every paid package purchase, you receive {percent}% commission of the package amount.","Free package users do not generate package purchase commission.","Each referral is counted once, according to the existing referral rules."]'),
  ('invite_reward_levels', '[{"required":5000,"reward":1500},{"required":10000,"reward":3000},{"required":20000,"reward":6000},{"required":30000,"reward":9000},{"required":50000,"reward":15000}]'),
  ('jazzcash_account', '0301-7654321 (TaskEarn Pvt Ltd)'),
  ('jazzcash_title', 'TaskEarn Pvt Ltd'),
  ('max_withdrawal', '0'),
  ('min_withdrawal', '20'),
  ('payment_instructions', 'Send the exact amount to the account above, then paste the Transaction ID (TID) from your payment app receipt. Your plan activates after admin approval — usually within a few hours.'),
  ('require_payment_proof', 'false'),
  ('site_favicon_url', ''),
  ('site_logo_url', ''),
  ('site_title', 'TaskEarn'),
  ('support_email', 'support@taskearn.app'),
  ('unlock_amount_per_ref', '300'),
  ('usdt_address', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'),
  ('usdt_qr_url', ''),
  ('wallet_method_image_url', '')
on conflict (key) do nothing;

-- Task 38 policy sync — applies the withdrawal & commission policy to
-- deployments that already hold older system_settings rows (the seeds above
-- are on-conflict-do-nothing, so existing rows keep their old values without
-- this). The admin can still tune invite_commission_percent from the
-- website's Admin → Invite page afterwards.
update public.system_settings set value = '50' where key = 'invite_commission_percent';
update public.system_settings set value = '20' where key = 'min_withdrawal';
update public.system_settings set value = '0'  where key = 'max_withdrawal';

insert into public.plans (id, name, description, price, reward_per_task, daily_task_limit, duration_days, is_active, sort_order) values
  ('plan_vip1_starter_000000000001', 'VIP 1 · Starter', 'Entry-level plan — warm up your daily earnings.', 1500, 75, 2, 30, true, 1),
  ('plan_vip2_silver_00000000000002', 'VIP 2 · Silver', 'Our most popular plan — balanced rewards and tasks.', 5000, 220, 3, 30, true, 2),
  ('plan_vip3_gold_0000000000000003', 'VIP 3 · Gold', 'For serious earners — bigger daily rewards.', 15000, 700, 3, 30, true, 3),
  ('plan_vip4_platinum_0000000000004', 'VIP 4 · Platinum', 'Maximum earning power with extended validity.', 40000, 2000, 3, 45, true, 4)
on conflict (id) do nothing;

insert into public.tasks (id, title, description, url, duration_seconds, is_active, sort_order) values
  ('task_watch_video_000000000000001', 'Watch Sponsored Video', 'Watch a short sponsor video and verify the code.', 'https://www.youtube.com', 15, true, 1),
  ('task_join_telegram_0000000000002', 'Join Telegram Channel', 'Join our official channel for daily bonus codes.', 'https://telegram.org', 10, true, 2),
  ('task_follow_social_0000000000003', 'Follow Social Page', 'Follow our partner''s social page.', 'https://www.facebook.com', 10, true, 3),
  ('task_visit_partner_0000000000004', 'Visit Partner Website', 'Browse a partner site for the required time.', 'https://example.com', 12, true, 4),
  ('task_mini_survey_000000000000005', 'Complete Mini Survey', 'Answer a 3-question survey.', 'https://example.com/survey', 20, true, 5),
  ('task_share_promo_000000000000006', 'Share Promo Post', 'Share today''s promo post to your feed.', 'https://twitter.com', 10, true, 6)
on conflict (id) do nothing;

insert into public.users (id, name, email, password_hash, role, referral_code, supabase_auth_id, created_at)
values (
  'b61lvha7tlz8ozkwl1dmezjcv',
  'Site Admin',
  'admin@taskearn.com',
  '4e889b1080f05e140944973ae9c2c8d6:83192a0ee96f528a195161fb94c8b6d42a072c2422eb777a373d089b4ee29b0f4288338048909d7e3ae079ab4291b0731b8ae9fbb8986aca4995454355156ce8',
  'admin',
  'ADMIN001',
  null::uuid,
  now()
)
on conflict (id) do nothing;

insert into public.wallets (user_id) values ('b61lvha7tlz8ozkwl1dmezjcv')
on conflict (user_id) do nothing;

insert into public.investment_packages
  (id, title, price, daily_earning, duration_days, total_return, net_profit, is_active, sort_order)
values
  ('pkg_mini_starter_00000000000001', 'Mini Plan',    213,  100, 36500, 3650000, 3649787, true, 1),
  ('pkg_starter_plus_00000000000002', 'Starter Plan', 1150, 500, 730,   365000,  363850,  true, 2),
  ('pkg_growth_saver_00000000000003', 'Growth Plan',  2950, 1300, 365,  474500,  471550,  true, 3),
  ('pkg_pro_max_00000000000000000004', 'Pro Plan',    5750, 2600, 365,  949000,  943250,  true, 4)
on conflict (id) do nothing;

-- ============================================================================
-- 8. Dynamic Home Page widgets (Task 15)
--    home_* system_settings defaults + promo code claim engine
--    (promo_codes / promo_claims + member RPCs; service-role only)
-- ============================================================================

insert into public.promo_codes (code, title, reward_amount, max_uses, is_active, is_system) values
  ('TELEGRAM', 'Telegram join reward', 50, null, true, true),
  ('WHATSAPP', 'WhatsApp join reward', 50, null, true, true),
  ('WELCOME50', 'Welcome bonus', 50, 100, true, false)
on conflict (code) do nothing;

insert into public.withdrawal_methods (name, kind, sort_order) values
  ('EasyPaisa', 'wallet', 1),
  ('JazzCash', 'wallet', 2),
  ('UPaisa', 'wallet', 3),
  ('SadaPay', 'wallet', 4),
  ('NayaPay', 'wallet', 5),
  ('UBL Bank', 'bank', 6),
  ('Bank Al Habib', 'bank', 7)
on conflict (name) do nothing;

-- ############################################################################
-- STEP 5 — Triggers
-- ############################################################################
-- updated_at maintenance on every mutable table.
drop trigger if exists users_touch on public.users;
create trigger users_touch before update on public.users
  for each row execute function public.touch_updated_at();

drop trigger if exists wallets_touch on public.wallets;
create trigger wallets_touch before update on public.wallets
  for each row execute function public.touch_updated_at();

drop trigger if exists plans_touch on public.plans;
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists investment_packages_touch on public.investment_packages;
create trigger investment_packages_touch before update on public.investment_packages
  for each row execute function public.touch_updated_at();

drop trigger if exists user_packages_touch on public.user_packages;
create trigger user_packages_touch before update on public.user_packages
  for each row execute function public.touch_updated_at();

drop trigger if exists promo_codes_touch on public.promo_codes;
create trigger promo_codes_touch before update on public.promo_codes
  for each row execute function public.touch_updated_at();

drop trigger if exists payment_methods_touch on public.payment_methods;
create trigger payment_methods_touch before update on public.payment_methods
  for each row execute function public.touch_updated_at();

drop trigger if exists withdrawal_methods_touch on public.withdrawal_methods;
create trigger withdrawal_methods_touch before update on public.withdrawal_methods
  for each row execute function public.touch_updated_at();

drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();

-- ############################################################################
-- STEP 6 — Indexes
-- ############################################################################
create index if not exists user_plans_user_status_idx on public.user_plans(user_id, status);

create index if not exists user_tasks_user_date_idx on public.user_tasks(user_id, date);

create index if not exists transactions_user_created_idx on public.transactions(user_id, created_at desc);
create index if not exists transactions_type_status_idx on public.transactions(type, status);

create index if not exists user_packages_user_status_idx on public.user_packages(user_id, status);
create index if not exists user_packages_status_ends_idx on public.user_packages(status, ends_at);

create index if not exists promo_claims_user_idx on public.promo_claims(user_id);

create index if not exists payment_methods_order_idx on public.payment_methods (sort_order);

create index if not exists withdrawal_methods_order_idx on public.withdrawal_methods (sort_order);

create index if not exists package_task_logs_user_date_idx on public.package_task_logs (user_id, date);

create index if not exists idx_support_tickets_status_created
  on public.support_tickets (status, created_at desc);

create index if not exists idx_support_tickets_user_created
  on public.support_tickets (user_id, created_at desc);

-- ############################################################################
-- STEP 7 — Row Level Security
-- ############################################################################
-- RLS is ENABLED on every table with NO policies created on purpose:
-- with no permissive policy, anon and authenticated keys get zero rows and
-- zero writes (PostgreSQL default-deny). The website's server uses the
-- service role key, which bypasses RLS entirely.
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.plans enable row level security;
alter table public.tasks enable row level security;
alter table public.user_plans enable row level security;
alter table public.user_tasks enable row level security;
alter table public.transactions enable row level security;
alter table public.system_settings enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.notifications enable row level security;
alter table public.investment_packages enable row level security;
alter table public.user_packages enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_claims enable row level security;
alter table public.payment_methods enable row level security;
alter table public.withdrawal_methods enable row level security;
alter table public.package_task_logs enable row level security;
alter table public.support_tickets enable row level security;

-- ############################################################################
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
