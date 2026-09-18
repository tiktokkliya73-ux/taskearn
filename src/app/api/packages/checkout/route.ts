import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { ensurePaymentMethodsSeeded, resolvePaymentMethod, toTransactionDTO } from "@/lib/business";
import { getSettings } from "@/lib/settings";
import { supabaseSubmitPackagePayment } from "@/server/supabase/user-routes";
import type { PackageCheckoutResponseDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

interface CheckoutBody {
  packageId?: string;
  /** PaymentMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  txId?: string;
  /** Payment screenshot (downscaled image data URL, optional unless required). */
  proof?: string;
}

/** Transaction/reference IDs from payment providers (e.g. TXN12345678). */
const TXID_PATTERN = /^[A-Za-z0-9-]{6,40}$/;
const MAX_PROOF_CHARS = 2_000_000; // ~1.5 MB image data URL after client downscaling
const PROOF_PREFIX = /^data:image\/(png|jpe?g|webp);base64,/;

/** Money-in submission types that can carry a TxID. */
const TXID_TYPES = ["deposit", "plan_purchase", "package_purchase"] as const;

/**
 * POST /api/packages/checkout — Packages Payment Checkout submission.
 *
 * Creates a PENDING `package_purchase` payment request (amount is ALWAYS the
 * package price read from the database — client amounts are never trusted),
 * validated server-side: package active, payment method active (admin rows),
 * TxID format + duplicate guards (same user / same package pending /
 * TxID reuse), screenshot format+size (+ required when the admin enabled
 * require_payment_proof). The package is NOT activated here — only an admin
 * approval (Deposit/Package Approvals) can do that.
 */
export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseSubmitPackagePayment(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<CheckoutBody>(req);

    const packageId = (body.packageId ?? "").trim();
    const txId = (body.txId ?? "").trim();
    const proof = typeof body.proof === "string" ? body.proof.trim() : "";

    if (!packageId) throw new ApiError("Package is required.", 400);
    if (!TXID_PATTERN.test(txId)) {
      throw new ApiError("Enter the transaction ID from your payment app (e.g. TXN12345678).", 400);
    }
    if (proof && (!PROOF_PREFIX.test(proof) || proof.length > MAX_PROOF_CHARS)) {
      throw new ApiError("Invalid payment screenshot — use a JPG, PNG or WEBP image.", 400);
    }

    // ── Server-side source of truth: package + price + method + policy ──
    const pkg = await db.investmentPackage.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.isActive) throw new ApiError("Package not found or disabled.", 400);

    const settings = await getSettings();
    const requireProof = settings.require_payment_proof === "true";
    if (requireProof && !proof) {
      throw new ApiError("A payment screenshot is required — attach your receipt image.", 400);
    }

    const method = await resolvePaymentMethod(db, {
      id: body.paymentMethodId,
      name: body.paymentMethod,
    });
    if (!method) throw new ApiError("Select a valid payment method.", 400);

    // ── Duplicate guards ──
    // 1) Same member already has a PENDING request for this exact package.
    const duplicatePending = await db.transaction.findFirst({
      where: {
        userId: user.id,
        type: "package_purchase",
        status: "pending",
        meta: { contains: `"packageId":"${packageId}"` },
      },
      select: { id: true },
    });
    if (duplicatePending) {
      throw new ApiError(
        "You already have a pending payment request for this package — wait for the admin review before submitting again.",
        400,
      );
    }

    // 2) This member has already used this TxID on a non-rejected submission.
    const txIdNeedle = `"txId":"${txId}"`;
    const ownTxId = await db.transaction.findFirst({
      where: {
        userId: user.id,
        type: { in: [...TXID_TYPES] },
        status: { not: "rejected" },
        meta: { contains: txIdNeedle },
      },
      select: { id: true },
    });
    if (ownTxId) {
      throw new ApiError("You have already submitted this transaction ID.", 400);
    }

    // 3) Another member's PENDING request carries the same TxID.
    const globalTxId = await db.transaction.findFirst({
      where: {
        userId: { not: user.id },
        type: { in: [...TXID_TYPES] },
        status: "pending",
        meta: { contains: txIdNeedle },
      },
      select: { id: true },
    });
    if (globalTxId) {
      throw new ApiError("This transaction ID is already under review.", 400);
    }

    // ── Create the pending payment request (amount from the DB row) ──
    const txn = await db.transaction.create({
      data: {
        userId: user.id,
        type: "package_purchase",
        amount: pkg.price,
        status: "pending",
        description: `Payment for ${pkg.title} — awaiting admin review`,
        meta: JSON.stringify({
          packageId: pkg.id,
          packageTitle: pkg.title,
          purpose: "package",
          paymentMethod: method.name,
          paymentMethodId: method.id,
          txId,
          ...(proof ? { proof } : {}),
        }),
      },
    });

    const res: PackageCheckoutResponseDTO = { transaction: toTransactionDTO(txn) };
    return NextResponse.json(res);
  });
}
