/**
 * TaskEarn seed — run with: npm run db:seed   (or: bunx/bun prisma/seed.ts)
 * Creates settings, plans, tasks, admin + demo users, referrals, transaction history.
 * LOCAL demo database only — never run this against a production deployment
 * (it wipes and reseeds the local SQLite database).
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { getSettings } from "../src/lib/settings";
import { SEED_SETTINGS } from "./seed-assets";

const db = new PrismaClient();

const hours = (h: number) => new Date(Date.now() - h * 3600_000);
const days = (d: number) => new Date(Date.now() - d * 86400_000);
const daysFromNow = (d: number) => new Date(Date.now() + d * 86400_000);
const todayStr = new Date().toISOString().slice(0, 10);
const daysAgoStr = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);

async function main() {
  console.log("🌱 Seeding TaskEarn…");

  // wipe (FK-safe order)
  await db.passwordResetToken.deleteMany();
  await db.transaction.deleteMany();
  await db.userTask.deleteMany();
  await db.userPlan.deleteMany();
  await db.wallet.deleteMany();
  await db.user.deleteMany();
  await db.systemSetting.deleteMany();
  await db.plan.deleteMany();
  await db.task.deleteMany();

  // ── settings ──
  // SEED_SETTINGS (prisma/seed-assets.ts) carries the production site's real
  // branding + configuration — the admin-uploaded logo & favicon data URLs,
  // payment receiving accounts, home-page content, invite texts, promo
  // banners — so the seeded local database looks exactly like the live site.
  // The data-backend switch is always forced to the local SQLite track.
  const settings: Record<string, string> = {
    ...SEED_SETTINGS,
    data_backend: "local",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.systemSetting.create({ data: { key, value } });
  }

  // ── plans ──
  const planDefs = [
    { name: "VIP 1 · Starter", description: "Entry-level plan — warm up your daily earnings.", price: 1500, rewardPerTask: 75, dailyTaskLimit: 2, durationDays: 30, sortOrder: 1 },
    { name: "VIP 2 · Silver", description: "Our most popular plan — balanced rewards and tasks.", price: 5000, rewardPerTask: 220, dailyTaskLimit: 3, durationDays: 30, sortOrder: 2 },
    { name: "VIP 3 · Gold", description: "For serious earners — bigger daily rewards.", price: 15000, rewardPerTask: 700, dailyTaskLimit: 3, durationDays: 30, sortOrder: 3 },
    { name: "VIP 4 · Platinum", description: "Maximum earning power with extended validity.", price: 40000, rewardPerTask: 2000, dailyTaskLimit: 3, durationDays: 45, sortOrder: 4 },
  ];
  const plans: Record<string, string> = {};
  for (const p of planDefs) {
    const plan = await db.plan.create({ data: p });
    plans[p.name] = plan.id;
  }

  // ── tasks ──
  const taskDefs = [
    { title: "Watch Sponsored Video", description: "Watch a short sponsor video and verify the code.", url: "https://www.youtube.com", durationSeconds: 15, sortOrder: 1 },
    { title: "Join Telegram Channel", description: "Join our official channel for daily bonus codes.", url: "https://telegram.org", durationSeconds: 10, sortOrder: 2 },
    { title: "Follow Social Page", description: "Follow our partner's social page.", url: "https://www.facebook.com", durationSeconds: 10, sortOrder: 3 },
    { title: "Visit Partner Website", description: "Browse a partner site for the required time.", url: "https://example.com", durationSeconds: 12, sortOrder: 4 },
    { title: "Complete Mini Survey", description: "Answer a 3-question survey.", url: "https://example.com/survey", durationSeconds: 20, sortOrder: 5 },
    { title: "Share Promo Post", description: "Share today's promo post to your feed.", url: "https://twitter.com", durationSeconds: 10, sortOrder: 6 },
  ];
  const tasks: Record<string, string> = {};
  for (const t of taskDefs) {
    const task = await db.task.create({ data: t });
    tasks[t.title] = task.id;
  }

  // ── users ──
  async function mkUser(opts: {
    name: string; email: string; password: string; role?: string;
    referralCode: string; referredById?: string; ip?: string; fp?: string;
    taskBalance?: number; withdrawableBalance?: number; createdAt?: Date; lastLoginAt?: Date;
  }) {
    const user = await db.user.create({
      data: {
        name: opts.name, email: opts.email, passwordHash: hashPassword(opts.password),
        role: opts.role ?? "user", referralCode: opts.referralCode,
        referredById: opts.referredById ?? null,
        ipAddress: opts.ip ?? null, fingerprint: opts.fp ?? null,
        createdAt: opts.createdAt ?? days(20), lastLoginAt: opts.lastLoginAt ?? hours(2),
      },
    });
    await db.wallet.create({
      data: { userId: user.id, taskBalance: opts.taskBalance ?? 0, withdrawableBalance: opts.withdrawableBalance ?? 0 },
    });
    return user;
  }

  const admin = await mkUser({
    name: "Site Admin", email: "admin@taskearn.com", password: "Admin@123", role: "admin",
    referralCode: "ADMIN001", createdAt: days(45), lastLoginAt: hours(1),
  });

  const demo = await mkUser({
    name: "Demo User", email: "demo@taskearn.com", password: "Demo@123",
    referralCode: "DEMO1234", ip: "103.45.201.77", fp: "fp_demo_a1b2c3d4e5f6",
    taskBalance: 2450, withdrawableBalance: 5820, createdAt: days(20), lastLoginAt: hours(1),
  });

  const ali = await mkUser({
    name: "Ali Khan", email: "ali@example.com", password: "User@123",
    referralCode: "ALIKHAN1", referredById: demo.id, ip: "103.45.201.88", fp: "fp_ali_khan_778899",
    taskBalance: 900, withdrawableBalance: 0, createdAt: days(9),
  });

  const sara = await mkUser({
    name: "Sara Ahmed", email: "sara@example.com", password: "User@123",
    referralCode: "SARAAHM2", referredById: demo.id, ip: "103.45.201.99", fp: "fp_sara_ah_556677",
    taskBalance: 1320, withdrawableBalance: 0, createdAt: days(3),
  });

  const bilal = await mkUser({
    name: "Bilal Raza", email: "bilal@example.com", password: "User@123",
    referralCode: "BILALRAZ", referredById: demo.id, ip: "182.44.10.5", fp: "fp_bilal_112233",
    taskBalance: 0, withdrawableBalance: 0, createdAt: days(1), lastLoginAt: hours(5),
  });

  // payout users (for ticker & stats)
  const payoutUsers = [
    { name: "Hassan Iqbal", email: "hassan@example.com", code: "HASSIQ1", amount: 1500, method: "easypaisa", at: hours(1), dep: 5000 },
    { name: "Fatima Noor", email: "fatima@example.com", code: "FATINO2", amount: 3200, method: "jazzcash", at: hours(4), dep: 5000 },
    { name: "Usman Tariq", email: "usman@example.com", code: "USMANT3", amount: 7800, method: "usdt", at: hours(7), dep: 15000 },
    { name: "Ayesha Malik", email: "ayesha@example.com", code: "AYESMA4", amount: 5000, method: "easypaisa", at: hours(11), dep: 5000 },
    { name: "Imran Shah", email: "imran@example.com", code: "IMRASH5", amount: 12000, method: "jazzcash", at: hours(16), dep: 15000 },
    { name: "Zainab Fatima", email: "zainab@example.com", code: "ZAINFA6", amount: 2000, method: "easypaisa", at: hours(20), dep: 1500 },
  ];

  // ── user plans ──
  await db.userPlan.create({
    data: { userId: demo.id, planId: plans["VIP 2 · Silver"], startedAt: days(12), expiresAt: daysFromNow(18) },
  });
  await db.userPlan.create({
    data: { userId: ali.id, planId: plans["VIP 1 · Starter"], startedAt: days(8), expiresAt: daysFromNow(22) },
  });
  await db.userPlan.create({
    data: { userId: sara.id, planId: plans["VIP 2 · Silver"], startedAt: days(2), expiresAt: daysFromNow(28) },
  });

  // ── daily task records (demo: 1 completed + 1 in progress today) ──
  await db.userTask.create({
    data: { userId: demo.id, taskId: tasks["Watch Sponsored Video"], date: todayStr, startedAt: hours(3), completedAt: hours(3) },
  });
  await db.userTask.create({
    data: { userId: demo.id, taskId: tasks["Join Telegram Channel"], date: todayStr, startedAt: hours(1), completedAt: null },
  });

  // ── transactions: demo ──
  const demoTxns = [
    { userId: demo.id, type: "deposit", amount: 5000, status: "approved", description: "Deposit approved — VIP 2 · Silver plan activated", at: days(12), meta: { planId: plans["VIP 2 · Silver"], purpose: "plan", paymentMethod: "jazzcash", txId: "JC-88291047" } },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(11), meta: { taskId: tasks["Watch Sponsored Video"] } },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(10), meta: { taskId: tasks["Join Telegram Channel"] } },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(9), meta: { taskId: tasks["Follow Social Page"] } },
    { userId: demo.id, type: "referral_unlock", amount: 300, status: "completed", description: "Referral unlock from Ali Khan's plan activation", relatedUserId: ali.id, at: days(8), meta: { inviteeId: ali.id, unlockAmount: 300, actualUnlock: 300 } },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(7), meta: {} },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(6), meta: {} },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(5), meta: {} },
    { userId: demo.id, type: "withdrawal", amount: 2500, status: "approved", description: "Withdrawal paid via EasyPaisa", at: days(5), meta: { paymentMethod: "easypaisa", accountDetails: "0300-9998887" } },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(4), meta: {} },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(3), meta: {} },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(2), meta: {} },
    { userId: demo.id, type: "referral_unlock", amount: 300, status: "completed", description: "Referral unlock from Sara Ahmed's plan activation", relatedUserId: sara.id, at: days(2), meta: { inviteeId: sara.id, unlockAmount: 300, actualUnlock: 300 } },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(1), meta: {} },
    { userId: demo.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward (today)", at: hours(3), meta: { taskId: tasks["Watch Sponsored Video"] } },
  ];
  for (const t of demoTxns) {
    await db.transaction.create({
      data: {
        userId: t.userId, type: t.type, amount: t.amount, status: t.status,
        description: t.description, createdAt: t.at, processedAt: t.at,
        relatedUserId: (t as { relatedUserId?: string }).relatedUserId ?? null,
        meta: JSON.stringify(t.meta ?? {}),
      },
    });
  }

  // ali + sara history
  const aliTxns = [
    { userId: ali.id, type: "deposit", amount: 1500, status: "approved", description: "Deposit approved — VIP 1 · Starter plan activated", at: days(8), meta: { planId: plans["VIP 1 · Starter"], purpose: "plan", paymentMethod: "easypaisa", txId: "EP-77120338" } },
    { userId: ali.id, type: "task_reward", amount: 75, status: "completed", description: "Daily task reward", at: days(7), meta: {} },
    { userId: ali.id, type: "task_reward", amount: 75, status: "completed", description: "Daily task reward", at: days(5), meta: {} },
  ];
  const saraTxns = [
    { userId: sara.id, type: "deposit", amount: 5000, status: "approved", description: "Deposit approved — VIP 2 · Silver plan activated", at: days(2), meta: { planId: plans["VIP 2 · Silver"], purpose: "plan", paymentMethod: "usdt", txId: "USDT-0x9f31a4c8" } },
    { userId: sara.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: days(1), meta: {} },
    { userId: sara.id, type: "task_reward", amount: 220, status: "completed", description: "Daily task reward", at: hours(2), meta: {} },
  ];
  for (const t of [...aliTxns, ...saraTxns]) {
    await db.transaction.create({
      data: {
        userId: t.userId, type: t.type, amount: t.amount, status: t.status,
        description: t.description, createdAt: t.at, processedAt: t.at, meta: JSON.stringify(t.meta ?? {}),
      },
    });
  }

  // payout users: approved deposits + withdrawals + task rewards
  for (const p of payoutUsers) {
    const u = await mkUser({
      name: p.name, email: p.email, password: "User@123",
      referralCode: p.code, ip: `39.50.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
      fp: `fp_${p.code.toLowerCase()}_seed`, taskBalance: Math.floor(p.dep * 0.3), withdrawableBalance: 0,
      createdAt: days(15), lastLoginAt: p.at,
    });
    await db.userPlan.create({
      data: {
        userId: u.id,
        planId: p.dep >= 15000 ? plans["VIP 3 · Gold"] : plans["VIP 2 · Silver"],
        startedAt: days(10), expiresAt: daysFromNow(20),
      },
    });
    await db.transaction.create({
      data: { userId: u.id, type: "deposit", amount: p.dep, status: "approved", description: "Deposit approved — plan activated", createdAt: days(10), processedAt: days(10), meta: JSON.stringify({ purpose: "plan", paymentMethod: p.method, txId: `TX-${p.code}${Math.floor(Math.random() * 99999)}` }) },
    });
    // a few task rewards for chart volume
    for (let d = 6; d >= 0; d--) {
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        await db.transaction.create({
          data: { userId: u.id, type: "task_reward", amount: p.dep >= 15000 ? 700 : 220, status: "completed", description: "Daily task reward", createdAt: days(d), processedAt: days(d), meta: JSON.stringify({}) },
        });
      }
    }
    await db.transaction.create({
      data: {
        userId: u.id, type: "withdrawal", amount: p.amount, status: "approved",
        description: `Withdrawal paid via ${p.method === "easypaisa" ? "EasyPaisa" : p.method === "jazzcash" ? "JazzCash" : "USDT"}`,
        createdAt: p.at, processedAt: p.at,
        meta: JSON.stringify({ paymentMethod: p.method, accountDetails: `03${Math.floor(Math.random() * 9)}-****` }),
      },
    });
  }

  // one pending withdrawal for the admin payout queue
  await db.transaction.create({
    data: {
      userId: sara.id, type: "withdrawal", amount: 1320, status: "pending",
      description: "Withdrawal requested via JazzCash", createdAt: hours(6),
      meta: JSON.stringify({ paymentMethod: "jazzcash", accountDetails: "0302-4455667" }),
    },
  });

  // a couple of banned/pending extras for admin user manager
  const banned = await mkUser({
    name: "Kamran S.", email: "kamran@example.com", password: "User@123",
    referralCode: "KAMRANS", ip: "182.44.10.9", fp: "fp_kamran_s_9900",
    createdAt: days(6), lastLoginAt: days(2),
  });
  await db.user.update({ where: { id: banned.id }, data: { isBanned: true } });
  const pendingDep = await mkUser({
    name: "Hina Aslam", email: "hina@example.com", password: "User@123",
    referralCode: "HINAASL", referredById: demo.id, ip: "182.44.10.77", fp: "fp_hina_as_4433",
    createdAt: hours(10), lastLoginAt: hours(10),
  });
  await db.transaction.create({
    data: {
      userId: pendingDep.id, type: "deposit", amount: 1500, status: "pending",
      description: "Deposit for VIP 1 · Starter plan", createdAt: hours(9),
      meta: JSON.stringify({ planId: plans["VIP 1 · Starter"], purpose: "plan", paymentMethod: "easypaisa", txId: "EP-55440011" }),
    },
  });

  // ─── Dynamic Home widgets (Task 15): system Telegram reward + starter promo ──
  const homeSettings = await getSettings();
  const telegramReward = parseInt(homeSettings.home_telegram_reward, 10) || 50;
  await db.promoCode.upsert({
    where: { code: "TELEGRAM" },
    update: { rewardAmount: telegramReward },
    create: {
      code: "TELEGRAM",
      title: "Telegram join reward",
      rewardAmount: telegramReward,
      maxUses: null,
      isActive: true,
      isSystem: true,
    },
  });
  await db.promoCode.upsert({
    where: { code: "WELCOME50" },
    update: {},
    create: {
      code: "WELCOME50",
      title: "Welcome bonus",
      rewardAmount: 50,
      maxUses: 100,
      isActive: true,
    },
  });

  const counts = {
    users: await db.user.count(),
    plans: await db.plan.count(),
    tasks: await db.task.count(),
    transactions: await db.transaction.count(),
    promoCodes: await db.promoCode.count(),
  };
  console.log("✅ Seed complete:", counts);
  console.log("   admin@taskearn.com / Admin@123");
  console.log("   demo@taskearn.com / Demo@123");
  console.log(`   admin id: ${admin.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
