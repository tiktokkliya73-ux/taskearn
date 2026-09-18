import { PrismaClient } from '@prisma/client'

// Out-of-the-box resilience: if DATABASE_URL is not set (e.g. the project was
// just unzipped and no .env / .env.local has been created yet), fall back to
// the bundled SQLite database so the app still runs locally instead of
// failing every query with "Environment variable not found: DATABASE_URL".
// An explicit value from .env / .env.local / the host environment ALWAYS wins.
// The relative path resolves against prisma/schema.prisma (Prisma's rule), so
// it points at <project-root>/db/custom.db in dev, CLI and the standalone
// production server alike.
process.env.DATABASE_URL ??= 'file:../db/custom.db'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db