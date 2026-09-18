# ENV_SETUP — exactly what goes into `.env` on your PC

The app needs at most **4 environment variables**. Everything else is built in.

> Windows: create the file `.env` in the project root (same folder as
> `package.json`) with VS Code: right-click → New File → name it `.env`.
> Or in the terminal: `copy .env.example .env` (cmd) /
> `Copy-Item .env.example .env` (PowerShell). Then edit it.

---

## Variable reference

| Variable | Scope | Required? | What it does / where to get it |
|---|---|---|---|
| `DATABASE_URL` | Server | Optional at runtime, **required for CLI** (`db:push`, `db:seed`) | Path of the local SQLite database. Use exactly `file:../db/custom.db` (Prisma resolves it against the `prisma/` folder → `<project>/db/custom.db`). If omitted entirely, `src/lib/db.ts` falls back to the same value automatically, so `npm run dev` still works right after unzip. |
| `NEXT_PUBLIC_SUPABASE_URL` | Server-side use (despite the name, never referenced in browser code) | Only for the Supabase track / password-recovery emails | Supabase dashboard → **Settings → API → Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only SECRET** | Only for the Supabase track / recovery emails | Supabase dashboard → **Settings → API → service_role** key. Treat it like a root password — anyone holding it has full database access. Never put it in client code, never commit it. |
| `JWT_SECRET` | Server | Optional | Long random string that signs session cookies. If unset, a built-in development value is used (fine locally). For production generate one, e.g. `openssl rand -hex 32` (or any 64+ random characters). |

Script-only (leave empty unless you run those helper scripts):
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` (used by
`scripts/supabase-setup.ts`), `DB_PATH` (debug scripts).

Supabase **dashboard-side** settings (not `.env` vars): `Site URL` and
`Redirect URLs` under Authentication → URL Configuration — see
`supabase/README.md` §3 step 6.

---

## MODE A — default local run (what 99% of people want)

`.env` contents (this is also the **zero-config** case — even an empty/missing
`.env` works because of the built-in fallback):

```env
DATABASE_URL=file:../db/custom.db
```

Result: the site runs on the bundled demo database immediately.
Forgot-password emails are unavailable in this mode (honest 503).

## MODE B — connect to your existing hosted Supabase project

`.env` contents:

```env
DATABASE_URL=file:../db/custom.db
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=some-long-random-string-you-generated
```

Then:
1. Run `supabase/schema/supabase-schema.sql` once in the Supabase SQL Editor
   (see `supabase/README.md` §3).
2. `npm run backend:supabase` (or Admin → Supabase → Migrate & Activate).

## Security rules

- `.env` is git-ignored — still, **never** commit or share it.
- The service-role key gives full database access. Only ever paste it into
  `.env` on machines you control.
- This export intentionally ships **no secret values** — names only
  (`.env.example`).
