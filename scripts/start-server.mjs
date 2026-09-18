/**
 * Cross-platform production start with .env support.
 *
 * `next build` produces `.next/standalone/server.js`, but that server does
 * NOT load `.env.local` / `.env` on its own — on a plain `npm start` the
 * required DATABASE_URL would be missing. This tiny loader reads the env
 * files first (Next.js precedence: `.env.local` over `.env`), sets only the
 * variables that are not already present in the environment, and then boots
 * the standalone server. Windows / macOS / Linux — no shell features needed.
 *
 * Usage:  npm start        (package.json → node scripts/start-server.mjs)
 * Optional env vars: PORT (default 3000), HOSTNAME (default 0.0.0.0)
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Parse a .env file into a flat KEY→VALUE map (quotes stripped, comments ignored). */
function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Next.js precedence: real environment wins, then .env.local, then .env.
// (`.env.local` is intentionally NOT loaded when NODE_ENV=test, matching
// Next.js behavior — irrelevant for a production start.)
const fromFiles = { ...parseEnvFile(path.join(projectRoot, ".env")), ...parseEnvFile(path.join(projectRoot, ".env.local")) };
for (const [key, value] of Object.entries(fromFiles)) {
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
}

// The standalone server reads PORT / HOSTNAME from the environment.
if (!process.env.PORT) process.env.PORT = "3000";

const standalone = path.join(projectRoot, ".next", "standalone", "server.js");
if (!existsSync(standalone)) {
  console.error(
    "[start] .next/standalone/server.js not found — run `npm run build` first.",
  );
  process.exit(1);
}

console.log(
  `[start] env loaded (files: ${[
    existsSync(path.join(projectRoot, ".env.local")) ? ".env.local" : null,
    existsSync(path.join(projectRoot, ".env")) ? ".env" : null,
  ]
    .filter(Boolean)
    .join(", ") || "none found"}), starting production server on port ${process.env.PORT}…`,
);

await import(standalone);
