import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { processTopupApproval, resolvePaymentMethod, toTransactionDTO } from "@/lib/business";
import { getSettings } from "@/lib/settings";
import { supabaseWalletDeposit } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

interface DepositBody {
  /** PaymentMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  txId?: string;
  amount?: number | string;
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseWalletDeposit(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<DepositBody>(req);

    // Method is validated against the admin-managed payment_methods rows
    // (legacy easypaisa/jazzcash/usdt aliases still resolve to their rows).
    const method = await resolvePaymentMethod(db, {
      id: body.paymentMethodId,
      name: body.paymentMethod,
    });
    const txId = (body.txId ?? "").trim();

    if (!method) throw new ApiError("Select a payment method.", 400);
    if (txId.length < 4) throw new ApiError("Enter your transaction ID (TxID).", 400);

    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
      throw new ApiError("Enter a valid deposit amount.", 400);
    }

    const txnId = await db.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          userId: user.id,
          type: "deposit",
          amount,
          status: "pending",
          description: "Account top-up deposit",
          meta: JSON.stringify({
            paymentMethod: method.name,
            paymentMethodId: method.id,
            txId,
            purpose: "topup",
          }),
        },
      });

      const settings = await getSettings(tx);
      if (settings.auto_approve_deposits === "true") {
        await processTopupApproval(tx, txn.id);
      }
      return txn.id;
    });

    const refreshed = await db.transaction.findUnique({ where: { id: txnId } });
    return NextResponse.json({ transaction: toTransactionDTO(refreshed!) });
  });
}
