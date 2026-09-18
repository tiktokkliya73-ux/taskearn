import { NextResponse } from "next/server";
import { clearSessionCookie, handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { supabaseLogout } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

export async function POST() {
  return handleRoute(async () => {
    // Cookie-only in both modes (the supabase branch keeps dispatch symmetric).
    if (await isSupabaseData()) {
      return supabaseLogout();
    }

    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  });
}
