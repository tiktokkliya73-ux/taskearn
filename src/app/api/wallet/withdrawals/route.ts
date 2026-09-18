import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { supabaseWithdrawalHistory } from "@/server/supabase/user-routes";
import type { WithdrawalsResponseDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/withdrawals — the signed-in member's withdrawal requests
 * (type=withdrawal), newest first, take 60. Same shape/pattern as
 * /api/payments; scoped to the session user only.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseWithdrawalHistory();
    }

    const user = await requireAuth();
    const rows = await db.transaction.findMany({
      where: { userId: user.id, type: "withdrawal" },
      orderBy: { createdAt: "desc" },
      take: 60,
    });

    const body: WithdrawalsResponseDTO = { withdrawals: rows.map(toTransactionDTO) };
    return NextResponse.json(body);
  });
}
