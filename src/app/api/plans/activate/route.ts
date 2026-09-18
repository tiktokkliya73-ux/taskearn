import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  getActiveUserPlan,
  processPlanActivation,
  resolvePaymentMethod,
  toTransactionDTO,
} from "@/lib/business";
import { getSettings } from "@/lib/settings";
import type { ActivatePlanResponseDTO, UnlockResult } from "@/lib/types";
import { supabaseActivatePlan } from "@/server/supabase/user-routes";

export const dynamic = "force-dynamic";

interface ActivateBody {
  planId?: string;
  /** PaymentMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  txId?: string;
  /** Optional payment proof screenshot (downscaled JPEG data URL). */
  proof?: string;
}

/** 11/12-digit transaction IDs from EasyPaisa/JazzCash/USDT receipts. */
const TID_PATTERN = /^\d{11,12}$/;
const MAX_PROOF_CHARS = 2_000_000; // ~1.5 MB JPEG data URL after client downscaling

/**
 * Plan Activation & Payment Checkout submission (Task 16).
 * `activate_plan_and_unlock_referral()` equivalent entry point:
 * creates a PENDING `plan_purchase` transaction; auto-approves (plan
 * activation + referral unlock) inside one $transaction only when the
 * auto_approve_deposits setting is "true".
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseActivatePlan(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<ActivateBody>(req);

    const planId = (body.planId ?? "").trim();
    const txId = (body.txId ?? "").trim();
    const proof = typeof body.proof === "string" ? body.proof.trim() : "";

    // The payment method is validated against the admin-managed
    // payment_methods rows (legacy easypaisa/jazzcash/usdt aliases resolve).
    const method = await resolvePaymentMethod(db, {
      id: body.paymentMethodId,
      name: body.paymentMethod,
    });
    if (!method) throw new ApiError("Select a payment method.", 400);
    if (!TID_PATTERN.test(txId)) {
      throw new ApiError("Enter the 11 or 12-digit Transaction ID (TID) from your payment app.", 400);
    }
    if (proof && (!proof.startsWith("data:image/") || proof.length > MAX_PROOF_CHARS)) {
      throw new ApiError("Invalid payment screenshot.", 400);
    }

    const plan = planId ? await db.plan.findUnique({ where: { id: planId } }) : null;
    if (!plan || !plan.isActive) throw new ApiError("Plan not found.", 400);

    const activeUserPlan = await getActiveUserPlan(user.id);
    if (activeUserPlan) throw new ApiError("You already have an active plan.", 400);

    const { txnId, activated, unlock } = await db.$transaction(async (tx) => {
      const txn = await tx.transaction.create({
        data: {
          userId: user.id,
          type: "plan_purchase",
          amount: plan.price,
          status: "pending",
          description: `Payment for ${plan.name} plan — awaiting admin approval`,
          meta: JSON.stringify({
            planId: plan.id,
            planName: plan.name,
            purpose: "plan",
            paymentMethod: method.name,
            paymentMethodId: method.id,
            txId,
            ...(proof ? { proof } : {}),
          }),
        },
      });

      const settings = await getSettings(tx);
      if (settings.auto_approve_deposits === "true") {
        const unlockResult = await processPlanActivation(tx, {
          userId: user.id,
          planId: plan.id,
          depositTransactionId: txn.id,
        });
        return { txnId: txn.id, activated: true, unlock: unlockResult };
      }
      return { txnId: txn.id, activated: false, unlock: null };
    });

    const refreshed = await db.transaction.findUnique({ where: { id: txnId } });

    const response: ActivatePlanResponseDTO = {
      transaction: toTransactionDTO(refreshed!),
      activated,
      unlock: (unlock as UnlockResult | null) ?? null,
    };
    return NextResponse.json(response);
  });
}
