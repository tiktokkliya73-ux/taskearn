# Task Earn Hub — Deployment Guide (Vercel / Netlify)

This is the **final audited codebase**. Deploy exactly as-is; no code changes
are needed or expected before deployment. The primary guide below targets
**Vercel**; §2b covers the equivalent Netlify import (a ready `netlify.toml`
is included).

---

## 0. Running locally / dependency install notes

**Requirement:** Node.js **20.9 or newer** (22 LTS recommended) —
https://nodejs.org. npm comes bundled with Node; bun and pnpm also work.

The Prisma client is generated **automatically on every install** via the
root `postinstall` script (`prisma generate` — see `package.json`). This works
with npm, pnpm and bun. If your toolchain blocks *all* lifecycle scripts
(e.g. `npm/pnpm install --ignore-scripts`, or an allow-scripts policy), run
it once manually afterwards:

```bash
npm install            # or: pnpm install / bun install
npx prisma generate    # only needed if your install blocked scripts
```

The package ships with a **pre-initialized local database**
(`db/custom.db` — schema + the `data_backend = local` switch row), so the
app boots with zero extra setup:

```bash
cp .env.example .env.local   # Windows cmd: copy .env.example .env.local
npm run dev                  # http://localhost:3000
```

All npm scripts are **cross-platform** (Windows / macOS / Linux — no Unix
`cp`/`tee` commands). The useful ones:

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run build` | Production build (also prepares `.next/standalone`) |
| `npm start` | Run the production server (loads `.env.local`/`.env`, serves `.next/standalone`) |
| `npm run db:push` | (Re-)create the local SQLite schema from `prisma/schema.prisma` |
| `npm run db:seed` | **Demo data** — admin `admin@taskearn.com` / `Admin@123`, member `demo@taskearn.com` / `Demo@123` (wipes + reseeds the LOCAL database only — never run in production) |
| `npm run seed:packages` | Add the 4 sample investment packages (local demo, idempotent) |
| `npm run backend:local` | Switch the data backend to LOCAL SQLite |
| `npm run backend:supabase` | Switch the data backend to SUPABASE (run before deploying — see §3) |
| `npm run cron:daily-earnings` | Manually run the nightly investment-earnings engine (idempotent per day) |

> If you ever see `"@prisma/client did not initialize yet"`, it means the
> Prisma client was not generated in `node_modules/.prisma/client` — run
> `npx prisma generate` once and restart. The root `postinstall` makes this
> a non-issue for normal installs.

Framework versions are **pinned** to the audited combination
(`next@16.1.3`, `react@19.2.3`, `react-dom@19.2.3`, `prisma@6.19.2`,
`@prisma/client@6.19.2`, `tsx@4.23.13`) so every install is reproducible and
matches the tested runtime.

Two synchronized lockfiles are included:

- `package-lock.json` — used by **npm** (this is what Vercel uses; it pins the
  entire dependency tree, so a fresh Vercel install reproduces the exact
  tested versions of every package).
- `bun.lock` — used by **bun** for local development.

> Vercel runs a locked install when `package-lock.json` is present — the full
> tree is installed exactly as locked, with no silent version drift.

## 1. Environment variables (set in Vercel BEFORE first deploy)

Vercel → Project → Settings → Environment Variables. Names (values are yours —
never commit them):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | YES | SQLite file for the local data track + the data-backend switch row. Use the relative schema-anchored path `file:../db/custom.db` (Prisma resolves relative SQLite paths against the `prisma/` folder — this targets `<project-root>/db/custom.db` in dev, CLI and the production server) |
| `NEXT_PUBLIC_SUPABASE_URL` | YES* | Your Supabase project URL (auth + password recovery + Supabase data track) |
| `SUPABASE_SERVICE_ROLE_KEY` | YES* | Supabase service key — server-side only, never exposed to the browser |
| `JWT_SECRET` | optional | Long random string signing session cookies. Recommended in production (`openssl rand -hex 32`); if unset a built-in development fallback is used |

\* Required for production operation (see §3).

## 2. How to deploy to Vercel

**Recommended: Vercel Git deployment** (the app has server-side API routes,
so a plain static drag-and-drop deploy is NOT sufficient):

1. Push this project to a Git repository (GitHub/GitLab/Bitbucket) — see the
   README §7a for the exact `git init` commands.
2. In Vercel: *Add New… → Project* → **Import** the repository.
3. Vercel auto-detects **Next.js** — keep the default build settings.
   `postinstall` (`prisma generate`) runs during the install step and
   `next.config.ts` traces the Prisma engine into the serverless functions.
4. Set the environment variables from §1, then **Deploy**.
5. Every future `git push` automatically redeploys (continuous deployment);
  pull requests get preview deployments.

## 2b. How to deploy to Netlify (alternative)

1. Push this project to a Git repository.
2. In Netlify: *Add new site → Import an existing project* → pick the repo.
3. Netlify auto-detects Next.js and uses `netlify.toml` (build command
   `npx prisma generate && npm run build`, publish `.next`, the Next.js
   runtime plugin is declared in `netlify.toml`).
4. Set the three environment variables from §1, then deploy.

(Alternative: `netlify deploy --build` via the Netlify CLI from this folder.)

## 3. Data layer — read this before going live

The app has a **dual data backend** (the persistent-disk logic referenced
below is already implemented in the app — `src/lib/data-backend.ts` reads the
`data_backend` SystemSetting row from the local SQLite file and routes every
API accordingly):

- **Local track** (`data_backend = local`): Prisma + SQLite via `DATABASE_URL`.
- **Supabase track** (`data_backend = supabase`): your Supabase Postgres
  project (schema, RPCs, RLS, member auth records — provisioned from
  `db/supabase-schema.sql`, see §3b).

The switch row lives in the local SQLite table `SystemSetting`
(key `data_backend`). Empirically verified behavior:

- A **missing/empty** SQLite file ⇒ local-track queries fail.
- A **read-only bundled** SQLite file (schema pushed) ⇒ reads succeed —
- which is all the Supabase track needs from the local file.

Switching back and forth is one cross-platform command (no sqlite3 CLI
needed on Windows):

```bash
npm run backend:local       # data_backend = local
npm run backend:supabase    # data_backend = supabase
```

**Recommended production posture on Vercel/Netlify** (serverless = ephemeral
filesystem): run the **Supabase track** and bundle a SQLite file that already
contains `data_backend = supabase`. The shipped `db/custom.db` starts as
`local` (so the app runs out of the box on your PC), so flip it once before
deploying and commit the flipped file:

```bash
# once, from your development machine, after filling .env.local with your Supabase keys
npm run backend:supabase     # flips db/custom.db
# commit the flipped db/custom.db with your deployment
```

(Equivalent manual form, if you prefer the sqlite3 CLI:
`sqlite3 db/custom.db "INSERT OR REPLACE INTO SystemSetting (key, value, updatedAt) VALUES ('data_backend', 'supabase', datetime('now'));"`)

A self-hosted Node server with a persistent disk (the repo's `output:
"standalone"` build via `npm run build && npm start`) can instead keep the
SQLite track writable and use Admin → Supabase → Activate from the admin
panel.

## 3b. Provisioning your Supabase project (fresh project)

The complete, idempotent provisioning script ships with the package:
`db/supabase-schema.sql` (the same file the Admin → Supabase panel serves
in-app). One time, ~10 seconds:

1. Open your Supabase project dashboard → **SQL Editor → New query**.
2. Paste the ENTIRE `db/supabase-schema.sql` file → **Run**.
3. It creates all tables, RLS (default-deny for client keys), the
   SECURITY DEFINER RPCs (all financial rules), seed data, and the initial
   admin account `admin@taskearn.com` (temporary password `Admin@123` —
   **log in once and change it from the website before going live**).
4. The script ends with `NOTIFY pgrst, 'reload schema'` — the PostgREST
   schema-cache refresh. If you ever see an error like
   `"Could not find the table 'public.investment_packages' in the schema cache"`,
   simply re-run that one line from the SQL Editor (or the whole script — it
   is idempotent) to force the cache reload.
5. Back on the website → Admin → Supabase → **Migrate & Activate** (or set
   the `data_backend` switch row as in §3).

The script is safe to re-run at any time (create-or-replace / if-not-exists /
on-conflict-do-nothing everywhere), and running it on an already-provisioned
project never overwrites existing rows.

## 4. Supabase Dashboard — REQUIRED for password recovery

Verified during the final audit — the recovery flow (request → email → link →
recovery session → password reset) is implemented with Supabase Auth's native
mechanism and was verified end-to-end. For it to work **on your production
domain**, set in Supabase Dashboard → Authentication → URL Configuration:

1. **Site URL** → your production URL (e.g. `https://your-app.vercel.app`).
2. **Redirect URLs** → add `https://your-app.vercel.app/**`.

Until this is set, Supabase rewrites recovery redirects to the old Site URL
and emailed links will not open on members' phones.

3. **Email volume**: the built-in Supabase mail sender is capped (~2–4
   emails/hour) and often lands in Gmail spam. For production, configure
   custom SMTP (Authentication → Auth Providers → Email → SMTP Settings).

4. **Phone recovery (optional)**: enable the Phone provider + Twilio
   credentials in the Supabase dashboard if you want SMS/OTP recovery later.

## 5. Security notes

- `prisma/seed.ts` contains **local-development demo credentials** only —
  never run the seed against your production deployment.
- The admin account lives in your Supabase project — manage credentials there.
- No secrets are included in this archive; all credentials come from the
  environment variables above.

## 5b. Deployed runtime notes (Prisma)

- The root `postinstall` script runs `prisma generate` during the platform's
  install step, and `next.config.ts` sets `outputFileTracingIncludes` so the
  generated client (including the native query engine) is carried into the
  runtime bundles. (Netlify's `netlify.toml` additionally prefixes the build
  command with `npx prisma generate &&` for the same reason.)
- On Vercel/Netlify, follow §3 and run the **Supabase data track**; the local
  Prisma/SQLite track is for self-hosted servers with a persistent disk.
- If a serverless function ever reports `"@prisma/client did not initialize
  yet"`, confirm `postinstall` still runs `prisma generate` (or that the
  Netlify build command still starts with `npx prisma generate &&`).

## 6. Post-deployment verification checklist

- [ ] Register a test member → dashboard loads
- [ ] Login / logout works; refresh keeps the session
- [ ] Forgot password → email arrives (check spam) → link opens ON THE
      PRODUCTION DOMAIN → set a new password → login succeeds
- [ ] Admin login → all admin views load → payment methods visible
- [ ] Member support message → admin unread badge updates → admin reply
      visible to the member
- [ ] Deposits / withdrawals function per your business configuration
