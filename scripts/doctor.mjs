#!/usr/bin/env node
/**
 * TaskEarn environment doctor — quick sanity check for local runs.
 *
 * Usage:   node scripts/doctor.mjs
 * (Always exits 0 — pure diagnostics, never writes anything.)
 *
 * Catches the #1 cause of "every data API returns 500" on a PC: a
 * machine-global DATABASE_URL (set by another project via `setx`) silently
 * overriding the project's .env files — Next.js gives the real process
 * environment priority over .env / .env.local. That single conflict produces:
 * homepage stats showing "—", empty VIP plans, a generic logo, and login
 * failing with "Something went wrong. Please try again."
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ok = (s) => `  [OK]   ${s}`;
const warn = (s) => `  [WARN] ${s}`;
const info = (s) => `  [..]   ${s}`;

console.log("TaskEarn environment doctor");
console.log("=".repeat(64));

// 1. Node version
const major = Number(process.versions.node.split(".")[0]);
console.log(`\nNode.js: v${process.versions.node}`);
console.log(
  major >= 20
    ? ok("Node 20.9 or newer (required by Next.js 16)")
    : warn("Node older than 20.9 — install the LTS from https://nodejs.org")
);

// 2. DATABASE_URL — the critical check
const dbUrl = process.env.DATABASE_URL;
let dbPath = resolve(root, "db", "custom.db");
console.log("\nDATABASE_URL:");
if (dbUrl) {
  console.log(info(`set to: ${dbUrl}`));
  const m = /^file:(.+)$/.exec(dbUrl);
  if (m) {
    // Prisma resolves relative `file:` paths against the prisma/ folder.
    dbPath = m[1].startsWith("/") ? m[1] : resolve(root, "prisma", m[1]);
  }
  if (!dbPath.startsWith(root)) {
    console.log(warn(`resolves OUTSIDE this project: ${dbPath}`));
    console.log(
      warn(
        "A machine-global DATABASE_URL (from another project) OVERRIDES .env / .env.local in Next.js."
      )
    );
    console.log(
      info(
        "Fix (Windows): 'Edit the system environment variables' -> Environment Variables... -> delete DATABASE_URL (User AND System lists), then open a NEW terminal."
      )
    );
    console.log(
      info(
        "Fix (macOS/Linux): remove any 'export DATABASE_URL=...' from ~/.bashrc, ~/.zshrc or ~/.profile, then open a NEW terminal."
      )
    );
  } else {
    console.log(ok(`resolves to ${dbPath}`));
  }
} else {
  console.log(
    ok("not set — the app falls back to the bundled database (file:../db/custom.db)")
  );
}

// 3. Database file
console.log("\nDatabase file:");
if (existsSync(dbPath)) {
  const size = statSync(dbPath).size;
  console.log(ok(`${dbPath} (${size.toLocaleString()} bytes)`));
  if (size < 100000) {
    console.log(
      warn(
        "suspiciously small (schema only?) — restore demo data: npm run db:seed && npm run seed:packages"
      )
    );
  }
} else {
  console.log(warn(`${dbPath} — MISSING`));
  console.log(
    info(
      "Create it: copy .env.example .env.local   then   npm run db:push && npm run db:seed && npm run seed:packages"
    )
  );
}

// 4. Env files
console.log("\nEnv files:");
const hasEnvLocal = existsSync(resolve(root, ".env.local"));
const hasEnv = existsSync(resolve(root, ".env"));
console.log(
  hasEnvLocal ? ok(".env.local present") : info(".env.local absent (optional — fallbacks apply)")
);
console.log(hasEnv ? ok(".env present") : info(".env absent (optional)"));
if (hasEnvLocal && hasEnv) {
  console.log(
    info("Next.js loads .env.local with priority over .env (real process env wins over both).")
  );
}

// 5. Supabase variables — presence only, NEVER values
console.log("\nSupabase (optional — the local data track works without it):");
const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const hasKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log(
  hasUrl
    ? ok("NEXT_PUBLIC_SUPABASE_URL set")
    : info("NEXT_PUBLIC_SUPABASE_URL not set — local track only, no recovery emails")
);
console.log(
  hasKey
    ? ok("SUPABASE_SERVICE_ROLE_KEY set")
    : info("SUPABASE_SERVICE_ROLE_KEY not set — local track only")
);
if (hasUrl !== hasKey) {
  console.log(warn("only ONE of the two Supabase variables is set — configure both or neither."));
}

// 6. Key files every run depends on
console.log("\nKey files:");
const keyFiles = [
  "package.json",
  "prisma/schema.prisma",
  "db/custom.db",
  "db/supabase-schema.sql",
  "public/logo.svg",
  "public/hero-illustration.png",
];
for (const f of keyFiles) {
  console.log(existsSync(resolve(root, f)) ? ok(f) : warn(`${f} — MISSING`));
}

console.log("\n" + "=".repeat(64));
console.log("Doctor complete.");
console.log("If DATABASE_URL resolved outside this project, that was the cause of:");
console.log('  stats "—" / empty VIP plans / generic logo / login "Something went wrong"');
console.log("(every data API returns 500 in that state). Remove the override and restart.");
