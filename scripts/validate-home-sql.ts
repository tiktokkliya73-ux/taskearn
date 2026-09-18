/**
 * One-off validation harness for the dynamic-home section (section 8) of
 * db/supabase-schema.sql — runs the WHOLE script through PGlite
 * (Postgres-WASM) twice (idempotency) and asserts the home RPCs + claim engine.
 * Run: bun scripts/validate-home-sql.ts
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

  console.log("2. Tables, RLS & seeds…");
  const tables = await j<{ n: number }>(
    "select count(*)::int as n from pg_tables where schemaname='public' and tablename in ('promo_codes','promo_claims')"
  );
  assert(tables.n === 2, "promo_codes + promo_claims exist");
  const rls = await db.query(
    "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('promo_codes','promo_claims')"
  );
  assert(rls.rows.every((r: any) => r.relrowsecurity === true), "RLS enabled on both tables");
  const settings = await j<{ n: number }>(
    "select count(*)::int as n from system_settings where key like 'home_%'"
  );
  assert(settings.n === 23, "23 home_* settings defaults present (10 + section-15 channel/header/popup keys + team salary banner image)");
  const seeds = await db.query(
    "select code, reward_amount, max_uses, is_system from promo_codes order by is_system desc, code"
  );
  assert(seeds.rows.length === 3, "TELEGRAM + WHATSAPP + WELCOME50 seeded");
  assert((seeds.rows[0] as any).code === "TELEGRAM" && (seeds.rows[0] as any).is_system === true, "TELEGRAM is the system row");
  assert(seeds.rows.some((r: any) => r.code === "WHATSAPP" && r.is_system === true), "WHATSAPP system row seeded (section 15)");

  console.log("3. Fixtures (users, wallets, team investment)…");
  await db.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values ('u1','Leader One','u1@x.com','ph','user','LEADER1'),('u2','Member Two','u2@x.com','ph','user','MEMBER2'),('u3','Member Three','u3@x.com','ph','user','MEMBER3')"
  );
  await db.exec("update users set referred_by_id='u1' where id in ('u2','u3')");
  await db.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('u1', 200, 100),('u2', 0, 0),('u3', 0, 0)");
  // u2 invests 5,750 (plan) and u3 invests 213 (package) → team investment 5,963
  // plus a REAL plan purchase by u2 recorded as an approved plan-purpose deposit (+1,500)
  // → team investment 7,463; topup (+5,000) and pending plan (+2,000) deposits must NOT count
  await db.exec(
    "insert into transactions (user_id, type, amount, status, description, meta, created_at) values" +
      "('u2','plan_purchase',-5750,'completed','VIP plan', '{}', now() - interval '2 hours')," +
      "('u3','package_purchase',-213,'completed','Mini Plan', '{}', now() - interval '1 hours')," +
      "('u2','deposit',1500,'approved','Deposit for VIP 1 plan', '{\"purpose\":\"plan\",\"planId\":\"p1\"}', now() - interval '3 hours')," +
      "('u3','deposit',5000,'approved','Deposit approved — balance credited', '{\"purpose\":\"topup\"}', now() - interval '4 hours')," +
      "('u2','deposit',2000,'pending','Deposit for VIP 2 plan', '{\"purpose\":\"plan\",\"planId\":\"p2\"}', now() - interval '30 minutes')," +
      "('u1','task_reward',220,'completed','Task 1 done', '{}', now())," +
      "('u1','referral_unlock',300,'completed','Referral unlocked', '{}', now() - interval '1 day')"
  );

  console.log("4. api_home_data…");
  const home = await j<any>("select public.api_home_data('u1') as v");
  const v = home.v;
  assert(v.announcementUr.includes("السلام"), "Urdu announcement default present");
  assert(v.luckyDrawDate === "2026-09-25", "lucky draw date 2026-09-25");
  assert(v.teamLeader.targetAmount === 50000, "team leader target 50000");
  assert(v.teamLeader.applyEnabled === true, "apply enabled");
  assert(v.teamLeader.teamInvestment === 7463, "team investment = 5750 + 213 + 1500 (plan deposit) = 7463 — topup/pending excluded");
  assert(v.stats.totalEarnings === 520, "total earnings 220 + 300");
  assert(v.stats.todayTaskEarning === 220, "today task earning 220");
  assert(v.stats.referralEarnings === 300, "referral earnings 300");
  assert(v.promo.activePromoAvailable === true, "WELCOME50 makes promo available");
  assert(v.telegram.rewardAmount === 50, "telegram reward 50");
  assert(v.telegram.claimed === false, "telegram not claimed yet");

  console.log("5. api_claim_promo — happy path…");
  const claim = await j<any>("select public.api_claim_promo('u1','WELCOME50') as v");
  assert(claim.v.reward === 50, "WELCOME50 pays 50");
  const wallet = await j<{ w: number }>("select withdrawable_balance as w from wallets where user_id='u1'");
  assert(wallet.w === 150, "wallet 100 → 150 credited");
  const tx = await j<{ t: string; a: number; d: string }>(
    "select type as t, amount as a, description as d from transactions where user_id='u1' and type='promo_reward'"
  );
  assert(tx.t === "promo_reward" && tx.a === 50, "promo_reward ledger row +50");
  assert(tx.d === "Promo reward: WELCOME50", "description matches local engine");

  console.log("6. api_claim_promo — error paths…");
  const dup = await j<any>("select public.api_claim_promo('u1','WELCOME50') as v");
  assert(dup.v.error === "You have already claimed this code.", "duplicate claim rejected");
  const bad = await j<any>("select public.api_claim_promo('u1','NOPE99') as v");
  assert(bad.v.error === "Invalid promo code.", "invalid code rejected");
  const sysGuard = await j<any>("select public.api_claim_promo('u1','TELEGRAM') as v");
  assert(sysGuard.v.error === "Use the Telegram reward box to claim this one.", "TELEGRAM via promo box rejected");

  console.log("7. Usage limit enforcement…");
  // maxUses=1 code for the limit test
  await db.exec(
    "insert into promo_codes (code, title, reward_amount, max_uses, is_active) values ('ONETIME','One time test',10,1,true)"
  );
  const first = await j<any>("select public.api_claim_promo('u2','ONETIME') as v");
  assert(first.v.reward === 10, "u2 claims ONETIME");
  const second = await j<any>("select public.api_claim_promo('u3','ONETIME') as v");
  assert(second.v.error === "This promo code has reached its usage limit.", "u3 blocked by usage limit");

  console.log("8. api_claim_telegram…");
  const tg = await j<any>("select public.api_claim_telegram('u1') as v");
  assert(tg.v.reward === 50, "telegram reward pays the live setting amount");
  const wallet2 = await j<{ w: number }>("select withdrawable_balance as w from wallets where user_id='u1'");
  assert(wallet2.w === 200, "wallet 150 → 200");
  const tgTx = await j<{ d: string }>(
    "select description as d from transactions where user_id='u1' and type='promo_reward' and description='Telegram join reward'"
  );
  assert(tgTx.d === "Telegram join reward", "telegram ledger row description");
  const dupTg = await j<any>("select public.api_claim_telegram('u1') as v");
  assert(dupTg.v.error === "You have already claimed this code.", "telegram one-time enforced");
  const home2 = await j<any>("select public.api_home_data('u1') as v");
  assert(home2.v.telegram.claimed === true, "home data now shows claimed");
  assert(home2.v.stats.totalEarnings === 620, "total earnings includes both rewards (520 + 50 + 50)");
  const claimsCount = await j<{ n: number }>("select count(*)::int as n from promo_claims where user_id='u1'");
  assert(claimsCount.n === 2, "two claim rows for u1 (promo + telegram)");

  console.log("9. Setting-driven behaviour…");
  await db.exec("update system_settings set value='75' where key='home_telegram_reward'");
  const home3 = await j<any>("select public.api_home_data('u2') as v");
  assert(home3.v.telegram.rewardAmount === 75, "telegram reward reflects setting change");
  const tg2 = await j<any>("select public.api_claim_telegram('u2') as v");
  assert(tg2.v.reward === 75, "claim pays the UPDATED amount");
  const tgRow = await j<{ r: number }>("select reward_amount as r from promo_codes where code='TELEGRAM'");
  assert(tgRow.r === 75, "system row synced to setting");
  await db.exec("update system_settings set value='false' where key='home_team_leader_apply_enabled'");
  const home4 = await j<any>("select public.api_home_data('u1') as v");
  assert(home4.v.teamLeader.applyEnabled === false, "apply toggle reflected");
  assert(home4.v.teamSalary.image === "", "team salary banner image defaults to empty (icon fallback)");
  await db.exec("update system_settings set value='https://example.com/banner.png' where key='home_team_salary_image'");
  const home5 = await j<any>("select public.api_home_data('u1') as v");
  assert(home5.v.teamSalary.image === "https://example.com/banner.png", "team salary banner image reflected in home data");

  console.log("\nALL SECTION-8 ASSERTIONS PASSED ✅");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e);
  process.exit(1);
});
