import { db } from "@/lib/db";

/**
 * Dual data-backend switch (Task 8).
 *
 * The LOCAL sqlite Prisma db is always readable and is therefore the source of
 * truth for which backend is live. The SystemSetting row `data_backend` holds
 * either "local" (default) or "supabase". Every API route reads this flag
 * (through `isSupabaseData()`) and dispatches to either the untouched local
 * implementation or the Supabase implementation under src/server/supabase.
 *
 * Fail-safe: ANY error reading the flag resolves to `false` (local backend),
 * so a broken switch can never take the whole API down.
 */

export type DataBackend = "local" | "supabase";

const DATA_BACKEND_KEY = "data_backend";
const CACHE_TTL_MS = 5_000;

interface CacheEntry {
  value: boolean;
  at: number;
}

let cache: CacheEntry | null = null;

/** True when the app is currently serving data from the Supabase project. */
export async function isSupabaseData(): Promise<boolean> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  try {
    const row = await db.systemSetting.findUnique({ where: { key: DATA_BACKEND_KEY } });
    const value = row?.value === "supabase";
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // Fail-safe: never let a broken settings read break request dispatch.
    return false;
  }
}

/** Switch the data backend (upserts the local SystemSetting row) + drop cache. */
export async function setDataBackend(backend: DataBackend): Promise<void> {
  await db.systemSetting.upsert({
    where: { key: DATA_BACKEND_KEY },
    update: { value: backend },
    create: { key: DATA_BACKEND_KEY, value: backend },
  });
  cache = null;
}
