# WINDOWS_SETUP — run TaskEarn on a Windows PC with VS Code

## 1. Install Node.js

- Version **20.9 or newer** required by Next.js 16. Recommended: **Node 22 LTS**
  (verified in this export with Node 24).
- Download from https://nodejs.org → LTS installer → default options.
- Verify (open a new Command Prompt / PowerShell):
  ```bat
  node -v
  npm -v
  ```

## 2. Extract the ZIP

- Right-click `TaskEarn-Complete-Working-Source.zip` → **Extract All…**
- You get a single folder `task-earn/` containing the whole project.

## 3. Open the folder in VS Code

- VS Code → **File → Open Folder…** → select `task-earn`.
- When VS Code suggests extensions (ESLint etc.), installing them is optional.

## 4. Install dependencies

- VS Code → **Terminal → New Terminal** (this opens in the project folder):
  ```bat
  npm install
  ```
- Takes a few minutes on first run. It also auto-generates the Prisma client
  (`postinstall` hook). Internet connection required.

## 5. Create your `.env`

```bat
copy .env.example .env
```
…or skip this step entirely for the default local mode (the app has a
built-in fallback). See **`ENV_SETUP.md`** for the exact contents for both
running modes.

## 6. Configure environment variables

Only needed if you want the Supabase cloud track / password-recovery emails —
follow `ENV_SETUP.md` MODE B. Default local mode needs nothing.

## 7. Configure Supabase (optional — Mode B only)

Follow `supabase/README.md` §3 (run the schema SQL once in the Supabase SQL
Editor, copy the two keys into `.env`, flip the backend).

## 8. Local database — already included

The export ships a **pre-seeded demo database** (`db/custom.db`): demo member
+ admin accounts, 4 VIP plans, 6 tasks, 4 investment packages and the full
site branding. Nothing to run. To regenerate it from scratch instead:
```bat
npm run db:push
npm run db:seed
npm run seed:packages
```

## 9. Start the dev server

**Recommended pre-flight** (10 seconds — catches the #1 PC issue before it
looks like a broken app):

```bat
node scripts\doctor.mjs
```

It verifies your Node version, that **no machine-global `DATABASE_URL` from
another project is hijacking this one** (Next.js lets the machine environment
override `.env` files — that single conflict produces empty stats "—", missing
VIP plans, a generic logo and login errors), that the bundled database file is
present, and whether the Supabase variables are configured.

Then:

```bat
npm run dev
```
Wait for `✓ Ready` in the terminal.

## 10. Open the website

- Browser: **http://localhost:3000**
- Demo logins (seeded, documented, change on any real deployment):

  | Role | Email | Password |
  |---|---|---|
  | Member | `demo@taskearn.com` | `Demo@123` |
  | Admin | `admin@taskearn.com` | `Admin@123` |

- Sign up a new account any time from the landing page (referral code
  `DEMO1234` belongs to the demo member).

## 11. Production build (optional, exactly what deployment runs)

```bat
npm run build
npm start
```
`npm start` serves the compiled app on the same http://localhost:3000.

## 12. Lint / type checks

```bat
npm run lint
npx tsc --noEmit
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Stats show "—" / VIP plans empty / generic logo / login "Something went wrong" | A machine-global `DATABASE_URL` (from another project) is overriding `.env` — run `node scripts\doctor.mjs`; if it flags an outside path: Windows search "Edit the system environment variables" → Environment Variables… → delete `DATABASE_URL` (User + System), open a NEW terminal, restart. |
| Not sure this is the latest ZIP | `certutil -hashfile TaskEarn-Complete-Working-Source.zip SHA256` and compare with `CHECKSUM.txt` next to the archive. |
| `'npm' is not recognized` | Node.js not installed / terminal opened before install — reopen terminal, check `node -v`. |
| `npm run dev` errors about the port | Another app uses port 3000. Close it, or edit the `-p 3000` value in `package.json` → `scripts.dev`. |
| `prisma` / `@prisma/client` errors | Run `npx prisma generate`, then `npm run dev` again. |
| Login fails on a **fresh regenerated** db | You ran `db:push` (schema only) without `db:seed`. Run `npm run db:seed` and `npm run seed:packages`. |
| Forgot-password says "recovery email not configured" | Expected on local mode — Supabase env vars missing. See `ENV_SETUP.md` MODE B. |
| Build fails to fetch Google fonts (offline) | `next/font/google` needs internet during build. Connect and rebuild. |
| Supabase track errors | Check the two Supabase vars, run the schema SQL (supabase/README.md §3); the app automatically falls back to the local track if Supabase is unreachable. |
