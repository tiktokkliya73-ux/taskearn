import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const mode = process.argv[2] || "local";
async function main() {
  await db.systemSetting.upsert({ where: { key: "data_backend" }, update: { value: mode }, create: { key: "data_backend", value: mode } });
  console.log("data_backend =", mode);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
