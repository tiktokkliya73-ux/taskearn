import { NextResponse } from "next/server";
import { handleRoute, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { toWalletData } from "../_lib/helpers";
import { supabaseWallet } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseWallet();
    }

    const user = await requireAuth();

    const [wallet, transactions] = await Promise.all([
      db.wallet.findUnique({ where: { userId: user.id } }),
      db.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    return NextResponse.json({
      wallet: wallet ? toWalletData(wallet) : { taskBalance: 0, withdrawableBalance: 0 },
      transactions: transactions.map(toTransactionDTO),
    });
  });
}
