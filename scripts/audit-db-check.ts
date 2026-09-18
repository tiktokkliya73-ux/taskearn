import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const [users, wallets, txns, plans, tasks, pm, wm, settings, tickets, notifications, promos] = await Promise.all([
    db.user.count(), db.wallet.count(), db.transaction.count(), db.plan.count(),
    db.task.count(), db.paymentMethod.count(), db.withdrawalMethod.count(),
    db.systemSetting.count(), db.supportTicket.count(), db.notification.count(), db.promoClaim.count(),
  ]);
  console.log(JSON.stringify({ users, wallets, txns, plans, tasks, paymentMethods: pm, withdrawalMethods: wm, settings, tickets, notifications, promoClaims: promos }));
  const orphanTx = await db.$queryRawUnsafe('SELECT COUNT(*) as n FROM "Transaction" t LEFT JOIN "User" u ON t."userId" = u."id" WHERE u."id" IS NULL');
  console.log("orphan txns:", Number((orphanTx as any)[0].n));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
