import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { getSettings } from "@/lib/settings";
import { supabasePublicGateways } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicGateways();
    }

    const s = await getSettings();
    return NextResponse.json({
      site_title: s.site_title,
      easypaisa_account: s.easypaisa_account,
      jazzcash_account: s.jazzcash_account,
      usdt_address: s.usdt_address,
      easypaisa_title: s.easypaisa_title,
      jazzcash_title: s.jazzcash_title,
      usdt_qr_url: s.usdt_qr_url,
      payment_instructions: s.payment_instructions,
      min_withdrawal: s.min_withdrawal,
      max_withdrawal: s.max_withdrawal,
    });
  });
}
