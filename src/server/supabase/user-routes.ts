import { NextResponse } from "next/server";

import { ApiError, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { buildHomeHeaderDTO, buildWelcomePopupDTO } from "@/lib/home-data";
import { buildPromoBannersDTO } from "@/lib/promo-banners";
import { MIN_WITHDRAWAL_AMOUNT, today } from "@/lib/business";
import type {
  ActivatePlanResponseDTO,
  DashboardDTO,
  HomeResponseDTO,
  PackageCheckoutResponseDTO,
  PackageTaskClaimResponseDTO,
  PackageTasksResponseDTO,
  PackagesResponseDTO,
  PaymentHistoryResponseDTO,
  PromoClaimResponseDTO,
  PurchasePackageResponseDTO,
  ReferralsResponseDTO,
  SupportListResponseDTO,
  SupportTicketDTO,
  TasksResponseDTO,
  TransactionDTO,
  WalletData,
  WalletResponseDTO,
} from "@/lib/types";
import {
  claimedTaskWithin24h,
  countCompletedToday,
  fetchActiveUserPlan,
  fetchAnyCompletedPackageTaskToday,
  fetchPlanRow,
  fetchTaskRow,
  fetchUserPackageInstance,
  fetchPackageTaskLogToday,
  fetchUserTaskToday,
  fetchWalletOrNull,
  getSupabaseSettings,
  hasPendingWithdrawal,
  requireSupabaseAdmin,
  resolveSupabasePaymentMethod,
  resolveSupabaseWithdrawalMethod,
  rpcCall,
} from "@/server/supabase/core";

/**
 * Supabase-mode implementations for the user dashboard routes (Task 8).
 *
 * Reads use the aggregate RPCs; financial mutations go through RPCs as well.
 * TS-side validations BEFORE each RPC mirror the local implementations
 * message-for-message (the RPC re-validates atomically as defense in depth).
 */

/* -------------------------------- dashboard -------------------------------- */

export async function supabaseDashboard(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<DashboardDTO>("api_dashboard", { p_user_id: user.id });
  return NextResponse.json(dto);
}

/* ---------------------------------- tasks ---------------------------------- */

export async function supabaseTasksList(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<TasksResponseDTO>("api_tasks_list", { p_user_id: user.id });
  return NextResponse.json(dto);
}

/* -------------------------------- tasks/start ------------------------------- */

interface TaskIdBody {
  taskId?: string;
}

interface StartTaskRpcResult {
  ok: true;
  startedAt: string;
}

export async function supabaseStartTask(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<TaskIdBody>(req);
  const taskId = (body.taskId ?? "").trim();

  const task = taskId ? await fetchTaskRow(taskId) : null;
  if (!task || !task.is_active) throw new ApiError("Task not found.", 400);

  const activePlan = await fetchActiveUserPlan(user.id);
  if (!activePlan) throw new ApiError("You need an active plan to start tasks.", 400);

  // Ads Execution Engine gates: target-plan + rolling 24h same-task guard.
  if (task.plan_id && task.plan_id !== activePlan.plan_id) {
    throw new ApiError("This task is not available for your current plan.", 400);
  }
  if (await claimedTaskWithin24h(user.id, task.id)) {
    throw new ApiError("You can claim each task once every 24 hours.", 400);
  }

  const existing = await fetchUserTaskToday(user.id, task.id, today());
  if (existing?.completed_at) throw new ApiError("This task is already completed today.", 400);
  if (existing?.started_at) {
    // Idempotent — already started today.
    return NextResponse.json({ startedAt: existing.started_at });
  }

  const result = await rpcCall<StartTaskRpcResult>("api_start_task", {
    p_user_id: user.id,
    p_task_id: task.id,
  });
  return NextResponse.json({ startedAt: result.startedAt });
}

/* ------------------------------- tasks/complete ----------------------------- */

interface CompleteTaskRpcResult {
  ok: true;
  reward: number;
  completedToday: number;
  wallet: WalletData;
}

export async function supabaseCompleteTask(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<TaskIdBody>(req);
  const taskId = (body.taskId ?? "").trim();
  const date = today();

  // 1. Task exists & is active
  const task = taskId ? await fetchTaskRow(taskId) : null;
  if (!task || !task.is_active) throw new ApiError("Task not found.", 400);

  // 2. Active plan required
  const plan = await fetchActiveUserPlan(user.id);
  if (!plan) throw new ApiError("You need an active plan to earn rewards.", 400);

  // 2b. Target-plan gate (Ads Execution Engine)
  if (task.plan_id && task.plan_id !== plan.plan_id) {
    throw new ApiError("This task is not available for your current plan.", 400);
  }

  // 2c. Rolling 24-hour same-task guard
  if (await claimedTaskWithin24h(user.id, task.id)) {
    throw new ApiError("You can claim each task once every 24 hours.", 400);
  }

  // 3. Must have started the task today
  const userTask = await fetchUserTaskToday(user.id, task.id, date);
  if (!userTask || !userTask.started_at) throw new ApiError("Start the task first.", 400);

  // 4. Not already completed today
  if (userTask.completed_at) throw new ApiError("You already completed this task today.", 400);

  // 5. Daily limit
  const completedToday = await countCompletedToday(user.id, date);
  if (completedToday >= plan.daily_task_limit) {
    throw new ApiError("Daily task limit reached — come back tomorrow.", 400);
  }

  // 6. Timer elapsed (1s grace)
  const elapsedSeconds = (Date.now() - new Date(userTask.started_at).getTime()) / 1000;
  if (elapsedSeconds < task.duration_seconds - 1) {
    throw new ApiError("Please wait for the timer to finish.", 400);
  }

  const result = await rpcCall<CompleteTaskRpcResult>("api_complete_task", {
    p_user_id: user.id,
    p_task_id: task.id,
  });
  return NextResponse.json({
    wallet: result.wallet,
    reward: result.reward,
    completedToday: result.completedToday,
  });
}

/* --------------------------- package tasks (Ads flow) ----------------------- */

/** GET /api/package-tasks — THE one applicable daily task card + content. */
export async function supabasePackageTasksList(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<PackageTasksResponseDTO>("api_package_tasks_list", {
    p_user_id: user.id,
  });
  return NextResponse.json(dto);
}

interface PackageTaskBody {
  userPackageId?: string;
}

/** POST /api/package-tasks/start — TS pre-checks + the idempotent RPC start. */
export async function supabasePackageTaskStart(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<PackageTaskBody>(req);
  const userPackageId = (body.userPackageId ?? "").trim();

  const instance = userPackageId ? await fetchUserPackageInstance(userPackageId) : null;
  if (!instance || instance.user_id !== user.id) throw new ApiError("Package not found.", 400);
  if (instance.status !== "active" || new Date(instance.ends_at) <= new Date()) {
    throw new ApiError("This package is no longer active.", 400);
  }

  // The countdown duration comes from the admin-configured content task.
  const content = await fetchActiveContentTask();
  if (!content) throw new ApiError("Task content is not available. Please try again later.", 400);

  const date = today();
  if (instance.last_earning_date === date) {
    throw new ApiError("This task is already completed today.", 400);
  }

  // Member-level daily guard — ONE task claim per day across ALL packages.
  if (await fetchAnyCompletedPackageTaskToday(user.id, date)) {
    throw new ApiError("You already claimed today's task.", 400);
  }

  const existing = await fetchPackageTaskLogToday(user.id, instance.id, date);
  if (existing?.completed_at) throw new ApiError("This task is already completed today.", 400);
  if (existing?.started_at) {
    // Idempotent — already started today.
    return NextResponse.json({ startedAt: existing.started_at });
  }

  const result = await rpcCall<{ ok: true; startedAt: string }>("api_start_package_task", {
    p_user_id: user.id,
    p_user_package_id: instance.id,
  });
  return NextResponse.json({ startedAt: result.startedAt });
}

interface PackageTaskRpcResult {
  ok: true;
  reward: number;
  wallet: WalletData;
}

/**
 * POST /api/package-tasks/complete — the CLAIM. TS pre-checks mirror the
 * local implementation message-for-message; api_complete_package_task
 * re-validates everything atomically as defense in depth (including the
 * server-side timer and the shared last_earning_date no-double-credit
 * marker).
 */
export async function supabasePackageTaskComplete(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<PackageTaskBody>(req);
  const userPackageId = (body.userPackageId ?? "").trim();
  const date = today();

  // 1-2. Instance exists, belongs to the caller, active, not expired.
  const instance = userPackageId ? await fetchUserPackageInstance(userPackageId) : null;
  if (!instance || instance.user_id !== user.id) throw new ApiError("Package not found.", 400);
  if (instance.status !== "active" || new Date(instance.ends_at) <= new Date()) {
    throw new ApiError("This package is no longer active.", 400);
  }

  // 3. Task content + countdown duration from the admin configuration.
  const task = await fetchActiveContentTask();
  if (!task) throw new ApiError("Task content is not available. Please try again later.", 400);

  // 4. Same-day duplicate guard (claim OR nightly cron credit).
  if (instance.last_earning_date === date) {
    throw new ApiError("You already claimed this task today.", 400);
  }

  // 4b. Member-level daily guard — ONE claim per day across ALL packages.
  if (await fetchAnyCompletedPackageTaskToday(user.id, date)) {
    throw new ApiError("You already claimed today's task.", 400);
  }

  // 5-6. Started today + not completed.
  const log = await fetchPackageTaskLogToday(user.id, instance.id, date);
  if (!log || !log.started_at) throw new ApiError("Start the task first.", 400);
  if (log.completed_at) throw new ApiError("You already claimed this task today.", 400);

  // Timer elapsed (1s grace) — the RPC re-checks atomically.
  const elapsedSeconds = (Date.now() - new Date(log.started_at).getTime()) / 1000;
  if (elapsedSeconds < task.duration_seconds - 1) {
    throw new ApiError("Please wait for the timer to finish.", 400);
  }

  const result = await rpcCall<PackageTaskRpcResult>("api_complete_package_task", {
    p_user_id: user.id,
    p_user_package_id: instance.id,
  });
  return NextResponse.json({
    wallet: result.wallet,
    reward: result.reward,
  });
}

/** The first active tasks row — the admin-configured content task. */
async function fetchActiveContentTask(): Promise<{
  id: string;
  url: string;
  duration_seconds: number;
} | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("tasks")
    .select("id,url,duration_seconds")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);
  return (data as { id: string; url: string; duration_seconds: number } | null) ?? null;
}

/* ------------------------------- plans/activate ----------------------------- */

interface ActivateBody {
  planId?: string;
  /** PaymentMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  txId?: string;
  /** Optional payment proof screenshot (downscaled JPEG data URL). */
  proof?: string;
}

export async function supabaseActivatePlan(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<ActivateBody>(req);

  const planId = (body.planId ?? "").trim();
  const txId = (body.txId ?? "").trim();
  const proof = typeof body.proof === "string" ? body.proof.trim() : "";

  // Method validated against the admin-managed payment_methods rows
  // (legacy aliases resolve to their seeded rows).
  const method = await resolveSupabasePaymentMethod({
    id: body.paymentMethodId,
    name: body.paymentMethod,
  });
  if (!method) throw new ApiError("Select a payment method.", 400);
  if (!/^\d{11,12}$/.test(txId)) {
    throw new ApiError("Enter the 11 or 12-digit Transaction ID (TID) from your payment app.", 400);
  }

  const plan = planId ? await fetchPlanRow(planId) : null;
  if (!plan || !plan.is_active) throw new ApiError("Plan not found.", 400);

  const activePlan = await fetchActiveUserPlan(user.id);
  if (activePlan) throw new ApiError("You already have an active plan.", 400);

  const dto = await rpcCall<ActivatePlanResponseDTO>("api_activate_plan", {
    p_user_id: user.id,
    p_plan_id: plan.id,
    p_payment_method: method.name,
    p_tx_id: txId,
    p_proof: proof || null,
  });
  return NextResponse.json(dto);
}

/* --------------------------------- referrals -------------------------------- */

export async function supabaseReferrals(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<ReferralsResponseDTO>("api_referrals", { p_user_id: user.id });
  return NextResponse.json(dto);
}

/* ----------------------------------- wallet --------------------------------- */

export async function supabaseWallet(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<WalletResponseDTO>("api_wallet_txns", { p_user_id: user.id });
  return NextResponse.json(dto);
}

/* ------------------------------- wallet/deposit ----------------------------- */

interface DepositBody {
  /** PaymentMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  txId?: string;
  amount?: number | string;
}

export async function supabaseWalletDeposit(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<DepositBody>(req);

  const method = await resolveSupabasePaymentMethod({
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

  const result = await rpcCall<{ ok: true; transaction: TransactionDTO }>(
    "api_topup_deposit",
    {
      p_user_id: user.id,
      p_payment_method: method.name,
      p_tx_id: txId,
      p_amount: amount,
    }
  );
  return NextResponse.json({ transaction: result.transaction });
}

/* ------------------------------- wallet/withdraw ---------------------------- */

interface WithdrawBody {
  /** WithdrawalMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  accountDetails?: string;
  amount?: number | string;
}

export async function supabaseWalletWithdraw(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<WithdrawBody>(req);

  // The payout channel is validated against the admin-managed
  // withdrawal_methods rows (the Withdraw page dropdown channels).
  const method = await resolveSupabaseWithdrawalMethod({
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

  // Withdrawal policy (parity with the local route): fixed Rs 20 minimum,
  // NO fixed platform maximum — the per-request cap is the member's own
  // MIN(taskBalance, withdrawableBalance). The Task Balance is only an
  // eligibility cap: it is never withdrawn and never deducted. The RPC
  // api_request_withdrawal re-validates and holds the funds atomically.
  if (amount < MIN_WITHDRAWAL_AMOUNT) {
    throw new ApiError(`Minimum withdrawal is Rs ${MIN_WITHDRAWAL_AMOUNT}.`, 400);
  }

  const wallet = await fetchWalletOrNull(user.id);
  if (!wallet || wallet.withdrawableBalance < amount) {
    throw new ApiError("Insufficient withdrawable balance.", 400);
  }
  if (wallet.taskBalance < amount) {
    throw new ApiError(
      `Withdrawal amount exceeds your Task Balance (${wallet.taskBalance}).`,
      400,
    );
  }

  const pending = await hasPendingWithdrawal(user.id);
  if (pending) throw new ApiError("You already have a pending withdrawal request.", 400);

  const result = await rpcCall<{ ok: true; transaction: TransactionDTO }>(
    "api_request_withdrawal",
    {
      p_user_id: user.id,
      p_amount: amount,
      p_payment_method: method.name,
      p_account_details: accountDetails,
    }
  );
  return NextResponse.json({ transaction: result.transaction });
}

/* ----------------------------- packages (Task 12) --------------------------- */

/**
 * Member catalogue + own instances + portfolio totals. All aggregation happens
 * inside the SECURITY DEFINER RPC api_packages_list (see db/supabase-schema.sql).
 */
export async function supabasePackagesGet(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<PackagesResponseDTO>("api_packages_list", { p_user_id: user.id });
  return NextResponse.json(dto);
}

interface PurchasePackageBody {
  packageId?: string;
}

/**
 * Buy an investment package with the available balance. The TS-side only
 * validates the payload; every financial rule (active package, sufficient
 * combined balance, task-first deduction, instance + ledger creation) runs
 * atomically inside api_purchase_package with a FOR UPDATE wallet lock.
 */
export async function supabasePurchasePackage(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<PurchasePackageBody>(req);
  const packageId = (body.packageId ?? "").trim();
  if (!packageId) throw new ApiError("Package is required.", 400);

  const dto = await rpcCall<PurchasePackageResponseDTO>("api_purchase_package", {
    p_user_id: user.id,
    p_package_id: packageId,
  });
  return NextResponse.json(dto);
}

/* ------------------- packages checkout (Task 17: payment requests) ---------- */

interface CheckoutBody {
  packageId?: string;
  /** PaymentMethod row id (preferred) or its name. */
  paymentMethodId?: string;
  paymentMethod?: string;
  txId?: string;
  /** Payment screenshot (downscaled image data URL, optional unless required). */
  proof?: string;
}

/**
 * POST /api/packages/checkout — submit an external package payment request.
 * TS validates the payload shape + method against the payment_methods rows;
 * every financial rule (package active, price from the DB, duplicate pending
 * request, TxID reuse, require_proof policy, pending transaction creation)
 * runs atomically inside the SECURITY DEFINER RPC api_submit_package_payment.
 */
export async function supabaseSubmitPackagePayment(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<CheckoutBody>(req);

  const packageId = (body.packageId ?? "").trim();
  const txId = (body.txId ?? "").trim();
  const proof = typeof body.proof === "string" ? body.proof.trim() : "";

  if (!packageId) throw new ApiError("Package is required.", 400);
  if (!/^[A-Za-z0-9-]{6,40}$/.test(txId)) {
    throw new ApiError("Enter the transaction ID from your payment app (e.g. TXN12345678).", 400);
  }

  const method = await resolveSupabasePaymentMethod({
    id: body.paymentMethodId,
    name: body.paymentMethod,
  });
  if (!method) throw new ApiError("Select a valid payment method.", 400);

  const dto = await rpcCall<PackageCheckoutResponseDTO>("api_submit_package_payment", {
    p_user_id: user.id,
    p_package_id: packageId,
    p_payment_method_id: method.id,
    p_tx_id: txId,
    p_proof: proof || null,
  });
  return NextResponse.json(dto);
}

/* ---------------------------- payments history (Task 17) -------------------- */

/**
 * GET /api/payments — the signed-in member's payment requests (deposit,
 * plan_purchase, package_purchase), newest first, proof stripped from the
 * DTOs. Scoped to the session user inside the RPC.
 */
export async function supabasePaymentHistory(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<PaymentHistoryResponseDTO>("api_payment_history", {
    p_user_id: user.id,
  });
  return NextResponse.json(dto);
}

/* --------------------------- dynamic home (Task 15) ------------------------- */

/** GET /api/home — widget config + stats + claim states (RPC aggregate). */
export async function supabaseHome(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<HomeResponseDTO>("api_home_data", { p_user_id: user.id });
  // The RPC predates the Home header block — merge it from the settings
  // table so both backends return the identical DTO shape.
  const settings = await getSupabaseSettings();
  return NextResponse.json({ ...dto, header: buildHomeHeaderDTO(settings) });
}

/**
 * GET /api/home/welcome-popup — the Login Welcome Popup config shown on the
 * member Home screen right after login (settings-driven, no RPC needed).
 * Same sanitized-DTO contract as the local backend: forced off without a
 * valid admin-uploaded image, link restricted to /… or http(s).
 */
export async function supabaseWelcomePopup(): Promise<NextResponse> {
  await requireAuth();
  const settings = await getSupabaseSettings();
  return NextResponse.json(buildWelcomePopupDTO(settings));
}

/**
 * GET /api/home/promo-banners — the ACTIVE admin-managed promotional
 * banners for the member premium overlay carousel (settings-driven, no RPC
 * needed — the banner list lives in one system_settings row). Same
 * sanitized-DTO contract as the local backend: only active banners with a
 * valid image, links restricted to /… or http(s), admin's display order.
 */
export async function supabasePromoBanners(): Promise<NextResponse> {
  await requireAuth();
  const settings = await getSupabaseSettings();
  return NextResponse.json({ banners: buildPromoBannersDTO(settings) });
}

interface PromoClaimBody {
  code?: string;
}

/** POST /api/home/promo — redeem an admin-issued code (atomic RPC). */
export async function supabaseHomePromo(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<PromoClaimBody>(req);
  const code = (body.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new ApiError("Invalid promo code.", 400);
  if (code === "TELEGRAM") {
    throw new ApiError("Use the Telegram reward box to claim this one.", 400);
  }
  if (code === "WHATSAPP") {
    throw new ApiError("Use the WhatsApp reward box to claim this one.", 400);
  }

  const dto = await rpcCall<PromoClaimResponseDTO>("api_claim_promo", {
    p_user_id: user.id,
    p_code: code,
  });
  return NextResponse.json(dto);
}

/** POST /api/home/telegram — one-time visit reward (amount from settings). */
export async function supabaseHomeTelegram(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<PromoClaimResponseDTO>("api_claim_telegram", {
    p_user_id: user.id,
  });
  return NextResponse.json(dto);
}

/**
 * POST /api/home/whatsapp — one-time visit reward. Reuses the generic promo
 * RPC with the system WHATSAPP code (same engine as the local backend;
 * amount + eligibility stay server-side in the RPC).
 */
export async function supabaseHomeWhatsapp(): Promise<NextResponse> {
  const user = await requireAuth();
  const dto = await rpcCall<PromoClaimResponseDTO>("api_claim_promo", {
    p_user_id: user.id,
    p_code: "WHATSAPP",
  });
  return NextResponse.json(dto);
}

/* ------------------------- withdrawal history (profile) --------------------- */

interface WithdrawalTxRow {
  id: string;
  user_id: string;
  related_user_id: string | null;
  type: string;
  amount: number;
  status: string;
  description: string;
  meta: Record<string, unknown> | string | null;
  processed_at: string | null;
  created_at: string;
}

/**
 * GET /api/wallet/withdrawals — the member's payout requests, newest first.
 * Direct PostgREST read scoped to the session user (same access pattern as
 * hasPendingWithdrawal / admin payment lists).
 */
export async function supabaseWithdrawalHistory(): Promise<NextResponse> {
  const user = await requireAuth();
  const { data, error } = await requireSupabaseAdmin()
    .from("transactions")
    .select("id,user_id,related_user_id,type,amount,status,description,meta,processed_at,created_at")
    .eq("user_id", user.id)
    .eq("type", "withdrawal")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) throw new ApiError(`Supabase data backend error: ${error.message}`, 500);

  const rows = (data ?? []) as WithdrawalTxRow[];
  const withdrawals: TransactionDTO[] = rows.map((row) => {
    let meta: Record<string, unknown> = {};
    if (typeof row.meta === "string") {
      try {
        const parsed = JSON.parse(row.meta);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = {};
      }
    } else if (row.meta && typeof row.meta === "object") {
      meta = row.meta;
    }
    const hasProof = typeof meta.proof === "string" && meta.proof.length > 0;
    if ("proof" in meta) delete meta.proof;
    return {
      id: row.id,
      userId: row.user_id,
      relatedUserId: row.related_user_id,
      type: row.type as TransactionDTO["type"],
      amount: row.amount,
      status: row.status as TransactionDTO["status"],
      description: row.description,
      meta,
      hasProof,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    };
  });
  return NextResponse.json({ withdrawals });
}

/* --------------------------------- support ---------------------------------- */

/** GET /api/support — the member's OWN tickets (p_user_id-scoped RPC on top
 *  of the service-role-only RLS default-deny model — a member can never see
 *  another member's requests). */
export async function supabaseSupportList(): Promise<NextResponse> {
  const user = await requireAuth();
  const tickets = await rpcCall<SupportTicketDTO[]>("api_support_list", {
    p_user_id: user.id,
  });
  const payload: SupportListResponseDTO = { tickets };
  return NextResponse.json(payload);
}

interface SupportCreateBody {
  subject?: string;
  message?: string;
}

/** POST /api/support — submit a new help request (same validation as the
 *  local route; the RPC re-validates inside the transaction). */
export async function supabaseSupportCreate(req: Request): Promise<NextResponse> {
  const user = await requireAuth();
  const body = await parseJsonBody<SupportCreateBody>(req);

  const subject = (body.subject ?? "").trim();
  const message = (body.message ?? "").trim();
  if (subject.length < 3 || subject.length > 120) {
    throw new ApiError("Subject must be 3–120 characters.", 400);
  }
  if (message.length < 5 || message.length > 2000) {
    throw new ApiError("Message must be 5–2000 characters.", 400);
  }

  const ticket = await rpcCall<SupportTicketDTO>("api_support_create", {
    p_user_id: user.id,
    p_subject: subject,
    p_message: message,
  });
  return NextResponse.json({ ticket });
}
