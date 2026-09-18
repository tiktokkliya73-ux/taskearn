# Supabase Integration — TaskEarn

This folder documents and organizes **everything database-related** for the
TaskEarn website: the Supabase (PostgreSQL) track, the default local SQLite
track, and how to switch between them.

---

## 1. How the app talks to data (dual-track, built-in)

| Track | Database | Status |
|---|---|---|
| **`local`** (default) | Local SQLite file `db/custom.db` via Prisma | Ships **pre-seeded** in this export — the site runs with zero configuration |
| **`supabase`** | Your hosted Supabase PostgreSQL project | Opt-in — flip when you want the cloud database |

- The switch is a single database row: `SystemSetting` key **`data_backend`**,
  value `"local"` or `"supabase"` (see `src/lib/data-backend.ts`).
- Switching methods: **Admin panel → Supabase → Migrate & Activate**, or the
  npm scripts `npm run backend:local` / `npm run backend:supabase`.
- The check uses a 5-second cache and **fails safe to the local track** if
  Supabase is unreachable, so the site never goes down because of the switch.
- On the Supabase track, every wallet mutation runs through
  `SECURITY DEFINER` RPC functions server-side (the service-role key is never
  exposed to the browser), and **Row-Level Security is enabled on all tables**
  with deny-all policies for publishable (anon) keys.

## 2. What is in this folder

> **Runtime note:** the in-app admin panel (Admin → Supabase) reads
> `db/supabase-schema.sql` from disk at request time, so the **canonical copy
> of every SQL file must remain in `db/`**. The copies in this folder are
> provided for organized reading and are byte-identical.

| File | Purpose |
|---|---|
| `schema/supabase-schema.sql` | **Canonical full provisioning script** — 18 tables, 64 `SECURITY DEFINER` functions/RPCs, 10 triggers, RLS enabled on every table, seed data (settings, 4 VIP plans, 6 tasks, demo admin), and the `NOTIFY pgrst, 'reload schema'` cache refresh. Idempotent (`create table if not exists`, `on conflict do nothing`). |
| `migrations/supabase-migration.sql` | Consolidated 1:1 migration derived from the schema (same 18 tables + data). Reference/audit copy. |
| `migrations/supabase-upgrade-withdrawal-support.sql` | Incremental upgrade for deployments provisioned before the withdrawal/support-ticket features (adds `support_tickets`, 4 RPCs, extra settings, payment-method seeds). Fully idempotent. |
| `seed/supabase-logo-seed.sql` | **Optional** media seed — writes the base64 data-URL images (payout-channel logos, payment-method logos, site branding, team-salary banner) into the `logo_url` columns / `system_settings`. |
| `audit/supabase-audit-diagnostic.sql` | 100% read-only diagnostics: catalog query + data-integrity checks + storage bucket listing. |

**Database objects covered by the schema:** 18 tables (`users`, `wallets`,
`plans`, `tasks`, `user_plans`, `user_tasks`, `transactions`,
`system_settings`, `password_reset_tokens`, `notifications`,
`investment_packages`, `user_packages`, `promo_codes`, `promo_claims`,
`payment_methods`, `withdrawal_methods`, `package_task_logs`,
`support_tickets`), their columns/types/keys/unique constraints, indexes,
64 functions (RPCs), 10 triggers, RLS enablement on all tables.
No enums or extensions beyond the Supabase defaults are required.
The **local SQLite track** is defined by `prisma/schema.prisma` (the exact
same model) and is pushed with `npm run db:push`.

## 3. OPTION A — connect to your existing hosted Supabase project

1. Open your Supabase dashboard → **SQL Editor** → New query.
2. Paste the entire contents of `supabase/schema/supabase-schema.sql` → **Run**.
   (Idempotent — safe on a project that already has the tables.)
3. Dashboard → **Settings → API**: copy the **Project URL** and the
   **service_role** key.
4. Put both into `.env` (or `.env.local`) — see `ENV_SETUP.md`.
5. Flip the app to the cloud database:
   `npm run backend:supabase` (or Admin → Supabase → Migrate & Activate).
6. **Auth URLs** — dashboard → Authentication → URL Configuration:
   - `Site URL` = your production origin (e.g. `https://your-app.vercel.app`)
   - `Redirect URLs` = your origin `/**` **plus** `http://localhost:3000/**`
     if you also run locally against the same project.
   Until this is set, password-recovery email links point at the old Site URL.
7. Optional: run `supabase/seed/supabase-logo-seed.sql` to install the image
   assets on the cloud database too.

## 4. OPTION B — run fully local (the default)

- **Nothing to configure.** The export ships a pre-seeded local SQLite
  database (`db/custom.db`) with `data_backend = local`, demo members, plans,
  tasks, packages and the full site branding. `npm install` → `npm run dev`.
- Reset/regenerate the local database any time:
  ```bash
  npm run db:push          # recreate the schema (prisma/schema.prisma)
  npm run db:seed          # demo users, plans, tasks, transactions, branding
  npm run seed:packages    # 4 investment packages + demo plan instance
  ```
- **Honest scope note:** the "local" track is SQLite (Prisma), *not* a local
  Postgres/Supabase emulator. Running the Supabase stack locally via the
  Supabase CLI / Docker is possible with the same SQL files (they are standard
  PostgreSQL), but it is not wired into the app — the app's local mode is
  SQLite by design.

## 5. Authentication users — what stays hosted

- **Login / signup / logout** use the app's own sessions: `scrypt` password
  hashes in the app database + signed httpOnly JWT cookie (`te_session`).
- **Supabase Auth (GoTrue)** is used *server-side* for password-recovery
  emails and as the auth bridge on the Supabase track (lazy account linking
  + two-way hash sync).
- Existing Supabase Auth users **remain hosted in your Supabase project** —
  `auth.users` is a hosted system table and is **not** part of this export.
  A full Auth backup was not performed and is not claimed.
- Without the Supabase env vars everything works locally **except**
  forgot-password emails (the API answers an honest 503
  "recovery email not configured").

## 6. Supabase Storage

**The app uses no Supabase Storage buckets.** All images (site logo, favicon,
payment-channel logos, banners) are stored as base64 **data URLs inside the
database** (`system_settings` values and `logo_url` columns). There are no
buckets, no storage policies and no upload rules to configure. Admin image
uploads go through `POST /api/admin/settings` → `SystemSetting` rows.

## 7. Where the real member data lives

For security, the **real member data (real users, password hashes,
transactions) is not included** in this export. The ZIP's database contains
demo data + the site's public branding. Your live data remains in your
workspace database / hosted Supabase project.
