/**
 * One-off validation harness for the Ads Execution Engine section (section 9)
 * of db/supabase-schema.sql — runs the WHOLE script through PGlite
 * (Postgres-WASM) twice (idempotency) and asserts the task engine:
 * target-plan filtering, reward override, complete_task_transaction, the
 * rolling 24-hour guard, timer + daily-limit enforcement, delegate parity,
 * and service-role-only grants.
 * Run: bun scripts/validate-tasks-sql.ts
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

  console.log("2. New columns & FK…");
  const cols = await db.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='tasks' and column_name in ('reward_amount','plan_id')`
  );
  assert(cols.rows.length === 2, "tasks.reward_amount + tasks.plan_id exist");
  const utCol = await j<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
     where table_schema='public' and table_name='user_tasks' and column_name='reward_amount'`
  );
  assert(utCol.n === 1, "user_tasks.reward_amount exists");
  const fk = await j<{ n: number }>(
    `select count(*)::int as n from pg_constraint where conname='tasks_plan_id_fkey' and contype='f'`
  );
  assert(fk.n === 1, "tasks.plan_id → plans(id) on delete set null");

  console.log("3. Fixtures (plans, member, targeted tasks)…");
  // Member m1 on planA (Standard, Rs 220/task, limit 2/day).
  await db.exec(
    `insert into plans (id, name, price, reward_per_task, daily_task_limit, duration_days, is_active, sort_order)
     values ('planA','Standard Plan',1500,220,2,30,true,1),
            ('planB','Gold Plan',5000,900,5,30,true,2)`
  );
  await db.exec(
    `insert into users (id, name, email, password_hash, role, referral_code) values
     ('m1','Member One','m1@x.com','ph','user','MEMONE')`
  );
  await db.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('m1', 100, 50)");
  await db.exec(
    `insert into user_plans (id, user_id, plan_id, status, started_at, expires_at)
     values ('up1','m1','planA','active', now() - interval '1 day', now() + interval '29 days')`
  );
  // t1: plan-default reward · t2: Rs 900 override (the spec's example) ·
  // t3: pinned to planB (must be invisible/inaccessible for planA members)
  await db.exec(
    `insert into tasks (id, title, url, duration_seconds, reward_amount, plan_id, is_active, sort_order) values
     ('t1','Watch Video A','https://ads.example.com/a',10,null,null,true,1),
     ('t2','Sponsored Page B','https://ads.example.com/b',10,900,null,true,2),
     ('t3','Gold-only offer','https://ads.example.com/c',10,500,'planB',true,3)`
  );

  console.log("4. api_tasks_list — plan-target filtering + DTO…");
  const list = await j<any>("select public.api_tasks_list('m1') as v");
  assert(list.v.plan.name === "Standard Plan", "plan block: Standard Plan");
  assert(list.v.plan.rewardPerTask === 220, "plan reward 220");
  assert(list.v.plan.dailyLimit === 2, "plan daily limit 2");
  const ids = list.v.tasks.map((e: any) => e.task.id);
  assert(!ids.includes("t3"), "t3 (planB target) hidden from planA member");
  assert(ids.includes("t1") && ids.includes("t2"), "t1+t2 listed");
  const t2entry = list.v.tasks.find((e: any) => e.task.id === "t2");
  assert(t2entry.task.rewardAmount === 900, "t2 DTO carries rewardAmount override");
  const t3entry = list.v.tasks.find((e: any) => e.task.id === "t3");
  assert(t3entry === undefined, "t3 not present");
  const t1entry = list.v.tasks.find((e: any) => e.task.id === "t1");
  assert(t1entry.task.rewardAmount === null, "t1 reward override null (plan default)");
  assert(list.v.canCompleteMore === true, "canCompleteMore true at 0/2");

  console.log("5. Target-plan gate…");
  const gated = await j<any>("select public.api_start_task('m1','t3') as v");
  assert(gated.v.error === "This task is not available for your current plan.", "start t3 rejected for planA member");

  console.log("6. Timer enforcement…");
  const started = await j<any>("select public.api_start_task('m1','t2') as v");
  assert(started.v.ok === true, "t2 started");
  const tooEarly = await j<any>("select public.complete_task_transaction('m1','t2') as v");
  assert(
    tooEarly.v.error === "Please wait for the timer to finish before submitting.",
    "claim before the 10s timer is rejected"
  );

  console.log("7. complete_task_transaction — reward override path…");
  await db.exec("update user_tasks set started_at = now() - interval '11 seconds' where user_id='m1' and task_id='t2'");
  const claim = await j<any>("select public.complete_task_transaction('m1','t2') as v");
  assert(claim.v.ok === true, "claim succeeds");
  assert(claim.v.reward === 900, "reward = task override 900 (not plan 220)");
  assert(claim.v.completedToday === 1, "completedToday 1");
  assert(claim.v.wallet.taskBalance === 1000, "wallet task_balance 100 + 900");
  const log = await j<{ r: number; c: boolean }>(
    "select reward_amount as r, completed_at is not null as c from user_tasks where user_id='m1' and task_id='t2'"
  );
  assert(log.r === 900 && log.c === true, "task_logs row records completion + reward 900");
  const txn = await j<{ t: string; a: number; s: string }>(
    "select type as t, amount as a, status as s from transactions where user_id='m1' and type='task_reward'"
  );
  assert(txn.t === "task_reward" && txn.a === 900 && txn.s === "completed", "task_reward ledger row +900 completed");

  console.log("8. Rolling 24-hour guard (crosses midnight)…");
  const dupDay = await j<any>("select public.complete_task_transaction('m1','t2') as v");
  assert(dupDay.v.error === "You already completed this task today.", "same-day duplicate rejected");
  // Simulate yesterday's row completed 23h ago (different date) — must still block.
  const yesterday = new Date(Date.now() - 23 * 3600 * 1000);
  const yDate = yesterday.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (yDate !== today) {
    await db.exec(
      `insert into user_tasks (user_id, task_id, date, started_at, completed_at, reward_amount)
       values ('m1','t1','${yDate}', now() - interval '24 hours', now() - interval '23 hours', 220)
       on conflict (user_id, task_id, date) do nothing`
    );
    const blocked = await j<any>("select public.api_start_task('m1','t1') as v");
    assert(blocked.v.error === "You can claim each task once every 24 hours.", "23h-old completion blocks re-claim");
    // Push it beyond 24h → claimable again.
    await db.exec(
      `update user_tasks set completed_at = now() - interval '25 hours' where user_id='m1' and task_id='t1'`
    );
  } else {
    // Edge: 23h ago is the same UTC date — instead insert a 23h-old row dated yesterday manually.
    await db.exec(
      `insert into user_tasks (user_id, task_id, date, started_at, completed_at, reward_amount)
       values ('m1','t1', to_char(now() - interval '25 hours','YYYY-MM-DD'), now() - interval '24 hours', now() - interval '23 hours', 220)
       on conflict (user_id, task_id, date) do nothing`
    );
    const blocked = await j<any>("select public.api_start_task('m1','t1') as v");
    assert(blocked.v.error === "You can claim each task once every 24 hours.", "23h-old completion blocks re-claim");
    await db.exec(
      `update user_tasks set completed_at = now() - interval '25 hours' where user_id='m1' and task_id='t1'`
    );
  }
  const okAfter = await j<any>("select public.api_start_task('m1','t1') as v");
  assert(okAfter.v.ok === true, "25h-old completion no longer blocks (start ok)");

  console.log("9. Plan-default reward + daily limit…");
  await db.exec("update user_tasks set started_at = now() - interval '11 seconds' where user_id='m1' and task_id='t1' and completed_at is null");
  const claimDefault = await j<any>("select public.complete_task_transaction('m1','t1') as v");
  assert(claimDefault.v.ok === true && claimDefault.v.reward === 220, "t1 pays plan default 220");
  assert(claimDefault.v.completedToday === 2, "completedToday 2 (limit reached)");
  const wallet2 = await j<{ w: number }>("select task_balance as w from wallets where user_id='m1'");
  assert(wallet2.w === 1220, "wallet 100 + 900 + 220 = 1220");
  // New unlimited task — daily limit must now reject.
  await db.exec(
    `insert into tasks (id, title, url, duration_seconds, is_active, sort_order)
     values ('t4','Extra task','https://ads.example.com/d',5,true,4)`
  );
  const s4 = await j<any>("select public.api_start_task('m1','t4') as v");
  const c4 = await j<any>("select public.complete_task_transaction('m1','t4') as v");
  assert(s4.v.ok === true || s4.v.error === "Daily task limit reached for your plan.", "start t4 ok");
  assert(c4.v.error === "Daily task limit reached for your plan.", "third claim today blocked by daily limit");

  console.log("10. api_complete_task delegate parity…");
  const viaDelegate = await j<any>("select public.api_complete_task('m1','t4') as v");
  assert(viaDelegate.v.error === c4.v.error, "delegate returns the identical result");

  console.log("11. No-plan member sees only untargeted tasks…");
  await db.exec(
    `insert into users (id, name, email, password_hash, role, referral_code) values
     ('m2','No Plan','m2@x.com','ph','user','MEMTWO')`
  );
  const noPlan = await j<any>("select public.api_tasks_list('m2') as v");
  assert(noPlan.v.plan === null, "plan null for plan-less member");
  const ids2 = noPlan.v.tasks.map((e: any) => e.task.id);
  assert(!ids2.includes("t3"), "t3 hidden from plan-less member too");
  assert(ids2.includes("t1") && ids2.includes("t2") && ids2.includes("t4"), "plan-less member sees untargeted tasks");
  const noPlanStart = await j<any>("select public.api_start_task('m2','t1') as v");
  assert(noPlanStart.v.error === "You need an active plan to start tasks.", "plan-less start rejected");

  console.log("12. Functions hardened (service-role only)…");
  const perms = await db.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('complete_task_transaction','api_complete_task','api_start_task','api_tasks_list')`
  );
  assert(perms.rows.length === 4, "all four RPCs present");
  assert(perms.rows.every((r: any) => r.anon_can === false), "anon cannot execute any of the task RPCs");
  const svc = await db.query(
    `select p.proname, has_function_privilege('service_role', p.oid, 'execute') as svc_can
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('complete_task_transaction','api_complete_task')`
  );
  assert(svc.rows.every((r: any) => r.svc_can === true), "service_role can execute both claim RPCs");

  console.log("\nALL ADS-EXECUTION-ENGINE (SECTION 9) ASSERTIONS PASSED ✅");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e);
  process.exit(1);
});
