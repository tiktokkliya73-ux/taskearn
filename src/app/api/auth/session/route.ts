import { NextResponse } from "next/server";
import { getSessionUser, handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { getAnimationSettings } from "@/lib/animations";
import { getSettings } from "@/lib/settings";
import { toSessionUser, toWalletData } from "../../_lib/helpers";
import { supabaseSession } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseSession();
    }

    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ user: null, wallet: null });
    }
    // Animation switches ride along with the wallet read (parallel, no added
    // latency) so member views can honor the admin's ON/OFF controls.
    const [wallet, settings] = await Promise.all([
      db.wallet.findUnique({ where: { userId: user.id } }),
      getSettings(),
    ]);
    return NextResponse.json({
      user: toSessionUser(user),
      wallet: wallet ? toWalletData(wallet) : null,
      animations: getAnimationSettings(settings),
    });
  });
}
