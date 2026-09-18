import { NextResponse } from "next/server";
import { handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { claimPromoCode } from "@/lib/home-data";
import { supabaseHomePromo } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/**
 * POST /api/home/promo — redeem an admin-issued promo code.
 * Credits the withdrawable balance atomically and logs a promo_reward txn.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseHomePromo(req);
    }
    const user = await requireAuth();
    const body = await parseJsonBody<{ code?: string }>(req);
    const result = await claimPromoCode(user.id, body.code ?? "");
    return NextResponse.json(result);
  });
}
