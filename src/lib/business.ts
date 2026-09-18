import { db } from "@/lib/db";
import type { PaymentMethod, Prisma, User, WithdrawalMethod } from "@prisma/client";
import { ApiError } from "@/lib/api-helpers";
import { getSettings } from "@/lib/settings";
import { randomBytes } from "crypto";
import type { WithdrawalMethodDTO } from "@/lib/types";

type Tx = Prisma.TransactionClient;

/** The fixed withdrawal policy minimum (Task 38): a request must be Rs 20 or
 * more — no higher minimum may ever be introduced. There is NO fixed platform
 * maximum: the per-request cap is the member's own
 * MIN(taskBalance, withdrawableBalance) — enforced server-side in the
 * withdraw route and in the Supabase api_request_withdrawal RPC. */
export const MIN_WITHDRAWAL_AMOUNT = 20;

/** YYYY-MM-DD for daily task tracking (server date). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Payment Methods engine (admin-managed, 100% dynamic)                */
/* ------------------------------------------------------------------ */

/** Serialize a PaymentMethod row to the shared DTO. */
export function toPaymentMethodDTO(m: PaymentMethod) {
  return {
    id: m.id,
    name: m.name,
    accountNumber: m.accountNumber,
    accountTitle: m.accountTitle,
    instructions: m.instructions,
    logoUrl: m.logoUrl,
    sortOrder: m.sortOrder,
    isActive: m.isActive,
  };
}

/** Active payment methods in display order. */
export async function listActivePaymentMethods(tx: Tx = db): Promise<PaymentMethod[]> {
  return tx.paymentMethod.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Split a legacy account string like "0300-1234567 (TaskEarn Pvt Ltd)" into
 * its number + title parts (server-side twin of the client helper).
 */
function splitLegacyAccount(raw: string): { title: string | null; number: string } {
  const value = (raw ?? "").trim();
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(value);
  if (m) {
    const number = m[1].trim();
    const title = m[2].trim();
    if (number) return { title: title || null, number };
  }
  return { title: null, number: value };
}

/**
 * ONE-TIME backfill: seed the payment_methods table from the legacy
 * system_settings gateway keys the very first time it is empty, so the
 * owner's already-configured merchant accounts carry over automatically.
 * Idempotent — later runs are a single COUNT away.
 */
export async function ensurePaymentMethodsSeeded(tx: Tx = db): Promise<void> {
  const count = await tx.paymentMethod.count();
  if (count > 0) return;

  const s = await getSettings(tx);
  const ep = splitLegacyAccount(s.easypaisa_account ?? "");
  const jc = splitLegacyAccount(s.jazzcash_account ?? "");
  const instructions = (s.payment_instructions ?? "").trim() || null;

  const rows: { name: string; accountNumber: string; accountTitle: string | null; logoUrl: string | null; sortOrder: number }[] =
    [
      {
        name: "EasyPaisa",
        accountNumber: ep.number || "0300-1234567",
        accountTitle: (s.easypaisa_title ?? "").trim() || ep.title,
        logoUrl: null,
        sortOrder: 1,
      },
      {
        name: "JazzCash",
        accountNumber: jc.number || "0301-7654321",
        accountTitle: (s.jazzcash_title ?? "").trim() || jc.title,
        logoUrl: null,
        sortOrder: 2,
      },
      {
        name: "USDT (TRC20)",
        accountNumber: (s.usdt_address ?? "").trim() || "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        accountTitle: null,
        logoUrl: (s.usdt_qr_url ?? "").trim() || null,
        sortOrder: 3,
      },
    ].filter((r) => r.accountNumber);

  for (const row of rows) {
    await tx.paymentMethod.create({
      data: { ...row, instructions, isActive: true },
    });
  }
}

/** Normalize a name/alias for fuzzy matching ("USDT (TRC20)" → "usdttrc20"). */
function normalizeName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a payment method submitted by a client: by row id first, then by
 * exact (case-insensitive) name, then legacy alias fallback
 * ("easypaisa" → the EasyPaisa row, "usdt" → the USDT row, …).
 * Returns null when nothing active matches — callers must reject.
 */
export async function resolvePaymentMethod(
  tx: Tx,
  opts: { id?: string | null; name?: string | null }
): Promise<PaymentMethod | null> {
  await ensurePaymentMethodsSeeded(tx);

  const id = (opts.id ?? "").trim();
  if (id) {
    const byId = await tx.paymentMethod.findUnique({ where: { id } });
    if (byId && byId.isActive) return byId;
  }

  const name = (opts.name ?? "").trim();
  if (!name) return null;

  const methods = await listActivePaymentMethods(tx);
  const exact = methods.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;

  // Legacy alias fallback (rows written before the dynamic engine).
  const normalized = normalizeName(name);
  return (
    methods.find((m) => normalizeName(m.name) === normalized) ??
    methods.find((m) => {
      const n = normalizeName(m.name);
      if (normalized === "easypaisa") return n.startsWith("easypaisa");
      if (normalized === "jazzcash") return n.startsWith("jazzcash");
      if (normalized === "usdt" || normalized === "usdttrc20" || normalized === "usdtbep20") {
        return n.startsWith("usdt");
      }
      return false;
    }) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Withdrawal Methods engine (admin-managed Withdraw page dropdown)    */
/* ------------------------------------------------------------------ */

/** The fixed channel set of the Withdraw page (seeded once; admin-managed). */
const WITHDRAWAL_METHOD_SEED: { name: string; kind: "wallet" | "bank" }[] = [
  { name: "EasyPaisa", kind: "wallet" },
  { name: "JazzCash", kind: "wallet" },
  { name: "UPaisa", kind: "wallet" },
  { name: "SadaPay", kind: "wallet" },
  { name: "NayaPay", kind: "wallet" },
  { name: "UBL Bank", kind: "bank" },
  { name: "Bank Al Habib", kind: "bank" },
];

/** Serialize a WithdrawalMethod row to the shared DTO. */
export function toWithdrawalMethodDTO(m: WithdrawalMethod): WithdrawalMethodDTO {
  return {
    id: m.id,
    name: m.name,
    kind: m.kind === "bank" ? "bank" : "wallet",
    logoUrl: m.logoUrl,
    sortOrder: m.sortOrder,
    isActive: m.isActive,
  };
}

/**
 * Seed the seven fixed payout channels the first time (idempotent —
 * admin edits to order/logo/enable state are always preserved).
 */
export async function ensureWithdrawalMethodsSeeded(tx: Tx = db): Promise<void> {
  const existing = await tx.withdrawalMethod.findMany({ select: { name: true } });
  if (existing.length >= WITHDRAWAL_METHOD_SEED.length) return;
  const have = new Set(existing.map((m) => m.name));
  for (const [i, m] of WITHDRAWAL_METHOD_SEED.entries()) {
    if (have.has(m.name)) continue;
    await tx.withdrawalMethod.create({
      data: { name: m.name, kind: m.kind, sortOrder: i + 1, isActive: true },
    });
  }
}

/** All withdrawal channels in display order (admin manager). */
export async function listAllWithdrawalMethods(tx: Tx = db): Promise<WithdrawalMethod[]> {
  await ensureWithdrawalMethodsSeeded(tx);
  return tx.withdrawalMethod.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

/** Active withdrawal channels in display order (Withdraw page dropdown). */
export async function listActiveWithdrawalMethods(tx: Tx = db): Promise<WithdrawalMethod[]> {
  await ensureWithdrawalMethodsSeeded(tx);
  return tx.withdrawalMethod.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/**
 * Resolve a withdrawal method submitted by a client: by row id first, then
 * exact (case-insensitive) name. Returns null when nothing active matches —
 * callers must reject.
 */
export async function resolveWithdrawalMethod(
  tx: Tx,
  opts: { id?: string | null; name?: string | null }
): Promise<WithdrawalMethod | null> {
  await ensureWithdrawalMethodsSeeded(tx);

  const id = (opts.id ?? "").trim();
  if (id) {
    const byId = await tx.withdrawalMethod.findUnique({ where: { id } });
    if (byId && byId.isActive) return byId;
  }

  const name = (opts.name ?? "").trim();
  if (!name) return null;

  const methods = await listActiveWithdrawalMethods(tx);
  return methods.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** Unique 8-char referral code. */
export async function generateReferralCode(tx: Tx = db): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    const exists = await tx.user.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  throw new ApiError("Could not generate referral code", 500);
}

export function maskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= 2) return `${trimmed}***`;
  return `${trimmed.slice(0, 2)}***`;
}

/** The single active (non-expired) UserPlan of a user, with plan included. */
export async function getActiveUserPlan(userId: string, tx: Tx = db) {
  const userPlans = await tx.userPlan.findMany({
    where: { userId, status: "active" },
    include: { plan: true },
    orderBy: { startedAt: "desc" },
  });
  const now = new Date();
  const active = userPlans.find((up) => up.expiresAt > now) ?? null;
  if (!active) return null;
  return active.expiresAt > now ? active : null;
}

/**
 * 24-HOUR SAME-TASK CLAIM GUARD (Ads Execution Engine):
 * a member can claim a given task once every 24 hours — stricter than the
 * per-day reset, so a 23:59 claim cannot be re-claimed right after midnight.
 */
export async function claimedWithin24h(userId: string, taskId: string, tx: Tx = db): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await tx.userTask.findFirst({
    where: { userId, taskId, completedAt: { gt: since } },
    select: { id: true },
  });
  return recent !== null;
}

/**
 * ATOMIC REFERRAL UNLOCK — the core financial rule:
 * - reads unlock_amount from system_settings
 * - actual_unlock = LEAST(inviter.task_balance, unlock_amount)
 * - moves actual_unlock inviter task_balance -> withdrawable_balance
 * - inserts immutable transaction (referral_unlock, completed | blocked)
 * - anti-self-referral: blocked when inviter/invitee IP or fingerprint match
 * - runs at most once per invitee (guard on existing referral_unlock with relatedUserId=invitee)
 */
export async function processReferralUnlock(
  tx: Tx,
  invitee: User
): Promise<{ amount: number; blocked: boolean; inviterName: string } | null> {
  if (!invitee.referredById) return null;

  const inviter = await tx.user.findUnique({
    where: { id: invitee.referredById },
    include: { wallet: true },
  });
  if (!inviter || !inviter.wallet) return null;

  const once = await tx.transaction.findFirst({
    where: { type: "referral_unlock", relatedUserId: invitee.id, status: "completed" },
  });
  if (once) return null; // already unlocked for this invitee

  // Anti-self-referral / anti-fraud checks
  const sameIp =
    !!inviter.ipAddress && !!invitee.ipAddress && inviter.ipAddress === invitee.ipAddress;
  const sameFp =
    !!inviter.fingerprint && !!invitee.fingerprint && inviter.fingerprint === invitee.fingerprint;

  if (sameIp || sameFp) {
    await tx.transaction.create({
      data: {
        userId: inviter.id,
        relatedUserId: invitee.id,
        type: "referral_unlock",
        amount: 0,
        status: "blocked",
        description: `Referral unlock blocked (matching IP/device): invitee ${invitee.name}`,
        meta: JSON.stringify({ inviteeId: invitee.id, reason: "anti_fraud_ip_fingerprint_match" }),
        processedAt: new Date(),
      },
    });
    return { amount: 0, blocked: true, inviterName: inviter.name };
  }

  const settings = await getSettings(tx);
  const unlockAmount = parseInt(settings.unlock_amount_per_ref, 10) || 0;
  const actualUnlock = Math.min(inviter.wallet.taskBalance, unlockAmount);

  if (actualUnlock > 0) {
    await tx.wallet.update({
      where: { userId: inviter.id },
      data: {
        taskBalance: { decrement: actualUnlock },
        withdrawableBalance: { increment: actualUnlock },
      },
    });
  }

  await tx.transaction.create({
    data: {
      userId: inviter.id,
      relatedUserId: invitee.id,
      type: "referral_unlock",
      amount: actualUnlock,
      status: "completed",
      description: `Referral unlock from ${invitee.name}'s plan activation`,
      meta: JSON.stringify({ inviteeId: invitee.id, unlockAmount, actualUnlock }),
      processedAt: new Date(),
    },
  });

  return { amount: actualUnlock, blocked: false, inviterName: inviter.name };
}

/**
 * REFERRAL PACKAGE COMMISSION — the withdrawable-balance earning rule.
 *
 * When a referred member ACTIVATES an investment package (either by paying
 * from their wallet balance or through an admin-approved external payment),
 * their inviter earns `invite_commission_percent`% of the package price,
 * credited DIRECTLY to the inviter's WITHDRAWABLE balance (immediately
 * withdrawable under the existing withdrawal rules). The commission amount
 * is ALWAYS computed server-side from the live admin setting and the
 * package price — never from client input.
 *
 * Runs INSIDE the caller's db.$transaction, right after the UserPackage
 * instance is created, so the purchase, the instance and the commission
 * commit (or roll back) as ONE atomic event.
 *
 * Duplicate protection (the same activation can never pay twice):
 *   - the activation paths themselves are single-shot (wallet re-check /
 *     pending-only approval), AND
 *   - an explicit guard skips when a `referral_commission` row already
 *     exists for the SAME relatedUserId + meta.userPackageId — so retries,
 *     re-approvals or replays can never double-credit one activation.
 *
 * The earlier same-IP/fingerprint suppression was REMOVED (Task 38): mobile
 * carriers in Pakistan put thousands of members behind one shared public IP
 * (CGNAT) and inviter/invitee pairs routinely register from the same
 * household or even the same phone, so the check silently zeroed out
 * legitimate commissions (the reported "Withdrawable Rs 0" issue). Fraud
 * control stays where it belongs: external payments require a manual ADMIN
 * approval before any package (and therefore commission) activates.
 *
 * Task earnings are NEVER touched here — they stay in the inviter's
 * taskBalance (main balance); only the commission is new withdrawable money.
 */
export async function creditReferralCommission(
  tx: Tx,
  opts: {
    inviteeId: string;
    userPackageId: string;
    packageId: string;
    packageTitle: string;
    packagePrice: number;
  }
): Promise<{ amount: number; blocked: boolean } | null> {
  const invitee = await tx.user.findUnique({ where: { id: opts.inviteeId } });
  if (!invitee?.referredById) return null; // not a referred member — no commission

  const inviter = await tx.user.findUnique({
    where: { id: invitee.referredById },
    include: { wallet: true },
  });
  if (!inviter || !inviter.wallet) return null;

  // Idempotency: exactly ONE commission per (invitee, package activation).
  // The guard matches on relatedUserId + the userPackageId stored in meta.
  const prior = await tx.transaction.findMany({
    where: { type: "referral_commission", relatedUserId: invitee.id },
    select: { meta: true },
  });
  const alreadyPaid = prior.some((row) => {
    try {
      const meta = JSON.parse(row.meta ?? "{}") as { userPackageId?: string };
      return meta.userPackageId === opts.userPackageId;
    } catch {
      return false;
    }
  });
  if (alreadyPaid) return null;

  const settings = await getSettings(tx);
  const percent = Math.min(100, Math.max(0, parseInt(settings.invite_commission_percent, 10) || 0));
  const amount = Math.floor((opts.packagePrice * percent) / 100);
  if (amount <= 0) return null; // commission disabled (0%) — nothing to credit

  await tx.wallet.update({
    where: { userId: inviter.id },
    data: { withdrawableBalance: { increment: amount } },
  });

  await tx.transaction.create({
    data: {
      userId: inviter.id,
      relatedUserId: invitee.id,
      type: "referral_commission",
      amount,
      status: "completed",
      description: `Referral commission — ${percent}% of ${opts.packageTitle} activated by ${invitee.name}`,
      meta: JSON.stringify({
        inviteeId: invitee.id,
        userPackageId: opts.userPackageId,
        packageId: opts.packageId,
        packageTitle: opts.packageTitle,
        packagePrice: opts.packagePrice,
        percent,
      }),
      processedAt: new Date(),
    },
  });

  return { amount, blocked: false };
}

/**
 * Process a plan-purchase deposit: mark approved, activate plan, unlock referral.
 * Must be called INSIDE a $transaction. Returns unlock result (null if no inviter).
 */
export async function processPlanActivation(
  tx: Tx,
  opts: { userId: string; planId: string; depositTransactionId: string }
): Promise<{ amount: number; blocked: boolean; inviterName: string } | null> {
  const user = await tx.user.findUnique({ where: { id: opts.userId } });
  const plan = await tx.plan.findUnique({ where: { id: opts.planId } });
  if (!user || !plan) throw new ApiError("User or plan not found", 404);

  const alreadyActive = await getActiveUserPlan(opts.userId, tx);
  if (alreadyActive) throw new ApiError("User already has an active plan", 400);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

  await tx.userPlan.create({
    data: { userId: opts.userId, planId: opts.planId, startedAt: now, expiresAt },
  });

  await tx.transaction.update({
    where: { id: opts.depositTransactionId },
    data: {
      status: "approved",
      processedAt: now,
      description: `Payment approved — ${plan.name} plan activated`,
    },
  });

  return processReferralUnlock(tx, user);
}

/** Approve a plain top-up deposit: credit withdrawable balance. */
export async function processTopupApproval(tx: Tx, depositTransactionId: string) {
  const txn = await tx.transaction.findUnique({ where: { id: depositTransactionId } });
  if (!txn || txn.type !== "deposit") throw new ApiError("Deposit not found", 404);
  await tx.wallet.update({
    where: { userId: txn.userId },
    data: { withdrawableBalance: { increment: txn.amount } },
  });
  await tx.transaction.update({
    where: { id: depositTransactionId },
    data: {
      status: "approved",
      processedAt: new Date(),
      description: `Payment approved — balance credited`,
    },
  });
}

/**
 * INVESTMENT PACKAGE PURCHASE — the multiple-active-packages engine.
 *
 * A member may buy ANY package any number of times (and hold several different
 * packages at once) as long as their total available balance
 * (taskBalance + withdrawableBalance) covers the price.
 *
 * Deduction order: Task Balance first (it is the locked, non-withdrawable
 * earning pocket — investing it is its intended use), remainder from the
 * Withdrawable Balance. Runs entirely inside db.$transaction with a
 * re-read guard so concurrent purchases can never overdraw.
 */
export async function purchaseInvestmentPackage(
  tx: Tx,
  opts: { userId: string; packageId: string }
): Promise<{
  userPackageId: string;
  transactionId: string;
  investAmount: number;
  dailyEarning: number;
  durationDays: number;
  deducted: { task: number; withdrawable: number };
}> {
  const pkg = await tx.investmentPackage.findUnique({ where: { id: opts.packageId } });
  if (!pkg || !pkg.isActive) throw new ApiError("Package not found or disabled.", 400);

  const wallet = await tx.wallet.findUnique({ where: { userId: opts.userId } });
  if (!wallet) throw new ApiError("Wallet not found.", 404);

  const available = wallet.taskBalance + wallet.withdrawableBalance;
  if (available < pkg.price) {
    throw new ApiError(
      `Insufficient balance. You need ${pkg.price - available} more to invest in ${pkg.title}.`,
      400
    );
  }

  // Re-check inside this transaction (rows were just read on the same tx).
  const fromTask = Math.min(wallet.taskBalance, pkg.price);
  const fromWithdrawable = pkg.price - fromTask;

  const now = new Date();
  const endsAt = new Date(now.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);

  const userPackage = await tx.userPackage.create({
    data: {
      userId: opts.userId,
      packageId: pkg.id,
      investAmount: pkg.price,
      dailyEarning: pkg.dailyEarning,
      status: "active",
      startedAt: now,
      endsAt,
    },
  });

  await tx.wallet.update({
    where: { userId: opts.userId },
    data: {
      taskBalance: { decrement: fromTask },
      withdrawableBalance: { decrement: fromWithdrawable },
    },
  });

  const ledger = await tx.transaction.create({
    data: {
      userId: opts.userId,
      type: "package_purchase",
      amount: -pkg.price,
      status: "completed",
      description: `Invested in ${pkg.title} — ${pkg.dailyEarning}/day for ${pkg.durationDays} days`,
      meta: JSON.stringify({
        packageId: pkg.id,
        packageTitle: pkg.title,
        userPackageId: userPackage.id,
        durationDays: pkg.durationDays,
        dailyEarning: pkg.dailyEarning,
        deductedFrom: { task: fromTask, withdrawable: fromWithdrawable },
      }),
      processedAt: now,
    },
  });

  // Referral commission — same transaction, so the purchase and the inviter's
  // withdrawable credit commit (or roll back) as ONE atomic event. Idempotent
  // per activation instance; skipped entirely for non-referred members.
  await creditReferralCommission(tx, {
    inviteeId: opts.userId,
    userPackageId: userPackage.id,
    packageId: pkg.id,
    packageTitle: pkg.title,
    packagePrice: pkg.price,
  });

  return {
    userPackageId: userPackage.id,
    transactionId: ledger.id,
    investAmount: pkg.price,
    dailyEarning: pkg.dailyEarning,
    durationDays: pkg.durationDays,
    deducted: { task: fromTask, withdrawable: fromWithdrawable },
  };
}

/**
 * PACKAGE PAYMENT APPROVAL — admin confirms an external package payment.
 *
 * Creates the UserPackage instance WITHOUT touching the wallet (the money
 * arrived out-of-band — EasyPaisa/JazzCash/USDT — and the admin review IS
 * the verification), marks the payment transaction `approved` with a review
 * audit trail (processedAt + meta.reviewedBy/userPackageId), and is strictly
 * single-shot: a second approval attempt is rejected because the row is no
 * longer `pending`.
 */
export async function activatePackageFromPayment(
  tx: Tx,
  opts: { userId: string; packageId: string; paymentTransactionId: string; reviewedBy?: string }
): Promise<{ userPackageId: string; dailyEarning: number; endsAt: Date } | null> {
  const txn = await tx.transaction.findUnique({ where: { id: opts.paymentTransactionId } });
  if (!txn || txn.type !== "package_purchase") {
    throw new ApiError("Package payment request not found.", 404);
  }
  if (txn.status !== "pending") {
    throw new ApiError("This payment request was already processed.", 400);
  }

  const pkg = await tx.investmentPackage.findUnique({ where: { id: opts.packageId } });
  // Package deleted since submission → caller falls back to crediting a top-up.
  if (!pkg) return null;

  const now = new Date();
  const endsAt = new Date(now.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);

  const userPackage = await tx.userPackage.create({
    data: {
      userId: opts.userId,
      packageId: pkg.id,
      investAmount: pkg.price,
      dailyEarning: pkg.dailyEarning,
      status: "active",
      startedAt: now,
      endsAt,
    },
  });

  const meta = JSON.parse(txn.meta ?? "{}") as Record<string, unknown>;
  await tx.transaction.update({
    where: { id: opts.paymentTransactionId },
    data: {
      status: "approved",
      processedAt: now,
      description: `Payment approved — ${pkg.title} activated`,
      meta: JSON.stringify({
        ...meta,
        userPackageId: userPackage.id,
        ...(opts.reviewedBy ? { reviewedBy: opts.reviewedBy } : {}),
      }),
    },
  });

  // Referral commission — same transaction as the activation, so an approved
  // external package payment pays the inviter's withdrawable commission
  // exactly once (approval itself is single-shot: status must be `pending`).
  await creditReferralCommission(tx, {
    inviteeId: opts.userId,
    userPackageId: userPackage.id,
    packageId: pkg.id,
    packageTitle: pkg.title,
    packagePrice: pkg.price,
  });

  return { userPackageId: userPackage.id, dailyEarning: pkg.dailyEarning, endsAt };
}

/**
 * The nightly daily-earnings distribution engine lives in @/lib/daily-earnings
 * (free of next/server imports) so the standalone cron script can run it too.
 * Re-exported here for backwards compatibility with existing route imports.
 */
export { runDailyEarnings } from "@/lib/daily-earnings";

/** Serialize a Transaction row (with optional user join) into TransactionDTO.
 * The payment-proof screenshot (meta.proof data URL) is stripped — it is only
 * served through the dedicated admin proof endpoint; `hasProof` flags it. */
export function toTransactionDTO(
  t: {
    id: string;
    userId: string;
    relatedUserId?: string | null;
    type: string;
    amount: number;
    status: string;
    description: string;
    meta?: string | null;
    createdAt: Date;
    processedAt?: Date | null;
    user?: { name: string; email: string } | null;
  }
) {
  const meta = t.meta ? safeParseMeta(t.meta) : {};
  const hasProof = typeof meta.proof === "string" && meta.proof.length > 0;
  if ("proof" in meta) delete meta.proof;
  return {
    id: t.id,
    userId: t.userId,
    userName: t.user?.name,
    userEmail: t.user?.email,
    relatedUserId: t.relatedUserId ?? null,
    type: t.type as never,
    amount: t.amount,
    status: t.status as never,
    description: t.description,
    meta,
    hasProof,
    createdAt: t.createdAt.toISOString(),
    processedAt: t.processedAt ? t.processedAt.toISOString() : null,
  };
}

function safeParseMeta(meta: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(meta);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
