/**
 * Validation harness for db/supabase-audit-diagnostic.sql (Phase 1 read-only
 * audit). Runs in PGlite (Postgres-WASM) — NO real database is touched.
 *
 * Scenario 1 — FULL canonical schema loaded:
 *   • PART A executes as ONE statement and returns a comprehensive result
 *     (all key sections present: tables, columns, keys, indexes, functions,
 *     triggers, RLS, privileges, expected-objects checklist, duplicates).
 *   • Duplicate-trigger detector: inject a second trigger with the same
 *     table+function+timing+events → the audit must flag it.
 *   • Function-overload detector: the canonical schema itself contains the
 *     known api_process_deposit 3-arg/4-arg overload pair → must be flagged.
 *   • Every PART B block executes cleanly (except B11 storage buckets —
 *     PGlite has no `storage` schema; the error is expected and matches the
 *     documented Supabase-only behavior).
 *
 * Scenario 2 — EMPTY database (roles only):
 *   • PART A executes without error (null-safe) and reports every expected
 *     object as MISSING — the checklist itself becomes the finding list.
 *
 * Run: bun scripts/validate-audit-diagnostic.ts
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";

const file = readFileSync("db/supabase-audit-diagnostic.sql", "utf8");
const canonical = readFileSync("db/supabase-schema.sql", "utf8");

const blocks = file
  .split("-- >>> BLOCK: ")
  .slice(1)
  .map((b) => {
    const nl = b.indexOf("\n");
    return { name: b.slice(0, nl).trim(), sql: b.slice(nl + 1).trim() };
  });

const partABlock = blocks.find((b) => b.name === "PART_A");
if (!partABlock) throw new Error("PART_A block not found in the audit file");
// Narrowed once so the hoisted runPartA() below sees a definite string.
const partA: string = partABlock.sql;

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

const ROLES =
  "create role anon nologin; create role authenticated nologin; create role service_role nologin;";

interface AuditRow {
  ord: number;
  section: string;
  object_type: string;
  object_name: string;
  detail: string;
}

async function runPartA(pg: PGlite): Promise<AuditRow[]> {
  const res = await pg.query<AuditRow>(partA);
  return res.rows;
}

async function scenario1() {
  console.log("SCENARIO 1 — full canonical schema");
  const pg = new PGlite();
  await pg.exec(ROLES);
  await pg.exec(canonical);
  console.log("  ✓ canonical schema installed (includes roles)");

  const rows = await runPartA(pg);
  assert(rows.length > 300, `PART A runs as one statement, ${rows.length} rows (>300)`);

  const sections = new Set(rows.map((r) => r.section));
  // 'schemas' (auth/storage) is Supabase-only — empty in PGlite, so not asserted here.
  // 'duplicates' is data-dependent: EMPTY on a clean schema (proven below by injecting
  // a duplicate trigger + an obsolete overload and watching the section appear).
  for (const s of [
    "database",
    "structure",
    "functions",
    "triggers",
    "security",
    "expected_objects",
  ]) {
    assert(sections.has(s), `section present: ${s}`);
  }

  const types = new Set(rows.map((r) => r.object_type));
  for (const t of [
    "table",
    "feature_area",
    "column",
    "primary_key",
    "foreign_key",
    "index",
    "function",
    "trigger",
    "rls_status",
    "table_privileges",
  ]) {
    assert(types.has(t), `object_type present: ${t}`);
  }

  const tables = rows
    .filter((r) => r.object_type === "table" && r.section === "structure")
    .map((r) => r.object_name);
  assert(tables.length === 18, `18 public tables discovered (found ${tables.length})`);
  for (const t of [
    "users",
    "wallets",
    "transactions",
    "system_settings",
    "payment_methods",
    "withdrawal_methods",
    "support_tickets",
    "investment_packages",
  ]) {
    assert(tables.includes(t), `table row: ${t}`);
  }

  // RLS: every table must show ENABLED with 0 policies in the canonical model
  const rls = rows.filter((r) => r.object_type === "rls_status");
  assert(
    rls.length === 18 && rls.every((r) => /rls=ENABLED/.test(r.detail) && /policies=0/.test(r.detail)),
    "rls_status: all 18 tables ENABLED with 0 policies"
  );

  // Privileges: canonical = service_role EXEC, anon/auth/PUBLIC revoked
  const fnRows = rows.filter((r) => r.section === "functions");
  assert(fnRows.length === 50, `50 public functions listed (found ${fnRows.length})`);
  // Privileges — canonical model: every api_* RPC is service_role-only; internal
  // helpers (fn_*, tx_dto, process_referral_unlock) carry NO direct grants; the
  // trigger fn touch_updated_at keeps its harmless default PUBLIC execute.
  const apiFns = fnRows.filter((r) => r.object_name.startsWith("api_"));
  assert(
    apiFns.length === 38 &&
      apiFns.every(
        (r) =>
          /service_role=EXEC/.test(r.detail) &&
          /anon=-/.test(r.detail) &&
          /authenticated=-/.test(r.detail) &&
          /PUBLIC=-/.test(r.detail),
      ),
    "api_* RPC exec privileges: service_role only, anon/auth/PUBLIC revoked (38 RPCs)"
  );
  assert(
    apiFns.every((r) => /security=DEFINER/.test(r.detail)),
    "all api_* RPCs are SECURITY DEFINER (internal helpers aside)"
  );

  // Clean canonical DB → duplicates section must be ABSENT (no overloads, no dup
  // triggers/indexes/policies/tables). The canonical script itself drops the obsolete
  // 3-arg api_process_deposit (line 2619) before creating the 4-arg version.
  assert(
    rows.every((r) => r.section !== "duplicates"),
    "clean canonical DB reports ZERO duplicate candidates"
  );

  // Duplicate-trigger detector: inject a second, differently-named trigger
  await pg.exec(
    "create trigger support_tickets_touch2 before update on public.support_tickets " +
      "for each row execute function public.touch_updated_at();"
  );
  // Obsolete-overload detector: simulate a leftover OLD 3-arg api_process_deposit
  // (exactly what a partially-run / older script leaves behind on real databases)
  await pg.exec(
    "create or replace function public.api_process_deposit(p_transaction_id text, p_action text, " +
    "p_note text default null) returns jsonb language plpgsql as $$ begin return null; end $$;"
  );
  const rows2 = await runPartA(pg);
  const dupTrg = rows2.filter((r) => r.object_type === "duplicate_triggers");
  assert(
    dupTrg.length === 1 &&
      /support_tickets/.test(dupTrg[0].object_name) &&
      /support_tickets_touch2/.test(dupTrg[0].detail),
    "duplicate_triggers detector fires on the injected duplicate"
  );
  const overloads2 = rows2.filter((r) => r.object_type === "function_overloads");
  assert(
    overloads2.length === 1 &&
      overloads2[0].object_name === "api_process_deposit" &&
      /2 different/.test(overloads2[0].detail),
    "function_overloads detector fires on the leftover obsolete 3-arg version"
  );
  await pg.exec("drop trigger support_tickets_touch2 on public.support_tickets;");
  await pg.exec("drop function if exists public.api_process_deposit(text, text, text);");

  // Expected-objects checklist on the canonical DB: no MISSING tables
  const checkRows = rows.filter((r) => r.object_type === "expected_table");
  assert(
    checkRows.length === 18 && checkRows.every((r) => r.detail === "EXISTS"),
    "expected_objects: all 18 tables EXISTS on canonical"
  );
  const checkFns = rows.filter((r) => r.object_type === "expected_function");
  assert(
    checkFns.length === 50 && checkFns.every((r) => /definition/.test(r.detail)),
    "expected_objects: all 50 functions listed with definition counts"
  );

  // PART B blocks — all run clean on canonical except B11 (no storage schema in PGlite)
  for (const b of blocks.filter((x) => x.name !== "PART_A")) {
    if (b.name === "B11_storage_buckets") {
      let expectedError = "";
      try {
        await pg.query(b.sql);
      } catch (e) {
        expectedError = String(e);
      }
      assert(
        /storage.buckets|does not exist/i.test(expectedError),
        "B11 (storage buckets) correctly errors outside Supabase — documented behavior"
      );
      continue;
    }
    const r = await pg.query(b.sql);
    console.log(`  ✓ PART B ${b.name} ran (${r.rows.length} rows)`);
  }

  await pg.close();
  console.log("SCENARIO 1 PASSED\n");
}

async function scenario2() {
  console.log("SCENARIO 2 — empty database (null-safety)");
  const pg = new PGlite();
  await pg.exec(ROLES);
  const rows = await runPartA(pg);
  assert(rows.length >= 60, `PART A runs with NO error on an empty db (${rows.length} rows)`);
  const missing = rows.filter(
    (r) => r.section === "expected_objects" && (r.detail === "MISSING" || /^0 definition/.test(r.detail))
  );
  assert(
    missing.length === 18 + 50,
    `empty db: all 68 expected objects reported MISSING/0-definitions (found ${missing.length})`
  );
  assert(
    rows.some((r) => r.object_type === "feature_area" && /none found/.test(r.detail)),
    "feature areas report 'none found' on an empty db"
  );
  await pg.close();
  console.log("SCENARIO 2 PASSED\n");
}

scenario1()
  .then(scenario2)
  .then(() => console.log("ALL AUDIT-DIAGNOSTIC VALIDATIONS GREEN"))
  .catch((e) => {
    console.error("VALIDATION FAILED:", e);
    process.exit(1);
  });
