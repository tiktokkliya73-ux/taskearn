import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { supabasePaymentHistory } from "@/server/supabase/user-routes";
import type { PaymentHistoryResponseDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Money-in submission types — the member's payment requests. */
const PAYMENT_TYPES = ["deposit", "plan_purchase", "package_purchase"] as const;

/**
 * GET /api/payments — the signed-in member's Payment History: every package /
 * plan / top-up payment request they submitted (pending → approved/rejected),
 * newest first. Scoped to the session user only — a member can never read
 * another member's requests.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePaymentHistory();
    }

    const user = await requireAuth();
    const rows = await db.transaction.findMany({
      where: { userId: user.id, type: { in: [...PAYMENT_TYPES] } },
      orderBy: { createdAt: "desc" },
      take: 60,
    });

    const body: PaymentHistoryResponseDTO = { payments: rows.map(toTransactionDTO) };
    return NextResponse.json(body);
  });
}
