/**
 * One-time setup: install YOUR admin account in BOTH the local data store and
 * your Supabase project's Auth.
 *
 * All values come from the environment (never hardcode secrets):
 *
 *   DATABASE_URL=file:../db/custom.db \
 *   ADMIN_EMAIL=you@example.com \
 *   ADMIN_PASSWORD='YourStrongPassword' \
 *   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
 *   npx tsx scripts/supabase-setup.ts
 *
 * (Also reads .env / .env.local automatically when run from the project root.)
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";

if (!url || !serviceKey || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "Missing environment variables. Set NEXT_PUBLIC_SUPABASE_URL, " +
      "SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL and ADMIN_PASSWORD (see the " +
      "usage comment at the top of this file), then re-run.",
  );
  process.exit(1);
}

const ADMIN_NAME = process.env.ADMIN_NAME ?? ADMIN_EMAIL.split("@")[0];

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function cuidLike(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(25);
  return Array.from(bytes).map((b) => alphabet[b % alphabet.length]).join("");
}

async function main() {
  // 1. Remove the seeded demo admin (if the local demo seed was used), keep everything else
  const old = await db.user.findUnique({ where: { email: "admin@taskearn.com" } });
  if (old) {
    await db.transaction.deleteMany({ where: { OR: [{ userId: old.id }, { relatedUserId: old.id }] } });
    await db.userPlan.deleteMany({ where: { userId: old.id } });
    await db.userTask.deleteMany({ where: { userId: old.id } });
    await db.passwordResetToken.deleteMany({ where: { userId: old.id } });
    await db.wallet.deleteMany({ where: { userId: old.id } });
    await db.user.deleteMany({ where: { referredById: old.id } });
    await db.user.delete({ where: { id: old.id } });
    console.log("removed old seeded admin admin@taskearn.com");
  }

  // 2. Create local admin row + wallet
  let admin = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    admin = await db.user.create({
      data: {
        id: cuidLike(),
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        passwordHash: hashPassword(ADMIN_PASSWORD),
        role: "admin",
        referralCode: "ADMIN001",
        createdAt: new Date(),
      },
    });
    await db.wallet.create({ data: { userId: admin.id } });
    console.log("created local admin:", ADMIN_EMAIL, admin.id);
  } else {
    await db.user.update({
      where: { id: admin.id },
      data: { role: "admin", passwordHash: hashPassword(ADMIN_PASSWORD) },
    });
    console.log("promoted existing local user to admin:", ADMIN_EMAIL);
  }

  // 3. Create the Supabase Auth user (visible in your dashboard → Authentication → Users)
  const { data, error } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { name: ADMIN_NAME, role: "admin", referral_code: "ADMIN001" },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message ?? "")) {
      const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
      const users = (list.data as { users?: { id: string; email?: string }[] } | null)?.users ?? [];
      const hit = users.find((u) => (u.email ?? "").toLowerCase() === ADMIN_EMAIL);
      if (hit) {
        await supabase.auth.admin.updateUserById(hit.id, {
          password: ADMIN_PASSWORD,
          email_confirm: true,
          user_metadata: { name: ADMIN_NAME, role: "admin", referral_code: "ADMIN001" },
        });
        await db.user.update({ where: { id: admin.id }, data: { supabaseAuthId: hit.id } });
        console.log("updated existing Supabase auth admin user:", hit.id);
      } else {
        console.log("Supabase auth user exists but could not be located");
      }
    } else {
      console.error("Supabase createUser error:", error.message);
    }
  } else {
    await db.user.update({ where: { id: admin.id }, data: { supabaseAuthId: data.user?.id ?? null } });
    console.log("created Supabase auth admin user:", data.user?.id);
  }

  // 4. Also sync the demo user's auth account (local demo seed only)
  const demo = await db.user.findUnique({ where: { email: "demo@taskearn.com" } });
  if (demo) {
    const { data: d2, error: e2 } = await supabase.auth.admin.createUser({
      email: "demo@taskearn.com",
      password: "Demo@123",
      email_confirm: true,
      user_metadata: { name: demo.name, referral_code: demo.referralCode },
    });
    if (!e2 && d2?.user) {
      await db.user.update({ where: { id: demo.id }, data: { supabaseAuthId: d2.user.id } });
      console.log("created Supabase auth demo user:", d2.user.id);
    } else if (e2 && !/already|registered/i.test(e2.message ?? "")) {
      console.log("demo auth sync skipped:", e2.message);
    } else {
      console.log("demo auth user already exists in Supabase");
    }
  }

  const total = await db.user.count();
  console.log("done. local users:", total);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
