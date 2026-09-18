import { NextResponse } from "next/server";

import { ApiError, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { assertPackageNumbersFit, assertSortOrderFits } from "@/lib/package-limits";
import { validateInviteSettings } from "@/lib/invite";
import {
  applyPromoBannerAction,
  parseStoredPromoBanners,
  PROMO_BANNERS_KEY,
  serializePromoBanners,
  toAdminPromoBannerDTOs,
  validatePromoBannerInput,
  type PromoBannerAction,
} from "@/lib/promo-banners";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { isHttpUrl, isImageSourceUrl, toIntOrNull, validateHomeHeaderSettingValue, validateWelcomePopupSettingValue } from "@/app/api/_lib/helpers";
import type {
  AdminNotificationsPayloadDTO,
  AdminStatsDTO,
  AdminUsersPayloadDTO,
  DailyEarningsSummaryDTO,
  NotificationDTO,
  PackageDTO,
  PaymentMethodDTO,
  PlanDTO,
  SupportTicketDTO,
  TaskDTO,
  TransactionDTO,
} from "@/lib/types";
import {
  countOtherActiveWithdrawalMethods,
  fetchPlanRow,
  fetchTransactionRow,
  fetchUserById,
  fetchWithdrawalMethodById,
  fetchWithdrawalMethods,
  getSupabaseSettings,
  mapPackageRow,
  mapPlanRow,
  mapTaskRow,
  mapWithdrawalMethodRow,
  requireSupabaseAdmin,
  rpcCall,
  updateWithdrawalMethod,
  upsertSupabaseSettings,
  type PackageRow,
  type PaymentMethodRow,
  type PlanRow,
  type TaskRow,
} from "@/server/supabase/core";

/**
 * Supabase-mode implementations for the /api/admin/* routes (Task 8).
 *
 * - Aggregate reads (stats/users/txn lists) go through RPCs.
 * - plans/tasks CRUD + settings + ban/unban use plain PostgREST.
 * - Financial mutations (withdrawal/deposit approve-reject, balance adjust)
 *   go through the SECURITY DEFINER RPCs.
 *
 * Validation messages + status codes mirror the local implementations exactly;
 * TS-side pre-checks run BEFORE the RPCs.
 */

const dataError = (message: string, context: string) =>
  new ApiError(`Supabase data backend error: ${message} (${context})`, 500);

/* ---------------------------------- stats ----------------------------------- */

export async function supabaseAdminStats(): Promise<NextResponse> {
  await requireAdmin();
  const dto = await rpcCall<AdminStatsDTO>("api_admin_stats");
  return NextResponse.json(dto);
}

/* --------------------------------- settings --------------------------------- */

export async function supabaseAdminSettingsGet(): Promise<NextResponse> {
  await requireAdmin();
  const settings = await getSupabaseSettings();
  return NextResponse.json({ settings });
}

export async function supabaseAdminSettingsPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<{ settings?: Record<string, unknown> }>(req);

  const incoming = body.settings;
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    throw new ApiError("Invalid settings payload.", 400);
  }

  // Whitelist: only known setting keys are persisted.
  const updates = Object.entries(incoming)
    .filter(([key]) => key in SETTING_DEFAULTS)
    .map(([key, value]) => ({ key, value: String(value) }));

  // Branding image keys only accept real image sources (parity with the
  // local Prisma settings route).
  const IMAGE_SETTING_KEYS = new Set([
    "site_logo_url",
    "site_favicon_url",
    "wallet_method_image_url",
    "home_team_salary_image",
  ]);
  for (const { key, value } of updates) {
    if (IMAGE_SETTING_KEYS.has(key) && value.trim() && !isImageSourceUrl(value)) {
      throw new ApiError(
        "Branding images must be uploaded image files (JPG, PNG or WEBP) or http(s) URLs.",
        400,
      );
    }
  }

  await upsertSupabaseSettings(updates);

  const settings = await getSupabaseSettings();
  return NextResponse.json({ settings });
}

/* ---------------------------- invite page (Task 25) ------------------------- */

const INVITE_KEYS = Object.keys(SETTING_DEFAULTS).filter((k) => k.startsWith("invite_"));

/** GET /api/admin/invite — raw Invite page settings (parity with local route). */
export async function supabaseAdminInviteGet(): Promise<NextResponse> {
  await requireAdmin();
  const settings = await getSupabaseSettings();
  const inviteSettings: Record<string, string> = {};
  for (const key of INVITE_KEYS) inviteSettings[key] = settings[key] ?? "";
  return NextResponse.json({ settings: inviteSettings });
}

/** POST /api/admin/invite — validate + persist Invite page settings (parity). */
export async function supabaseAdminInvitePost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<{ settings?: Record<string, unknown> }>(req);

  const result = validateInviteSettings(body.settings);
  if (!result.ok) throw new ApiError(result.error, 400);

  await upsertSupabaseSettings(Object.entries(result.settings).map(([key, value]) => ({ key, value })));

  const settings = await getSupabaseSettings();
  const inviteSettings: Record<string, string> = {};
  for (const key of INVITE_KEYS) inviteSettings[key] = settings[key] ?? "";
  return NextResponse.json({ settings: inviteSettings });
}

/* ---------------------------------- plans ----------------------------------- */

async function fetchAllPlans(): Promise<PlanDTO[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("plans")
    .select(
      "id,name,description,price,reward_per_task,daily_task_limit,duration_days,is_active,sort_order"
    )
    .order("sort_order", { ascending: true });
  if (error) throw dataError(error.message, "plans list");
  return ((data ?? []) as PlanRow[]).map(mapPlanRow);
}

const NUMERIC_PLAN_FIELDS = ["price", "rewardPerTask", "dailyTaskLimit", "durationDays"] as const;

interface PlanPostBody {
  action?: string;
  id?: string;
  name?: string;
  description?: string;
  price?: number | string;
  rewardPerTask?: number | string;
  dailyTaskLimit?: number | string;
  durationDays?: number | string;
  isActive?: boolean;
}

const PLAN_FIELD_TO_COLUMN: Record<string, string> = {
  price: "price",
  rewardPerTask: "reward_per_task",
  dailyTaskLimit: "daily_task_limit",
  durationDays: "duration_days",
};

export async function supabaseAdminPlansGet(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({ plans: await fetchAllPlans() });
}

export async function supabaseAdminPlansPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const client = requireSupabaseAdmin();
  const body = await parseJsonBody<PlanPostBody>(req);
  const action = (body.action ?? "").trim();

  if (action === "create") {
    const name = (body.name ?? "").trim();
    if (name.length < 2) throw new ApiError("Plan name must be at least 2 characters.", 400);

    const nums: Record<string, number> = {};
    for (const field of NUMERIC_PLAN_FIELDS) {
      const n = toIntOrNull(body[field]);
      if (n === null || n < 1) {
        throw new ApiError(
          "Price, reward per task, daily limit and duration must be positive integers.",
          400
        );
      }
      nums[field] = n;
    }
    const description = body.description == null ? null : String(body.description).trim() || null;

    // max sort_order + 1 (same as local)
    const { data: maxRow, error: maxErr } = await client
      .from("plans")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) throw dataError(maxErr.message, "plans max order");
    const maxOrder = (maxRow as { sort_order: number } | null)?.sort_order ?? 0;

    const { error } = await client.from("plans").insert({
      name,
      description,
      price: nums.price,
      reward_per_task: nums.rewardPerTask,
      daily_task_limit: nums.dailyTaskLimit,
      duration_days: nums.durationDays,
      is_active: body.isActive === undefined ? true : Boolean(body.isActive),
      sort_order: maxOrder + 1,
    });
    if (error) throw dataError(error.message, "plan create");
  } else if (action === "update") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPlanRowById(id) : null;
    if (!existing) throw new ApiError("Plan not found.", 400);

    const data: Record<string, number | string | boolean | null> = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2) throw new ApiError("Plan name must be at least 2 characters.", 400);
      data.name = name;
    }
    if (body.description !== undefined) {
      const d = String(body.description ?? "").trim();
      data.description = d.length ? d : null;
    }
    for (const field of NUMERIC_PLAN_FIELDS) {
      if (body[field] !== undefined) {
        const n = toIntOrNull(body[field]);
        if (n === null || n < 1) {
          throw new ApiError(`${field} must be a positive integer.`, 400);
        }
        data[PLAN_FIELD_TO_COLUMN[field]] = n;
      }
    }
    if (body.isActive !== undefined) data.is_active = Boolean(body.isActive);

    const { error } = await client.from("plans").update(data).eq("id", id);
    if (error) throw dataError(error.message, "plan update");
  } else if (action === "toggle") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPlanRowById(id) : null;
    if (!existing) throw new ApiError("Plan not found.", 400);
    const { error } = await client
      .from("plans")
      .update({ is_active: !existing.is_active })
      .eq("id", id);
    if (error) throw dataError(error.message, "plan toggle");
  } else {
    throw new ApiError("Unknown action. Use create, update or toggle.", 400);
  }

  return NextResponse.json({ plans: await fetchAllPlans() });
}

async function fetchPlanRowById(id: string): Promise<PlanRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("plans")
    .select(
      "id,name,description,price,reward_per_task,daily_task_limit,duration_days,is_active,sort_order"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError(error.message, "plan lookup");
  return (data as PlanRow | null) ?? null;
}

/* ---------------------------------- tasks ----------------------------------- */

async function fetchAllTasks(): Promise<TaskDTO[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("tasks")
    .select("id,title,description,url,duration_seconds,reward_amount,plan_id,is_active,sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw dataError(error.message, "tasks list");
  return ((data ?? []) as TaskRow[]).map(mapTaskRow);
}

async function fetchTaskRowById(id: string): Promise<TaskRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("tasks")
    .select("id,title,description,url,duration_seconds,reward_amount,plan_id,is_active,sort_order")
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError(error.message, "task lookup");
  return (data as TaskRow | null) ?? null;
}

interface TaskPostBody {
  action?: string;
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  durationSeconds?: number | string;
  rewardAmount?: number | string | null; // PKR override — null/"" = plan default
  planId?: string | null; // target plan — null/"" = all plans
  isActive?: boolean;
}

// Ads Execution Engine field parsing (mirrors the local route).
function parseTaskReward(v: TaskPostBody["rewardAmount"]): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = toIntOrNull(v);
  if (n === null || n < 0 || n > 100_000) {
    throw new ApiError("Reward must be a whole number between 0 and 100,000 PKR.", 400);
  }
  return n;
}

async function parseTaskPlanId(v: TaskPostBody["planId"]): Promise<string | null> {
  const p = v === null || v === undefined ? "" : String(v).trim();
  if (!p) return null;
  const plan = await fetchPlanRow(p);
  if (!plan) throw new ApiError("Target plan not found.", 400);
  return plan.id;
}

export async function supabaseAdminTasksGet(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({ tasks: await fetchAllTasks() });
}

export async function supabaseAdminTasksPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const client = requireSupabaseAdmin();
  const body = await parseJsonBody<TaskPostBody>(req);
  const action = (body.action ?? "").trim();

  if (action === "create") {
    const title = (body.title ?? "").trim();
    if (title.length < 2) throw new ApiError("Task title must be at least 2 characters.", 400);
    if (!isHttpUrl(body.url)) throw new ApiError("Task URL must start with http:// or https://.", 400);
    const durationSeconds = toIntOrNull(body.durationSeconds);
    if (durationSeconds === null || durationSeconds < 5 || durationSeconds > 600) {
      throw new ApiError("Duration must be between 5 and 600 seconds.", 400);
    }
    const description = body.description == null ? null : String(body.description).trim() || null;

    const { data: maxRow, error: maxErr } = await client
      .from("tasks")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) throw dataError(maxErr.message, "tasks max order");
    const maxOrder = (maxRow as { sort_order: number } | null)?.sort_order ?? 0;

    const { error } = await client.from("tasks").insert({
      title,
      description,
      url: String(body.url).trim(),
      duration_seconds: durationSeconds,
      reward_amount: parseTaskReward(body.rewardAmount),
      plan_id: await parseTaskPlanId(body.planId),
      is_active: body.isActive === undefined ? true : Boolean(body.isActive),
      sort_order: maxOrder + 1,
    });
    if (error) throw dataError(error.message, "task create");
  } else if (action === "update") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchTaskRowById(id) : null;
    if (!existing) throw new ApiError("Task not found.", 400);

    const data: Record<string, string | number | boolean | null> = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length < 2) throw new ApiError("Task title must be at least 2 characters.", 400);
      data.title = title;
    }
    if (body.description !== undefined) {
      const d = String(body.description ?? "").trim();
      data.description = d.length ? d : null;
    }
    if (body.url !== undefined) {
      if (!isHttpUrl(body.url)) throw new ApiError("Task URL must start with http:// or https://.", 400);
      data.url = String(body.url).trim();
    }
    if (body.durationSeconds !== undefined) {
      const n = toIntOrNull(body.durationSeconds);
      if (n === null || n < 5 || n > 600) {
        throw new ApiError("Duration must be between 5 and 600 seconds.", 400);
      }
      data.duration_seconds = n;
    }
    if (body.rewardAmount !== undefined) data.reward_amount = parseTaskReward(body.rewardAmount);
    if (body.planId !== undefined) data.plan_id = await parseTaskPlanId(body.planId);
    if (body.isActive !== undefined) data.is_active = Boolean(body.isActive);

    const { error } = await client.from("tasks").update(data).eq("id", id);
    if (error) throw dataError(error.message, "task update");
  } else if (action === "toggle") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchTaskRowById(id) : null;
    if (!existing) throw new ApiError("Task not found.", 400);
    const { error } = await client
      .from("tasks")
      .update({ is_active: !existing.is_active })
      .eq("id", id);
    if (error) throw dataError(error.message, "task toggle");
  } else {
    throw new ApiError("Unknown action. Use create, update or toggle.", 400);
  }

  return NextResponse.json({ tasks: await fetchAllTasks() });
}

/* ---------------------------------- users ----------------------------------- */

export async function supabaseAdminUsersGet(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  const payload = await rpcCall<AdminUsersPayloadDTO>("api_admin_users", {
    p_query: params.get("q") ?? "",
    p_status: params.get("status") ?? "all",
    p_page: Number.parseInt(params.get("page") ?? "1", 10) || 1,
    p_page_size: Number.parseInt(params.get("pageSize") ?? "25", 10) || 25,
  });
  return NextResponse.json(payload);
}

interface UserPostBody {
  userId?: string;
  action?: string;
  balanceType?: string;
  amount?: number | string;
  reason?: string;
}

export async function supabaseAdminUsersPost(req: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  const client = requireSupabaseAdmin();
  const body = await parseJsonBody<UserPostBody>(req);

  const userId = (body.userId ?? "").trim();
  const action = (body.action ?? "").trim();

  const target = userId ? await fetchUserById(userId) : null;
  if (!target) throw new ApiError("User not found.", 400);

  if (action === "ban") {
    if (target.role === "admin" || target.id === admin.id) {
      throw new ApiError("Cannot ban an admin.", 400);
    }
    const { error } = await client.from("users").update({ is_banned: true }).eq("id", target.id);
    if (error) throw dataError(error.message, "user ban");
  } else if (action === "unban") {
    const { error } = await client.from("users").update({ is_banned: false }).eq("id", target.id);
    if (error) throw dataError(error.message, "user unban");
  } else if (action === "adjust") {
    const balanceType = (body.balanceType ?? "").trim();
    if (balanceType !== "task" && balanceType !== "withdrawable") {
      throw new ApiError("Balance type must be task or withdrawable.", 400);
    }
    const amount = toIntOrNull(body.amount);
    if (amount === null || amount === 0) {
      throw new ApiError("Enter a non-zero integer amount.", 400);
    }
    const reason =
      body.reason === undefined || body.reason === null ? null : String(body.reason).trim();

    // Financial mutation → RPC (wallet update + adjustment ledger entry, atomic).
    // The RPC also enforces the wallet-exists + insufficient-balance guards.
    await rpcCall("api_adjust_balance", {
      p_user_id: target.id,
      p_balance_type: balanceType,
      p_amount: amount,
      p_reason: reason,
      p_admin_id: admin.id,
    });
  } else {
    throw new ApiError("Unknown action. Use ban, unban or adjust.", 400);
  }

  // The list itself is refreshed by the client via query invalidation.
  return NextResponse.json({ ok: true });
}

/* ------------------------------- notifications ------------------------------- */

interface NotificationPostBody {
  title?: string;
  message?: string;
}

export async function supabaseAdminNotificationsGet(params: {
  page: number;
  pageSize: number;
}): Promise<NextResponse> {
  await requireAdmin();
  const payload = await rpcCall<AdminNotificationsPayloadDTO>("api_admin_notifications", {
    p_page: params.page,
    p_page_size: params.pageSize,
  });
  return NextResponse.json(payload);
}

export async function supabaseAdminNotificationsPost(req: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  const body = await parseJsonBody<NotificationPostBody>(req);

  const title = (body.title ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!title) throw new ApiError("Enter a notification title.", 400);
  if (title.length > 80) throw new ApiError("Title must be 80 characters or fewer.", 400);
  if (!message) throw new ApiError("Enter a notification message.", 400);
  if (message.length > 500) throw new ApiError("Message must be 500 characters or fewer.", 400);

  const created = await rpcCall<NotificationDTO & { createdBy: string }>(
    "api_admin_notification_create",
    { p_title: title, p_message: message, p_created_by: admin.email },
  );
  return NextResponse.json({ ok: true, notification: created });
}

/* ------------------------------- withdrawals -------------------------------- */

async function fetchAdminTxns(type: "withdrawal" | "deposit"): Promise<TransactionDTO[]> {
  return rpcCall<TransactionDTO[]>("api_admin_txns", { p_type: type, p_limit: 60 });
}

export async function supabaseAdminWithdrawalsGet(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({ withdrawals: await fetchAdminTxns("withdrawal") });
}

export async function supabaseAdminWithdrawalsPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<{ id?: string; action?: string; note?: string }>(req);

  const id = (body.id ?? "").trim();
  const action = (body.action ?? "").trim();
  const note = typeof body.note === "string" ? body.note.trim() : "";

  const txn = id ? await fetchTransactionRow(id) : null;
  if (!txn || txn.type !== "withdrawal" || txn.status !== "pending") {
    throw new ApiError("Withdrawal not found or already processed.", 400);
  }

  // Approval safety (parity with the local route): the payout destination
  // snapshot captured at request time (meta.accountDetails) must be present
  // before the withdrawal may be marked paid. Reject stays available.
  if (action === "approve") {
    // Supabase jsonb meta arrives from supabase-js ALREADY PARSED (object),
    // unlike the local Prisma track (raw JSON string) — do not re-parse it.
    const meta = txn.meta ?? {};
    const destination =
      typeof meta.accountDetails === "string" ? meta.accountDetails.trim() : "";
    if (destination.length < 5) {
      throw new ApiError(
        "Payment details are missing for this withdrawal. Please resolve the member's payment details before approving.",
        400,
      );
    }
  }

  if (action === "approve" || action === "reject") {
    // Financial mutation → RPC (approve pays out; reject refunds atomically).
    await rpcCall("api_process_withdrawal", {
      p_transaction_id: txn.id,
      p_action: action,
      p_note: note || null,
    });
  } else {
    throw new ApiError("Unknown action. Use approve or reject.", 400);
  }

  return NextResponse.json({ withdrawals: await fetchAdminTxns("withdrawal") });
}

/* --------------------------------- deposits --------------------------------- */

export async function supabaseAdminDepositsGet(): Promise<NextResponse> {
  await requireAdmin();
  // api_admin_txns('deposit') covers `deposit`, `plan_purchase` AND
  // `package_purchase` money-in submissions (Tasks 16 + 17 checkout engines).
  return NextResponse.json({ deposits: await fetchAdminTxns("deposit") });
}

export async function supabaseAdminDepositsPost(req: Request): Promise<NextResponse> {
  const admin = await requireAdmin();
  const body = await parseJsonBody<{ id?: string; action?: string; note?: string }>(req);

  const id = (body.id ?? "").trim();
  const action = (body.action ?? "").trim();
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";

  const txn = id ? await fetchTransactionRow(id) : null;
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

  if (action === "approve" || action === "reject") {
    // Financial mutation → RPC (plan-purpose submissions activate the plan +
    // referral unlock; package-purpose submissions activate the investment
    // instance without touching the wallet; top-ups credit the balance;
    // reject just marks it). The reviewer name rides along as the audit trail.
    await rpcCall("api_process_deposit", {
      p_transaction_id: txn.id,
      p_action: action,
      p_note: note || null,
      p_reviewed_by: admin.name,
    });
  } else {
    throw new ApiError("Unknown action. Use approve or reject.", 400);
  }

  return NextResponse.json({ deposits: await fetchAdminTxns("deposit") });
}

/** Serve the payment-proof screenshot for a submission (admin only). */
export async function supabaseAdminDepositProof(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get("id") ?? "").trim();

  const txn = id ? await fetchTransactionRow(id) : null;
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

  const raw = txn.meta?.proof;
  const proof = typeof raw === "string" && raw.startsWith("data:image/") ? raw : null;
  return NextResponse.json({ id: txn.id, proof });
}

/* ----------------------------- transactions ledger --------------------------- */

/**
 * Read-only, paginated view over the EXISTING transaction ledger for the
 * Admin Control Center (search by member + type/status filters). Mirrors the
 * local /api/admin/transactions implementation via the api_admin_transactions
 * RPC (security definer, service-role only).
 */
export async function supabaseAdminTransactionsGet(params: {
  q: string;
  type: string;
  status: string;
  page: number;
  pageSize: number;
}): Promise<NextResponse> {
  await requireAdmin();
  const result = await rpcCall<{ total: number | null; transactions: TransactionDTO[] | null }>(
    "api_admin_transactions",
    {
      p_query: params.q || null,
      p_type: params.type || null,
      p_status: params.status || null,
      p_limit: params.pageSize,
      p_offset: (params.page - 1) * params.pageSize,
    },
  );
  const total = Number(result.total ?? 0);
  return NextResponse.json({
    transactions: result.transactions ?? [],
    total,
    page: params.page,
    pageSize: params.pageSize,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  });
}

/* ------------------------- investment packages (Task 12) --------------------- */

interface PackageStats {
  totalInstances: number;
  activeInstances: number;
  totalInvested: number;
  dailyLiability: number;
  totalEarnedPaid: number;
}

async function fetchAllPackages(): Promise<PackageDTO[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("investment_packages")
    .select(
      "id,title,description,price,daily_earning,duration_days,total_return,net_profit,is_active,sort_order"
    )
    .order("sort_order", { ascending: true });
  if (error) throw dataError(error.message, "investment packages list");
  return ((data ?? []) as PackageRow[]).map(mapPackageRow);
}

async function fetchPackageStats(): Promise<PackageStats> {
  const client = requireSupabaseAdmin();
  const { data: instances, error: instErr } = await client
    .from("user_packages")
    .select("invest_amount,daily_earning,status,ends_at");
  if (instErr) throw dataError(instErr.message, "user packages stats");
  const rows = (instances ?? []) as {
    invest_amount: number;
    daily_earning: number;
    status: string;
    ends_at: string;
  }[];
  const nowIso = new Date().toISOString();
  const active = rows.filter((r) => r.status === "active" && r.ends_at > nowIso);
  const { data: earned, error: earnedErr } = await client
    .from("transactions")
    .select("amount")
    .eq("type", "daily_earning")
    .eq("status", "completed");
  if (earnedErr) throw dataError(earnedErr.message, "daily earnings stats");
  return {
    totalInstances: rows.length,
    activeInstances: active.length,
    totalInvested: rows.reduce((sum, r) => sum + r.invest_amount, 0),
    dailyLiability: active.reduce((sum, r) => sum + r.daily_earning, 0),
    totalEarnedPaid: (earned ?? []).reduce((sum, r) => sum + (r as { amount: number }).amount, 0),
  };
}

async function fetchPackageRowById(id: string): Promise<PackageRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("investment_packages")
    .select(
      "id,title,description,price,daily_earning,duration_days,total_return,net_profit,is_active,sort_order"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError(error.message, "investment package lookup");
  return (data as PackageRow | null) ?? null;
}

interface PackagePostBody {
  action?: string;
  id?: string;
  title?: string;
  description?: string | null;
  price?: number | string;
  dailyEarning?: number | string;
  durationDays?: number | string;
  totalReturn?: number | string | null;
  sortOrder?: number | string;
  isActive?: boolean;
}

const PKG_NUMERIC_FIELDS = ["price", "dailyEarning", "durationDays"] as const;

function pkgPositiveInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function pkgInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Trim + cap the optional package description (500 chars). */
function pkgDescription(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().slice(0, 500);
  return s || null;
}

export async function supabaseAdminPackagesGet(): Promise<NextResponse> {
  await requireAdmin();
  const [packages, stats] = await Promise.all([fetchAllPackages(), fetchPackageStats()]);
  return NextResponse.json({ packages, stats });
}

export async function supabaseAdminPackagesPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const client = requireSupabaseAdmin();
  const body = await parseJsonBody<PackagePostBody>(req);
  const action = (body.action ?? "").trim();

  if (action === "create") {
    const title = (body.title ?? "").trim();
    if (title.length < 2) throw new ApiError("Package title must be at least 2 characters.", 400);

    const nums: Record<string, number> = {};
    for (const field of PKG_NUMERIC_FIELDS) {
      const n = pkgPositiveInt(body[field]);
      if (n === null) {
        throw new ApiError("Price, daily earnings and duration must be positive integers.", 400);
      }
      nums[field] = n;
    }

    let totalReturn: number;
    if (body.totalReturn === undefined || body.totalReturn === null || body.totalReturn === "") {
      totalReturn = nums.dailyEarning * nums.durationDays;
    } else {
      const t = pkgPositiveInt(body.totalReturn);
      if (t === null) throw new ApiError("Total return must be a positive integer.", 400);
      totalReturn = t;
    }

    let sortOrder: number;
    if (body.sortOrder === undefined || body.sortOrder === null || body.sortOrder === "") {
      const { data: maxRow, error: maxErr } = await client
        .from("investment_packages")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw dataError(maxErr.message, "packages max order");
      sortOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? 0) + 1;
    } else {
      const s = pkgInt(body.sortOrder);
      if (s === null) throw new ApiError("Priority must be an integer.", 400);
      sortOrder = s;
    }

    // Reject values the int4 columns cannot hold BEFORE writing them
    // (packages hotfix — mirrors the local-track guard).
    assertPackageNumbersFit({
      price: nums.price,
      dailyEarning: nums.dailyEarning,
      durationDays: nums.durationDays,
      totalReturn,
    });
    assertSortOrderFits(sortOrder);

    const { error } = await client.from("investment_packages").insert({
      title,
      description: pkgDescription(body.description),
      price: nums.price,
      daily_earning: nums.dailyEarning,
      duration_days: nums.durationDays,
      total_return: totalReturn,
      net_profit: totalReturn - nums.price,
      is_active: body.isActive === undefined ? true : Boolean(body.isActive),
      sort_order: sortOrder,
    });
    if (error) throw dataError(error.message, "package create");
  } else if (action === "update") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPackageRowById(id) : null;
    if (!existing) throw new ApiError("Package not found.", 400);

    const data: Record<string, number | string | boolean | null> = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length < 2) throw new ApiError("Package title must be at least 2 characters.", 400);
      data.title = title;
    }
    if (body.description !== undefined) {
      data.description = pkgDescription(body.description);
    }

    const nums: Record<string, number> = {};
    for (const field of PKG_NUMERIC_FIELDS) {
      if (body[field] !== undefined) {
        const n = pkgPositiveInt(body[field]);
        if (n === null) throw new ApiError(`${field} must be a positive integer.`, 400);
        nums[field] = n;
      }
    }
    if (nums.price !== undefined) data.price = nums.price;
    if (nums.dailyEarning !== undefined) data.daily_earning = nums.dailyEarning;
    if (nums.durationDays !== undefined) data.duration_days = nums.durationDays;

    const daily = nums.dailyEarning ?? existing.daily_earning;
    const duration = nums.durationDays ?? existing.duration_days;
    const price = nums.price ?? existing.price;

    if (body.totalReturn === undefined) {
      const auto = daily * duration;
      data.total_return =
        existing.total_return === existing.daily_earning * existing.duration_days
          ? auto
          : existing.total_return;
    } else if (body.totalReturn === null || body.totalReturn === "") {
      data.total_return = daily * duration; // cleared → back to auto
    } else {
      const t = pkgPositiveInt(body.totalReturn);
      if (t === null) throw new ApiError("Total return must be a positive integer.", 400);
      data.total_return = t;
    }
    data.net_profit = (data.total_return as number) - price;

    // Reject values the int4 columns cannot hold BEFORE writing them
    // (checks the resolved numbers whether or not they changed).
    assertPackageNumbersFit({ price, dailyEarning: daily, durationDays: duration, totalReturn: data.total_return as number });

    if (body.sortOrder !== undefined) {
      const s = pkgInt(body.sortOrder);
      if (s === null) throw new ApiError("Priority must be an integer.", 400);
      data.sort_order = s;
      assertSortOrderFits(s);
    }
    if (body.isActive !== undefined) data.is_active = Boolean(body.isActive);

    const { error } = await client.from("investment_packages").update(data).eq("id", id);
    if (error) throw dataError(error.message, "package update");
  } else if (action === "toggle") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPackageRowById(id) : null;
    if (!existing) throw new ApiError("Package not found.", 400);
    const { error } = await client
      .from("investment_packages")
      .update({ is_active: !existing.is_active })
      .eq("id", id);
    if (error) throw dataError(error.message, "package toggle");
  } else {
    throw new ApiError("Unknown action. Use create, update or toggle.", 400);
  }

  const [packages, stats] = await Promise.all([fetchAllPackages(), fetchPackageStats()]);
  return NextResponse.json({ packages, stats });
}

/** Manual trigger of the nightly distribution engine (same RPC as the cron script). */
export async function supabaseAdminCronDailyEarnings(): Promise<NextResponse> {
  await requireAdmin();
  const dto = await rpcCall<DailyEarningsSummaryDTO>("api_run_daily_earnings");
  return NextResponse.json(dto);
}

/* --------------------------- dynamic home (Task 15) ------------------------- */

const HOME_KEYS = Object.keys(SETTING_DEFAULTS).filter((k) => k.startsWith("home_"));

interface PromoRow {
  id: string;
  code: string;
  title: string;
  reward_amount: number;
  max_uses: number | null;
  used_count: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
}

async function fetchPromoRows(): Promise<PromoRow[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("promo_codes")
    .select("id,code,title,reward_amount,max_uses,used_count,is_active,is_system,created_at")
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw dataError(error.message, "promo codes list");
  return (data ?? []) as PromoRow[];
}

async function fetchPromoClaimCounts(): Promise<Map<string, number>> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client.from("promo_claims").select("promo_code_id");
  if (error) throw dataError(error.message, "promo claims list");
  const map = new Map<string, number>();
  for (const row of (data ?? []) as { promo_code_id: string }[]) {
    map.set(row.promo_code_id, (map.get(row.promo_code_id) ?? 0) + 1);
  }
  return map;
}

/** GET /api/admin/home — home widget settings + promo codes + telegram reward. */
export async function supabaseAdminHomeGet(): Promise<NextResponse> {
  await requireAdmin();
  const client = requireSupabaseAdmin();

  // Ensure the system TELEGRAM row exists (app config, like the local engine).
  const settings = await getSupabaseSettings();
  const telegramReward = parseInt(settings.home_telegram_reward ?? "50", 10) || 50;
  const { error: seedErr } = await client
    .from("promo_codes")
    .upsert(
      {
        code: "TELEGRAM",
        title: "Telegram join reward",
        reward_amount: telegramReward,
        max_uses: null,
        is_active: true,
        is_system: true,
      },
      { onConflict: "code", ignoreDuplicates: true }
    );
  if (seedErr) throw dataError(seedErr.message, "telegram promo seed");

  const [promoRows, claimCounts] = await Promise.all([fetchPromoRows(), fetchPromoClaimCounts()]);
  const homeSettings: Record<string, string> = {};
  for (const key of HOME_KEYS) homeSettings[key] = settings[key] ?? "";

  return NextResponse.json({
    settings: homeSettings,
    telegramReward,
    promoCodes: promoRows.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      rewardAmount: p.is_system ? telegramReward : p.reward_amount,
      maxUses: p.max_uses,
      usedCount: p.used_count,
      claimsCount: claimCounts.get(p.id) ?? 0,
      isActive: p.is_active,
      isSystem: p.is_system,
      createdAt: p.created_at,
    })),
  });
}

/** POST /api/admin/home — persist home_* settings (whitelisted). */
export async function supabaseAdminHomePost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<{ settings?: Record<string, unknown> }>(req);
  const incoming = body.settings;
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    throw new ApiError("Invalid settings payload.", 400);
  }

  const updates = Object.entries(incoming)
    .filter(([key]) => key in SETTING_DEFAULTS && key.startsWith("home_"))
    .map(([key, value]) => ({ key, value: String(value) }));

  // Login Welcome Popup values are validated BEFORE anything is persisted —
  // identical rules to the local backend (image source, frequency, link,
  // caps) — plus the Home header title/tagline length caps.
  for (const { key, value } of updates) {
    if (key.startsWith("home_welcome_popup_")) {
      const err = validateWelcomePopupSettingValue(key, value);
      if (err) throw new ApiError(err, 400);
    }
    if (key.startsWith("home_header_")) {
      const err = validateHomeHeaderSettingValue(key, value);
      if (err) throw new ApiError(err, 400);
    }
  }

  await upsertSupabaseSettings(updates);

  if (updates.some((u) => u.key === "home_telegram_reward")) {
    const client = requireSupabaseAdmin();
    const settings = await getSupabaseSettings();
    const reward = parseInt(settings.home_telegram_reward, 10) || 50;
    const { error } = await client
      .from("promo_codes")
      .update({ reward_amount: reward })
      .eq("code", "TELEGRAM")
      .eq("is_system", true);
    if (error) throw dataError(error.message, "telegram reward sync");
  }

  const settings = await getSupabaseSettings();
  const homeSettings: Record<string, string> = {};
  for (const key of HOME_KEYS) homeSettings[key] = settings[key] ?? "";
  return NextResponse.json({ settings: homeSettings });
}

/* ------------------------------------------------------------------ */
/* Promotional banners (settings-driven — one system_settings row)     */
/* ------------------------------------------------------------------ */

/**
 * GET /api/admin/promo-banners — every banner (active + inactive) in display
 * order. The banner list lives in the single `promo_banners` system_settings
 * row — the same storage pattern as the welcome popup — so no RPC and no new
 * database object is involved on this backend either.
 */
export async function supabaseAdminPromoBannersGet(): Promise<NextResponse> {
  await requireAdmin();
  const settings = await getSupabaseSettings();
  return NextResponse.json({ banners: toAdminPromoBannerDTOs(parseStoredPromoBanners(settings[PROMO_BANNERS_KEY])) });
}

/** POST /api/admin/promo-banners — one banner action per call
 *  (create / update / delete / reorder), identical validation + shared
 *  apply logic to the local backend, then one settings-row upsert. */
export async function supabaseAdminPromoBannersPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<PromoBannerAction>(req);
  const action = body.action;

  if (action !== "create" && action !== "update" && action !== "delete" && action !== "reorder") {
    throw new ApiError("Unknown banner action — use create, update, delete or reorder.", 400);
  }
  if ((action === "update" || action === "delete") && !(body.id ?? "").trim()) {
    throw new ApiError("Missing banner id.", 400);
  }
  if (action === "reorder" && !Array.isArray(body.ids)) {
    throw new ApiError("reorder requires the ordered ids array.", 400);
  }
  if (action === "create" || action === "update") {
    const err = validatePromoBannerInput(body.banner ?? {}, action === "create");
    if (err) throw new ApiError(err, 400);
  }

  const settings = await getSupabaseSettings();
  const list = parseStoredPromoBanners(settings[PROMO_BANNERS_KEY]);
  const id = (body.id ?? "").trim();
  if ((action === "update" || action === "delete") && !list.some((b) => b.id === id)) {
    throw new ApiError("Banner not found.", 404);
  }

  const next = applyPromoBannerAction(list, body);
  await upsertSupabaseSettings([{ key: PROMO_BANNERS_KEY, value: serializePromoBanners(next) }]);
  return NextResponse.json({ banners: toAdminPromoBannerDTOs(next) });
}

interface AdminPromoPostBody {
  action?: string;
  id?: string;
  code?: string;
  title?: string;
  rewardAmount?: number | string;
  maxUses?: number | string | null;
  isActive?: boolean;
}

function promoInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** POST /api/admin/home/promo — promo code CRUD (system row protected). */
export async function supabaseAdminHomePromo(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const client = requireSupabaseAdmin();
  const body = await parseJsonBody<AdminPromoPostBody>(req);
  const action = (body.action ?? "").trim();

  if (action === "create") {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw new ApiError("Code must be 3-32 letters, numbers, dash or underscore.", 400);
    }
    if (code === "TELEGRAM") {
      throw new ApiError("TELEGRAM is reserved for the system reward.", 400);
    }
    const reward = promoInt(body.rewardAmount);
    if (reward === null || reward < 1) {
      throw new ApiError("Reward amount must be a positive integer (PKR).", 400);
    }
    let maxUses: number | null = null;
    if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== "") {
      const m = promoInt(body.maxUses);
      if (m === null || m < 1) throw new ApiError("Usage limit must be a positive integer.", 400);
      maxUses = m;
    }
    const { error } = await client.from("promo_codes").insert({
      code,
      title: String(body.title ?? "").trim(),
      reward_amount: reward,
      max_uses: maxUses,
      is_active: body.isActive === undefined ? true : Boolean(body.isActive),
      is_system: false,
    });
    if (error) {
      if (error.code === "23505") throw new ApiError("This code already exists.", 400);
      throw dataError(error.message, "promo create");
    }
  } else if (action === "update" || action === "toggle" || action === "delete") {
    const id = (body.id ?? "").trim();
    const { data: existing, error: fetchErr } = await client
      .from("promo_codes")
      .select("id,code,is_system,max_uses")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) throw dataError(fetchErr.message, "promo fetch");
    if (!existing) throw new ApiError("Promo code not found.", 400);
    const row = existing as { id: string; code: string; is_system: boolean };

    if (action === "toggle") {
      const { data: cur, error: e2 } = await client
        .from("promo_codes")
        .select("is_active")
        .eq("id", id)
        .maybeSingle();
      if (e2) throw dataError(e2.message, "promo fetch");
      const { error } = await client
        .from("promo_codes")
        .update({ is_active: !(cur as { is_active: boolean } | null)?.is_active })
        .eq("id", id);
      if (error) throw dataError(error.message, "promo toggle");
    } else if (action === "delete") {
      if (row.is_system) {
        throw new ApiError("The system Telegram reward cannot be deleted.", 400);
      }
      const { error } = await client.from("promo_codes").delete().eq("id", id);
      if (error) throw dataError(error.message, "promo delete");
    } else {
      const data: Record<string, string | number | boolean | null> = {};
      if (body.code !== undefined) {
        const code = String(body.code).trim().toUpperCase();
        if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
          throw new ApiError("Code must be 3-32 letters, numbers, dash or underscore.", 400);
        }
        if (row.is_system && code !== row.code) {
          throw new ApiError("The system reward code cannot be renamed.", 400);
        }
        data.code = code;
      }
      if (body.title !== undefined) data.title = String(body.title).trim();
      if (body.rewardAmount !== undefined) {
        const reward = promoInt(body.rewardAmount);
        if (reward === null || reward < 1) {
          throw new ApiError("Reward amount must be a positive integer (PKR).", 400);
        }
        data.reward_amount = reward;
      }
      if (body.maxUses === null || body.maxUses === "") {
        data.max_uses = null;
      } else if (body.maxUses !== undefined) {
        const m = promoInt(body.maxUses);
        if (m === null || m < 1) throw new ApiError("Usage limit must be a positive integer.", 400);
        data.max_uses = m;
      }
      if (body.isActive !== undefined) data.is_active = Boolean(body.isActive);
      const { error } = await client.from("promo_codes").update(data).eq("id", id);
      if (error) {
        if (error.code === "23505") throw new ApiError("This code already exists.", 400);
        throw dataError(error.message, "promo update");
      }
    }
  } else {
    throw new ApiError("Unknown action. Use create, update, toggle or delete.", 400);
  }

  return NextResponse.json({ ok: true });
}

/* ---------------------- payment methods manager (Task 17) -------------------- */

interface PaymentMethodPostBody {
  action?: string; // create | update | toggle | delete
  id?: string;
  name?: string;
  accountNumber?: string;
  accountTitle?: string;
  instructions?: string;
  logoUrl?: string;
  sortOrder?: number | string;
  isActive?: boolean;
}

/** All payment methods in display order (admin manager list). */
async function fetchAllPaymentMethods(): Promise<PaymentMethodDTO[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("payment_methods")
    .select(
      "id,name,account_number,account_title,instructions,logo_url,sort_order,is_active"
    )
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw dataError(error.message, "payment methods list");
  return ((data ?? []) as PaymentMethodRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    accountNumber: row.account_number,
    accountTitle: row.account_title ?? null,
    instructions: row.instructions ?? null,
    logoUrl: row.logo_url ?? null,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
}

async function fetchPaymentMethodRowById(id: string): Promise<PaymentMethodRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("payment_methods")
    .select(
      "id,name,account_number,account_title,instructions,logo_url,sort_order,is_active"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError(error.message, "payment method lookup");
  return (data as PaymentMethodRow | null) ?? null;
}

function validateMethodFields(input: {
  name?: string;
  accountNumber?: string;
  accountTitle?: string;
  instructions?: string;
  logoUrl?: string;
}): {
  name: string;
  accountNumber: string;
  accountTitle: string | null;
  instructions: string | null;
  logoUrl: string | null;
} {
  const name = (input.name ?? "").trim();
  if (name.length < 2 || name.length > 40) {
    throw new ApiError("Payment method name must be 2–40 characters.", 400);
  }
  const accountNumber = (input.accountNumber ?? "").trim();
  if (accountNumber.length < 4 || accountNumber.length > 100) {
    throw new ApiError("Account number must be 4–100 characters.", 400);
  }
  const accountTitle = (input.accountTitle ?? "").trim();
  if (accountTitle.length > 60) throw new ApiError("Account title must be at most 60 characters.", 400);
  const instructions = (input.instructions ?? "").trim();
  if (instructions.length > 400) throw new ApiError("Instructions must be at most 400 characters.", 400);
  const logoUrl = (input.logoUrl ?? "").trim();
  if (logoUrl && !isImageSourceUrl(logoUrl)) {
    throw new ApiError("Logo / QR image must be an http(s) URL or an uploaded image (JPG, PNG or WEBP).", 400);
  }
  return {
    name,
    accountNumber,
    accountTitle: accountTitle || null,
    instructions: instructions || null,
    logoUrl: logoUrl || null,
  };
}

function methodSortOrder(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function supabaseAdminPaymentMethodsGet(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({ methods: await fetchAllPaymentMethods() });
}

export async function supabaseAdminPaymentMethodsPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const client = requireSupabaseAdmin();
  const body = await parseJsonBody<PaymentMethodPostBody>(req);
  const action = (body.action ?? "").trim();

  if (action === "create") {
    const fields = validateMethodFields(body);
    const sortOrder = methodSortOrder(body.sortOrder);
    let order: number;
    if (sortOrder === null) {
      const { data: maxRow, error: maxErr } = await client
        .from("payment_methods")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr) throw dataError(maxErr.message, "payment methods max order");
      order = ((maxRow as { sort_order: number } | null)?.sort_order ?? 0) + 1;
    } else {
      order = sortOrder;
    }

    const { error } = await client.from("payment_methods").insert({
      name: fields.name,
      account_number: fields.accountNumber,
      account_title: fields.accountTitle,
      instructions: fields.instructions,
      logo_url: fields.logoUrl,
      sort_order: order,
      is_active: true,
    });
    if (error) {
      if (error.code === "23505") throw new ApiError("A payment method with that name already exists.", 400);
      throw dataError(error.message, "payment method create");
    }
  } else if (action === "update") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPaymentMethodRowById(id) : null;
    if (!existing) throw new ApiError("Payment method not found.", 400);

    const fields = validateMethodFields({
      name: body.name !== undefined ? body.name : existing.name,
      accountNumber:
        body.accountNumber !== undefined ? body.accountNumber : existing.account_number,
      accountTitle:
        body.accountTitle !== undefined ? body.accountTitle : (existing.account_title ?? ""),
      instructions:
        body.instructions !== undefined ? body.instructions : (existing.instructions ?? ""),
      logoUrl: body.logoUrl !== undefined ? body.logoUrl : (existing.logo_url ?? ""),
    });

    const data: Record<string, string | number | boolean | null> = {
      name: fields.name,
      account_number: fields.accountNumber,
      account_title: fields.accountTitle,
      instructions: fields.instructions,
      logo_url: fields.logoUrl,
    };
    const sortOrder = methodSortOrder(body.sortOrder);
    if (sortOrder !== null) data.sort_order = sortOrder;
    if (body.isActive !== undefined) data.is_active = Boolean(body.isActive);

    const { error } = await client.from("payment_methods").update(data).eq("id", id);
    if (error) {
      if (error.code === "23505") throw new ApiError("A payment method with that name already exists.", 400);
      throw dataError(error.message, "payment method update");
    }
  } else if (action === "toggle") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPaymentMethodRowById(id) : null;
    if (!existing) throw new ApiError("Payment method not found.", 400);
    const { count, error: countErr } = await client
      .from("payment_methods")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .neq("id", id);
    if (countErr) throw dataError(countErr.message, "active payment methods count");
    if (existing.is_active && (count ?? 0) === 0) {
      throw new ApiError("At least one payment method must stay enabled.", 400);
    }
    const { error } = await client
      .from("payment_methods")
      .update({ is_active: !existing.is_active })
      .eq("id", id);
    if (error) throw dataError(error.message, "payment method toggle");
  } else if (action === "delete") {
    const id = (body.id ?? "").trim();
    const existing = id ? await fetchPaymentMethodRowById(id) : null;
    if (!existing) throw new ApiError("Payment method not found.", 400);
    const { count, error: countErr } = await client
      .from("payment_methods")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .neq("id", id);
    if (countErr) throw dataError(countErr.message, "active payment methods count");
    if (existing.is_active && (count ?? 0) === 0) {
      throw new ApiError("Disable or add another method before deleting the last enabled one.", 400);
    }
    // Payment history keeps the stored method NAME (meta->>'paymentMethod').
    const { error } = await client.from("payment_methods").delete().eq("id", id);
    if (error) throw dataError(error.message, "payment method delete");
  } else {
    throw new ApiError("Unknown action. Use create, update, toggle or delete.", 400);
  }

  return NextResponse.json({ methods: await fetchAllPaymentMethods() });
}

/* ------------------------- withdrawal methods (Task 22) --------------------- */

interface WithdrawalMethodPostBody {
  action?: string; // update | toggle (the channel set itself is fixed)
  id?: string;
  logoUrl?: string;
  sortOrder?: number | string;
  isActive?: boolean;
}

/** All withdrawal channels in display order (mirrors the local route). */
async function fetchAllWithdrawalMethodRows() {
  const rows = await fetchWithdrawalMethods();
  return rows.map(mapWithdrawalMethodRow);
}

export async function supabaseAdminWithdrawalMethodsGet(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({ methods: await fetchAllWithdrawalMethodRows() });
}

export async function supabaseAdminWithdrawalMethodsPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<WithdrawalMethodPostBody>(req);
  const action = (body.action ?? "").trim();

  const id = (body.id ?? "").trim();
  const existing = id ? await fetchWithdrawalMethodById(id) : null;
  if (!existing) throw new ApiError("Withdrawal method not found.", 400);

  if (action === "update") {
    const logoUrl = (body.logoUrl ?? "").trim();
    if (logoUrl && !isImageSourceUrl(logoUrl)) {
      throw new ApiError(
        "Logo image must be an http(s) URL or an uploaded image (JPG, PNG or WEBP).",
        400,
      );
    }
    const nextActive = body.isActive !== undefined ? Boolean(body.isActive) : existing.is_active;
    if (existing.is_active && !nextActive) {
      const remaining = await countOtherActiveWithdrawalMethods(id);
      if (remaining === 0) {
        throw new ApiError("At least one withdrawal method must stay enabled.", 400);
      }
    }
    const sortOrder = toIntOrNull(body.sortOrder);
    // Partial update: only fields actually sent are written.
    await updateWithdrawalMethod(id, {
      ...(body.logoUrl !== undefined ? { logo_url: logoUrl || null } : {}),
      ...(sortOrder !== null ? { sort_order: sortOrder } : {}),
      ...(body.isActive !== undefined ? { is_active: nextActive } : {}),
    });
  } else if (action === "toggle") {
    if (existing.is_active) {
      const remaining = await countOtherActiveWithdrawalMethods(id);
      if (remaining === 0) {
        throw new ApiError("At least one withdrawal method must stay enabled.", 400);
      }
    }
    await updateWithdrawalMethod(id, { is_active: !existing.is_active });
  } else {
    throw new ApiError("Unknown action. Use update or toggle.", 400);
  }

  return NextResponse.json({ methods: await fetchAllWithdrawalMethodRows() });
}

/* ---------------------------------- support --------------------------------- */

/** GET /api/admin/support — every ticket, newest first, with the member's
 *  name/email resolved by the RPC (service-role-only surface). */
export async function supabaseAdminSupportGet(): Promise<NextResponse> {
  await requireAdmin();
  const tickets = await rpcCall<SupportTicketDTO[]>("api_admin_support_list", {});
  return NextResponse.json({ tickets });
}

interface SupportUpdateBody {
  id?: string;
  status?: string;
  reply?: string;
}

/** POST /api/admin/support — set a ticket's status and/or the admin reply
 *  (same validation as the local route; the RPC re-validates + updates). */
export async function supabaseAdminSupportPost(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const body = await parseJsonBody<SupportUpdateBody>(req);

  const id = (body.id ?? "").trim();
  const status = (body.status ?? "").trim();
  const reply = typeof body.reply === "string" ? body.reply.trim() : undefined;

  if (!id) throw new ApiError("Missing ticket id.", 400);
  if (!status && reply === undefined) {
    throw new ApiError("Provide a status or a reply to update.", 400);
  }
  if (status && !["open", "in_progress", "resolved", "closed"].includes(status)) {
    throw new ApiError("Unknown status.", 400);
  }
  if (reply !== undefined && (reply.length < 1 || reply.length > 2000)) {
    throw new ApiError("Reply must be 1–2000 characters.", 400);
  }

  const ticket = await rpcCall<SupportTicketDTO>("api_admin_support_update", {
    p_id: id,
    p_status: status || null,
    p_reply: reply !== undefined ? reply : null,
    p_has_reply: reply !== undefined,
  });
  return NextResponse.json({ ticket, tickets: await rpcCall<SupportTicketDTO[]>("api_admin_support_list", {}) });
}
