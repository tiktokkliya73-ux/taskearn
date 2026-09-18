/**
 * One-off validation harness for the Packages Payment Checkout Engine
 * (section 11) of db/supabase-schema.sql — runs the WHOLE script through
 * PGlite (Postgres-WASM) twice (idempotency) and asserts:
 * payment_methods table + one-time settings backfill seed, dynamic checkout
 * list (incl. require_proof flag + disabled rows hidden), every server-side
 * guard on api_submit_package_payment (TxID format, package active, method
 * active, duplicate pending, per-user + global TxID reuse, proof policy),
 * pending package_purchase submission with amount from the DB row, admin
 * approve via api_process_deposit (instance created WITHOUT wallet changes,
 * reviewer audit trail, duplicate approval blocked), reject with note (no
 * activation), api_payment_history scoping + proof stripping, admin listings
 * including package requests, package description parity, home team
 * investment aggregation counting approved package payments, and
 * service-role-only grants.
 * Run: bun scripts/validate-package-checkout-sql.ts
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
  await db.exec(
    "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
  );
  await db.exec(sql);
  await db.exec(sql); // idempotent re-run
  console.log("  ✓ script executed cleanly both times (incl. re-run idempotency)");

  console.log("2. Fixtures (custom gateway settings, packages, members)…");
  await db.exec(
    `update system_settings set value='0301-7778888 (Task Reward Payments)' where key='easypaisa_account'`
  );
  await db.exec(
    `insert into investment_packages (id, title, description, price, daily_earning, duration_days, total_return, net_profit, is_active, sort_order)
     values ('pkgMini','Mini Plan','Starter investment',213,100,36500,3650000,3649787,true,1),
            ('pkgPro','Pro Plan',null,1000,80,500,40000,39000,true,2)`
  );
  await db.exec(
    `insert into users (id, name, email, password_hash, role, referral_code, referred_by_id) values
     ('inv2','Inviter Two','inv2@x.com','ph','user','INVTWO',null),
     ('m3','Member Three','m3@x.com','ph','user','MEMTHREE','inv2'),
     ('m4','Member Four','m4@x.com','ph','user','MEMFOUR',null)`
  );
  await db.exec(
    "insert into wallets (user_id, task_balance, withdrawable_balance) values ('inv2', 500, 100), ('m3', 700, 300), ('m4', 0, 0)"
  );

  console.log("3. Payment methods — one-time seed from gateway settings…");
  const list1 = await j<any>("select public.api_payment_methods_list() as v");
  assert(list1.v.methods.length === 3, "3 methods seeded on first list");
  const names = list1.v.methods.map((m: any) => m.name).join(",");
  assert(names === "EasyPaisa,JazzCash,USDT (TRC20)", "seeded in display order");
  const ep = list1.v.methods.find((m: any) => m.name === "EasyPaisa");
  assert(ep.accountNumber === "0301-7778888", "EasyPaisa number split from legacy string");
  assert(
    ep.accountTitle === "TaskEarn Pvt Ltd",
    "explicit easypaisa_title setting wins over the legacy embedded title"
  );
  assert(Boolean(ep.instructions), "instructions seeded from payment_instructions");
  assert(list1.v.requireProof === false, "requireProof flag defaults to false");
  const seed2 = await j<any>("select public.ensure_payment_methods_seeded() as v");
  assert(seed2.v.seeded === false, "second seed call is a no-op (idempotent)");

  console.log("4. Payment methods — dynamic CRUD behaviour…");
  await db.exec(
    `insert into payment_methods (id, name, account_number, account_title, sort_order, is_active)
     values ('pmBank','Bank Transfer','PK36SCBL0000001123456702','Task Reward Pvt',0,true)`
  );
  await db.exec("update payment_methods set is_active = false where name = 'JazzCash'");
  const list2 = await j<any>("select public.api_payment_methods_list() as v");
  assert(list2.v.methods.length === 3, "custom method in, disabled JazzCash out");
  assert(list2.v.methods[0].name === "Bank Transfer", "sortOrder 0 renders first");
  const bankRow = await j<{ n: number }>(
    "select count(*)::int as n from payment_methods where name='Bank Transfer' and updated_at is not null"
  );
  assert(bankRow.n === 1, "Bank Transfer row present with touch trigger");
  await db.exec("update payment_methods set is_active = true where name = 'JazzCash'");

  console.log("5. api_submit_package_payment — server-side guards…");
  const methodId = await j<{ id: string }>(
    "select id from payment_methods where name='EasyPaisa' limit 1"
  );
  const badTid = await j<any>(
    `select public.api_submit_package_payment('m3','pkgMini','${methodId.id}','123') as v`
  );
  assert(
    badTid.v.error ===
      "Enter the transaction ID from your payment app (e.g. TXN12345678).",
    "short TxID rejected with the spec message"
  );
  const badPkg = await j<any>(
    `select public.api_submit_package_payment('m3','nope','${methodId.id}','TXN12345678') as v`
  );
  assert(badPkg.v.error === "Package not found or disabled.", "unknown package rejected");
  const badMethod = await j<any>(
    `select public.api_submit_package_payment('m3','pkgMini','nope','TXN12345678') as v`
  );
  assert(badMethod.v.error === "Select a valid payment method.", "unknown method rejected");
  await db.exec("update system_settings set value='true' where key='require_payment_proof'");
  const needProof = await j<any>(
    `select public.api_submit_package_payment('m3','pkgMini','${methodId.id}','TXN12345678') as v`
  );
  assert(
    needProof.v.error === "A payment screenshot is required — attach your receipt image.",
    "require_payment_proof=true blocks proofless submission"
  );
  await db.exec("update system_settings set value='false' where key='require_payment_proof'");

  console.log("6. Pending submission (amount from the DB row, never the client)…");
  const submit = await j<any>(
    `select public.api_submit_package_payment('m3','pkgMini','${methodId.id}','TXN12345678','data:image/jpeg;base64,QUJD') as v`
  );
  assert(submit.v.ok === true, "submission accepted");
  assert(submit.v.activated === undefined || submit.v.activated === null, "no activation flag — admin review only");
  const row = await j<any>(
    "select type, amount, status, meta, description from transactions where user_id='m3' order by created_at desc limit 1"
  );
  assert(row.type === "package_purchase", "ledger type = package_purchase");
  assert(row.status === "pending", "status = pending (spec)");
  assert(Number(row.amount) === 213, "amount = package price 213 from the DB");
  assert(row.meta.packageId === "pkgMini", "meta.packageId recorded");
  assert(row.meta.packageTitle === "Mini Plan", "meta.packageTitle recorded");
  assert(row.meta.purpose === "package", "meta.purpose = package (routing key)");
  assert(row.meta.paymentMethod === "EasyPaisa", "meta.paymentMethod = method NAME");
  assert(row.meta.txId === "TXN12345678", "meta.txId recorded");
  assert(row.description === "Payment for Mini Plan — awaiting admin review", "spec description");
  assert(submit.v.transaction.hasProof === true, "DTO hasProof = true");
  assert(submit.v.transaction.meta.proof === undefined, "DTO meta.proof stripped");

  console.log("7. Duplicate guards…");
  const dupPending = await j<any>(
    `select public.api_submit_package_payment('m3','pkgMini','${methodId.id}','TXN99999999') as v`
  );
  assert(
    dupPending.v.error.includes("pending payment request for this package"),
    "duplicate pending request for the same package blocked"
  );
  const ownTx = await j<any>(
    `select public.api_submit_package_payment('m3','pkgPro','${methodId.id}','TXN12345678') as v`
  );
  assert(ownTx.v.error === "You have already submitted this transaction ID.", "own TxID reuse blocked");
  const globalTx = await j<any>(
    `select public.api_submit_package_payment('m4','pkgMini','${methodId.id}','TXN12345678') as v`
  );
  assert(globalTx.v.error === "This transaction ID is already under review.", "another member's pending TxID blocked");

  console.log("8. Admin approve — instance created WITHOUT wallet changes + audit…");
  const txnId = await j<{ id: string }>(
    "select id from transactions where user_id='m3' and status='pending' limit 1"
  );
  const before = await j<{ t: number; w: number }>(
    "select task_balance as t, withdrawable_balance as w from wallets where user_id='m3'"
  );
  const approve = await j<any>(
    `select public.api_process_deposit('${txnId.id}','approve',null,'Admin User') as v`
  );
  assert(approve.v.ok === true, "approval ok");
  assert(approve.v.transaction.status === "approved", "transaction approved");
  assert(approve.v.transaction.processedAt !== null, "approval timestamp recorded");
  assert(approve.v.transaction.meta.reviewedBy === "Admin User", "reviewer recorded in meta (audit)");
  const after = await j<{ t: number; w: number }>(
    "select task_balance as t, withdrawable_balance as w from wallets where user_id='m3'"
  );
  assert(
    before.t === after.t && before.w === after.w,
    "wallet UNTOUCHED on external package approval (no double-spend)"
  );
  const instance = await j<any>(
    "select up.invest_amount, up.daily_earning, up.status from user_packages up join transactions t on t.meta->>'userPackageId' = up.id where t.id = $1",
    [txnId.id]
  );
  assert(instance !== null, "user_packages instance created and linked via meta.userPackageId");
  assert(Number(instance.invest_amount) === 213, "instance invest_amount = 213");
  assert(Number(instance.daily_earning) === 100, "instance daily snapshot = 100");
  assert(instance.status === "active", "instance active");

  console.log("9. Duplicate approval blocked…");
  const dupApprove = await j<any>(
    `select public.api_process_deposit('${txnId.id}','approve',null,'Admin User') as v`
  );
  assert(
    dupApprove.v.error === "This payment request was already processed.",
    "second approval attempt rejected"
  );

  console.log("10. Reject with note — nothing activates…");
  const rej = await j<any>(
    `select public.api_submit_package_payment('m4','pkgPro','${methodId.id}','TXN42424242') as v`
  );
  assert(rej.v.ok === true, "m4 submission accepted");
  const rejTxn = await j<{ id: string }>(
    "select id from transactions where user_id='m4' and status='pending' limit 1"
  );
  const reject = await j<any>(
    `select public.api_process_deposit('${rejTxn.id}','reject','Untraceable TxID','Admin User') as v`
  );
  assert(reject.v.ok === true, "rejection ok");
  assert(reject.v.transaction.status === "rejected", "status = rejected");
  assert(reject.v.transaction.description === "Payment rejected — Untraceable TxID", "note visible in description");
  assert(reject.v.transaction.meta.note === "Untraceable TxID", "note stored in meta for the member view");
  assert(reject.v.transaction.meta.reviewedBy === "Admin User", "reviewer recorded on rejection");
  const m4Instances = await j<{ n: number }>(
    "select count(*)::int as n from user_packages where user_id='m4'"
  );
  assert(m4Instances.n === 0, "NO package instance for the rejected member");
  const m4Wallet = await j<{ t: number; w: number }>(
    "select task_balance as t, withdrawable_balance as w from wallets where user_id='m4'"
  );
  assert(m4Wallet.t === 0 && m4Wallet.w === 0, "no balance credited on rejection");

  console.log("11. Payment history + admin listings…");
  const histM3 = await j<any>("select public.api_payment_history('m3') as v");
  assert(histM3.v.payments.length >= 1, "m3 sees own payments");
  assert(histM3.v.payments[0].type === "package_purchase", "newest first = the approved package payment");
  assert(histM3.v.payments[0].meta.proof === undefined, "history DTOs strip the proof payload");
  const histM4 = await j<any>("select public.api_payment_history('m4') as v");
  assert(
    histM4.v.payments.every((p: any) => p.userId === "m4"),
    "members only ever see their own requests"
  );
  const adminList = await j<any>("select public.api_admin_txns('deposit', 60) as v");
  const pkgRows = adminList.v.filter((r: any) => r.type === "package_purchase");
  assert(pkgRows.length === 2, "admin deposit listing includes both package requests");
  assert(
    adminList.v.every((r: any) => r.meta.proof === undefined),
    "admin listing DTOs strip the proof payload"
  );

  console.log("12. Package description parity…");
  const cat = await j<any>("select public.api_packages_list('m3') as v");
  const mini = cat.v.packages.find((p: any) => p.id === "pkgMini");
  assert(mini.description === "Starter investment", "catalogue DTO carries admin description");
  assert(cat.v.packages.find((p: any) => p.id === "pkgPro").description === null, "null description round-trips");

  console.log("13. Home aggregation — approved package payment counts for the team…");
  const home = await j<any>("select public.api_home_data('inv2') as v");
  assert(
    Number(home.v.teamLeader.teamInvestment) === 213,
    "m3's approved package payment (213) counts toward inv2's team investment"
  );

  console.log("14. Grants — service role only…");
  for (const fn of [
    "ensure_payment_methods_seeded()",
    "api_payment_methods_list()",
    "api_submit_package_payment(text, text, text, text, text)",
    "api_process_deposit(text, text, text, text)",
    "api_payment_history(text)",
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
  const procCount = await j<{ n: number }>(
    "select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='api_process_deposit'"
  );
  assert(procCount.n === 1, "exactly ONE api_process_deposit overload (no dangling 3-arg)");

  console.log("\nALL SECTION-11 ASSERTIONS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
