/** Remove E2E test artifacts (run once).
 *
 * Reads your Supabase project from the environment (see .env.example):
 *   DATABASE_URL=file:../db/custom.db \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/cleanup-e2e.ts
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const db = new PrismaClient();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const email = "ayesha.e2e@example.com";
  const u = await db.user.findUnique({ where: { email } });
  if (u) {
    await db.transaction.deleteMany({ where: { OR: [{ userId: u.id }, { relatedUserId: u.id }] } });
    await db.userTask.deleteMany({ where: { userId: u.id } });
    await db.userPlan.deleteMany({ where: { userId: u.id } });
    await db.passwordResetToken.deleteMany({ where: { userId: u.id } });
    await db.wallet.deleteMany({ where: { userId: u.id } });
    await db.user.delete({ where: { id: u.id } });
    console.log("local test user removed");
  } else {
    console.log("local test user already gone");
  }
  // remove from Supabase Auth
  const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const users = (list.data as { users?: { id: string; email?: string }[] } | null)?.users ?? [];
  const hit = users.find((x) => (x.email ?? "").toLowerCase() === email);
  if (hit) {
    const { error } = await supabase.auth.admin.deleteUser(hit.id);
    console.log(error ? "supabase auth delete error: " + error.message : "supabase auth test user removed");
  } else {
    console.log("no supabase auth test user found");
  }
  console.log("final local users:", await db.user.count());
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
