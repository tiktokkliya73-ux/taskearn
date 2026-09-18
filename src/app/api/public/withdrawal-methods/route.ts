import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { listActiveWithdrawalMethods, toWithdrawalMethodDTO } from "@/lib/business";
import { supabasePublicWithdrawalMethods } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/withdrawal-methods — the admin-managed payout channels
 * rendered in the Withdraw page dropdown. Active rows only, in the admin's
 * display order. The dropdown shows ONLY the channel identity (name + logo);
 * the member's own payout account is a separate field below it. Values come
 * 100% from the database — nothing hardcoded.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicWithdrawalMethods();
    }

    const methods = await listActiveWithdrawalMethods();
    return NextResponse.json({ methods: methods.map(toWithdrawalMethodDTO) });
  });
}
