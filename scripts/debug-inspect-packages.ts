/// <reference types="bun-types" />
/**
 * READ-ONLY debug inspection for the Packages 500 bug (P2023 Int overflow).
 * Usage: bun scripts/debug-inspect-packages.ts [dbPath]
 */
import { Database } from "bun:sqlite";

const dbPath = process.argv[2] || process.env.DB_PATH || "db/custom.db";
const db = new Database(dbPath, { readonly: true });

const INT_MAX = 2147483647;
const INT_MIN = -2147483648;

console.log(`DB: ${dbPath}\n`);
console.log("=== InvestmentPackage rows ===");
const rows = db
  .query(
    "SELECT id, title, price, dailyEarning, durationDays, totalReturn, netProfit, isActive, sortOrder FROM InvestmentPackage ORDER BY sortOrder, createdAt",
  )
  .all() as Record<string, unknown>[];

for (const r of rows) {
  const flags: string[] = [];
  for (const col of ["price", "dailyEarning", "durationDays", "totalReturn", "netProfit", "sortOrder"]) {
    const v = Number(r[col]);
    if (v > INT_MAX || v < INT_MIN) flags.push(`${col}=${v} OUT-OF-RANGE`);
  }
  const derivedTotal = Number(r.dailyEarning) * Number(r.durationDays);
  const autoMatch = derivedTotal === Number(r.totalReturn) ? "auto(daily*duration)" : "custom";
  console.log(
    `- [${r.id}] "${r.title}" active=${r.isActive} sort=${r.sortOrder}\n` +
      `    price=${r.price} daily=${r.dailyEarning} duration=${r.durationDays} totalReturn=${r.totalReturn} (${autoMatch}) netProfit=${r.netProfit}` +
      (flags.length ? `\n    !! ${flags.join(", ")}` : ""),
  );
}

console.log("\n=== Out-of-range row check (any Int col) ===");
const bad = rows.filter((r) =>
  ["price", "dailyEarning", "durationDays", "totalReturn", "netProfit", "sortOrder"].some(
    (c) => Number(r[c]) > INT_MAX || Number(r[c]) < INT_MIN,
  ),
);
console.log(`bad rows: ${bad.length} -> ${bad.map((b) => b.id).join(", ") || "none"}`);

console.log("\n=== UserPackage rows (invest snapshot check) ===");
const up = db
  .query(
    `SELECT up.id, up.userId, up.packageId, p.title, up.investAmount, up.dailyEarning, up.status, up.lastEarningDate
     FROM UserPackage up JOIN InvestmentPackage p ON p.id = up.packageId
     ORDER BY up.createdAt`,
  )
  .all() as Record<string, unknown>[];
for (const r of up) {
  const flags: string[] = [];
  for (const col of ["investAmount", "dailyEarning"]) {
    const v = Number(r[col]);
    if (v > INT_MAX || v < INT_MIN) flags.push(`${col}=${v} OUT-OF-RANGE`);
  }
  console.log(
    `- pkg="${r.title}" invest=${r.investAmount} daily=${r.dailyEarning} status=${r.status} lastEarning=${r.lastEarningDate}` +
      (flags.length ? ` !! ${flags.join(",")}` : ""),
  );
}
console.log(`total user packages: ${up.length}`);

console.log("\n=== Ledger sanity ===");
const txs = db
  .query(`SELECT COUNT(*) AS n FROM "Transaction" WHERE type = 'daily_earning'`)
  .all() as Record<string, unknown>[];
console.log(`daily_earning transactions: ${txs[0].n}`);

db.close();
