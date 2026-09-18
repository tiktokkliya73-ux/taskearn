/**
 * One-off validation harness for the Daily Package Tasks section (section 13)
 * of db/supabase-schema.sql — runs the WHOLE script through PGlite
 * (Postgres-WASM) twice (idempotency) and asserts the package-task engine:
 * ONE daily task card for the member (the applicable active instance = the
 * package with the highest admin-configured daily_earning; never one card per
 * package, never summed), reward = the package's LIVE admin config (Admin
 * edits apply instantly), member-level ONE-claim-per-day guard, ownership /
 * active gates, the server-side timer check, the same-day duplicate guard via
 * last_earning_date (shared with the nightly earnings engine → no double
 * credit), wallet credit + daily_earning ledger row, and service-role-only
 * grants.
 * Run: bun scripts/validate-package-tasks-sql.ts
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
  console.log("1. Running full schema script (twice)…");
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  await db.exec(sql);
  await db.exec(sql); // idempotent re-run
  console.log("  ✓ script executed cleanly both times (incl. re-run idempotency)");

  console.log("2. package_task_logs table + unique key…");
  const cols = await db.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='package_task_logs'`
  );
  const names = cols.rows.map((r: any) => r.column_name);
  for (const c of ["id", "user_id", "user_package_id", "date", "started_at", "completed_at", "reward_amount", "created_at"]) {
    assert(names.includes(c), `column ${c} exists`);
  }
  const rls = await j<{ n: number }>(
    `select count(*)::int as n from pg_tables where schemaname='public' and tablename='package_task_logs' and rowsecurity=true`
  );
  assert(rls.n === 1, "RLS enabled on package_task_logs (no policies → default deny)");
  const uq = await j<{ n: number }>(
    `select count(*)::int as n from pg_indexes
     where schemaname='public' and tablename='package_task_logs' and indexdef like '%UNIQUE%(user_id, user_package_id, date)%'`
  );
  assert(uq.n === 1, "unique (user_id, user_package_id, date) index");

  console.log("3. Fixtures (members, packages, instances, content task)…");
  await db.exec(
    `insert into users (id, name, email, password_hash, role, referral_code) values
     ('m1','Member One','m1@x.com','ph','user','MEMONE'),
     ('m2','Member Two','m2@x.com','ph','user','MEMTWO')`
  );
  await db.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('m1', 100, 500)");
  await db.exec(
    `insert into investment_packages (id, title, price, daily_earning, duration_days, total_return, net_profit, is_active, sort_order)
     values ('pk1','Standard Plan',5000,900,30,27000,22000,true,1),
            ('pk2','Mini Plan',300,100,365,36500,36200,true,2)`
  );
  // m1 holds TWO active instances (one per package) + one EXPIRED instance +
  // one COMPLETED instance — the Ads page must still show exactly ONE task.
  await db.exec(
    `insert into user_packages (id, user_id, package_id, invest_amount, daily_earning, status, started_at, ends_at) values
     ('upk1','m1','pk1',5000,900,'active', now() - interval '2 days', now() + interval '28 days'),
     ('upk2','m1','pk2',300,100,'active', now() - interval '1 day', now() + interval '364 days'),
     ('upkX','m1','pk2',300,100,'active', now() - interval '40 days', now() - interval '5 days'),
     ('upkC','m1','pk2',300,100,'completed', now() - interval '40 days', now() + interval '5 days')`
  );
  // The admin-configured content: lowest sort_order wins; t2 must NOT be it.
  // (Deactivate the schema's own seeded tasks so the fixtures are the only
  // active content rows — deterministic first-active-task selection.)
  await db.exec("update tasks set is_active = false");
  await db.exec(
    `insert into tasks (id, title, url, duration_seconds, reward_amount, plan_id, is_active, sort_order) values
     ('t1','Watch Sponsored Video','https://ads.example.com/a',10,null,null,true,1),
     ('t2','Other Task','https://ads.example.com/b',30,null,null,true,2)`
  );

  console.log("4. api_package_tasks_list — ONE task card, reward from the applicable package…");
  const list = await j<any>("select public.api_package_tasks_list('m1') as v");
  assert(Array.isArray(list.v.tasks) && list.v.tasks.length === 1,
    "exactly ONE card (NOT one per active package; expired + completed excluded)");
  const card = list.v.tasks[0];
  assert(card.id === "upk1", "the applicable instance = highest package daily_earning (Standard 900 > Mini 100)");
  assert(card.packageTitle === "Standard Plan" && card.reward === 900, "card: Standard Plan, REWARD Rs 900 (live admin config)");
  assert(card.claimedToday === false, "nothing claimed yet");
  assert(card.startedAt === null, "no startedAt before starting");
  assert(list.v.content.id === "t1" && list.v.content.url === "https://ads.example.com/a", "content = first active task (t1)");
  assert(list.v.content.durationSeconds === 10, "content durationSeconds 10 (drives the countdown)");
  const empty = await j<any>("select public.api_package_tasks_list('m2') as v");
  assert(empty.v.tasks.length === 0, "member without packages gets an empty task list");
  const stranger = await j<any>("select public.api_package_tasks_list('nobody') as v");
  assert(stranger.v.tasks.length === 0, "unknown member → empty task list, no error");

  // Tie-break: two instances of the SAME package → the newest purchase wins.
  await db.exec(
    `insert into user_packages (id, user_id, package_id, invest_amount, daily_earning, status, started_at, ends_at)
     values ('upkT','m1','pk1',5000,900,'active', now() - interval '1 hour', now() + interval '30 days')`
  );
  const tie = await j<any>("select public.api_package_tasks_list('m1') as v");
  assert(tie.v.tasks.length === 1 && tie.v.tasks[0].id === "upkT",
    "same-package tie-break: newest purchase is the applicable instance");
  await db.exec("delete from user_packages where id='upkT'");

  console.log("5. Ownership + foreign-package gates…");
  const notOwned = await j<any>("select public.api_start_package_task('m2','upk1') as v");
  assert(notOwned.v.error === "Package not found.", "m2 cannot start m1's package task");
  const expired = await j<any>("select public.api_start_package_task('m1','upkX') as v");
  assert(expired.v.error === "This package is no longer active.", "expired instance rejected");
  const completed = await j<any>("select public.api_start_package_task('m1','upkC') as v");
  assert(completed.v.error === "This package is no longer active.", "completed instance rejected");

  console.log("6. Timer enforcement (server-side countdown)…");
  const started = await j<any>("select public.api_start_package_task('m1','upk1') as v");
  assert(started.v.ok === true && typeof started.v.startedAt === "string", "the daily task started");
  const midList = await j<any>("select public.api_package_tasks_list('m1') as v");
  assert(midList.v.tasks.length === 1 && midList.v.tasks[0].startedAt != null,
    "list reflects the server-registered countdown anchor (resume support)");
  const tooEarly = await j<any>("select public.api_complete_package_task('m1','upk1') as v");
  assert(tooEarly.v.error === "Please wait for the timer to finish.", "claim before the 10s timer is rejected");
  const unstarted = await j<any>("select public.api_complete_package_task('m1','upk2') as v");
  assert(unstarted.v.error === "Start the task first.", "claim without starting is rejected");
  // idempotent start keeps the original anchor
  const again = await j<any>("select public.api_start_package_task('m1','upk1') as v");
  assert(again.v.startedAt === started.v.startedAt, "re-start is idempotent (same startedAt)");

  console.log("7. THE CLAIM — reward, wallet credit, log, ledger, marker…");
  await db.exec(
    "update package_task_logs set started_at = now() - interval '11 seconds' where user_package_id='upk1'"
  );
  const claim = await j<any>("select public.api_complete_package_task('m1','upk1') as v");
  assert(claim.v.ok === true, "claim succeeds");
  assert(claim.v.reward === 900, "reward = the package's live daily_earning (900), never client input");
  assert(claim.v.wallet.taskBalance === 1000 && claim.v.wallet.withdrawableBalance === 500,
    "credited to the MAIN task balance 100 + 900 = 1000 (Task 33: task earnings are never auto-withdrawable)");
  const log = await j<{ r: number; c: boolean }>(
    "select reward_amount as r, completed_at is not null as c from package_task_logs where user_package_id='upk1'"
  );
  assert(log.r === 900 && log.c === true, "package_task_logs row records completion + reward 900");
  const marker = await j<{ d: string }>("select last_earning_date as d from user_packages where id='upk1'");
  const today = new Date().toISOString().slice(0, 10);
  assert(marker.d === today, "user_packages.last_earning_date = today (claimed-today marker set)");
  const txn = await j<{ t: string; a: number; s: string; d: string }>(
    "select type as t, amount as a, status as s, description as d from transactions where user_id='m1' and type='daily_earning'"
  );
  assert(txn.t === "daily_earning" && txn.a === 900 && txn.s === "completed", "daily_earning ledger row +900 completed");
  assert(txn.d === "Daily task reward — Standard Plan", "ledger description carries the package title");

  console.log("8. ONE-claim-per-day duplicate guards (member-level, DB-persisted)…");
  const dupComplete = await j<any>("select public.api_complete_package_task('m1','upk1') as v");
  assert(dupComplete.v.error === "You already claimed this task today.", "second claim on the same instance rejected");
  const dupOtherComplete = await j<any>("select public.api_complete_package_task('m1','upk2') as v");
  assert(dupOtherComplete.v.error === "You already claimed today's task.",
    "claim via ANOTHER active package the same day rejected (ONE daily task per member)");
  const dupOtherStart = await j<any>("select public.api_start_package_task('m1','upk2') as v");
  assert(dupOtherStart.v.error === "You already claimed today's task.",
    "starting another package's task after claiming today rejected");
  const dupStart = await j<any>("select public.api_start_package_task('m1','upk1') as v");
  assert(dupStart.v.error === "This task is already completed today.", "re-start after claim rejected");
  const claimedList = await j<any>("select public.api_package_tasks_list('m1') as v");
  assert(claimedList.v.tasks.length === 1 && claimedList.v.tasks[0].claimedToday === true,
    "the single card shows claimedToday (state persisted in the DB)");

  console.log("9. Nightly-engine interlock — a claimed instance is skipped by the cron…");
  // run_daily_earnings credits every ACTIVE instance whose last_earning_date
  // is not today; upk1 was claimed above, so only upk2 (Rs 100) must credit.
  const cron = await j<any>("select public.api_run_daily_earnings() as v");
  assert(cron.v.totalCredited === 100, "cron credits ONLY the unclaimed instance (no double pay)");
  const afterCron = await j<any>("select public.api_package_tasks_list('m1') as v");
  assert(afterCron.v.tasks.length === 1 && afterCron.v.tasks[0].claimedToday === true,
    "the card still shows claimedToday after claim + cron (DB state)");
  const postCron = await j<any>("select public.api_start_package_task('m1','upk2') as v");
  assert(postCron.v.error === "This task is already completed today.", "cron-credited instance cannot be started either");

  console.log("10. Admin edits apply instantly (TEST C) + fresh member full flow (TEST A)…");
  await db.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('m2', 0, 0)");
  await db.exec(
    `insert into user_packages (id, user_id, package_id, invest_amount, daily_earning, status, started_at, ends_at)
     values ('upm2','m2','pk2',300,100,'active', now() - interval '1 day', now() + interval '364 days')`
  );
  const before = await j<any>("select public.api_package_tasks_list('m2') as v");
  assert(before.v.tasks.length === 1 && before.v.tasks[0].reward === 100,
    "fresh member with the Mini package: ONE card, Rs 100");
  // Admin edits the package's daily earning 100 → 150 in the existing config.
  await db.exec("update investment_packages set daily_earning = 150 where id = 'pk2'");
  const edited = await j<any>("select public.api_package_tasks_list('m2') as v");
  assert(edited.v.tasks.length === 1 && edited.v.tasks[0].reward === 150,
    "after the Admin edit the SAME card shows Rs 150 (live config, no code change)");
  // Full flow for m2 — start, wait, claim.
  const m2Start = await j<any>("select public.api_start_package_task('m2','upm2') as v");
  assert(m2Start.v.ok === true, "m2 starts the task (countdown anchor registered)");
  await db.exec(
    "update package_task_logs set started_at = now() - interval '11 seconds' where user_package_id='upm2'"
  );
  const m2Claim = await j<any>("select public.api_complete_package_task('m2','upm2') as v");
  assert(m2Claim.v.ok === true && m2Claim.v.reward === 150,
    "claim pays the CURRENT config (Rs 150), not the Rs 100 purchase snapshot");
  assert(m2Claim.v.wallet.taskBalance === 150, "Rs 150 credited to the MAIN task balance (Task 33 semantics)");
  const m2Dup = await j<any>("select public.api_complete_package_task('m2','upm2') as v");
  assert(m2Dup.v.error === "You already claimed this task today.", "m2 duplicate claim rejected");
  // m2 activates a HIGHER package afterwards — still ONE card, now the Standard
  // one, and still claimed-today (member-level state, selection follows config).
  await db.exec(
    `insert into user_packages (id, user_id, package_id, invest_amount, daily_earning, status, started_at, ends_at)
     values ('upm2b','m2','pk1',5000,900,'active', now() - interval '1 hour', now() + interval '30 days')`
  );
  const shifted = await j<any>("select public.api_package_tasks_list('m2') as v");
  assert(shifted.v.tasks.length === 1 && shifted.v.tasks[0].id === "upm2b" && shifted.v.tasks[0].reward === 900,
    "after activating a higher package: still ONE card, now Standard Rs 900");
  assert(shifted.v.tasks[0].claimedToday === true, "already claimed today — stays claimed (member-level marker)");
  const shiftedStart = await j<any>("select public.api_start_package_task('m2','upm2b') as v");
  assert(shiftedStart.v.error === "You already claimed today's task.",
    "cannot claim the new higher package the same day (ONE claim per day)");

  console.log("11. No content configured → tasks unavailable…");
  await db.exec("update tasks set is_active = false");
  const noContent = await j<any>("select public.api_package_tasks_list('m1') as v");
  assert(noContent.v.content === null, "content null when the admin disables every task");
  const noContentStart = await j<any>("select public.api_start_package_task('m1','upk1') as v");
  assert(noContentStart.v.error === "Task content is not available. Please try again later.", "start rejected without content");
  await db.exec("update tasks set is_active = true");

  console.log("12. Functions hardened (service-role only)…");
  const perms = await db.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can,
            has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
            has_function_privilege('service_role', p.oid, 'execute') as svc_can
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('api_package_tasks_list','api_start_package_task','api_complete_package_task')`
  );
  assert(perms.rows.length === 3, "all three RPCs present");
  assert(perms.rows.every((r: any) => r.anon_can === false && r.auth_can === false), "anon + authenticated cannot execute");
  assert(perms.rows.every((r: any) => r.svc_can === true), "service_role can execute all three");

  console.log("\nALL DAILY-PACKAGE-TASKS (SECTION 13) ASSERTIONS PASSED ✅");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e);
  process.exit(1);
});
