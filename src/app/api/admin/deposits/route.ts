import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import {
  activatePackageFromPayment,
  processPlanActivation,
  processTopupApproval,
  toTransactionDTO,
} from "@/lib/business";
import { safeParseMeta } from "../../_lib/helpers";
import {
  supabaseAdminDepositsGet,
  supabaseAdminDepositsPost,
  supabaseAdminDepositProof,
} from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

/** Types that represent member money-in submissions: wallet top-ups, VIP plan
 * purchases (Task 16: `plan_purchase`) and package payment requests
 * (`package_purchase`, pending → admin review). */
const DEPOSIT_TYPES = ["deposit", "plan_purchase", "package_purchase"] as const;

/** Deposit list: pending first, then newest, max 60 rows. */
async function fetchDeposits() {
  const pendingList = await db.transaction.findMany({
    where: { type: { in: [...DEPOSIT_TYPES] }, status: "pending" },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const rest = await db.transaction.findMany({
    where: { type: { in: [...DEPOSIT_TYPES] }, status: { not: "pending" } },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(0, 60 - pendingList.length),
  });
  return [...pendingList, ...rest].map(toTransactionDTO);
}

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminDepositsGet();
    }

    await requireAdmin();
    return NextResponse.json({ deposits: await fetchDeposits() });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminDepositsPost(req);
    }

    const admin = await requireAdmin();
    const body = await parseJsonBody<{ id?: string; action?: string; note?: string }>(req);

    const id = (body.id ?? "").trim();
    const action = (body.action ?? "").trim();
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

    const txn = id ? await db.transaction.findUnique({ where: { id } }) : null;
    if (
      !txn ||
      !(
        txn.type === "deposit" ||
        txn.type === "plan_purchase" ||
        txn.type === "package_purchase"
      ) ||
      txn.status !== "pending"
    ) {
      throw new ApiError("Payment request not found or already processed.", 400);
    }

    if (action === "approve") {
      const meta = safeParseMeta(txn.meta);
      if (meta.purpose === "plan" && typeof meta.planId === "string") {
        // Plan-purchase submission: activate plan + referral unlock
        // (activate_plan_and_unlock_referral equivalent).
        // If the user already has an active plan in the meantime, credit as top-up instead.
        await db.$transaction(async (tx) => {
          try {
            await processPlanActivation(tx, {
              userId: txn.userId,
              planId: meta.planId as string,
              depositTransactionId: txn.id,
            });
          } catch (err) {
            if (err instanceof ApiError && /already has an active plan/i.test(err.message)) {
              await processTopupApproval(tx, txn.id);
            } else {
              throw err;
            }
          }
        });
      } else if (meta.purpose === "package" && typeof meta.packageId === "string") {
        // Package payment request: activate the investment instance WITHOUT
        // touching the wallet (external money, admin review = verification).
        // Falls back to a top-up credit when the package was deleted since
        // the submission — the member's money is never lost.
        await db.$transaction(async (tx) => {
          const activated = await activatePackageFromPayment(tx, {
            userId: txn.userId,
            packageId: meta.packageId as string,
            paymentTransactionId: txn.id,
            reviewedBy: admin.name,
          });
          if (!activated) {
            await processTopupApproval(tx, txn.id);
          }
        });
      } else {
        await db.$transaction(async (tx) => {
          await processTopupApproval(tx, txn.id);
        });
      }
    } else if (action === "reject") {
      await db.transaction.update({
        where: { id: txn.id },
        data: {
          status: "rejected",
          processedAt: new Date(),
          description: note ? `Payment rejected — ${note}` : "Payment rejected",
          meta: JSON.stringify({
            ...safeParseMeta(txn.meta),
            ...(note ? { note } : {}),
            reviewedBy: admin.name,
          }),
        },
      });
    } else {
      throw new ApiError("Unknown action. Use approve or reject.", 400);
    }

    return NextResponse.json({ deposits: await fetchDeposits() });
  });
}

/** Serve the payment-proof screenshot for a submission (admin only). */
export async function PUT(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminDepositProof(req);
    }

    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") ?? "").trim();

    const txn = id ? await db.transaction.findUnique({ where: { id } }) : null;
    if (
      !txn ||
      !(
        txn.type === "deposit" ||
        txn.type === "plan_purchase" ||
        txn.type === "package_purchase"
      )
    ) {
      throw new ApiError("Payment request not found.", 404);
    }

    const meta = safeParseMeta(txn.meta);
    const proof = typeof meta.proof === "string" && meta.proof.startsWith("data:image/") ? meta.proof : null;
    return NextResponse.json({ id: txn.id, proof });
  });
}
