import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  MIN_WITHDRAWAL_AMOUNT,
  resolveWithdrawalMethod,
  toTransactionDTO,
} from "@/lib/business";
import { supabaseWalletWithdraw } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

/* Withdrawal policy (Task 38) — enforced below, server-side only:
 *   minimum request = Rs 20 (MIN_WITHDRAWAL_AMOUNT, fixed — no higher
 *   minimum may be introduced);
 *   maximum request = MIN(taskBalance, withdrawableBalance) — the Task
 *   Balance is ONLY an eligibility cap: it is never withdrawn and never
 *   deducted; only the Withdrawable Balance is reduced (held at request,
 *   refunded on admin rejection). */

interface WithdrawBody {
  /** WithdrawalMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  accountDetails?: string;
  amount?: number | string;
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseWalletWithdraw(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<WithdrawBody>(req);

    // The payout channel is validated against the admin-managed
    // withdrawal_methods rows (the Withdraw page dropdown channels).
    const method = await resolveWithdrawalMethod(db, {
      id: body.paymentMethodId,
      name: body.paymentMethod,
    });
    const accountDetails = (body.accountDetails ?? "").trim();
    const amount = Number(body.amount);

    if (!method) throw new ApiError("Select a payment method.", 400);
    if (accountDetails.length < 5) throw new ApiError("Enter your payout account details.", 400);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new ApiError("Enter a valid withdrawal amount.", 400);
    }

    // Fixed policy minimum — server-side only, never trusted from the client.
    if (amount < MIN_WITHDRAWAL_AMOUNT) {
      throw new ApiError(`Minimum withdrawal is Rs ${MIN_WITHDRAWAL_AMOUNT}.`, 400);
    }

    const wallet = await db.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet || wallet.withdrawableBalance < amount) {
      throw new ApiError("Insufficient withdrawable balance.", 400);
    }
    // Eligibility cap: the request may not exceed the Task Balance either —
    // maximum = MIN(taskBalance, withdrawableBalance). (The Task Balance
    // itself is never deducted — see the transaction below.)
    if (wallet.taskBalance < amount) {
      throw new ApiError(
        `Withdrawal amount exceeds your Task Balance (${wallet.taskBalance}).`,
        400,
      );
    }

    const pending = await db.transaction.findFirst({
      where: { userId: user.id, type: "withdrawal", status: "pending" },
    });
    if (pending) throw new ApiError("You already have a pending withdrawal request.", 400);

    // Hold funds immediately — deduct inside $transaction, re-check BOTH
    // balances under lock. ONLY the withdrawable pocket is reduced; the Task
    // Balance stays untouched (it only gates eligibility, never pays out).
    const txn = await db.$transaction(async (tx) => {
      const locked = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!locked || locked.withdrawableBalance < amount) {
        throw new ApiError("Insufficient withdrawable balance.", 400);
      }
      if (locked.taskBalance < amount) {
        throw new ApiError(
          `Withdrawal amount exceeds your Task Balance (${locked.taskBalance}).`,
          400,
        );
      }
      await tx.wallet.update({
        where: { userId: user.id },
        data: { withdrawableBalance: { decrement: amount } },
      });
      return tx.transaction.create({
        data: {
          userId: user.id,
          type: "withdrawal",
          amount,
          status: "pending",
          description: `Withdrawal requested via ${method.name}`,
          meta: JSON.stringify({
            paymentMethod: method.name,
            paymentMethodId: method.id,
            accountDetails,
          }),
        },
      });
    });

    return NextResponse.json({ transaction: toTransactionDTO(txn) });
  });
}
