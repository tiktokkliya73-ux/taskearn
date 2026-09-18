import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { safeParseMeta } from "../../_lib/helpers";
import {
  supabaseAdminWithdrawalsGet,
  supabaseAdminWithdrawalsPost,
} from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

/** Withdrawal list: pending first, then newest, max 60 rows. */
async function fetchWithdrawals() {
  const pendingList = await db.transaction.findMany({
    where: { type: "withdrawal", status: "pending" },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const rest = await db.transaction.findMany({
    where: { type: "withdrawal", status: { not: "pending" } },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(0, 60 - pendingList.length),
  });
  return [...pendingList, ...rest].map(toTransactionDTO);
}

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminWithdrawalsGet();
    }

    await requireAdmin();
    return NextResponse.json({ withdrawals: await fetchWithdrawals() });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminWithdrawalsPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<{ id?: string; action?: string; note?: string }>(req);

    const id = (body.id ?? "").trim();
    const action = (body.action ?? "").trim();
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const txn = id ? await db.transaction.findUnique({ where: { id } }) : null;
    if (!txn || txn.type !== "withdrawal" || txn.status !== "pending") {
      throw new ApiError("Withdrawal not found or already processed.", 400);
    }

    // Approval safety: the payout destination snapshot captured when the
    // member submitted the request (meta.accountDetails) must be present —
    // a withdrawal must never be marked paid without a place to send the
    // money. Reject stays available (it only refunds the held balance).
    if (action === "approve") {
      const meta = safeParseMeta(txn.meta);
      const destination =
        typeof meta.accountDetails === "string" ? meta.accountDetails.trim() : "";
      if (destination.length < 5) {
        throw new ApiError(
          "Payment details are missing for this withdrawal. Please resolve the member's payment details before approving.",
          400,
        );
      }
    }

    const now = new Date();
    if (action === "approve") {
      // Funds were already held at request time — approving just pays out.
      await db.transaction.update({
        where: { id: txn.id },
        data: { status: "approved", processedAt: now, description: "Withdrawal approved — paid out" },
      });
    } else if (action === "reject") {
      await db.$transaction(async (tx) => {
        await tx.wallet.update({
          where: { userId: txn.userId },
          data: { withdrawableBalance: { increment: txn.amount } },
        });
        const meta = { ...safeParseMeta(txn.meta), ...(note ? { note } : {}) };
        await tx.transaction.update({
          where: { id: txn.id },
          data: {
            status: "rejected",
            processedAt: now,
            description: "Withdrawal rejected — amount refunded",
            meta: JSON.stringify(meta),
          },
        });
      });
    } else {
      throw new ApiError("Unknown action. Use approve or reject.", 400);
    }

    return NextResponse.json({ withdrawals: await fetchWithdrawals() });
  });
}
