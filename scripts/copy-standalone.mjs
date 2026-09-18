/**
 * Cross-platform standalone asset copy (Windows/macOS/Linux — no `cp` needed).
 * Runs automatically after every `next build` via the `build` npm script.
 *
 * `output: "standalone"` (next.config.ts) produces a minimal server in
 * .next/standalone — but the static assets, public files, and the local
 * SQLite database are NOT copied there by default. This script makes the
 * standalone folder self-contained:
 *
 *   .next/standalone/.next/static   → client-side JS/CSS chunks
 *   .next/standalone/public         → logos, images, robots.txt
 *   .next/standalone/db             → supabase-schema.sql + the pre-initialized
 *                                     SQLite switch database (if present)
 *   .next/standalone/prisma         → schema.prisma — REQUIRED for Prisma's
 *                                     relative SQLite path resolution (Prisma
 *                                     resolves `file:../db/custom.db` against
 *                                     the schema folder when it exists next to
 *                                     the traced client; without it every
 *                                     relative file: URL fails with SQLite
 *                                     error 14 in the standalone server).
 *
 * `npm start` then boots the full production server from the project root
 * with `node .next/standalone/server.js`.
 */
import { cpSync, existsSync } from "node:fs";

const targets = [
  [".next/static", ".next/standalone/.next/static"],
  ["public", ".next/standalone/public"],
  ["db", ".next/standalone/db"],
  ["prisma", ".next/standalone/prisma"],
];

for (const [src, dest] of targets) {
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
    console.log(`[copy-standalone] ${src} → ${dest}`);
  } else {
    console.warn(`[copy-standalone] skipped (missing): ${src}`);
  }
}

console.log("[copy-standalone] done — run `npm start` for the production server.");
