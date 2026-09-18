/**
 * One-off validation harness for SECTION 15 of db/supabase-schema.sql
 * (channel visit rewards + referral commission parity) — runs the WHOLE
 * script through PGlite (Postgres-WASM) twice (idempotency) and asserts the
 * new/updated RPCs behave exactly like the local TS engine.
 * Run: bun scripts/validate-section15-sql.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const sql = readFileSync("db/supabase-schema.sql", "utf8");

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

const db = new PGlite();

async function j<T = any>(q: string): Promise<T> {
  const res = await db.query(q);
  return res.rows[0] as T;
}

async function main() {
  console.log("1. Running full schema script (twice)…");
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
  );
  await db.exec(sql);
  await db.exec(sql); // idempotent re-run
  console.log("  ✓ script executed cleanly both times (incl. re-run idempotency)");

  console.log("2. Seeds…");
  const seeds = await j<{ code: string; is_system: boolean }>(
    "select code, is_system from promo_codes where code in ('TELEGRAM','WHATSAPP') order by code"
  );
  assert(seeds.code === "TELEGRAM" && seeds.is_system === true, "TELEGRAM system row present");
  const wa = await db.query(
    "select code, title, reward_amount, is_system, is_active from promo_codes where code='WHATSAPP'"
  );
  const waRow = wa.rows[0] as any;
  assert(
    waRow && waRow.is_system === true && waRow.is_active === true && waRow.title === "WhatsApp join reward",
    "WHATSAPP system row seeded (title/is_system/is_active)"
  );
  for (const key of [
    "home_whatsapp_reward",
    "home_whatsapp_enabled",
    "home_telegram_enabled",
    "home_header_title",
    "home_header_tagline",
    "home_welcome_popup_enabled",
    "site_logo_url",
  ]) {
    const row = await j<{ n: number }>(`select count(*)::int as n from system_settings where key='${key}'`);
    assert(row.n === 1, `setting seeded: ${key}`);
  }

  console.log("3. Fixtures (inviter + referred member + package)…");
  await db.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values ('inv','Inviter','inv@x.com','ph','user','INV001'),('mem','Member','mem@x.com','ph','user','MEM001')"
  );
  await db.exec("update users set referred_by_id='inv' where id='mem'");
  await db.exec("insert into wallets (user_id, task_balance, withdrawable_balance) values ('inv', 100, 0),('mem', 5000, 0)");
  await db.exec(
    "insert into investment_packages (id, title, price, daily_earning, duration_days, total_return, net_profit) values ('pkg1','Pro Plan',1000,50,30,1500,500)"
  );

  console.log("4. api_home_data — whatsapp/enabled blocks + commission stats…");
  const home = await j<any>("select public.api_home_data('mem') as v");
  const hv = home.v;
  assert(hv.whatsapp && hv.whatsapp.rewardAmount === 50 && hv.whatsapp.claimed === false && hv.whatsapp.enabled === true, "home.whatsapp block correct");
  assert(hv.telegram && hv.telegram.rewardAmount === 50 && hv.telegram.enabled === true, "home.telegram block has enabled flag");
  assert(hv.stats && hv.stats.totalEarnings === 0, "home.stats present");

  console.log("5. api_claim_promo('WHATSAPP') — channel path…");
  await db.exec("update system_settings set value='80' where key='home_whatsapp_reward'");
  const claim = await j<any>("select public.api_claim_promo('mem','WHATSAPP') as v");
  assert(claim.v.reward === 80 && claim.v.code === "WHATSAPP", "WHATSAPP claim pays live setting amount (80)");
  const memWallet = await j<any>("select withdrawable_balance as w from wallets where user_id='mem'");
  assert(memWallet.w === 80, "member withdrawable_balance credited 80");
  const ledger = await j<any>(
    "select description, meta->>'source' as source, amount from transactions where user_id='mem' and type='promo_reward'"
  );
  assert(ledger.description === "WhatsApp join reward" && ledger.source === "whatsapp" && ledger.amount === 80, "promo_reward ledger row: WhatsApp description + source + amount");
  const dup = await j<any>("select public.api_claim_promo('mem','WHATSAPP') as v");
  assert(dup.v.error === "You have already claimed this code.", "duplicate WHATSAPP claim rejected");
  const home2 = await j<any>("select public.api_home_data('mem') as v");
  assert(home2.v.whatsapp.claimed === true, "home.whatsapp.claimed flips to true");

  console.log("6. Enabled gates…");
  await db.exec("update system_settings set value='false' where key='home_telegram_enabled'");
  const tgDisabled = await j<any>("select public.api_claim_telegram('mem') as v");
  assert(
    tgDisabled.v.error === "The Telegram reward is currently disabled.",
    "api_claim_telegram respects home_telegram_enabled"
  );
  await db.exec("update system_settings set value='true' where key='home_telegram_enabled'");
  const tg = await j<any>("select public.api_claim_telegram('mem') as v");
  assert(tg.v.reward === 50 && tg.v.code === "TELEGRAM", "telegram claim works when re-enabled");
  const invWalletAfterTg = await j<any>("select withdrawable_balance as w from wallets where user_id='mem'");
  assert(invWalletAfterTg.w === 130, "member withdrawable now 130 (80 WA + 50 TG)");

  console.log("7. Referral commission — balance purchase path…");
  const purchase = await j<any>("select public.api_purchase_package('mem','pkg1') as v");
  assert(purchase.v.ok === true && purchase.v.userPackage.id, "balance purchase succeeds");
  const invWallet = await j<any>(
    "select task_balance as t, withdrawable_balance as w from wallets where user_id='inv'"
  );
  assert(invWallet.w === 500, "inviter withdrawable credited 50% of 1000 (commission)");
  const comm = await j<any>(
    "select amount, status, description, meta->>'userPackageId' as upid from transactions where type='referral_commission' and user_id='inv'"
  );
  assert(comm.amount === 500 && comm.status === "completed" && comm.upid === purchase.v.userPackage.id, "referral_commission ledger row (500, completed, instance id)");
  const cnt = await j<{ n: number }>(
    "select count(*)::int as n from transactions where type='referral_commission' and user_id='inv'"
  );
  assert(cnt.n === 1, "exactly ONE commission row for the activation");

  console.log("8. Referral commission — admin approval path (api_process_deposit)…");
  await db.exec(
    "insert into transactions (user_id, type, amount, status, description, meta) values ('mem','package_purchase',1000,'pending','Payment for Pro Plan', jsonb_build_object('packageId','pkg1','packageTitle','Pro Plan','purpose','package','paymentMethod','EasyPaisa','txId','TXN12345678'))"
  );
  const pending = await j<{ id: string }>(
    "select id from transactions where type='package_purchase' and status='pending' limit 1"
  );
  const approval = await j<any>(
    `select public.api_process_deposit('${pending.id}','approve',null,'Admin') as v`
  );
  assert(approval.v.ok === true && approval.v.transaction.status === "approved", "package payment approved");
  const commissionCount = await j<{ n: number }>(
    "select count(*)::int as n from transactions where type='referral_commission' and user_id='inv'"
  );
  assert(commissionCount.n === 2, "approval path paid a SECOND commission (new instance)");
  const invWallet2 = await j<any>("select withdrawable_balance as w from wallets where user_id='inv'");
  assert(invWallet2.w === 1000, "inviter withdrawable now 1000 (two commissions of 500)");

  console.log("8b. Same-IP/fingerprint referral still pays (Task 38 — root-cause regression)…");
  await db.exec("update users set ip_address='1.2.3.4', fingerprint='same-device' where id in ('inv','mem')");
  await db.exec(
    "insert into transactions (user_id, type, amount, status, description, meta) values ('mem','package_purchase',1000,'pending','Payment for Pro Plan #2', jsonb_build_object('packageId','pkg1','packageTitle','Pro Plan','purpose','package','paymentMethod','EasyPaisa','txId','TXN87654321'))"
  );
  const pending2 = await j<{ id: string }>(
    "select id from transactions where type='package_purchase' and status='pending' limit 1"
  );
  await j<any>(`select public.api_process_deposit('${pending2.id}','approve',null,'Admin') as v`);
  const invWallet3 = await j<any>("select withdrawable_balance as w from wallets where user_id='inv'");
  assert(invWallet3.w === 1500, "same-IP commission PAID (+500 → 1500), not blocked at 0");
  const blockedCount = await j<{ n: number }>(
    "select count(*)::int as n from transactions where type='referral_commission' and status='blocked'"
  );
  assert(blockedCount.n === 0, "no blocked commission rows exist (old suppression removed)");

  console.log("9. Idempotency — re-running the whole script changes nothing…");
  await db.exec(sql);
  const still = await j<{ n: number }>(
    "select count(*)::int as n from transactions where type='referral_commission' and user_id='inv'"
  );
  assert(still.n === 3, "no new commission rows after re-run");
  const homeFinal = await j<any>("select public.api_home_data('inv') as v");
  assert(homeFinal.v.stats.totalEarnings === 1500, "home stats include referral_commission (inviter: 1500)");
  assert(homeFinal.v.stats.referralEarnings === 1500, "referralEarnings includes referral_commission");

  console.log("\nALL SECTION-15 ASSERTIONS PASSED");
}

main().catch((e) => {
  console.error("VALIDATION FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
