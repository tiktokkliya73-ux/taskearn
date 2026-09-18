import { NextResponse } from "next/server";
import { readFileSync } from "fs";

import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData, setDataBackend } from "@/lib/data-backend";
import {
  SUPABASE_PROJECT_URL,
  supabaseAdmin,
  supabaseConfigured,
  supabaseDataProvisioned,
} from "@/lib/supabase";
import { migrateLocalToSupabase } from "@/server/supabase/migrate";

export const dynamic = "force-dynamic";

/**
 * Admin control endpoint for the dual data backend (Task 8).
 *
 * GET    → full status (configured / provisioned / counts / backend / SQL text)
 * POST   → { action: "recheck" | "migrate" | "activate" | "deactivate" }
 *
 * Everything requires an admin session.
 */

async function readSql(): Promise<string> {
  try {
    return readFileSync(`${process.cwd()}/db/supabase-schema.sql`, "utf8");
  } catch {
    return "";
  }
}

/** Best-effort total count of auth.users in the Supabase project. */
async function countAuthUsers(): Promise<number | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    const total = (data as { total?: number } | null)?.total;
    return typeof total === "number" ? total : null;
  } catch {
    return null;
  }
}

async function buildStatus() {
  const provisionedInfo = await supabaseDataProvisioned();
  const [authUserCount, sql] = await Promise.all([countAuthUsers(), readSql()]);
  return {
    configured: supabaseConfigured,
    provisioned: provisionedInfo.provisioned,
    connectError: provisionedInfo.error ?? null,
    supabaseUserCount: provisionedInfo.userCount ?? null,
    authUserCount,
    backend: (await isSupabaseData()) ? "supabase" : "local",
    siteUrl: SUPABASE_PROJECT_URL,
    sql,
  };
}

export async function GET() {
  return handleRoute(async () => {
    await requireAdmin();
    return NextResponse.json(await buildStatus());
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    await requireAdmin();
    const body = await parseJsonBody<{ action?: string }>(req);
    const action = (body.action ?? "").trim();

    if (action === "recheck") {
      return NextResponse.json(await buildStatus());
    }

    if (action === "migrate") {
      const status = await buildStatus();
      if (!status.provisioned) {
        throw new ApiError("Run the SQL script in your Supabase SQL editor first.", 400);
      }
      const migrated = await migrateLocalToSupabase();
      await setDataBackend("supabase");
      return NextResponse.json({ ok: true, migrated, ...(await buildStatus()) });
    }

    if (action === "activate") {
      const status = await buildStatus();
      if (!status.provisioned) {
        throw new ApiError("Run the SQL script in your Supabase SQL editor first.", 400);
      }
      await setDataBackend("supabase");
      return NextResponse.json({ ok: true, action: "activate", ...(await buildStatus()) });
    }

    if (action === "deactivate") {
      // Escape hatch: switch back to the local SQLite backend.
      await setDataBackend("local");
      return NextResponse.json({ ok: true, action: "deactivate", ...(await buildStatus()) });
    }

    throw new ApiError("Unknown action. Use recheck, migrate, activate or deactivate.", 400);
  });
}
