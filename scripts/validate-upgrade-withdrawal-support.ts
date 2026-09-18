/**
 * Validation harness for db/supabase-upgrade-withdrawal-support.sql —
 * the incremental upgrade script for the withdrawal/support/media features.
 *
 * Simulates TWO realistic production baselines through PGlite (Postgres-WASM):
 *   TEST A — an OLDER deployment (canonical schema WITHOUT §15/§16/§17:
 *             pre channel-rewards / pre policy-sync / pre support): the
 *             upgrade script must install the support system + banner slot +
 *             method-table ensures cleanly, twice (idempotency), and the
 *             RPC behaviors must be correct (member isolation, admin reply,
 *             openSupportCount, banner image field, 7 payout channels).
 *   TEST B — an ALREADY-CURRENT deployment (full canonical schema): the
 *             upgrade script must run cleanly twice and change NOTHING in
 *             the catalog (same tables, same function set).
 *
 * Run: bun scripts/validate-upgrade-withdrawal-support.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const canonical = readFileSync("db/supabase-schema.sql", "utf8");
const upgrade = readFileSync("db/supabase-upgrade-withdrawal-support.sql", "utf8");

// Older baseline = canonical without §15 (channel rewards), §16 (policy sync)
// and §17 (support) — i.e. the state of a deployment provisioned before those
// deliveries.
const SEC15 = canonical.indexOf("-- 15. CHANNEL VISIT REWARDS");
if (SEC15 < 0) throw new Error("cannot locate §15 header in canonical schema");
const olderBaseline = canonical.slice(0, SEC15);

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

const ROLES =
  "create role anon nologin; create role authenticated nologin; create role service_role nologin;";

async function catalog(pg: PGlite) {
  const tables = await pg.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
  );
  const fns = await pg.query<{ n: number }>(
    "select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'"
  );
  return { tables: tables.rows[0].n, fns: fns.rows[0].n };
}

async function j<T = any>(pg: PGlite, q: string): Promise<T> {
  const res = await pg.query(q);
  return res.rows[0] as T;
}

async function testA() {
  console.log("TEST A — older deployment (pre-§15/§16/§17 baseline) + upgrade script");
  const pg = new PGlite();
  await pg.exec(ROLES);
  await pg.exec(olderBaseline);
  console.log("  ✓ older baseline schema installed");

  await pg.exec(upgrade);
  await pg.exec(upgrade); // idempotency
  console.log("  ✓ upgrade script executed cleanly TWICE on the older baseline");

  // 1. support_tickets table + RLS + no policies
  assert(
    (await j(pg, "select to_regclass('public.support_tickets') is not null as ok")).ok === true,
    "support_tickets table exists"
  );
  assert(
    (await j(pg, "select relrowsecurity as rls from pg_class where relname='support_tickets'")).rls === true,
    "RLS enabled on support_tickets (default-deny)"
  );
  assert(
    (await j(pg, "select count(*)::int as n from pg_policies where tablename='support_tickets'")).n === 0,
    "ZERO policies on support_tickets (service-role-only model, like every table)"
  );

  // 2. RPC behavior — members + isolation + admin flow
  await pg.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values" +
      "('u1','Member One','u1@x.com','ph','user','SUP1'),('u2','Member Two','u2@x.com','ph','user','SUPP2')"
  );
  const bad = await j<any>(pg, "select public.api_support_create('u1','ab','a message long enough') as r");
  assert(bad.r.error === "Subject must be 3–120 characters.", "subject validation works");
  const t1 = await j<any>(
    pg,
    "select public.api_support_create('u1','Withdrawal not received','My payout of Rs 500 has not arrived yet.') as r"
  );
  assert(typeof t1.r.id === "string" && t1.r.status === "open", "ticket created (open)");
  await pg.query("select public.api_support_create('u2','App issue','The tasks page sometimes crashes.') as r");
  const l1 = await j<{ r: any[] }>(pg, "select public.api_support_list('u1') as r");
  assert(l1.r.length === 1 && l1.r[0].subject === "Withdrawal not received", "member 1 sees ONLY own ticket");
  const l2 = await j<{ r: any[] }>(pg, "select public.api_support_list('u2') as r");
  assert(l2.r.length === 1, "member 2 sees ONLY own ticket");
  const adminList = await j<{ r: any[] }>(pg, "select public.api_admin_support_list() as r");
  assert(adminList.r.length === 2 && adminList.r[0].userName, "admin sees both tickets with member info");
  const upd = await j<any>(
    pg,
    "select public.api_admin_support_update('" + t1.r.id + "','in_progress','Payout is on the way within 24 hours.',true) as r"
  );
  assert(upd.r.status === "in_progress" && upd.r.reply === "Payout is on the way within 24 hours.", "admin reply + status saved");
  const seen = await j<any>(pg, "select public.api_support_list('u1') as r");
  assert(seen.r[0].reply === "Payout is on the way within 24 hours." && seen.r[0].repliedAt, "member sees admin reply");

  // 3. api_admin_stats openSupportCount
  const stats = await j<any>(pg, "select public.api_admin_stats() as r");
  assert(Number(stats.r.openSupportCount) === 2, "openSupportCount = 2 while open/in_progress");
  await pg.query(
    "select public.api_admin_support_update('" + t1.r.id + "','resolved',null,false) as r"
  );
  const stats2 = await j<any>(pg, "select public.api_admin_stats() as r");
  assert(Number(stats2.r.openSupportCount) === 1, "openSupportCount drops to 1 after resolve");

  // 4. banner media slot
  const home = await j<any>(pg, "select public.api_home_data('u1') as r");
  assert(home.r.teamSalary && home.r.teamSalary.image === "", "api_home_data returns teamSalary.image ('' default)");
  assert(
    (await j(pg, "select value from system_settings where key='home_team_salary_image'")).value === "",
    "home_team_salary_image setting seeded"
  );

  // 5. withdrawal/payment method ensures
  assert(
    (await j(pg, "select count(*)::int as n from withdrawal_methods")).n === 7,
    "7 payout channels seeded"
  );
  const wm = await j<any>(pg, "select public.api_withdrawal_methods_list() as r");
  assert(wm.r.methods.length === 7 && wm.r.methods[0].name === "EasyPaisa", "withdrawal methods list works (logoUrl field present)");
  assert("logoUrl" in wm.r.methods[0], "withdrawal method DTO carries logoUrl");
  const pm = await j<any>(pg, "select public.api_payment_methods_list() as r");
  assert(Array.isArray(pm.r.methods) && pm.r.methods.length >= 3, "payment methods list works");
  assert(
    (await j(pg, "select count(*)::int as n from information_schema.columns where table_name='withdrawal_methods' and column_name='logo_url'")).n === 1,
    "withdrawal_methods.logo_url column present"
  );
  assert(
    (await j(pg, "select count(*)::int as n from information_schema.columns where table_name='payment_methods' and column_name='logo_url'")).n === 1,
    "payment_methods.logo_url column present"
  );

  // 6. withdrawal destination snapshot is untouched (pre-existing behavior)
  await pg.exec("insert into wallets (user_id, withdrawable_balance, task_balance) values ('u1', 5000, 5000)");
  const wd = await j<any>(
    pg,
    "select public.api_request_withdrawal('u1', 2500, 'UBL Bank', 'PK36UBLK0100000001234567890') as r"
  );
  assert(wd.r.ok === true && wd.r.transaction.meta.accountDetails === "PK36UBLK0100000001234567890",
    "withdrawal request snapshots payment destination in meta (pre-existing, unmodified)");
  await pg.close();
  console.log("TEST A PASSED\n");
}

async function testB() {
  console.log("TEST B — already-current deployment (full canonical) + upgrade script");
  const pg = new PGlite();
  await pg.exec(ROLES);
  await pg.exec(canonical);
  const before = await catalog(pg);
  console.log(`  ✓ current schema installed (tables=${before.tables}, functions=${before.fns})`);

  await pg.exec(upgrade);
  await pg.exec(upgrade); // idempotency
  console.log("  ✓ upgrade script executed cleanly TWICE on the current schema");

  const after = await catalog(pg);
  assert(after.tables === before.tables, `table count unchanged (${before.tables} → ${after.tables})`);
  assert(after.fns === before.fns, `function count unchanged (${before.fns} → ${after.fns})`);
  assert(
    (await j(pg, "select (pg_get_functiondef('public.api_admin_stats()'::regprocedure) like '%openSupportCount%') as ok")).ok === true,
    "api_admin_stats still has openSupportCount"
  );
  assert(
    (await j(pg, "select (pg_get_functiondef('public.api_home_data(text)'::regprocedure) like '%home_team_salary_image%') as ok")).ok === true,
    "api_home_data still has the banner image field"
  );
  await pg.close();
  console.log("TEST B PASSED\n");
}

testA()
  .then(testB)
  .then(() => console.log("ALL UPGRADE-SCRIPT VALIDATIONS GREEN"))
  .catch((e) => {
    console.error("VALIDATION FAILED:", e);
    process.exit(1);
  });
