/**
 * NIGHTLY DAILY-EARNINGS CRON (investment packages engine)
 * Run with: npm run cron:daily-earnings   (or: bun scripts/daily-earnings.ts)
 *
 * Schedule (server crontab — 00:05 every night, Asia/Karachi):
 *   5 0 * * * cd /path/to/project && npm run cron:daily-earnings >> cron-earnings.log 2>&1
 *
 * Behavior:
 *  - Reads the data_backend flag from the local SQLite settings (always
 *    readable) — exactly like the website's API dispatch.
 *  - local     → runs the same engine as POST /api/admin/cron/daily-earnings
 *                (src/lib/daily-earnings.ts) inside one Prisma transaction.
 *  - supabase  → invokes the SECURITY DEFINER RPC api_run_daily_earnings()
 *                with the service-role key (env: NEXT_PUBLIC_SUPABASE_URL +
 *                SUPABASE_SERVICE_ROLE_KEY — export the vars or run through
 *                `npm run dev` tooling that loads .env automatically).
 *
 * The engine is IDEMPOTENT per calendar day (lastEarningDate guard) — a
 * repeated run on the same day credits nothing and reports alreadyRan: true.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { runDailyEarnings } from "../src/lib/daily-earnings";

const db = new PrismaClient();

function printSummary(summary: {
  date: string;
  usersCredited: number;
  packagesCredited: number;
  packagesCompleted: number;
  totalCredited: number;
  alreadyRan: boolean;
  details: { userName: string; packages: number; total: number }[];
}): void {
  console.log(
    `[daily-earnings ${summary.date}] users=${summary.usersCredited} ` +
      `packages=${summary.packagesCredited} completed=${summary.packagesCompleted} ` +
      `totalCredited=Rs ${summary.totalCredited.toLocaleString()} alreadyRan=${summary.alreadyRan}`
  );
  for (const d of summary.details.slice(0, 25)) {
    console.log(`  · ${d.userName}: ${d.packages} package(s) → Rs ${d.total.toLocaleString()}`);
  }
  if (summary.details.length > 25) {
    console.log(`  · …and ${summary.details.length - 25} more members`);
  }
}

async function runSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.rpc("api_run_daily_earnings");
  if (error) throw new Error(`Supabase RPC api_run_daily_earnings failed: ${error.message}`);
  if (data && typeof (data as { error?: unknown }).error === "string") {
    throw new Error(`api_run_daily_earnings: ${(data as { error: string }).error}`);
  }
  printSummary(data as Parameters<typeof printSummary>[0]);
}

async function main() {
  const flag = await db.systemSetting.findUnique({ where: { key: "data_backend" } });
  const backend = flag?.value === "supabase" ? "supabase" : "local";
  console.log(`[daily-earnings] backend=${backend}`);

  if (backend === "supabase") {
    await runSupabase();
  } else {
    const summary = await db.$transaction((tx) => runDailyEarnings(tx));
    printSummary(summary);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("[daily-earnings] FAILED:", e instanceof Error ? e.message : e);
    await db.$disconnect();
    process.exit(1);
  });
