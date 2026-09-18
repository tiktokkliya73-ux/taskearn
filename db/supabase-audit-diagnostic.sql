-- ============================================================================
-- TASK EARN HUB — SUPABASE READ-ONLY DATABASE AUDIT (PHASE 1)
-- ============================================================================
-- 100% READ-ONLY. Every statement in this file is a SELECT against system
-- catalogs (pg_*) or a read-only SELECT over your table DATA. There is NO
-- DDL, NO DML, NO function creation, NO setting change of any kind.
-- Safe to run on production exactly as-is, exactly once or many times.
--
-- HOW TO RUN:
--   1. Supabase Dashboard → SQL Editor → New query
--   2. Paste this ENTIRE file → Run
--   3. Send me back the COMPLETE output:
--        • the full result grid of PART A (one big table — use the result
--          pane's download/copy; CSV or plain text both fine)
--        • for every PART B block: its result grid OR its exact error text
--
-- STRUCTURE:
--   PART A — ONE single catalog-only query (cannot fail on any database):
--            tables, columns, primary/foreign/unique/check keys, indexes,
--            views, sequences, functions/RPCs (with body fingerprints),
--            triggers, RLS status, RLS policies, privileges, a per-feature
--            "which real table handles this" mapping, an expected-objects
--            checklist, and duplicate-candidate detection.
--            ZERO table-name / column-name assumptions.
--   PART B — data-level checks (still SELECT-only) that use the standard
--            TaskEarn table names: configuration rows, payment/withdrawal
--            method rows, package counts, support rows, and SAFE duplicate
--            financial-record detection (business-event keys — review only,
--            never deletion candidates).
--            ⚠ If a PART B block fails with 42P01 “relation … does not
--              exist” or 42703 “column … does not exist”, that error is
--              ITSELF a diagnostic finding (the table/column is missing or
--              named differently on your database). Note the error text,
--              then run the remaining blocks. Do NOT change anything yet.
--
-- SENSITIVE DATA HANDLING: settings values truncated to 100 chars,
-- account numbers to a 6-char prefix, payment destinations shown as
-- LENGTH only, no full image data-URLs dumped.
-- ============================================================================

-- >>> BLOCK: PART_A

with
-- ---------------------------------------------------------------------------
-- PART A — helpers
-- ---------------------------------------------------------------------------
ns_public as (
  select oid as ns from pg_namespace where nspname = 'public'
),
roles as (
  select r.rolname, r.oid
  from pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role')
  union all select 'PUBLIC', 0::oid
),
t_tables as (
  select c.oid, c.relname, c.relkind, c.reltuples, c.relacl, c.relowner,
         ow.rolname as owner_name,
         (select count(*) from pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as ncols,
         pg_total_relation_size(c.oid) as total_size
  from pg_class c
  join ns_public n on n.ns = c.relnamespace
  join pg_roles ow on ow.oid = c.relowner
  where c.relkind in ('r', 'p')
),
t_cols as (
  select tc.relname as tbl, a.attnum, a.attname,
         format_type(a.atttypid, a.atttypmod) as dtype,
         (not a.attnotnull) as nullable,
         pg_get_expr(ad.adbin, ad.adrelid) as dflt,
         case a.attidentity when 'a' then 'identity(always)' when 'd' then 'identity(default)' else '' end as ident,
         case a.attgenerated when 's' then 'generated(stored)' else '' end as gen
  from pg_attribute a
  join t_tables tc on tc.oid = a.attrelid
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped
),
cons_detail as (
  select k.oid, k.contype, k.conname, k.convalidated,
         tc.relname as tbl,
         (select string_agg(coalesce(a.attname, '?'::name), ', ' order by x.ord)
          from unnest(k.conkey) with ordinality x(attnum, ord)
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.attnum) as cols,
         rc.relname as ref_tbl,
         (select string_agg(coalesce(a.attname, '?'::name), ', ' order by x.ord)
          from unnest(k.confkey) with ordinality x(attnum, ord)
          join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.attnum) as ref_cols,
         case k.confdeltype when 'a' then 'NO ACTION' when 'c' then 'CASCADE'
                            when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
                            when 'r' then 'RESTRICT' end as on_delete,
         case k.confupdtype when 'a' then 'NO ACTION' when 'c' then 'CASCADE'
                            when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
                            when 'r' then 'RESTRICT' end as on_update,
         pg_get_constraintdef(k.oid) as condef
  from pg_constraint k
  join ns_public n on n.ns = k.connamespace
  join pg_class tc on tc.oid = k.conrelid
  left join pg_class rc on rc.oid = k.confrelid
),
idx_detail as (
  select x.indexrelid, x.idx_name, x.tbl, x.indrelid, x.indisunique, x.indisprimary,
         x.indisvalid, x.indisready,
         (select string_agg(coalesce(a.attname, '#' || x2.attnum::text), ', ' order by x2.ord)
          from unnest(x.indkey) with ordinality x2(attnum, ord)
          left join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x2.attnum) as cols,
         pg_get_expr(x.indpred, x.indrelid) as pred
  from (
    select i.indexrelid, i.indrelid, i.indisunique, i.indisprimary, i.indisvalid,
           i.indisready, i.indpred, i.indkey,
           ci.relname as idx_name, ct.relname as tbl
    from pg_index i
    join pg_class ci on ci.oid = i.indexrelid
    join pg_class ct on ct.oid = i.indrelid
    join ns_public n on n.ns = ct.relnamespace
  ) x
),
t_fn as (
  select p.oid, p.proname, p.prokind, p.prosecdef, p.provolatile,
         p.proconfig, p.proacl, p.proowner,
         l.lanname,
         coalesce(length(p.prosrc), 0) as body_len,
         md5(coalesce(p.prosrc, '')) as body_md5,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as ret,
         regexp_replace(coalesce(p.prosrc, ''), '[[:space:]]+', ' ', 'g') as flat_body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
),
fn_priv as (
  select f.oid,
         string_agg(r.rolname || '=' || case when exists (
           select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
           where a.grantee in (r.oid, 0) and a.privilege_type = 'EXECUTE'
         ) then 'EXEC' else '-' end, ' ' order by r.rolname) as privs
  from t_fn f cross join roles r
  group by f.oid
),
trg_detail as (
  select x.tgname, tc.relname as tbl, tf.proname as fn,
         case when (x.tgtype & 2)  <> 0 then 'BEFORE'
              when (x.tgtype & 64) <> 0 then 'INSTEAD OF'
              else 'AFTER' end as timing,
         case when (x.tgtype & 1) <> 0 then 'FOR EACH ROW' else 'FOR EACH STATEMENT' end as level,
         concat_ws(',',
           case when (x.tgtype & 4)  <> 0 then 'INSERT'   end,
           case when (x.tgtype & 8)  <> 0 then 'DELETE'   end,
           case when (x.tgtype & 16) <> 0 then 'UPDATE'   end,
           case when (x.tgtype & 32) <> 0 then 'TRUNCATE' end) as events,
         case x.tgenabled when 'O' then 'enabled' when 'A' then 'enabled(replica)'
              when 'R' then 'replica-only' when 'D' then 'DISABLED'
              else x.tgenabled::text end as state,
         left(x.def, 300) as def_preview
  from (select t.oid, t.tgname, t.tgrelid, t.tgfoid, t.tgtype, t.tgenabled,
               pg_get_triggerdef(t.oid) as def
        from pg_trigger t where not t.tgisinternal) x
  join pg_class tc on tc.oid = x.tgrelid
  join pg_namespace ntc on ntc.oid = tc.relnamespace
  join pg_proc tf on tf.oid = x.tgfoid
  join pg_namespace ntf on ntf.oid = tf.pronamespace
  where ntc.nspname = 'public' or ntf.nspname = 'public'
),
t_pol as (
  select p.polname, c.relname as tbl, p.polcmd,
         (case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                        when 'w' then 'UPDATE' when 'd' then 'DELETE'
                        when '*' then 'ALL' else p.polcmd::text end) as cmd_display,
         (select string_agg(g.grantee_name, ',')
          from (select r.rolname as grantee_name
                from pg_roles r where r.oid = any(p.polroles) and r.oid <> 0
                union all
                select 'PUBLIC' from (select 1) z where 0 = any(p.polroles)) g) as roles_display,
         pg_get_expr(p.polqual, c.oid) as using_expr,
         pg_get_expr(p.polwithcheck, c.oid) as check_expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join ns_public n on n.ns = c.relnamespace
),
t_rls as (
  select c.relname, c.relrowsecurity, c.relforcerowsecurity,
         (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
  from pg_class c
  join ns_public n on n.ns = c.relnamespace
  where c.relkind in ('r', 'p')
),
t_views as (
  select c.relname, c.relkind, left(pg_get_viewdef(c.oid), 400) as def
  from pg_class c
  join ns_public n on n.ns = c.relnamespace
  where c.relkind in ('v', 'm')
),
t_seq as (
  select c.relname
  from pg_class c
  join ns_public n on n.ns = c.relnamespace
  where c.relkind = 'S'
),
feature_areas(ord, area, pattern) as (values
  (1,  'users / members / profiles',            '(user|member|profile|account)'),
  (2,  'wallets / balances (task vs withdrawable)', '(wallet|balance)'),
  (3,  'packages / plans / investments',        '(package|plan|invest)'),
  (4,  'deposits / withdrawals / payouts',      '(deposit|withdraw|payout)'),
  (5,  'payment / withdrawal methods',          '(payment|method|channel|gateway)'),
  (6,  'tasks / earnings',                      '(task|earning)'),
  (7,  'transactions / ledger',                 '(transaction|ledger|journal|txn)'),
  (8,  'referrals / commissions / invites',     '(referral|commission|invite)'),
  (9,  'notifications',                         '(notification|announce)'),
  (10, 'support / tickets / help / messages',   '(support|ticket|help|message|contact|inquiry)'),
  (11, 'promo / rewards / codes',               '(promo|reward|coupon)'),
  (12, 'settings / config',                     '(setting|config|option|preference)'),
  (13, 'media / images / logos / banners',      '(media|image|logo|banner|photo|asset)'),
  (14, 'tokens / reset / security',             '(token|reset|session)')
),
feature_map as (
  select f.ord, f.area,
         coalesce(string_agg(t.relname || '(~' || greatest(t.reltuples::bigint, 0) || ' rows)',
                             ', ' order by t.relname), '— none found —') as tables_found
  from feature_areas f
  left join t_tables t on t.relname ~ f.pattern
  group by f.ord, f.area
),
fn_overloads as (
  select f.proname, count(*) as n,
         string_agg('(' || coalesce(f.args, '') || ') returns ' || f.ret, ' ‖ ' order by f.args) as signatures
  from t_fn f
  group by f.proname
  having count(*) > 1
),
dup_fn_bodies as (
  select string_agg(f.proname || '(' || coalesce(f.args, '') || ')', ' | ' order by f.proname, f.args) as fns,
         min(f.body_len) as body_len
  from t_fn f
  where f.body_len > 0
  group by f.body_md5
  having count(*) > 1
),
dup_triggers as (
  select td.tbl, td.fn, td.timing, td.level, td.events,
         string_agg(td.tgname, ' | ' order by td.tgname) as trigger_names,
         count(*) as n
  from trg_detail td
  group by td.tbl, td.fn, td.timing, td.level, td.events
  having count(*) > 1
),
dup_indexes as (
  select id.tbl,
         (case when id.indisunique then 'UNIQUE(' else '(' end || coalesce(id.cols, '?') || ')'
          || case when id.pred is not null then ' WHERE ' || id.pred else '' end) as def,
         string_agg(id.idx_name, ' | ' order by id.idx_name) as index_names,
         count(*) as n
  from idx_detail id
  where not id.indisprimary
  group by id.tbl, (case when id.indisunique then 'UNIQUE(' else '(' end || coalesce(id.cols, '?') || ')'
                || case when id.pred is not null then ' WHERE ' || id.pred else '' end)
  having count(*) > 1
),
dup_policies as (
  select tp.tbl, tp.cmd_display,
         coalesce(tp.using_expr, '') as using_expr,
         coalesce(tp.check_expr, '') as check_expr,
         string_agg(tp.polname, ' | ' order by tp.polname) as policy_names,
         count(*) as n
  from t_pol tp
  group by tp.tbl, tp.cmd_display, coalesce(tp.using_expr, ''), coalesce(tp.check_expr, '')
  having count(*) > 1
),
dup_table_structures as (
  select string_agg(x.tbl, ' | ' order by x.tbl) as tables,
         count(*) as n,
         x.cols_sig
  from (
    select t.relname as tbl,
           (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attname)
            from pg_attribute a
            where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped) as cols_sig
    from t_tables t
  ) x
  group by x.cols_sig
  having count(*) > 1
),
tbl_priv as (
  select tc.relname as tbl,
         string_agg(r.rolname || '=' ||
           (case when exists (select 1 from aclexplode(coalesce(tc.relacl, acldefault('r', tc.relowner))) a
                              where a.grantee in (r.oid, 0) and a.privilege_type = 'SELECT') then 'S' else '-' end) ||
           (case when exists (select 1 from aclexplode(coalesce(tc.relacl, acldefault('r', tc.relowner))) a
                              where a.grantee in (r.oid, 0) and a.privilege_type = 'INSERT') then 'I' else '-' end) ||
           (case when exists (select 1 from aclexplode(coalesce(tc.relacl, acldefault('r', tc.relowner))) a
                              where a.grantee in (r.oid, 0) and a.privilege_type = 'UPDATE') then 'U' else '-' end) ||
           (case when exists (select 1 from aclexplode(coalesce(tc.relacl, acldefault('r', tc.relowner))) a
                              where a.grantee in (r.oid, 0) and a.privilege_type = 'DELETE') then 'D' else '-' end)
           , ' ' order by r.rolname) as privs
  from t_tables tc cross join roles r
  group by tc.relname
),
expected(kind, name) as (values
  ('table','users'),('table','wallets'),('table','plans'),('table','tasks'),
  ('table','user_plans'),('table','user_tasks'),('table','transactions'),
  ('table','system_settings'),('table','password_reset_tokens'),('table','notifications'),
  ('table','investment_packages'),('table','user_packages'),('table','promo_codes'),
  ('table','promo_claims'),('table','payment_methods'),('table','withdrawal_methods'),
  ('table','package_task_logs'),('table','support_tickets'),
  ('function','app_id'),('function','touch_updated_at'),('function','get_setting'),
  ('function','tx_dto'),('function','process_referral_unlock'),
  ('function','api_signup_user'),('function','api_start_task'),('function','api_complete_task'),
  ('function','complete_task_transaction'),('function','api_activate_plan'),
  ('function','activate_plan_and_unlock_referral'),('function','api_topup_deposit'),
  ('function','api_process_deposit'),('function','api_request_withdrawal'),
  ('function','api_process_withdrawal'),('function','api_adjust_balance'),
  ('function','api_public_stats'),('function','api_public_payouts'),('function','api_dashboard'),
  ('function','api_tasks_list'),('function','api_referrals'),('function','api_wallet_txns'),
  ('function','api_admin_stats'),('function','api_admin_users'),
  ('function','api_admin_notifications'),('function','api_admin_notification_create'),
  ('function','api_admin_txns'),('function','api_admin_transactions'),
  ('function','api_packages_list'),('function','api_purchase_package'),
  ('function','api_run_daily_earnings'),('function','fn_redeem_promo'),
  ('function','api_home_data'),('function','api_claim_promo'),('function','api_claim_telegram'),
  ('function','ensure_payment_methods_seeded'),('function','api_payment_methods_list'),
  ('function','api_submit_package_payment'),('function','api_payment_history'),
  ('function','api_withdrawal_methods_list'),('function','api_package_tasks_list'),
  ('function','api_start_package_task'),('function','api_complete_package_task'),
  ('function','set_system_setting'),('function','fn_claim_channel'),
  ('function','fn_credit_referral_commission'),
  ('function','api_support_list'),('function','api_support_create'),
  ('function','api_admin_support_list'),('function','api_admin_support_update')
),
expected_status as (
  select e.kind, e.name,
         case e.kind
           when 'table' then case when exists (
               select 1 from pg_class c
               join ns_public n on n.ns = c.relnamespace
               where c.relname = e.name and c.relkind in ('r', 'p')
             ) then 'EXISTS' else 'MISSING' end
           when 'function' then (select count(*)::text from t_fn f where f.proname = e.name) || ' definition(s)'
         end as status
  from expected e
)

-- ---------------------------------------------------------------------------
-- PART A — the one result set (read-only; ordered by section)
-- ---------------------------------------------------------------------------
select * from (

  select 10 as ord, 'database' as section, 'info' as object_type,
         current_database() as object_name,
         'postgres=' || current_setting('server_version')
         || ' · current_user=' || current_user
         || ' · current_schema=' || current_schema() as detail

  union all
  select 11, 'database', 'extension', e.extname, 'version=' || e.extversion
  from pg_extension e

  union all
  select 12, 'database', 'extension_check', 'pg_cron',
         case when exists (select 1 from pg_extension where extname = 'pg_cron')
              then 'INSTALLED — scheduled jobs may exist (inspect cron.job separately)'
              else 'not installed' end

  union all
  select 13, 'schemas', 'auth_table', a.relname,
         'relkind=' || a.relkind::text || ' · est_rows≈' || greatest(a.reltuples::bigint, 0)
  from pg_class a
  where a.relnamespace = to_regnamespace('auth') and a.relkind in ('r', 'v')

  union all
  select 14, 'schemas', 'auth_users_column', a.attname,
         format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' NOT NULL' else '' end
  from pg_attribute a
  where a.attrelid = to_regclass('auth.users') and a.attnum > 0 and not a.attisdropped

  union all
  select 15, 'schemas', 'storage_table', s.relname, 'relkind=' || s.relkind::text
  from pg_class s
  where s.relnamespace = to_regnamespace('storage') and s.relkind in ('r', 'v')

  union all
  select 16, 'schemas', 'storage_policy', p.polname,
         'table=' || c.relname || ' · cmd=' || coalesce(p.polcmd::text, '?')
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relnamespace = to_regnamespace('storage')

  union all
  select 20, 'structure', 'table', t.relname,
         'columns=' || t.ncols
         || ' · est_rows≈' || greatest(t.reltuples::bigint, 0)
         || ' · size=' || pg_size_pretty(t.total_size)
         || ' · owner=' || t.owner_name
  from t_tables t

  union all
  select 21, 'structure', 'feature_area', fm.area, fm.tables_found
  from feature_map fm

  union all
  select 22, 'structure', 'column', tc.tbl || '.' || tc.attname,
         tc.dtype || case when tc.nullable then '' else ' NOT NULL' end
         || case when tc.dflt is not null then ' DEFAULT ' || tc.dflt else '' end
         || case when tc.ident <> '' then ' ' || tc.ident else '' end
         || case when tc.gen <> '' then ' ' || tc.gen else '' end
  from t_cols tc

  union all
  select 23, 'structure', 'primary_key', cd.tbl,
         cd.conname || ' (' || coalesce(cd.cols, '?') || ')'
  from cons_detail cd where cd.contype = 'p'

  union all
  select 24, 'structure', 'foreign_key', cd.tbl,
         cd.conname || ': (' || coalesce(cd.cols, '?') || ') → ' || coalesce(cd.ref_tbl, '?')
         || '(' || coalesce(cd.ref_cols, '?') || ')'
         || ' ON DELETE ' || coalesce(cd.on_delete, '?')
         || ' · validated=' || cd.convalidated::text
  from cons_detail cd where cd.contype = 'f'

  union all
  select 25, 'structure', 'unique_constraint', cd.tbl,
         cd.conname || ' (' || coalesce(cd.cols, '?') || ')'
  from cons_detail cd where cd.contype = 'u'

  union all
  select 26, 'structure', 'check_constraint', cd.tbl, cd.condef
  from cons_detail cd where cd.contype = 'c'

  union all
  select 27, 'structure', 'index', id.tbl || ' · ' || id.idx_name,
         (case when id.indisprimary then 'PK ' else '' end)
         || (case when id.indisunique then 'UNIQUE ' else '' end)
         || '(' || coalesce(id.cols, '?') || ')'
         || case when id.pred is not null then ' WHERE ' || id.pred else '' end
         || ' · valid=' || id.indisvalid::text || ' ready=' || id.indisready::text
         || ' · size=' || pg_size_pretty(pg_relation_size(id.indexrelid))
  from idx_detail id

  union all
  select 28, 'structure', 'view', v.relname,
         'relkind=' || v.relkind::text || ' · def=' || coalesce(v.def, '')
  from t_views v

  union all
  select 29, 'structure', 'sequence', s.relname, 'standalone sequence'
  from t_seq s

  union all
  select 40, 'functions', 'function', f.proname || '(' || coalesce(f.args, '') || ')',
         'returns ' || f.ret
         || ' · lang=' || f.lanname
         || ' · kind=' || f.prokind::text
         || ' · security=' || (case when f.prosecdef then 'DEFINER' else 'INVOKER' end)
         || ' · volatility=' || f.provolatile::text
         || case when f.proconfig is not null then ' · config=[' || array_to_string(f.proconfig, ' ') || ']'
                 else ' · config=[none]' end
         || ' · body_len=' || f.body_len
         || ' · body_md5=' || f.body_md5
         || ' · exec[' || coalesce(fp.privs, '—') || ']'
         || ' · body≈' || left(f.flat_body, 240)
  from t_fn f
  left join fn_priv fp on fp.oid = f.oid

  union all
  select 41, 'duplicates', 'function_overloads', fo.proname,
         fo.n::text || ' different definitions: ' || fo.signatures
  from fn_overloads fo

  union all
  select 42, 'duplicates', 'identical_function_bodies', df.fns,
         'byte-identical body in multiple functions · body_len=' || df.body_len
  from dup_fn_bodies df

  union all
  select 50, 'triggers', 'trigger', td.tbl || ' · ' || td.tgname,
         td.timing || ' ' || td.events || ' ' || td.level
         || ' · function=' || td.fn
         || ' · ' || td.state
         || ' · def=' || td.def_preview
  from trg_detail td

  union all
  select 51, 'duplicates', 'duplicate_triggers', dt.tbl || ' · ' || dt.fn,
         'count=' || dt.n || ' · names=[' || dt.trigger_names || '] '
         || dt.timing || ' ' || dt.events || ' ' || dt.level
  from dup_triggers dt

  union all
  select 60, 'security', 'rls_status', r.relname,
         'rls=' || (case when r.relrowsecurity then 'ENABLED' else 'DISABLED' end)
         || ' · force=' || (case when r.relforcerowsecurity then 'yes' else 'no' end)
         || ' · policies=' || r.policy_count
  from t_rls r

  union all
  select 61, 'security', 'rls_policy', tp.tbl || ' · ' || tp.polname,
         'cmd=' || tp.cmd_display
         || ' · roles=' || coalesce(tp.roles_display, 'n/a')
         || ' · USING=' || left(coalesce(tp.using_expr, '—'), 300)
         || ' · WITH CHECK=' || left(coalesce(tp.check_expr, '—'), 300)
  from t_pol tp

  union all
  select 62, 'duplicates', 'duplicate_policies', dp.tbl,
         'count=' || dp.n || ' · names=[' || dp.policy_names || ']'
         || ' · cmd=' || dp.cmd_display
         || ' · USING=' || left(dp.using_expr, 200)
         || ' · WITH CHECK=' || left(dp.check_expr, 200)
  from dup_policies dp

  union all
  select 70, 'security', 'table_privileges', tp2.tbl,
         coalesce(tp2.privs, '— no anon/authenticated/service_role/PUBLIC grants —')
  from tbl_priv tp2

  union all
  select 80, 'expected_objects', 'expected_' || es.kind, es.name, es.status
  from expected_status es

  union all
  select 90, 'duplicates', 'duplicate_indexes', di.tbl,
         'count=' || di.n || ' · names=[' || di.index_names || '] · def=' || di.def
  from dup_indexes di

  union all
  select 91, 'duplicates', 'structurally_identical_tables', dts.tables,
         'count=' || dts.n || ' · column signature=' || left(coalesce(dts.cols_sig, '?'), 500)
  from dup_table_structures dts

) audit
order by ord, object_type, object_name;

-- ============================================================================
-- PART B — DATA-LEVEL CHECKS (SELECT-only). Each block is ONE statement.
-- A 42P01 / 42703 error here is itself a diagnostic finding — note it and
-- run the remaining blocks. Nothing below modifies data.
-- ============================================================================

-- >>> BLOCK: B1_settings
-- Configuration rows (values truncated — no image data-URLs dumped).
select s.key,
       length(s.value) as value_length,
       left(s.value, 100) as value_preview
from public.system_settings s
order by s.key;

-- >>> BLOCK: B2_users_wallets
-- Member / wallet overview (no emails dumped in this block).
select
  (select count(*) from public.users)                                              as users_total,
  (select count(*) from public.users where role = 'admin')                         as admin_users,
  (select count(*) from public.users where is_banned)                              as banned_users,
  (select count(*) from public.users where supabase_auth_id is not null)           as auth_linked_users,
  (select count(*) from public.users u
     where not exists (select 1 from public.wallets w where w.user_id = u.id))     as users_missing_wallet,
  (select count(*) from public.wallets)                                            as wallets_total,
  (select count(*) from public.wallets
     where task_balance < 0 or withdrawable_balance < 0)                           as negative_balance_rows,
  (select coalesce(sum(task_balance), 0) from public.wallets)                      as sum_task_balance,
  (select coalesce(sum(withdrawable_balance), 0) from public.wallets)              as sum_withdrawable_balance;

-- >>> BLOCK: B3_transactions_overview
-- Ledger overview by type/status.
select t.type, t.status, count(*) as rows, coalesce(sum(t.amount), 0) as total_amount
from public.transactions t
group by t.type, t.status
order by t.type, t.status;

-- >>> BLOCK: B4a_pending_withdrawals
-- Pending payouts with their payment-destination snapshot (destination shown
-- as LENGTH only — its content stays private to this editor).
select t.id, t.user_id, t.amount, t.status,
       t.meta ->> 'paymentMethod' as payment_method,
       length(coalesce(t.meta ->> 'accountDetails', '')) as destination_length,
       t.created_at
from public.transactions t
where t.type = 'withdrawal' and t.status = 'pending'
order by t.created_at desc;

-- >>> BLOCK: B4b_multi_pending_per_user
-- Anomaly: more than one PENDING withdrawal for the same member
-- (business rule allows only one at a time).
select t.user_id, count(*) as pending_withdrawals
from public.transactions t
where t.type = 'withdrawal' and t.status = 'pending'
group by t.user_id
having count(*) > 1;

-- >>> BLOCK: B4c_repeated_withdrawals_review
-- REVIEW-ONLY candidates (NEVER auto-delete): identical user+amount+
-- destination+status occurring more than once. Repeated identical
-- withdrawals CAN be perfectly legitimate — this lists them for review.
select t.user_id, t.amount, t.status,
       t.meta ->> 'accountDetails' as destination, count(*) as occurrences,
       string_agg(t.id || ' @ ' || t.created_at, ' | ' order by t.created_at) as when_where
from public.transactions t
where t.type = 'withdrawal'
group by t.user_id, t.amount, t.status, t.meta ->> 'accountDetails'
having t.meta ->> 'accountDetails' is not null and count(*) > 1
order by count(*) desc;

-- >>> BLOCK: B5a_commission_sample
-- Newest referral-commission rows WITH meta — reveals the REAL idempotency
-- keys used by the working system.
select t.id, t.user_id, t.related_user_id, t.amount, t.status, t.created_at, t.meta
from public.transactions t
where t.type = 'referral_commission'
order by t.created_at desc
limit 10;

-- >>> BLOCK: B5b_commission_duplicate_candidates
-- GENUINE duplicate-commission candidates: the SAME (inviter, activation
-- instance) credited more than once — the business-event key the system
-- guarantees exactly once. Empty result = healthy.
select t.related_user_id as inviter,
       t.meta ->> 'userPackageId' as activation_instance,
       count(*) as commission_rows,
       string_agg(t.id || ':' || t.status || ':' || t.amount, ' | ' order by t.created_at) as rows_detail
from public.transactions t
where t.type = 'referral_commission'
group by t.related_user_id, t.meta ->> 'userPackageId'
having t.meta ->> 'userPackageId' is not null and count(*) > 1;

-- >>> BLOCK: B5c_daily_earning_duplicate_candidates
-- Same member + same activation instance + same day credited more than once.
select t.user_id, t.meta ->> 'userPackageId' as activation_instance, (t.created_at)::date as day,
       count(*) as daily_rows,
       string_agg(t.id || ':' || t.amount::text, ' | ' order by t.created_at) as rows_detail
from public.transactions t
where t.type = 'daily_earning'
group by t.user_id, t.meta ->> 'userPackageId', (t.created_at)::date
having t.meta ->> 'userPackageId' is not null and count(*) > 1;

-- >>> BLOCK: B5d_referral_unlock_duplicate_candidates
-- Same invitee producing more than one referral-unlock credit.
select t.related_user_id as invitee, count(*) as unlock_rows,
       string_agg(t.id || ':' || t.amount::text, ' | ' order by t.created_at) as rows_detail
from public.transactions t
where t.type = 'referral_unlock'
group by t.related_user_id
having count(*) > 1;

-- >>> BLOCK: B5e_earning_rows_sample
-- Newest rows per earning type with meta preview (key-name discovery for
-- the checks above — shows what the working system actually records).
select t.type, t.id, t.user_id, t.related_user_id, t.amount, t.status, t.created_at,
       left(t.meta::text, 400) as meta_preview
from public.transactions t
where t.type in ('referral_commission', 'referral_unlock', 'daily_earning', 'task_reward')
order by t.created_at desc
limit 15;

-- >>> BLOCK: B6_payment_methods
-- Deposit/checkout channels (account numbers truncated to a prefix).
select m.name, m.sort_order, m.is_active,
       length(coalesce(m.logo_url, '')) as logo_length,
       coalesce(m.account_title, '—') as account_title,
       left(m.account_number, 6) || '…' as account_number_prefix
from public.payment_methods m
order by m.sort_order, m.name;

-- >>> BLOCK: B7_withdrawal_methods
-- Payout channels (logo stored as data-URL/http URL — length shown).
select m.name, m.kind, m.sort_order, m.is_active,
       length(coalesce(m.logo_url, '')) as logo_length
from public.withdrawal_methods m
order by m.sort_order, m.name;

-- >>> BLOCK: B8a_packages
-- Investment-package system counts.
select
  (select count(*) from public.investment_packages)                    as investment_packages,
  (select count(*) from public.investment_packages where is_active)    as active_packages,
  (select count(*) from public.user_packages)                          as purchased_instances,
  (select count(*) from public.user_packages where status = 'active')  as active_instances;

-- >>> BLOCK: B8b_plans_tasks
-- VIP-plan / task system counts.
select (select count(*) from public.plans)      as vip_plans,
       (select count(*) from public.tasks)      as tasks,
       (select count(*) from public.user_plans) as user_plans,
       (select count(*) from public.user_tasks) as user_tasks;

-- >>> BLOCK: B9a_support_overview
-- Support system status breakdown (if the table exists on this database).
select s.status, count(*) as rows
from public.support_tickets s
group by s.status
order by s.status;

-- >>> BLOCK: B9b_support_recent
-- Newest support requests (subjects only).
select s.id, s.user_id, left(s.subject, 60) as subject, s.status,
       case when s.reply is null then 'no reply' else 'replied' end as reply_state,
       s.created_at
from public.support_tickets s
order by s.created_at desc
limit 10;

-- >>> BLOCK: B10a_promo_codes
-- Promo/reward codes (catches accidental duplicate seed rows).
select p.code, p.title, p.reward_amount, p.max_uses, p.used_count, p.is_active, p.is_system
from public.promo_codes p
order by p.code;

-- >>> BLOCK: B10b_misc_counts
-- Other table row counts.
select (select count(*) from public.notifications)        as notifications,
       (select count(*) from public.password_reset_tokens) as password_reset_tokens,
       (select count(*) from public.promo_claims)          as promo_claims,
       (select count(*) from public.package_task_logs)     as package_task_logs;

-- >>> BLOCK: B11_storage_buckets
-- Supabase Storage buckets (the project normally uses NONE — images are
-- stored as data URLs in table columns; any bucket here came from other
-- scripts and will be reviewed, not blindly removed).
select b.id, b.name, b.public as is_public, b.file_size_limit, b.allowed_mime_types
from storage.buckets b
order by b.name;

-- ============================================================================
-- END OF AUDIT — read-only, nothing was modified.
-- Send back: PART A's full result grid + every PART B block's result or its
-- exact error text. Cleanup/fix SQL will be prepared ONLY after reviewing
-- these results.
-- ============================================================================
