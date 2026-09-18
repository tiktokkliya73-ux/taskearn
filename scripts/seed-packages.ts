/**
 * Seed investment packages (Task 10) — additive & idempotent.
 * Run with: bun scripts/seed-packages.ts
 *
 * Creates the 4 dynamic investment packages (only when the table is empty so
 * admin customizations are never overwritten) and gives the demo user one
 * active Mini Plan instance so "My Packages" + the daily-earnings cron have
 * data to work with. Nothing existing is modified.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PACKAGES = [
  { title: "Mini Plan", price: 213, dailyEarning: 100, durationDays: 36500 },
  { title: "Starter Plan", price: 1150, dailyEarning: 500, durationDays: 730 },
  { title: "Growth Plan", price: 2950, dailyEarning: 1300, durationDays: 365 },
  { title: "Pro Plan", price: 5750, dailyEarning: 2600, durationDays: 365 },
] as const;

async function main() {
  console.log("🌱 Seeding investment packages…");

  const existing = await db.investmentPackage.count();
  if (existing > 0) {
    console.log(`↩ Skipping package seed — ${existing} package(s) already exist (admin data preserved).`);
  } else {
    for (const [i, p] of PACKAGES.entries()) {
      const totalReturn = p.dailyEarning * p.durationDays;
      await db.investmentPackage.create({
        data: {
          title: p.title,
          price: p.price,
          dailyEarning: p.dailyEarning,
          durationDays: p.durationDays,
          totalReturn,
          netProfit: totalReturn - p.price,
          isActive: true,
          sortOrder: i + 1,
        },
      });
      console.log(`  + ${p.title}: Rs ${p.price} → Rs ${p.dailyEarning}/day × ${p.durationDays}d (total Rs ${totalReturn.toLocaleString()})`);
    }
  }

  // Demo user gets one active Mini Plan (started 3 days ago) so the Packages
  // tab and the daily-earnings engine have something to show. lastEarningDate
  // is yesterday → the next earnings run credits today's Rs 100.
  const demo = await db.user.findUnique({ where: { email: "demo@taskearn.com" } });
  const mini = await db.investmentPackage.findFirst({ where: { title: "Mini Plan" } });
  if (demo && mini) {
    const hasInstance = await db.userPackage.findFirst({ where: { userId: demo.id } });
    if (!hasInstance) {
      const startedAt = new Date(Date.now() - 3 * 86400_000);
      await db.userPackage.create({
        data: {
          userId: demo.id,
          packageId: mini.id,
          investAmount: mini.price,
          dailyEarning: mini.dailyEarning,
          status: "active",
          lastEarningDate: new Date(Date.now() - 86400_000).toISOString().slice(0, 10),
          startedAt,
          endsAt: new Date(startedAt.getTime() + mini.durationDays * 86400_000),
        },
      });
      console.log(`  + demo@taskearn.com now holds an active ${mini.title} instance (Rs ${mini.dailyEarning}/day)`);
    } else {
      console.log("↩ Demo user already holds package instances — left untouched.");
    }
  }

  console.log("✅ Done.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
