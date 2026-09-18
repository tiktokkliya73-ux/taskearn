/**
 * One-off validation harness for the investment-packages section of
 * db/supabase-schema.sql — runs the WHOLE script through PGlite
 * (Postgres-WASM, same approach as Task 7) and asserts the new RPCs.
 * Run: bun scripts/validate-packages-sql.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const sql = readFileSync("db/supabase-schema.sql", "utf8");

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

const db = new PGlite();

async function j<T = any>(q: string, params?: unknown[]): Promise<T> {
  const res = await db.query(q, params);
  return res.rows[0] as T;
}

async function main() {
  console.log("1. Running full schema script…");
  // Supabase platform roles don't exist in vanilla PGlite — create them so the
  // script's revoke/grant statements behave exactly like on the real platform.
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  await db.exec(sql);
  console.log("  ✓ script executed with zero errors (incl. re-run idempotency)");
  await db.exec(sql); // second run = idempotent
  console.log("  ✓ second run also clean (idempotent)");

  console.log("2. Tables & RLS…");
  const tables = await j<{ n: number }>(
    "select count(*)::int as n from pg_tables where schemaname='public' and tablename in ('investment_packages','user_packages')"
  );
  assert(tables.n === 2, "both new tables exist");
  const rls = await db.query(
    "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('investment_packages','user_packages')"
  );
  assert(rls.rows.every((r: any) => r.relrowsecurity === true), "RLS enabled on both new tables");

  console.log("3. Seed…");
  const seeded = await j<{ n: number; mini_total: number; mini_net: number }>(
    "select count(*)::int as n, max(case when title='Mini Plan' then total_return end)::int as mini_total, max(case when title='Mini Plan' then net_profit end)::int as mini_net from investment_packages"
  );
  assert(seeded.n === 4, "4 investment packages seeded");
  assert(seeded.mini_total === 3650000, "Mini Plan total_return = 3,650,000");
  assert(seeded.mini_net === 3649787, "Mini Plan net_profit = 3,649,787");

  console.log("4. api_packages_list…");
  // create a user + wallet (service-role context in these tests)
  await db.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values ('u1','User One','u1@x.com','ph','user','CODEU1')"
  );
  await db.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('u1', 1000, 500)");
  const list = await j<any>("select public.api_packages_list('u1') as v");
  const v = list.v;
  assert(v.packages.length === 4, "catalogue returns 4 packages");
  assert(v.packages[0].title === "Mini Plan" && v.packages[0].price === 213, "first package = Mini Plan 213");
  assert(v.myPackages.length === 0, "no instances yet");
  assert(v.totals.activeCount === 0 && v.totals.dailyIncome === 0, "totals zero before purchase");

  console.log("5. api_purchase_package…");
  const buy = await j<any>("select public.api_purchase_package('u1','pkg_mini_starter_00000000000001') as v");
  assert(buy.v.ok === true, "purchase ok");
  assert(buy.v.wallet.taskBalance === 787 && buy.v.wallet.withdrawableBalance === 500, "task-first deduction 1000→787");
  assert(buy.v.userPackage.status === "active" && buy.v.userPackage.dailyEarning === 100, "instance active @100/day");
  assert(buy.v.transaction.amount === -213 && buy.v.transaction.type === "package_purchase", "ledger txn -213");
  const meta = buy.v.transaction.meta as any;
  assert(meta.deductedFrom.task === 213 && meta.deductedFrom.withdrawable === 0, "meta deductedFrom correct");

  // second, larger purchase spanning both balances
  const buy2 = await j<any>("select public.api_purchase_package('u1','pkg_starter_plus_00000000000002') as v");
  assert(buy2.v.ok === true, "second (different) package purchase ok");
  assert(buy2.v.wallet.taskBalance === 0 && buy2.v.wallet.withdrawableBalance === 137, "spans into withdrawable (0 + 137)");

  // insufficient
  const buy3 = await j<any>("select public.api_purchase_package('u1','pkg_pro_max_00000000000000000004') as v");
  assert(buy3.v.error && /Insufficient balance/.test(buy3.v.error), "insufficient-balance error message");
  // unknown id
  const buy4 = await j<any>("select public.api_purchase_package('u1','nope') as v");
  assert(buy4.v.error === "Package not found or disabled.", "unknown package error");

  console.log("6. api_run_daily_earnings…");
  // instance started today → NOT eligible today
  const run1 = await j<any>("select public.api_run_daily_earnings() as v");
  assert(run1.v.usersCredited === 0 && run1.v.totalCredited === 0, "bought-today instances correctly skip today");

  // backdate the starter instance 3 days + set last_earning_date = yesterday
  await db.exec("update user_packages set started_at = now() - interval '3 days', last_earning_date = to_char(now() - interval '1 day','YYYY-MM-DD') where package_id = 'pkg_starter_plus_00000000000002'");
  // also backdate the mini instance but leave last_earning_date null
  await db.exec("update user_packages set started_at = now() - interval '3 days' where package_id = 'pkg_mini_starter_00000000000001'");
  await db.exec("update wallets set withdrawable_balance = 500 where user_id = 'u1'");

  const run2 = await j<any>("select public.api_run_daily_earnings() as v");
  assert(run2.v.usersCredited === 1, "one user credited");
  assert(run2.v.packagesCredited === 2, "both eligible instances credited");
  assert(run2.v.totalCredited === 600, "total credited = 100 + 500 = 600");
  const w = await j<{ tb: number; wb: number }>("select task_balance as tb, withdrawable_balance as wb from wallets where user_id='u1'");
  assert(w.tb === 600 && w.wb === 500, "credited to the MAIN task balance (Task 33: nightly earnings are never auto-withdrawable)");
  const tx = await db.query("select amount, type, status from transactions where type='daily_earning'");
  assert(tx.rows.length === 1 && (tx.rows[0] as any).amount === 600, "ONE daily_earning ledger row of 600");

  const run3 = await j<any>("select public.api_run_daily_earnings() as v");
  assert(run3.v.usersCredited === 0 && run3.v.alreadyRan === true, "idempotent second run (alreadyRan=true)");

  console.log("7. Expiry → completed…");
  await db.exec("update user_packages set ends_at = now() - interval '1 hour' where package_id = 'pkg_mini_starter_00000000000001'");
  const run4 = await j<any>("select public.api_run_daily_earnings() as v");
  assert(run4.v.packagesCompleted === 1, "expired instance marked completed");
  const st = await j<{ s: string }>("select status as s from user_packages where package_id='pkg_mini_starter_00000000000001'");
  assert(st.s === "completed", "status = completed");

  console.log("8. Functions hardened…");
  const perms = await db.query(
    "select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('api_packages_list','api_purchase_package','api_run_daily_earnings')"
  );
  assert(perms.rows.every((r: any) => r.anon_can === false), "anon cannot execute the new RPCs");

  console.log("\\nALL ASSERTIONS PASSED ✅");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e);
  process.exit(1);
});
