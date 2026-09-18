import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { toWalletData } from "../../_lib/helpers";
import { supabaseWallet } from "@/server/supabase/user-routes";
import type { ReferralCreditsResponseDTO, TransactionDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Newest-first cap — purely how many past credits stay presentable. */
const MAX_CREDITS = 15;

/**
 * GET /api/wallet/referral-credits — READ-ONLY presentation feed.
 *
 * Returns the member's completed `referral_commission` transactions (newest
 * first, capped at 15) together with a fresh wallet snapshot read in the
 * same request. This endpoint exists ONLY so the frontend can present each
 * REAL commission credit exactly once — it never writes, never recalculates
 * and never touches the referral/commission system: every row it returns was
 * already created by the existing creditReferralCommission() flow, with its
 * original id, amount and description untouched.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      // Dormant production track — reuse the existing read-only wallet RPC
      // response and filter the commission rows out of it. No Supabase
      // objects, RPCs or configuration are added or modified.
      const res = await supabaseWallet();
      const dto = (await res.json()) as {
        wallet?: ReferralCreditsResponseDTO["wallet"];
        transactions?: TransactionDTO[];
      };
      const credits = (dto.transactions ?? [])
        .filter((t) => t.type === "referral_commission" && t.status === "completed")
        .slice(0, MAX_CREDITS);
      return NextResponse.json({
        wallet: dto.wallet ?? { taskBalance: 0, withdrawableBalance: 0 },
        credits,
      });
    }

    const user = await requireAuth();

    const [wallet, credits] = await Promise.all([
      db.wallet.findUnique({ where: { userId: user.id } }),
      db.transaction.findMany({
        where: { userId: user.id, type: "referral_commission", status: "completed" },
        orderBy: { createdAt: "desc" },
        take: MAX_CREDITS,
      }),
    ]);

    return NextResponse.json({
      wallet: wallet ? toWalletData(wallet) : { taskBalance: 0, withdrawableBalance: 0 },
      credits: credits.map(toTransactionDTO),
    });
  });
}
