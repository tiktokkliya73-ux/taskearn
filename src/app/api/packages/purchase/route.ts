import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { purchaseInvestmentPackage, toTransactionDTO } from "@/lib/business";
import { db } from "@/lib/db";
import { toWalletData } from "../../_lib/helpers";
import { supabasePurchasePackage } from "@/server/supabase/user-routes";
import type { PurchasePackageResponseDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PurchaseBody {
  packageId?: string;
}

/**
 * POST /api/packages/purchase — buy an investment package with the member's
 * available balance. Multiple simultaneous purchases are allowed (same or
 * different packages); the only guard is available >= price. The deduction,
 * instance creation and immutable ledger entry happen atomically in one
 * db.$transaction via purchaseInvestmentPackage().
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePurchasePackage(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<PurchaseBody>(req);
    const packageId = (body.packageId ?? "").trim();
    if (!packageId) throw new ApiError("Package is required.", 400);

    const { userPackageId, transactionId } = await db.$transaction((tx) =>
      purchaseInvestmentPackage(tx, { userId: user.id, packageId })
    );

    const [userPackage, wallet, transaction] = await Promise.all([
      db.userPackage.findUnique({ where: { id: userPackageId }, include: { pkg: { select: { title: true } } } }),
      db.wallet.findUnique({ where: { userId: user.id } }),
      db.transaction.findUnique({ where: { id: transactionId } }),
    ]);
    if (!userPackage || !wallet || !transaction) {
      throw new ApiError("Purchase could not be confirmed.", 500);
    }

    const res: PurchasePackageResponseDTO = {
      transaction: toTransactionDTO(transaction),
      wallet: toWalletData(wallet),
      userPackage: {
        id: userPackage.id,
        packageId: userPackage.packageId,
        packageTitle: userPackage.pkg?.title ?? "Package",
        investAmount: userPackage.investAmount,
        dailyEarning: userPackage.dailyEarning,
        status: "active",
        lastEarningDate: userPackage.lastEarningDate,
        startedAt: userPackage.startedAt.toISOString(),
        endsAt: userPackage.endsAt.toISOString(),
      },
    };
    return NextResponse.json(res);
  });
}
