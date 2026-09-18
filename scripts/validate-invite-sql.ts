/**
 * One-off validation harness for the Invite / Referral page (Task 25) changes
 * in db/supabase-schema.sql — runs the WHOLE script through PGlite
 * (Postgres-WASM) twice (idempotency) and asserts the extended api_referrals
 * RPC + invite_* settings seeds.
 * Run: bun scripts/validate-invite-sql.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const sql = readFileSync("db/supabase-schema.sql", "utf8");

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

const pg = new PGlite();

async function j<T = any>(q: string, params?: unknown[]): Promise<T> {
  const res = await pg.query(q, params);
  return res.rows[0] as T;
}

async function main() {
  console.log("1. Running full schema script (twice)…");
  await pg.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  await pg.exec(sql);
  await pg.exec(sql); // idempotent re-run
  console.log("  ✓ script executed cleanly both times (incl. re-run idempotency)");

  console.log("2. invite_* settings seeds…");
  const seeds = await j<{ n: number }>("select count(*)::int as n from system_settings where key like 'invite_%'");
  assert(seeds.n === 5, "5 invite_* settings defaults present");
  const pct = await j<{ v: string }>("select value as v from system_settings where key='invite_commission_percent'");
  assert(pct.v === "50", "default commission percent 50 (Task 38)");
  const lvl = await j<{ v: string }>("select value as v from system_settings where key='invite_reward_levels'");
  const lvlParsed = JSON.parse(lvl.v) as { required: number; reward: number }[];
  assert(
    lvlParsed.length === 5 && lvlParsed[0].required === 5000 && lvlParsed[4].reward === 15000,
    "default 5 reward levels (5000/1500 … 50000/15000)"
  );

  console.log("3. Fixtures (leader + referred members + qualifying team transactions)…");
  await pg.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values" +
      "('u1','Leader One','u1@x.com','ph','user','LEADER1'),('u2','Member Two','u2@x.com','ph','user','MEMBER2'),('u3','Member Three','u3@x.com','ph','user','MEMBER3')"
  );
  await pg.exec("update users set referred_by_id='u1' where id in ('u2','u3')");
  await pg.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('u1', 200, 100),('u2', 0, 0),('u3', 0, 0)");
  // u2 has an ACTIVE VIP plan (own fixture plan row); u3 none.
  await pg.exec(
    "insert into plans (id, name, price, reward_per_task, daily_task_limit, duration_days, is_active, sort_order) values ('p1','VIP 1',1500,50,10,30,true,1)"
  );
  await pg.exec(
    "insert into user_plans (id, user_id, plan_id, status, started_at, expires_at) values" +
      "('up1','u2','p1','active', now() - interval '1 day', now() + interval '29 days')"
  );
  // Team money-in (expected teamDeposits = 1500 + 5750 + 213 + 400 = 7863):
  //  - u2 plan-purpose deposit approved +1500        → counts
  //  - u2 topup deposit approved +5000               → NOT counted (not an investment)
  //  - u2 pending plan deposit +2000                 → NOT counted (pending)
  //  - u2 plan_purchase completed -5750              → counts (abs, balance purchase)
  //  - u3 package_purchase completed -213            → counts (abs, balance purchase)
  //  - u3 package_purchase approved +400             → counts (abs, external payment)
  //  - u2 task_reward + withdrawal rows               → NOT counted
  // Leader's own referral_unlock +300                → referralCommission
  await pg.exec(
    "insert into transactions (user_id, type, amount, status, description, meta, created_at) values" +
      "('u2','deposit',1500,'approved','Deposit for VIP 1 plan', '{\"purpose\":\"plan\",\"planId\":\"p1\"}', now() - interval '3 hours')," +
      "('u2','deposit',5000,'approved','Top-up', '{\"purpose\":\"topup\"}', now() - interval '4 hours')," +
      "('u2','deposit',2000,'pending','Deposit for VIP 2 plan', '{\"purpose\":\"plan\",\"planId\":\"p1\"}', now() - interval '30 minutes')," +
      "('u2','plan_purchase',-5750,'completed','VIP plan', '{}', now() - interval '2 hours')," +
      "('u3','package_purchase',-213,'completed','Mini Plan', '{}', now() - interval '1 hours')," +
      "('u3','package_purchase',400,'approved','Growth Plan payment', '{}', now() - interval '45 minutes')," +
      "('u2','task_reward',220,'completed','Task 1 done', '{}', now())," +
      "('u2','withdrawal',100,'rejected','Withdrawal', '{}', now())," +
      "('u1','referral_unlock',300,'completed','Referral unlocked', '{}', now() - interval '1 day')," +
      "('u1','referral_unlock',0,'blocked','Blocked', '{}', now() - interval '2 days')"
  );

  console.log("4. api_referrals — extended payload (defaults)…");
  const res = await j<any>("select public.api_referrals('u1') as v");
  const v = res.v;
  assert(v.code === "LEADER1", "referral code returned");
  assert(v.stats.total === 2, "stats.total = 2 (legacy field intact)");
  assert(v.stats.activated === 1, "stats.activated = 1 (u2 has active plan)");
  assert(v.stats.pending === 1, "stats.pending = 1");
  assert(v.stats.unlockedTotal === 300, "stats.unlockedTotal = 300 (completed only, blocked excluded)");
  assert(Array.isArray(v.list) && v.list.length === 2, "members list intact (2 rows)");
  assert(v.list.find((m: any) => m.id === "u2").planActivated === true, "u2 planActivated true");
  assert(v.list.find((m: any) => m.id === "u3").planActivated === false, "u3 planActivated false");
  assert(v.invite.commissionPercent === 50, "invite.commissionPercent = 50");
  assert(
    v.invite.commissionText === "Earn 50% commission on every referral's package purchase",
    "invite.commissionText rendered ({percent} → 50)"
  );
  assert(v.invite.teamMembers === 2, "invite.teamMembers = 2");
  assert(v.invite.teamDeposits === 7863, "invite.teamDeposits = 7863 (1500+5750+213+400; topup/pending/rejected excluded)");
  assert(v.invite.referralCommission === 300, "invite.referralCommission = 300 (blocked excluded)");
  assert(
    Array.isArray(v.invite.levels) && v.invite.levels.length === 5 && v.invite.levels[0].level === 1 &&
      v.invite.levels[0].required === 5000 && v.invite.levels[4].level === 5 && v.invite.levels[4].required === 50000,
    "invite.levels = 5 numbered ascending levels"
  );
  assert(
    v.invite.howItWorks.length === 4 && v.invite.howItWorks[2] === "You earn 50% commission on their package purchase",
    "invite.howItWorks = 4 rendered steps"
  );
  assert(
    v.invite.policy.length === 4 && v.invite.policy[1].includes("50% commission"),
    "invite.policy = 4 rendered bullets"
  );

  console.log("5. Admin edits go live instantly (no code changes)…");
  await pg.exec("update system_settings set value='25' where key='invite_commission_percent'");
  await pg.exec(
    "update system_settings set value='[{\"required\":6000,\"reward\":900},{\"required\":12000,\"reward\":2500}]' where key='invite_reward_levels'"
  );
  const res2 = await j<any>("select public.api_referrals('u1') as v");
  assert(res2.v.invite.commissionPercent === 25, "commission percent now 25");
  assert(res2.v.invite.commissionText.includes("Earn 25%"), "commission text now 25%");
  assert(
    res2.v.invite.howItWorks[2] === "You earn 25% commission on their package purchase",
    "how-it-works step now 25%"
  );
  assert(
    res2.v.invite.policy[1].includes("25% commission"),
    "policy bullet now 25%"
  );
  assert(
    res2.v.invite.levels.length === 2 && res2.v.invite.levels[0].required === 6000 &&
      res2.v.invite.levels[0].reward === 900 && res2.v.invite.levels[1].level === 2,
    "levels now the admin's 2 custom levels (renumbered)"
  );

  console.log("6. Defensive fallbacks on garbage settings…");
  await pg.exec("update system_settings set value='not json at all' where key='invite_reward_levels'");
  await pg.exec("update system_settings set value='[]' where key='invite_how_it_works'");
  await pg.exec("update system_settings set value='200' where key='invite_commission_percent'");
  const res3 = await j<any>("select public.api_referrals('u1') as v");
  assert(res3.v.invite.levels.length === 5, "garbage levels JSON → default 5 levels");
  assert(res3.v.invite.howItWorks.length === 4, "empty how-it-works array → default 4 steps");
  assert(res3.v.invite.commissionPercent === 100, "out-of-range percent (200) clamped to 100");
  // non-string / blank entries are dropped, order preserved
  await pg.exec(
    "update system_settings set value='[\"First\", 123, \"\", \"Second {percent}%\"]'::text where key='invite_referral_policy'"
  );
  const res4 = await j<any>("select public.api_referrals('u1') as v");
  assert(
    res4.v.invite.policy.length === 2 && res4.v.invite.policy[1] === "Second 100%",
    "non-string/blank policy entries dropped, {percent} rendered"
  );

  console.log("7. Grants — service role only…");
  const priv = await j<{ anon_can: boolean; auth_can: boolean; svc_can: boolean }>(
    `select has_function_privilege('anon', p.oid, 'execute') as anon_can,
            has_function_privilege('authenticated', p.oid, 'execute') as auth_can,
            has_function_privilege('service_role', p.oid, 'execute') as svc_can
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='api_referrals'`
  );
  assert(priv.anon_can === false, "api_referrals NOT executable by anon");
  assert(priv.auth_can === false, "api_referrals NOT executable by authenticated");
  assert(priv.svc_can === true, "api_referrals executable by service_role");

  console.log("8. Unknown user guard…");
  const nobody = await j<any>("select public.api_referrals('nope') as v");
  assert(nobody.v.error === 'User not found.', "unknown user returns error");

  // restore defaults so re-runs of other validators see a clean state
  await pg.exec("delete from transactions");
  await pg.exec("delete from user_plans");
  await pg.exec("delete from plans where id='p1'");
  await pg.exec("delete from wallets");
  await pg.exec("delete from users where id in ('u1','u2','u3')");
  await pg.exec(
    "update system_settings set value='50' where key='invite_commission_percent';" +
      "update system_settings set value='[{\"required\":5000,\"reward\":1500},{\"required\":10000,\"reward\":3000},{\"required\":20000,\"reward\":6000},{\"required\":30000,\"reward\":9000},{\"required\":50000,\"reward\":15000}]' where key='invite_reward_levels';" +
      "update system_settings set value='[\"Share your referral link with friends\",\"They sign up and buy a package\",\"You earn {percent}% commission on their package purchase\",\"Unlock Cash Rewards as your team grows!\"]' where key='invite_how_it_works';" +
      "update system_settings set value='[\"You earn only when your referred user purchases a package.\",\"On every paid package purchase, you receive {percent}% commission of the package amount.\",\"Free package users do not generate package purchase commission.\",\"Each referral is counted once, according to the existing referral rules.\"]' where key='invite_referral_policy';"
  );

  console.log("\nALL INVITE-SQL ASSERTIONS PASSED ✅");
}

main().catch((err) => {
  console.error("\nVALIDATION FAILED ❌\n", err);
  process.exit(1);
});
