# EXPORT MANIFEST — TaskEarn Complete Working Source

| Field | Value |
|---|---|
| Project | **Task Earn Hub** (site title: TASK REWARD) — task-earning rewards platform |
| Package name / version | `task-earn-hub` @ `1.0.0` |
| Source state | The verified original working version (git `verified-original-2026-09-17` / `bf6eb8c` + Task-64-a audit), **byte-identical `src/`, `public/`, `prisma/schema.prisma`** — verified by `diff -r` against the live project |
| Export date | 2026-09-17 (re-verified re-seal: adds `scripts/doctor.mjs` environment diagnostics, `engines.node >= 20.9`, expanded troubleshooting for the machine-global `DATABASE_URL` override — zero application-source changes) |
| ZIP filename | `TaskEarn-Complete-Working-Source.zip` |
| Top-level folder | `task-earn/` (single folder, ready to open in VS Code) |
| ZIP size / file count / SHA-256 | See `CHECKSUM.txt` delivered next to the ZIP (computed after sealing; verify on Windows with `certutil -hashfile TaskEarn-Complete-Working-Source.zip SHA256`) |
| Node.js requirement | 20.9+ (Next.js 16 minimum). Verified with Node 24.19.0 / npm 11 |
| Build result | `npm run build` — **PASSED** (exit 0; all API routes dynamic; standalone output + asset copy OK) |
| Lint result | `npm run lint` — **PASSED** (exit 0, zero issues) |
| Type-check result | `npx tsc --noEmit` — **PASSED** (0 errors) |
| Clean-install result | `npm ci` — **PASSED** (exit 0, exact locked versions: next 16.1.3, react 19.2.3, prisma 6.19.2; postinstall Prisma client generated) |
| Clean-build verification | **PERFORMED on this exact tree**: fresh install → build → production boot with **zero environment variables** (Ready in 71 ms) → full functional regression (below) → dev-mode boot (Ready in 910 ms) → browser E2E |
| Database export status | COMPLETE: `prisma/schema.prisma` (local track, 18-model schema) + `prisma/seed.ts` + `prisma/seed-assets.ts` (46-row live branding incl. the 48,867-char logo) + `scripts/seed-packages.ts` + **pre-seeded demo `db/custom.db`** (works instantly) + Supabase SQL (below) |
| Supabase setup status | COMPLETE: `db/supabase-schema.sql` (canonical, 18 tables, 64 SECURITY DEFINER RPCs, 10 triggers, RLS on all tables, seed data, `NOTIFY pgrst` refresh — 186,835 chars) + organized copies in `supabase/` (schema / migrations / seed / audit) + `supabase/README.md` run book. **Live connectivity verified against the hosted project** (database read OK, auth admin OK) |
| Storage/assets status | No Supabase Storage buckets exist or are needed — all images are data URLs in the database (verified in code and in the SQL). `public/` ships all 3 static assets (logo.svg, hero-illustration.png, robots.txt); no broken asset references |
| Auth backup status | **Honest statement:** hosted Supabase Auth users (9 accounts) remain in the hosted Supabase project; `auth.users` is a hosted system table and was **not** exported. App login/signup/logout uses the app's own JWT-cookie sessions (scrypt hashes in the app DB), which work fully offline |

## Functional verification performed on the exported tree (production build)

| Flow | Result |
|---|---|
| Homepage / branding / logo / hero / footer / navigation | ✅ renders, real branding, 4 VIP plans |
| Signup (API + browser UI, with referral code) | ✅ account created, referral linked, auto-login |
| Login (member + admin) / logout (cookie cleared) | ✅ 200 + valid sessions |
| Dashboard (balances, plan, announcements) | ✅ all 8 member views render with live data |
| VIP/package plans + purchase/activation + admin approval | ✅ plan activates on approval |
| Payment flow (deposit → pending → admin approve → credit) | ✅ withdrawable +Rs 1,000 |
| Task/ad system (start → timer → complete → reward) | ✅ task balance +Rs 220, daily-limit + 24 h guards present |
| Wallet balances (task vs withdrawable, dual-wallet policy) | ✅ exact expected values at every step |
| Referral system (unlock on invitee's plan activation) | ✅ Rs 250 moved task→withdrawable per the documented formula, immutable `referral_unlock` ledger row |
| Withdrawal (request → hold → admin approve) | ✅ hold −Rs 500, approved, ledger row |
| Notifications (admin send → member sees) | ✅ |
| Admin panel (all views, users list, settings) | ✅ 17 sections render with real data |
| Admin image/logo upload (data URL → SystemSetting → branding API) | ✅ |
| Supabase admin panel (serves schema SQL) | ✅ 186,835 chars incl. `NOTIFY pgrst` |
| Supabase hosted-project connectivity (with real keys in test env) | ✅ DB read OK, auth admin OK |
| Backend flip scripts (`backend:local` / `backend:supabase`) | ✅ both directions |
| Responsive layout (390 px mobile) | ✅ no overflow, footer correct |
| Animations (stats count-up on scroll, framer-motion) | ✅ |
| Console/page errors during entire browser E2E | ✅ zero |

## WHAT IS INCLUDED

- `src/` — 199 files: complete app (App Router, 60 API route handlers, all components/hooks/lib, Supabase server track, hash-router SPA)
- `public/` — all static assets (logo.svg, hero-illustration.png, robots.txt)
- `prisma/` — schema.prisma + seed.ts + seed-assets.ts (live branding)
- `scripts/` — 27 helper scripts (all env-driven, secret-free) incl. **`doctor.mjs`** (run `node scripts/doctor.mjs` to diagnose environment/path issues before they look like a broken app)
- `db/` — 5 Supabase SQL files (**canonical location — the admin panel reads `db/supabase-schema.sql` at runtime**) + pre-seeded demo `custom.db`
- `supabase/` — organized copies + README run book (schema / migrations / seed / audit)
- Root configs: `package.json` + `package-lock.json` + `bun.lock` (synced), `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `components.json`, `netlify.toml`, `.gitignore`, `.env.example`
- Docs: `README.md`, `WINDOWS_SETUP.md`, `ENV_SETUP.md`, `supabase/README.md`, `DEPLOYMENT.md`, this manifest
- Demo credentials (documented, seeded): member `demo@taskearn.com` / `Demo@123` · admin `admin@taskearn.com` / `Admin@123`

## WHAT YOU MUST STILL CONFIGURE ON YOUR PC

1. **Nothing for the default local mode** — `npm install` → `npm run dev` works out of the box (bundled pre-seeded db + built-in `DATABASE_URL` fallback). If anything looks off, run `node scripts/doctor.mjs` first — it detects the #1 PC issue (a machine-global `DATABASE_URL` from another project overriding this one) that produces empty stats / missing plans / login errors.
2. Optional: create `.env` from `.env.example` (see `ENV_SETUP.md`).
3. Supabase cloud mode (optional): your two Supabase keys + run the schema SQL once — see `supabase/README.md` §3.
4. On any real deployment: change the demo admin password, set a strong `JWT_SECRET`, configure Supabase Auth Site URL/Redirect URLs.

## WHAT REMAINS HOSTED ONLINE

- Your Supabase project (database + Auth users + recovery-email sending) — untouched by this export.
- Google Fonts (Geist) are fetched at build time from `next/font/google`.

## WHAT CANNOT BE EXPORTED FOR SECURITY REASONS

- **Secrets**: the Supabase service-role key, any password other than the documented demo credentials, JWT secrets — none are in the ZIP (scanned: zero hits).
- **Real member data**: the live database (real users, password hashes, transactions) is not included. The ZIP's database contains demo data + the site's public branding only. Your live data stays in your workspace / hosted project.
- `auth.users` hosted Auth accounts (see honest statement above).

## Security scan of the export

Patterns scanned across all text files + the demo db: service-key prefix, real admin name/email/password, real member emails, scrypt hash strings, JWT strings, absolute sandbox paths — **zero hits**. Demo values (`admin@taskearn.com` / `Admin@123`) appear only in the documented places (README, seed, Supabase SQL).
