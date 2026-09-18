/// <reference types="bun-types" />
/**
 * One-time data repair — Packages catalog hotfix (P2023 Int32 overflow).
 *
 * Run with: bun scripts/fix-package-int-overflow.ts [dbPath]
 *
 * Two "Ultimate Plan" rows were created with dailyEarning 85,000 ×
 * durationDays 36,500 → totalReturn 3,102,500,000 / netProfit 3,102,338,000.
 * SQLite accepted the 64-bit values, but the Prisma `Int` mapping cannot read
 * them back ("Conversion failed: Value … does not fit in an INT column",
 * P2023), so every packages list call returned 500 and the admin catalog
 * showed "Could not load packages".
 *
 * This script:
 *   1. backs up the database file first (db/backups/…),
 *   2. caps out-of-range totalReturn at the Int column maximum and recomputes
 *      netProfit = cappedTotal − price (display-only derived fields — member
 *      purchases/crediting use investAmount/dailyEarning snapshots and are
 *      untouched),
 *   3. verifies that NO Int column of ANY package row remains out of range.
 *
 * Idempotent: rows already within range are never modified.
 * The write paths are now guarded (src/lib/package-limits.ts), so this can
 * never happen again.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";

const INT_MAX = 2_147_483_647;
const INT_MIN = -2_147_483_648;
const INT_COLS = ["price", "dailyEarning", "durationDays", "totalReturn", "netProfit", "sortOrder"] as const;

const dbPath = process.argv[2] ?? process.env.DB_PATH ?? "db/custom.db";
const db = new Database(dbPath);

const isBad = (v: unknown) => {
  const n = Number(v);
  return n > INT_MAX || n < INT_MIN;
};

const before = db
  .query(
    "SELECT id, title, price, dailyEarning, durationDays, totalReturn, netProfit FROM InvestmentPackage ORDER BY sortOrder, createdAt",
  )
  .all() as Record<string, unknown>[];

const badRows = before.filter((r) => INT_COLS.some((c) => isBad(r[c])));
console.log(`DB: ${dbPath}`);
console.log(`Packages: ${before.length} total, ${badRows.length} with out-of-range Int values\n`);

if (badRows.length === 0) {
  console.log("Nothing to repair — all package values already fit the Int columns.");
  db.close();
  process.exit(0);
}

for (const r of badRows) {
  console.log(
    `  !! [${r.id}] "${r.title}" price=${r.price} daily=${r.dailyEarning} duration=${r.durationDays} ` +
      `totalReturn=${r.totalReturn} netProfit=${r.netProfit}`,
  );
}

// 1. Backup before touching anything.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
mkdirSync("db/backups", { recursive: true });
const backupPath = `db/backups/custom-pre-package-overflow-fix-${stamp}.db`;
copyFileSync(dbPath, backupPath);
console.log(`\nBackup written: ${backupPath}`);

// 2. Repair inside one transaction.
db.run("BEGIN");
try {
  const result = db.run(
    `UPDATE InvestmentPackage
        SET totalReturn = CASE WHEN totalReturn > ? THEN ? ELSE totalReturn END,
            netProfit   = (CASE WHEN totalReturn > ? THEN ? ELSE totalReturn END) - price
      WHERE totalReturn > ? OR netProfit > ? OR netProfit < ?`,
    [INT_MAX, INT_MAX, INT_MAX, INT_MAX, INT_MAX, INT_MAX, INT_MIN],
  );
  console.log(`Rows repaired: ${result.changes}`);
  db.run("COMMIT");
} catch (err) {
  db.run("ROLLBACK");
  db.close();
  throw err;
}

// 3. Verify: no Int column of any package row may remain out of range.
const after = db
  .query(
    "SELECT id, title, price, dailyEarning, durationDays, totalReturn, netProfit FROM InvestmentPackage ORDER BY sortOrder, createdAt",
  )
  .all() as Record<string, unknown>[];

const stillBad = after.filter((r) => INT_COLS.some((c) => isBad(r[c])));
console.log("\nRepaired rows (after):");
for (const r of after) {
  if (badRows.some((b) => b.id === r.id)) {
    console.log(
      `  ok [${r.id}] "${r.title}" price=${r.price} daily=${r.dailyEarning} duration=${r.durationDays} ` +
        `totalReturn=${r.totalReturn} netProfit=${r.netProfit}`,
    );
  }
}

db.close();

if (stillBad.length > 0) {
  console.error(`\nVERIFICATION FAILED — ${stillBad.length} row(s) still out of range:`);
  for (const r of stillBad) console.error(`  [${r.id}] ${JSON.stringify(r)}`);
  process.exit(1);
}
console.log(`\nVerification passed — all ${after.length} packages fit the Int columns.`);
