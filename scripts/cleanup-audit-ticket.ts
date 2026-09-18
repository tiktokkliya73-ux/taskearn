/** Remove the Task-54 final-audit test support ticket (run once). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const r = await db.supportTicket.deleteMany({ where: { subject: "Audit live-loop test" } });
  console.log("deleted test tickets:", r.count);
  console.log("remaining open tickets:", await db.supportTicket.count({ where: { status: "open" } }));
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
