/**
 * Validates /tmp/supabase-consolidated.sql (the 10-step consolidated
 * migration): full execution twice (idempotency) + the section-15 assertion
 * suite + a catalog equivalence check against db/supabase-schema.sql
 * (tables/columns, functions+signatures, triggers, indexes, RLS flags,
 * seed rows must match exactly).
 * Run: bun scripts/validate-consolidated.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const consolidated = readFileSync("db/supabase-migration.sql", "utf8");
const canonical = readFileSync("db/supabase-schema.sql", "utf8");

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

async function freshRun(sql: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
  );
  await db.exec(sql);
  await db.exec(sql); // idempotent re-run
  return db;
}

async function catalog(db: PGlite) {
  const tables = await db.query(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns where table_schema='public'
       order by table_name, ordinal_position`
  );
  const fns = await db.query(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' order by p.proname, args`
  );
  const trg = await db.query(
    `select trigger_name, event_object_table from information_schema.triggers
       where trigger_schema='public' order by trigger_name`
  );
  const idx = await db.query(
    `select indexname from pg_indexes where schemaname='public' order by indexname`
  );
  const rls = await db.query(
    `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' order by c.relname`
  );
  const seeds = await db.query(
    `select (select count(*) from system_settings)::int as settings,
            (select count(*) from plans)::int as plans,
            (select count(*) from tasks)::int as tasks,
            (select count(*) from investment_packages)::int as packages,
            (select count(*) from withdrawal_methods)::int as wmethods,
            (select count(*) from promo_codes where code in ('TELEGRAM','WHATSAPP','WELCOME50'))::int as promos,
            (select count(*) from users where email='admin@taskearn.com')::int as admin,
            (select count(*) from wallets where user_id='b61lvha7tlz8ozkwl1dmezjcv')::int as adminwallet`
  );
  return {
    tables: JSON.stringify(tables.rows),
    fns: JSON.stringify(fns.rows),
    trg: JSON.stringify(trg.rows),
    idx: JSON.stringify(idx.rows),
    rls: JSON.stringify(rls.rows),
    seeds: JSON.stringify(seeds.rows[0]),
  };
}

async function j<T = any>(db: PGlite, q: string): Promise<T> {
  const res = await db.query(q);
  return res.rows[0] as T;
}

async function main() {
  console.log("1. Consolidated script — full execution, twice…");
  const c = await freshRun(consolidated);
  console.log("  ✓ executed cleanly both times (idempotent)");

  console.log("2. Equivalence vs canonical db/supabase-schema.sql (schema + seeds, BEFORE any fixtures)…");
  const k = await freshRun(canonical);
  const cc = await catalog(c);
  const kk = await catalog(k);
  assert(cc.tables === kk.tables, "identical tables+columns");
  assert(cc.fns === kk.fns, "identical function set+signatures");
  assert(cc.trg === kk.trg, "identical triggers");
  assert(cc.idx === kk.idx, "identical indexes");
  assert(cc.rls === kk.rls, "identical RLS flags");
  assert(cc.seeds === kk.seeds, "identical seed row counts");

  console.log("3. Section-15 behavior suite on the consolidated script…");
  await c.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values ('inv','Inviter','inv@x.com','ph','user','INV001'),('mem','Member','mem@x.com','ph','user','MEM001')"
  );
  await c.exec("update users set referred_by_id='inv' where id='mem'");
  await c.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('inv', 100, 0),('mem', 5000, 0)");
  await c.exec(
    "insert into investment_packages (id, title, price, daily_earning, duration_days, total_return, net_profit) values ('pkg1','Pro Plan',1000,50,30,1500,500)"
  );

  const home = await j<any>(c, "select public.api_home_data('mem') as v");
  assert(home.v.whatsapp && home.v.whatsapp.enabled === true && home.v.telegram.enabled === true, "home whatsapp/telegram blocks with enabled flags");

  await c.exec("update system_settings set value='80' where key='home_whatsapp_reward'");
  const claim = await j<any>(c, "select public.api_claim_promo('mem','WHATSAPP') as v");
  assert(claim.v.reward === 80, "WHATSAPP claim pays live setting amount");
  const memW = await j<any>(c, "select withdrawable_balance as w from wallets where user_id='mem'");
  assert(memW.w === 80, "whatsapp reward credited to withdrawable");

  await c.exec("update system_settings set value='false' where key='home_telegram_enabled'");
  const tgOff = await j<any>(c, "select public.api_claim_telegram('mem') as v");
  assert(tgOff.v.error === "The Telegram reward is currently disabled.", "telegram enabled gate enforced");
  await c.exec("update system_settings set value='true' where key='home_telegram_enabled'");

  const purchase = await j<any>(c, "select public.api_purchase_package('mem','pkg1') as v");
  assert(purchase.v.ok === true, "balance purchase ok");
  const invW = await j<any>(c, "select withdrawable_balance as w from wallets where user_id='inv'");
  assert(invW.w === 500, "inviter commission (50% of 1000) credited to withdrawable");
  const comm = await j<any>(c, "select count(*)::int as n from transactions where type='referral_commission' and user_id='inv'");
  assert(comm.n === 1, "exactly one commission row");

  // Task 38: same-IP/fingerprint referrals must still pay (root-cause fix)
  await c.exec("update users set ip_address='1.2.3.4', fingerprint='same-device' where id in ('inv','mem')");
  await c.exec(
    "insert into transactions (user_id, type, amount, status, description, meta) values ('mem','package_purchase',1000,'pending','Payment 2', jsonb_build_object('packageId','pkg1','packageTitle','Pro Plan','purpose','package','paymentMethod','EasyPaisa','txId','TXN22233344'))"
  );
  const pend = await j<{ id: string }>(c, "select id from transactions where type='package_purchase' and status='pending' limit 1");
  await j<any>(c, `select public.api_process_deposit('${pend.id}','approve',null,'Admin') as v`);
  const invW2 = await j<any>(c, "select withdrawable_balance as w from wallets where user_id='inv'");
  assert(invW2.w === 1000, "same-IP commission PAID (+500 → 1000) — Task 38 root-cause fix");

  // Task 38: withdrawal policy — min Rs 20, cap = MIN(task, withdrawable)
  const wd0 = await j<any>(c, "select public.api_request_withdrawal('inv', 19, 'easypaisa', '03001234567') as v");
  assert(wd0.v.error === "Minimum withdrawal is Rs 20.", "below-minimum (19) rejected");
  const wd1 = await j<any>(c, "select public.api_request_withdrawal('inv', 200, 'easypaisa', '03001234567') as v");
  assert(wd1.v.error === "Withdrawal amount exceeds your Task Balance.", "above task-balance (200 > 100) rejected");
  const wd2 = await j<any>(c, "select public.api_request_withdrawal('inv', 100, 'easypaisa', '03001234567') as v");
  assert(wd2.v.ok === true, "request of 100 (≤ task 100, ≤ withdrawable 1000) accepted");
  const invW3 = await j<any>(c, "select task_balance as t, withdrawable_balance as w from wallets where user_id='inv'");
  assert(invW3.t === 100 && invW3.w === 900, "only withdrawable deducted (900), task balance untouched (100)");

  console.log("\nCONSOLIDATED SCRIPT FULLY VALIDATED");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
