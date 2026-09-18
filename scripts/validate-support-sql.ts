/**
 * Validation harness for the Member Support system (Task 40) additions in
 * db/supabase-schema.sql — runs the WHOLE script through PGlite
 * (Postgres-WASM) twice (idempotency), then asserts the support_tickets
 * table + RLS + the four RPCs + the api_admin_stats openSupportCount.
 * Run: bun scripts/validate-support-sql.ts
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

  console.log("2. support_tickets table + RLS…");
  const table = await j<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='support_tickets'"
  );
  assert(table.n === 1, "support_tickets table exists");
  const rls = await j<{ relrowsecurity: boolean }>(
    "select relrowsecurity from pg_class where relname='support_tickets'"
  );
  assert(rls.relrowsecurity === true, "RLS enabled on support_tickets (default-deny, no policies)");

  console.log("3. Fixtures (two members + tickets)…");
  await pg.exec(
    "insert into users (id, name, email, password_hash, role, referral_code) values" +
      "('u1','Member One','u1@x.com','ph','user','SUPP1'),('u2','Member Two','u2@x.com','ph','user','SUPP2')"
  );

  console.log("4. api_support_create — validation + creation…");
  const badSubject = await j<any>("select public.api_support_create('u1', 'ab', 'a message long enough') as r");
  assert(badSubject.r.error === "Subject must be 3–120 characters.", "too-short subject rejected");
  const badMsg = await j<any>("select public.api_support_create('u1', 'Valid subject', 'abc') as r");
  assert(badMsg.r.error === "Message must be 5–2000 characters.", "too-short message rejected");
  const noUser = await j<any>("select public.api_support_create('ghost', 'Valid subject', 'A valid message') as r");
  assert(noUser.r.error === "Account not found.", "unknown member rejected");
  const t1 = await j<any>(
    "select public.api_support_create('u1', 'Withdrawal not received', 'My payout of Rs 500 has not arrived yet.') as r"
  );
  assert(typeof t1.r.id === "string" && t1.r.status === "open" && t1.r.reply === null, "ticket created open with no reply");
  const t2 = await j<any>(
    "select public.api_support_create('u2', 'App issue', 'The app crashes on the tasks page sometimes.') as r"
  );
  assert(typeof t2.r.id === "string", "second member ticket created");

  console.log("5. api_support_list — p_user_id scoping (member isolation)…");
  const list1 = await j<{ r: any[] }>("select public.api_support_list('u1') as r");
  assert(list1.r.length === 1 && list1.r[0].subject === "Withdrawal not received", "member 1 sees ONLY their own ticket");
  assert(!("userName" in list1.r[0]) && !("userEmail" in list1.r[0]), "member list carries no other-member info");
  const list2 = await j<{ r: any[] }>("select public.api_support_list('u2') as r");
  assert(list2.r.length === 1 && list2.r[0].subject === "App issue", "member 2 sees ONLY their own ticket");
  const listGhost = await j<{ r: any[] }>("select public.api_support_list('ghost') as r");
  assert(listGhost.r.length === 0, "unknown member gets an empty list");

  console.log("6. api_admin_support_list — full list with member info…");
  const adminList = await j<{ r: any[] }>("select public.api_admin_support_list() as r");
  assert(adminList.r.length === 2, "admin sees both tickets");
  const withUser = adminList.r.find((t: any) => t.subject === "Withdrawal not received");
  assert(withUser.userName === "Member One" && withUser.userEmail === "u1@x.com", "admin list resolves member name/email");
  assert(adminList.r[0].subject === "App issue", "admin list newest-first");

  console.log("7. api_admin_support_update — status + reply + validation…");
  const badStatus = await j<any>(
    "select public.api_admin_support_update($1, 'bogus', null, false) as r", [t1.r.id]
  );
  assert(badStatus.r.error === "Unknown status.", "invalid status rejected");
  const notFound = await j<any>(
    "select public.api_admin_support_update('nope', 'resolved', null, false) as r"
  );
  assert(notFound.r.error === "Support request not found.", "unknown ticket rejected");
  const updated = await j<any>(
    "select public.api_admin_support_update($1, 'resolved', 'We have sent your payout — please check again.', true) as r",
    [t1.r.id]
  );
  assert(updated.r.status === "resolved" && updated.r.reply.includes("payout"), "status + reply stored");
  assert(updated.r.repliedAt !== null, "repliedAt stamped");
  assert(updated.r.userName === "Member One", "update returns member info");
  const memberView = await j<{ r: any[] }>("select public.api_support_list('u1') as r");
  assert(memberView.r[0].reply.includes("payout") && memberView.r[0].status === "resolved", "member sees the admin reply + status");
  // Status-only update (no reply change)
  const statusOnly = await j<any>(
    "select public.api_admin_support_update($1, 'in_progress', null, false) as r", [t2.r.id]
  );
  assert(statusOnly.r.status === "in_progress" && statusOnly.r.reply === null, "status-only update leaves reply untouched");

  console.log("8. api_admin_stats — openSupportCount…");
  const stats = await j<any>("select public.api_admin_stats() as r");
  assert(stats.r.openSupportCount === 1, "openSupportCount counts open + in_progress (1 after resolving one)");
  await pg.exec("update support_tickets set status='resolved' where user_id='u2'");
  const stats2 = await j<any>("select public.api_admin_stats() as r");
  assert(stats2.r.openSupportCount === 0, "openSupportCount drops to 0 when all resolved");
  assert(stats2.r.pendingPayoutsCount === 0, "other stats keys intact (pendingPayoutsCount)");

  console.log("\nSUPPORT SQL FULLY VALIDATED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
