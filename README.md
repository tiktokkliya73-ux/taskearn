# Task Earn Hub — Full Source Package

A complete earning-platform web application: members register with referral
codes, activate VIP plans and investment packages, complete daily tasks, earn
rewards and withdraw via EasyPaisa / JazzCash / USDT — with a full admin panel
(users, plans, packages, tasks, deposits, withdrawals, transactions, payment
methods, branding, promo banners, notifications, support tickets, home-page
content and more).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 +
shadcn/ui · Prisma 6 (SQLite local track) · Supabase (production data track +
auth) · Recharts · Framer Motion.

This archive contains **100% of the application source code, configuration,
database schemas, SQL provisioning scripts and public assets** — no placeholders,
no missing imports. The bundled database is **pre-seeded with demo data and the
site's real branding** (logo, favicon, payment accounts, home content), so the
app works end-to-end the moment it is installed. Follow the steps below to run
it locally and deploy it to **Vercel**.

**Documentation index**

| File | Purpose |
|---|---|
| `WINDOWS_SETUP.md` | Step-by-step Windows + VS Code setup (start here on a PC) |
| `ENV_SETUP.md` | Exactly what goes into `.env` (both running modes) |
| `supabase/README.md` | Database export: Supabase schema/migrations/seed + the two running modes |
| `DEPLOYMENT.md` | Vercel (primary) and Netlify deployment guides |
| `EXPORT_MANIFEST.md` | What this export contains, verification results, security notes |

---

## 1. Unzip the archive

- **Windows:** right-click `TaskEarn-Complete-Working-Source.zip` → *Extract All…* (built-in),
  or use 7-Zip / WinRAR.
- **macOS:** double-click the zip, or `unzip TaskEarn-Complete-Working-Source.zip`.
- **Linux:** `unzip TaskEarn-Complete-Working-Source.zip`.

You get one folder:

```
task-earn/
```

All commands below run from inside that folder.

## 2. Requirements

| | |
|---|---|
| **Node.js** | 20.9 or newer (22 LTS recommended) — https://nodejs.org |
| **npm** | bundled with Node (`bun` / `pnpm` also work) |
| **Supabase project** | only for production data / password-recovery email (free tier is fine) |

## 3. Install dependencies

```bash
npm install
```

The Prisma client is generated **automatically on every install** via the root
`postinstall` script (`prisma generate` — see `package.json`). If your toolchain
blocks lifecycle scripts (`npm install --ignore-scripts`), run `npx prisma
generate` once afterwards.

Two synchronized lockfiles are included: `package-lock.json` (npm — used by
Vercel for reproducible installs) and `bun.lock` (bun users).

## 4. Set up the environment file (recommended — and required for db commands)

Copy the template and name it `.env.local` (Next.js loads it automatically and
it is git-ignored):

```bash
# macOS / Linux
cp .env.example .env.local

# Windows (cmd)
copy .env.example .env.local

# Windows (PowerShell)
Copy-Item .env.example .env.local
```

Then open `.env.local` and fill in the values:

```ini
# Local SQLite database — keep the relative path exactly as shipped.
DATABASE_URL=file:../db/custom.db

# Your Supabase project (Project Settings → API). Optional for local-only
# exploration; REQUIRED for production (auth, recovery email, cloud data).
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# OPTIONAL but recommended in production: long random string that signs
# session cookies. Generate one:  openssl rand -hex 32
JWT_SECRET=
```

> **Works even without this step:** if `DATABASE_URL` is not set at all,
> `src/lib/db.ts` automatically falls back to the bundled
> `file:../db/custom.db`, so `npm run dev` boots with zero setup. Creating
> `.env.local` is still **required for the Prisma CLI commands**
> (`npm run db:push`, `npm run db:seed`) and recommended always.

## 5. Run it locally

```bash
npm run dev
```

Open **http://localhost:3000** — that's it.

### The bundled database is already seeded

`db/custom.db` ships **pre-seeded** — full schema plus demo data (13 demo
users, 4 VIP plans, 6 daily tasks, 4 investment packages, transactions,
payouts) **and the site's real branding** (logo, favicon, payment receiving
accounts, home-page content, invite texts, promo banners). Log in straight
away:

| Role | Email | Password |
|---|---|---|
| Admin | `admin@taskearn.com` | `Admin@123` |
| Member | `demo@taskearn.com` | `Demo@123` |

These are **demo credentials** — change or remove them before going live.

### Reset / regenerate the demo data

```bash
npm run db:seed             # wipes + reseeds the LOCAL demo database (incl. branding)
npm run seed:packages       # re-adds the 4 sample investment packages if missing
```

`db:seed` is destructive (it wipes the local database first) but restores the
exact same demo state, branding included. Never run it against a production
database.

### Production build on your own machine

```bash
npm run build     # production build (also prepares .next/standalone)
npm start         # boots the production server (loads .env.local / .env)
```

`npm start` reads your `.env.local` / `.env` automatically (cross-platform —
Windows included) and serves on `http://localhost:3000` (override with
`PORT=4000 npm start`).

> **Note:** the standalone production server snapshots `db/custom.db` at
> **build time** — if you reseed the local demo database, run
> `npm run build` again before `npm start` so the server serves the fresh
> data. (`npm run dev` always reads the live `db/custom.db` directly, so
> day-to-day development is unaffected.)

## 6. Connect your Supabase project (production data + password recovery)

The app has two data tracks. Locally it runs on the **SQLite track**
(`data_backend = local` in `db/custom.db`) — no cloud account needed. For
production you switch to the **Supabase track**:

1. Create/open a project at https://supabase.com → **SQL Editor → New query**.
2. Paste the entire **`db/supabase-schema.sql`** → **Run** (idempotent — safe
   to re-run; creates all tables, RLS, SECURITY DEFINER RPCs, seed data and
   the temporary admin `admin@taskearn.com` / `Admin@123`).
3. Dashboard → **Project Settings → API**: copy the **Project URL** and the
   **service_role key** into your `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
4. (Optional branding) run **`db/supabase-logo-seed.sql`** the same way to load
   the withdrawal-method logos.
5. Authentication → **URL Configuration**: set **SiteURL** to your production
   domain (e.g. `https://your-app.vercel.app`) and add
   `https://your-app.vercel.app/**` (+ optionally `http://localhost:3000/**`)
   to **Redirect URLs** — required for the forgot-password email links. See
   `DEPLOYMENT.md` §4 for the full checklist (SMTP, phone provider, etc.).

Log in once with the temporary admin and **change the password immediately**.

## 7. Deploy to Vercel (step by step)

The app is **fully Vercel-ready**: it is a standard Next.js 16 App Router
project — all API routes are dynamic (`force-dynamic`, no build-time database
access), every request is a relative path, and the Prisma client is generated
during Vercel's install step by the `postinstall` script.

### 7a. Push the project to GitHub

1. Create an empty repository on GitHub (e.g. `task-earn-hub`).
2. From the project folder:

   ```bash
   git init
   git add .
   git commit -m "Task Earn Hub — full source"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/task-earn.git
   git push -u origin main
   ```

   `.gitignore` already excludes `node_modules/`, `.next/`, `.env*` (except
   `.env.example`) — nothing secret is committed.

### 7b. Prepare the data backend for serverless

Vercel functions have an **ephemeral filesystem**, so production must run on
the **Supabase data track**. The backend switch lives inside `db/custom.db`
(`data_backend` row), and that file is bundled into every deployment — so flip
it **once** on your machine and commit the flipped file:

```bash
# after filling .env.local with your Supabase keys and provisioning §6
npm run backend:supabase      # flips db/custom.db → data_backend = supabase
git add db/custom.db
git commit -m "switch data backend to supabase for production"
git push
```

> Verified behavior: serverless functions only ever **read** the bundled
> SQLite switch file — reads work from a read-only bundle. All real data
> lives in your Supabase project.

### 7c. Import the repository into Vercel

1. Go to https://vercel.com → **Add New… → Project**.
2. **Import** your `task-earn` Git repository.
3. Vercel auto-detects **Next.js** (framework preset) — keep the defaults:
   Build Command `next build` (or leave blank — auto), Output auto.
   `next.config.ts` and the root `postinstall` handle everything else.
4. Before clicking **Deploy**, open **Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `file:../db/custom.db` (exactly as shipped) |
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service-role key |
   | `JWT_SECRET` | long random string (e.g. `openssl rand -hex 32`) |

5. Click **Deploy** and wait ~2–3 minutes.

### 7d. Automated continuous deployment

From now on, **every `git push` to `main` automatically builds and deploys**
a new production release (Vercel CI). Pull requests get preview deployments
with their own URL. Change an environment variable any time in *Project →
Settings → Environment Variables*, then *Deployments → ⋯ → Redeploy*.

### 7e. Post-deployment checklist

- [ ] Open `https://your-app.vercel.app` — landing page renders with stats
- [ ] Register a test member → dashboard loads
- [ ] Login / logout works; refresh keeps the session
- [ ] Admin login → all admin views load → payment methods visible
- [ ] Forgot password → email arrives (check spam) → link opens **on the
      production domain** → set a new password → login succeeds
- [ ] Deposits / withdrawals function per your business configuration

> **Alternative host (Netlify):** a ready `netlify.toml` is included — see
> `DEPLOYMENT.md` §2 for the Netlify-specific import steps. The Vercel flow
> above is otherwise identical for any Next.js-capable host.

## 8. Useful commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server (http://localhost:3000) |
| `npm run build` / `npm start` | Production build / run the production server |
| `npm run lint` | ESLint (flat config in `eslint.config.mjs`) |
| `npm run db:push` | (Re-)create the local SQLite schema from `prisma/schema.prisma` |
| `npm run db:seed` | Reset the local demo data (admin + member accounts + branding) |
| `npm run seed:packages` | Sample investment packages (local demo, idempotent) |
| `npm run backend:local` / `backend:supabase` | Switch the data track |
| `npm run cron:daily-earnings` | Manually run the nightly investment-earnings engine (idempotent per day) |
| `node scripts/doctor.mjs` | Environment sanity check — Node version, **machine-global `DATABASE_URL` override detection**, database file, Supabase variables |

All npm scripts are **cross-platform** (Windows / macOS / Linux).

## 9. Project structure

```
task-earn/
├─ src/
│  ├─ app/                  Next.js App Router (the / route + ~60 API routes)
│  ├─ components/           auth · landing · dashboard · admin · shadcn/ui
│  ├─ lib/                  db, settings, auth/JWT, business rules, helpers
│  └─ server/supabase/      Supabase-track API implementations + migration
├─ prisma/
│  ├─ schema.prisma         complete ORM schema (SQLite local track)
│  ├─ seed.ts               local demo data (admin + member accounts)
│  └─ seed-assets.ts        the live site's branding export (logo, favicon,
│                           banners, payment accounts) used by the seed
├─ db/
│  ├─ custom.db             pre-seeded local SQLite (demo data + branding +
│                           data_backend switch row)
│  ├─ supabase-schema.sql   complete Supabase provisioning (tables/RLS/RPCs)
│  ├─ supabase-migration.sql        local→Supabase data migration script
│  ├─ supabase-upgrade-withdrawal-support.sql   later schema upgrade
│  ├─ supabase-audit-diagnostic.sql            diagnostic queries
│  └─ supabase-logo-seed.sql         withdrawal-method logo branding
├─ scripts/                 copy-standalone · start-server · doctor · flip-backend ·
│                           daily-earnings · seed-packages · supabase-setup ·
│                           validators
├─ public/                  logo.svg · hero-illustration.png · robots.txt
├─ next.config.ts           standalone output + Prisma file tracing
├─ netlify.toml             alternative Netlify build config
├─ DEPLOYMENT.md            the full deployment guide (READ before going live)
├─ .env.example             environment variable template
├─ package.json / package-lock.json / bun.lock
├─ tsconfig.json · tailwind.config.ts · postcss.config.mjs
├─ eslint.config.mjs        (ESLint 9 flat config — the modern equivalent of .eslintrc.json)
└─ components.json          shadcn/ui component configuration
```

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Homepage stats show "—" · VIP plans empty · generic logo · login says "Something went wrong. Please try again." | Every data API is returning 500 — almost always a **machine-global `DATABASE_URL`** (set on the PC by another project via `setx`) silently overriding `.env` / `.env.local`, or a wrong path in `.env` | Run `node scripts/doctor.mjs`. If it reports a `DATABASE_URL` resolving outside this folder: Windows → "Edit the system environment variables" → Environment Variables… → delete `DATABASE_URL` (User **and** System), open a **new** terminal, restart `npm run dev`. |
| Not sure you have the correct/latest ZIP | An older export may still be on disk | Verify the archive: `certutil -hashfile TaskEarn-Complete-Working-Source.zip SHA256` (Windows) or `shasum -a 256 TaskEarn-Complete-Working-Source.zip` (macOS/Linux) and compare with `CHECKSUM.txt` shipped next to the ZIP. |
| APIs return 500 / "Environment variable not found: DATABASE_URL" | `.env` / `.env.local` missing **and** running an old checkout without the runtime fallback | Create `.env.local` from `.env.example` (see §4). The bundled `src/lib/db.ts` also falls back to `file:../db/custom.db` automatically. |
| No users / cannot log in / empty plans & payouts | Database was recreated with `db:push` only (schema, no data) | Run `npm run db:seed` (restores demo users, plans, payouts + branding) |
| Generic coin icon instead of the site logo | Branding rows missing from the database (logo lives in `system_settings`, not in a file) | Run `npm run db:seed`, or upload the logo again at `/admin/branding` |
| `npm run dev` fails on Windows (`tee is not recognized`) | Unix-only pipe in an old dev script | This archive's `dev` script is plain `next dev -p 3000` — cross-platform |
| Prisma error "did not initialize yet" / query engine missing | `postinstall` was skipped (`--ignore-scripts`) | Run `npx prisma generate` |
| Forgot-password email link opens the wrong domain | Supabase Auth Site URL not set | Supabase → Authentication → URL Configuration → set SiteURL + Redirect URLs (§6.5) |

## 11. Security notes

- **No secrets are included in this archive** — all credentials come from
  your environment (`.env.local` locally, Vercel env vars in production).
- `.env*` is git-ignored; never commit real keys or push them to a repository.
- `prisma/seed.ts` and `db/supabase-schema.sql` contain **demo/temporary
  credentials only** — change them before going live and never run the seed
  against production.
- `prisma/seed-assets.ts` contains **branding content only** (logo/favicon
  images, banner artwork, payment receiving accounts as shown on the public
  checkout) — no credentials, no user data.
- The Supabase `service_role` key bypasses row-level security — keep it
  server-side only (the app never exposes it to the browser).
- Admin setup helper `scripts/supabase-setup.ts` reads `ADMIN_EMAIL` /
  `ADMIN_PASSWORD` from the environment — nothing is hardcoded.
