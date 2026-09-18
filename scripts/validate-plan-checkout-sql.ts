/**
 * One-off validation harness for the Plan Activation & Payment Checkout
 * Engine (section 10) of db/supabase-schema.sql — runs the WHOLE script
 * through PGlite (Postgres-WASM) twice (idempotency) and asserts:
 * 11/12-digit TID validation, pending `plan_purchase` submission with proof,
 * admin approve via activate_plan_and_unlock_referral (plan + referral
 * unlock), reject with admin note, proof stripping in DTOs, api_admin_txns
 * deposit listings including plan_purchase, home teamInvestment aggregation,
 * set_system_setting, and service-role-only grants.
 * Run: bun scripts/validate-plan-checkout-sql.ts
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

  console.log("2. Fixtures (plans, inviter, buyer m1, buyer m2)…");
  await db.exec("update system_settings set value='false' where key='auto_approve_deposits'");
  await db.exec(
    `insert into plans (id, name, price, reward_per_task, daily_task_limit, duration_days, is_active, sort_order)
     values ('planA','Standard Plan',1500,220,2,30,true,1),
            ('planB','Gold Plan',5000,900,5,30,true,2)`
  );
  await db.exec(
    `insert into users (id, name, email, password_hash, role, referral_code, referred_by_id) values
     ('inv1','Inviter One','inv1@x.com','ph','user','INVONE',null),
     ('m1','Member One','m1@x.com','ph','user','MEMONE','inv1'),
     ('m2','Member Two','m2@x.com','ph','user','MEMTWO',null)`
  );
  await db.exec(
    "insert into wallets (user_id, task_balance, withdrawable_balance) values ('inv1', 300, 0), ('m1', 0, 0), ('m2', 0, 0)"
  );

  console.log("3. api_activate_plan — TID validation (11/12 digits)…");
  const badTid = await j<any>(
    `select public.api_activate_plan('m1','planA','easypaisa','1234') as v`
  );
  assert(
    badTid.v.error === "Enter the 11 or 12-digit Transaction ID (TID) from your payment app.",
    "short TID rejected with the spec message"
  );
  const badProof = await j<any>(
    `select public.api_activate_plan('m1','planA','easypaisa','03012345678','javascript:alert(1)') as v`
  );
  assert(badProof.v.ok === true, "non data:image proof silently dropped (still submits)");
  const dropped = await j<{ p: boolean }>(
    "select meta ? 'proof' as p from transactions where user_id='m1'"
  );
  assert(dropped.p === false, "malicious proof value NOT stored in meta");
  // that submission left a pending row for m1 — remove it so step 5/6 test a
  // single clean submission (approval picks the newest pending row).
  await db.exec("delete from transactions where user_id='m1'");

  console.log("4. Pending plan_purchase submission with proof…");
  const submit = await j<any>(
    `select public.api_activate_plan('m2','planA','easypaisa','03012345678','data:image/jpeg;base64,QUJD') as v`
  );
  assert(submit.v.ok === true, "submission accepted");
  assert(submit.v.activated === false, "not activated (manual approval mode)");
  const row = await j<any>(
    "select type, amount, status, meta, description from transactions where user_id='m2' order by created_at desc limit 1"
  );
  assert(row.type === "plan_purchase", "ledger type = plan_purchase (spec)");
  assert(row.status === "pending", "status = pending (spec)");
  assert(Number(row.amount) === 1500, "amount = plan price 1500");
  assert(row.meta.planName === "Standard Plan", "meta.planName recorded");
  assert(row.meta.txId === "03012345678", "meta.txId recorded");
  assert(row.meta.paymentMethod === "easypaisa", "meta.paymentMethod recorded");
  assert(row.meta.proof === "data:image/jpeg;base64,QUJD", "meta.proof (data URL) recorded");
  const dto = submit.v.transaction;
  assert(dto.hasProof === true, "DTO hasProof = true");
  assert(dto.meta.proof === undefined, "DTO meta.proof stripped (admin-only payload)");

  console.log("5. m1 checkout (no proof) → pending…");
  const m1submit = await j<any>(
    `select public.api_activate_plan('m1','planA','jazzcash','030987654321') as v`
  );
  assert(m1submit.v.ok === true && m1submit.v.activated === false, "m1 submission pending");
  assert(m1submit.v.transaction.meta.proof === undefined, "no proof → no hasProof leak");
  assert(m1submit.v.transaction.hasProof === false, "hasProof false");

  console.log("6. activate_plan_and_unlock_referral — approve, plan + referral unlock…");
  const approve = await j<any>(
    `select public.activate_plan_and_unlock_referral('m1','planA') as v`
  );
  assert(approve.v.ok === true, "approval ok");
  assert(approve.v.transaction.status === "approved", "transaction approved");
  assert(approve.v.transaction.description === "Payment approved — Standard Plan plan activated", "description updated");
  const up = await j<{ n: number }>(
    "select count(*)::int as n from user_plans where user_id='m1' and plan_id='planA' and status='active'"
  );
  assert(up.n === 1, "user_plans row active for m1/planA");
  const invWallet = await j<{ t: number; w: number }>(
    "select task_balance as t, withdrawable_balance as w from wallets where user_id='inv1'"
  );
  assert(invWallet.t === 0 && invWallet.w === 300, "inviter 300 task → withdrawable (unlock_amount_per_ref)");
  const unlock = await j<{ a: number; s: string }>(
    "select amount as a, status as s from transactions where user_id='inv1' and type='referral_unlock'"
  );
  assert(Number(unlock.a) === 300 && unlock.s === "completed", "referral_unlock ledger +300 completed");

  console.log("7. Already-active guard…");
  const again = await j<any>(
    `select public.api_activate_plan('m1','planB','easypaisa','03012345678') as v`
  );
  assert(again.v.error === "You already have an active plan.", "second activation blocked");
  const noPending = await j<any>(
    `select public.activate_plan_and_unlock_referral('m1','planA') as v`
  );
  assert(
    noPending.v.error === "No pending plan payment found for this member and plan.",
    "no pending payment → clear error"
  );

  console.log("8. Reject with admin note (api_process_deposit)…");
  const m2txn = await j<{ id: string }>(
    "select id from transactions where user_id='m2' and status='pending' limit 1"
  );
  const reject = await j<any>(
    `select public.api_process_deposit('${m2txn.id}','reject','TxID not found — please resubmit') as v`
  );
  assert(reject.v.ok === true, "reject ok");
  const rrow = await j<{ s: string; d: string; note: string }>(
    "select status as s, description as d, meta->>'note' as note from transactions where id=$1",
    [m2txn.id]
  );
  assert(rrow.s === "rejected", "status rejected");
  assert(rrow.d === "Payment rejected — TxID not found — please resubmit", "description carries the note for the member");
  assert(rrow.note === "TxID not found — please resubmit", "meta.note stored");
  const m2plan = await j<{ n: number }>(
    "select count(*)::int as n from user_plans where user_id='m2'"
  );
  assert(m2plan.n === 0, "no plan activated on reject");
  const m2wallet = await j<{ w: number }>(
    "select withdrawable_balance as w from wallets where user_id='m2'"
  );
  assert(Number(m2wallet.w) === 0, "no balance credited on reject");

  console.log("9. api_admin_txns — deposits listing includes plan_purchase…");
  // legacy top-up row (pre-Task-16 format) must still be listed alongside
  await db.exec(
    `insert into transactions (user_id, type, amount, status, description, meta)
     values ('m2','deposit',500,'pending','Wallet top-up deposit',
             '{"purpose":"topup","paymentMethod":"easypaisa","txId":"03012345678"}')`
  );
  const list = await j<any>("select public.api_admin_txns('deposit', 60) as v");
  const types = list.v.map((t: any) => t.type).sort();
  assert(list.v.length >= 3, "list returns deposit + plan_purchase rows");
  assert(types.includes("plan_purchase"), "plan_purchase row present");
  assert(types.includes("deposit"), "legacy deposit row present");
  const proofRow = list.v.find((t: any) => t.userId === "m2" && t.type === "plan_purchase");
  assert(proofRow.hasProof === true, "hasProof surfaced to the admin table");
  assert(proofRow.meta.proof === undefined, "proof image NOT embedded in the list payload");

  console.log("10. tx_dto strips proof universally…");
  const rawDto = await j<any>(
    "select public.tx_dto(t) as v from transactions t where user_id='m2' and meta ? 'proof' limit 1"
  );
  if (rawDto?.v) {
    assert(rawDto.v.hasProof === true && rawDto.v.meta.proof === undefined, "tx_dto: hasProof true, image stripped");
  }

  console.log("11. api_home_data — teamInvestment counts approved plan_purchase…");
  const home = await j<any>("select public.api_home_data('inv1') as v");
  assert(Number(home.v.teamLeader.teamInvestment) === 1500, "inv1 team investment = 1500 (approved plan_purchase)");

  console.log("12. set_system_setting — gateway settings management RPC…");
  const set = await j<any>(
    `select public.set_system_setting('easypaisa_title','TaskEarn Pvt Ltd') as v`
  );
  assert(set.v.ok === true, "upsert ok");
  const got = await j<{ v: string }>("select public.get_setting('easypaisa_title') as v");
  assert(got.v === "TaskEarn Pvt Ltd", "get_setting reads it back");
  const reSet = await j<any>(
    `select public.set_system_setting('easypaisa_title','New Title') as v`
  );
  assert(reSet.v.ok === true, "re-upsert ok");
  const got2 = await j<{ v: string }>("select public.get_setting('easypaisa_title') as v");
  assert(got2.v === "New Title", "value updated in place");
  const seeds = await db.query(
    "select key from system_settings where key in ('easypaisa_title','jazzcash_title','usdt_qr_url','payment_instructions')"
  );
  assert(seeds.rows.length === 4, "gateway seed settings present");

  console.log("13. Grants — service role only…");
  for (const fn of [
    "activate_plan_and_unlock_referral(text, text)",
    "set_system_setting(text, text)",
    "api_activate_plan(text, text, text, text, text)",
    "api_process_deposit(text, text, text, text)",
  ]) {
    const grants = await j<{ proacl: string | null }>(
      "select proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname = split_part($1,'(',1)",
      [fn]
    );
    const acl = grants?.proacl ?? "";
    assert(
      String(acl).includes("service_role") && !String(acl).includes("anon"),
      `${fn} → service_role only`
    );
  }

  console.log("\nALL TASK 16 (PLAN ACTIVATION & PAYMENT CHECKOUT) SQL ASSERTIONS PASSED ✅");
  await db.close();
}

main().catch((err) => {
  console.error("\nVALIDATION FAILED:", err);
  process.exit(1);
});
