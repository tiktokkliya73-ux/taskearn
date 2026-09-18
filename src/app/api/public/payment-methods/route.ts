import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import {
  ensurePaymentMethodsSeeded,
  listActivePaymentMethods,
  toPaymentMethodDTO,
} from "@/lib/business";
import { getSettings } from "@/lib/settings";
import { supabasePublicPaymentMethods } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/payment-methods — the admin-managed payment channels
 * rendered on every member checkout (packages, VIP plans, wallet deposit).
 * Active rows only, in the admin's display order. `requireProof` mirrors the
 * require_payment_proof setting so checkouts know when a screenshot is
 * mandatory. Values come 100% from the database — nothing hardcoded.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicPaymentMethods();
    }

    await ensurePaymentMethodsSeeded();
    const [methods, settings] = await Promise.all([
      listActivePaymentMethods(),
      getSettings(),
    ]);

    return NextResponse.json({
      methods: methods.map(toPaymentMethodDTO),
      requireProof: settings.require_payment_proof === "true",
      walletImageUrl: settings.wallet_method_image_url || null,
    });
  });
}
