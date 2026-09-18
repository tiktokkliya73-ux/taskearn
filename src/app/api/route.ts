import { NextResponse } from "next/server";
import { isSupabaseData } from "@/lib/data-backend";
import { supabaseConfigured, supabaseDataProvisioned } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  // Fail-safe helpers: neither of these can throw.
  const backend = (await isSupabaseData()) ? "supabase" : "local";
  const { provisioned } = await supabaseDataProvisioned();
  return NextResponse.json({
    ok: true,
    name: "TaskEarn API",
    backend,
    supabase: { configured: supabaseConfigured, provisioned },
  });
}
