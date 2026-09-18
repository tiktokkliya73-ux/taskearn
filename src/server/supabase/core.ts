import { supabaseAdmin } from "@/lib/supabase";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { ApiError } from "@/lib/api-helpers";
import type {
  AppUser,
  PackageDTO,
  PaymentMethodDTO,
  PlanDTO,
  TaskDTO,
  UserPackageDTO,
  WalletData,
  WithdrawalMethodDTO,
} from "@/lib/types";

/**
 * Core helpers for the Supabase DATA backend (Task 8).
 *
 * The ONLY client used here is the server-side service-role client from
 * @/lib/supabase — the secret key never leaves the server. Wallet mutations
 * always go through the SECURITY DEFINER RPCs declared in
 * db/supabase-schema.sql; plain PostgREST CRUD is limited to non-financial
 * tables (plans/tasks/settings/users flags/password tokens).
 */

/** The service-role client, or a 500 when Supabase is not configured. */
export function requireSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw new ApiError("Supabase is not configured on this server.", 500);
  }
  return supabaseAdmin;
}

/**
 * RPC wrapper with the error contract from the worklog:
 * - PostgREST/transport error  → ApiError 500
 * - json `.error` string       → ApiError 400 (the SQL's business error)
 */
export async function rpcCall<T = unknown>(
  fn: string,
  params?: Record<string, unknown>
): Promise<T> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client.rpc(fn, params ?? {});
  if (error) {
    throw new ApiError(`Supabase RPC ${fn} failed: ${error.message}`, 500);
  }
  if (data && typeof (data as { error?: unknown }).error === "string") {
    throw new ApiError((data as { error: string }).error, 400);
  }
  return data as T;
}

/* -------------------------------- row types -------------------------------- */

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  referral_code: string;
  referred_by_id: string | null;
  is_banned: boolean;
  ip_address: string | null;
  fingerprint: string | null;
  supabase_auth_id: string | null;
  recovery_email: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapUserRow(row: UserRow): AppUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as AppUser["role"],
    referralCode: row.referral_code,
    referredById: row.referred_by_id,
    isBanned: row.is_banned,
    ipAddress: row.ip_address,
    fingerprint: row.fingerprint,
    supabaseAuthId: row.supabase_auth_id,
    recoveryEmail: row.recovery_email,
    passwordHash: row.password_hash,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

export interface WalletRow {
  user_id: string;
  task_balance: number;
  withdrawable_balance: number;
}

export function mapWalletRow(row: WalletRow): WalletData {
  return { taskBalance: row.task_balance, withdrawableBalance: row.withdrawable_balance };
}

export interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price: number;
  reward_per_task: number;
  daily_task_limit: number;
  duration_days: number;
  is_active: boolean;
  sort_order: number;
}

export function mapPlanRow(row: PlanRow): PlanDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    rewardPerTask: row.reward_per_task,
    dailyTaskLimit: row.daily_task_limit,
    durationDays: row.duration_days,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  url: string;
  duration_seconds: number;
  reward_amount: number | null;
  plan_id: string | null;
  is_active: boolean;
  sort_order: number;
}

export function mapTaskRow(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    durationSeconds: row.duration_seconds,
    rewardAmount: row.reward_amount ?? null,
    planId: row.plan_id ?? null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

/* ----------------------- investment packages (Task 12) ---------------------- */

export interface PackageRow {
  id: string;
  title: string;
  description: string | null;
  price: number;
  daily_earning: number;
  duration_days: number;
  total_return: number;
  net_profit: number;
  is_active: boolean;
  sort_order: number;
}

export function mapPackageRow(row: PackageRow): PackageDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    price: row.price,
    dailyEarning: row.daily_earning,
    durationDays: row.duration_days,
    totalReturn: row.total_return,
    netProfit: row.net_profit,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export interface UserPackageRow {
  id: string;
  user_id: string;
  package_id: string;
  invest_amount: number;
  daily_earning: number;
  status: string;
  last_earning_date: string | null;
  started_at: string;
  ends_at: string;
  package_title?: string | null;
}

export function mapUserPackageRow(row: UserPackageRow): UserPackageDTO {
  return {
    id: row.id,
    packageId: row.package_id,
    packageTitle: row.package_title ?? "Package",
    investAmount: row.invest_amount,
    dailyEarning: row.daily_earning,
    status: row.status === "completed" ? "completed" : "active",
    lastEarningDate: row.last_earning_date,
    startedAt: row.started_at,
    endsAt: row.ends_at,
  };
}

export interface TransactionRow {
  id: string;
  user_id: string;
  related_user_id: string | null;
  type: string;
  amount: number;
  status: string;
  description: string;
  meta: Record<string, unknown>;
  processed_at: string | null;
  created_at: string;
}

export interface UserTaskTodayRow {
  id: string;
  user_id: string;
  task_id: string;
  date: string;
  started_at: string | null;
  completed_at: string | null;
}

/** One package_task_logs row (today's daily-task attempt for an instance). */
export interface PackageTaskLogRow {
  id: string;
  user_id: string;
  user_package_id: string;
  date: string;
  started_at: string;
  completed_at: string | null;
  reward_amount: number | null;
}

/** A user_packages instance joined with its package title (task eligibility checks). */
export interface UserPackageInstanceRow {
  id: string;
  user_id: string;
  package_id: string;
  invest_amount: number;
  daily_earning: number;
  status: string;
  last_earning_date: string | null;
  started_at: string;
  ends_at: string;
  package_title: string | null;
}

/** One user_packages instance by id (with the package title joined). Null when missing. */
export async function fetchUserPackageInstance(id: string): Promise<UserPackageInstanceRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("user_packages")
    .select(
      "id,user_id,package_id,invest_amount,daily_earning,status,last_earning_date,started_at,ends_at,investment_packages(title)"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError("user package lookup", error.message);
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    user_id: string;
    package_id: string;
    invest_amount: number;
    daily_earning: number;
    status: string;
    last_earning_date: string | null;
    started_at: string;
    ends_at: string;
    investment_packages: { title: string } | null;
  };
  return {
    id: row.id,
    user_id: row.user_id,
    package_id: row.package_id,
    invest_amount: row.invest_amount,
    daily_earning: row.daily_earning,
    status: row.status,
    last_earning_date: row.last_earning_date,
    started_at: row.started_at,
    ends_at: row.ends_at,
    package_title: row.investment_packages?.title ?? null,
  };
}

/** Today's package_task_logs row for (user, instance). Null when never started. */
export async function fetchPackageTaskLogToday(
  userId: string,
  userPackageId: string,
  date: string
): Promise<PackageTaskLogRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("package_task_logs")
    .select("id,user_id,user_package_id,date,started_at,completed_at,reward_amount")
    .eq("user_id", userId)
    .eq("user_package_id", userPackageId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw dataError("package task log lookup", error.message);
  return (data as PackageTaskLogRow | null) ?? null;
}

/**
 * True when the member already completed ANY package-task claim today — the
 * member-level ONE-claim-per-day marker (ONE daily task, no matter how many
 * packages are active).
 */
export async function fetchAnyCompletedPackageTaskToday(
  userId: string,
  date: string
): Promise<boolean> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("package_task_logs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("date", date)
    .not("completed_at", "is", null)
    .limit(1);
  if (error) throw dataError("package task claim lookup", error.message);
  return (data ?? []).length > 0;
}

export interface ActiveUserPlanRow {
  id: string;
  plan_id: string;
  status: string;
  started_at: string;
  expires_at: string;
  plan_name: string;
  reward_per_task: number;
  daily_task_limit: number;
  duration_days: number;
}

/* -------------------------- payment methods (Task 17) ----------------------- */

export interface PaymentMethodRow {
  id: string;
  name: string;
  account_number: string;
  account_title: string | null;
  instructions: string | null;
  logo_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export function mapPaymentMethodRow(row: PaymentMethodRow): PaymentMethodDTO {
  return {
    id: row.id,
    name: row.name,
    accountNumber: row.account_number,
    accountTitle: row.account_title ?? null,
    instructions: row.instructions ?? null,
    logoUrl: row.logo_url ?? null,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

const PAYMENT_METHOD_COLUMNS =
  "id,name,account_number,account_title,instructions,logo_url,sort_order,is_active" as const;

/** All payment methods in display order. */
export async function fetchPaymentMethods(): Promise<PaymentMethodRow[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("payment_methods")
    .select(PAYMENT_METHOD_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw dataError("payment methods list", error.message);
  return (data ?? []) as PaymentMethodRow[];
}

/** Active payment methods in display order. */
export async function fetchActivePaymentMethods(): Promise<PaymentMethodRow[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("payment_methods")
    .select(PAYMENT_METHOD_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw dataError("active payment methods list", error.message);
  return (data ?? []) as PaymentMethodRow[];
}

function normalizeMethodName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a client-submitted payment method (row id, exact name, or legacy
 * easypaisa/jazzcash/usdt alias) to an ACTIVE payment_methods row.
 * Returns null when nothing matches — callers must reject.
 */
export async function resolveSupabasePaymentMethod(
  opts: { id?: string | null; name?: string | null }
): Promise<PaymentMethodRow | null> {
  const id = (opts.id ?? "").trim();
  if (id) {
    const client = requireSupabaseAdmin();
    const { data, error } = await client
      .from("payment_methods")
      .select(PAYMENT_METHOD_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw dataError("payment method lookup", error.message);
    const row = data as PaymentMethodRow | null;
    if (row && row.is_active) return row;
  }

  const name = (opts.name ?? "").trim();
  if (!name) return null;

  const methods = await fetchActivePaymentMethods();
  const exact = methods.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;

  const normalized = normalizeMethodName(name);
  return (
    methods.find((m) => normalizeMethodName(m.name) === normalized) ??
    methods.find((m) => {
      const n = normalizeMethodName(m.name);
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

/* ------------------------- withdrawal methods (Task 22) --------------------- */

export interface WithdrawalMethodRow {
  id: string;
  name: string;
  kind: string;
  logo_url: string | null;
  sort_order: number;
  is_active: boolean;
}

export function mapWithdrawalMethodRow(row: WithdrawalMethodRow): WithdrawalMethodDTO {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "bank" ? "bank" : "wallet",
    logoUrl: row.logo_url ?? null,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

const WITHDRAWAL_METHOD_COLUMNS = "id,name,kind,logo_url,sort_order,is_active" as const;

/** All withdrawal channels in display order (admin manager). */
export async function fetchWithdrawalMethods(): Promise<WithdrawalMethodRow[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("withdrawal_methods")
    .select(WITHDRAWAL_METHOD_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw dataError("withdrawal methods list", error.message);
  return (data ?? []) as WithdrawalMethodRow[];
}

/** Active withdrawal channels in display order (Withdraw page dropdown). */
export async function fetchActiveWithdrawalMethods(): Promise<WithdrawalMethodRow[]> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("withdrawal_methods")
    .select(WITHDRAWAL_METHOD_COLUMNS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw dataError("active withdrawal methods list", error.message);
  return (data ?? []) as WithdrawalMethodRow[];
}

/** Count active channels excluding the given id (last-enabled guard). */
export async function countOtherActiveWithdrawalMethods(id: string): Promise<number> {
  const client = requireSupabaseAdmin();
  const { count, error } = await client
    .from("withdrawal_methods")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .neq("id", id);
  if (error) throw dataError("active withdrawal methods count", error.message);
  return count ?? 0;
}

/** Update a withdrawal channel row (partial patch). */
export async function updateWithdrawalMethod(
  id: string,
  patch: { logo_url?: string | null; sort_order?: number; is_active?: boolean }
): Promise<void> {
  const client = requireSupabaseAdmin();
  const { error } = await client.from("withdrawal_methods").update(patch).eq("id", id);
  if (error) throw dataError("withdrawal method update", error.message);
}

/** Get one withdrawal channel row. Null when it does not exist. */
export async function fetchWithdrawalMethodById(id: string): Promise<WithdrawalMethodRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("withdrawal_methods")
    .select(WITHDRAWAL_METHOD_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError("withdrawal method lookup", error.message);
  return (data as WithdrawalMethodRow | null) ?? null;
}

/** A withdrawal channel row by exact (case-insensitive) name, or null. */
export async function fetchWithdrawalMethodByName(name: string): Promise<WithdrawalMethodRow | null> {
  const methods = await fetchActiveWithdrawalMethods();
  const lower = name.toLowerCase();
  return methods.find((m) => m.name.toLowerCase() === lower) ?? null;
}

/**
 * Resolve a client-submitted withdrawal method (row id first, then exact
 * case-insensitive name) to an ACTIVE withdrawal_methods row.
 * Returns null when nothing matches — callers must reject.
 */
export async function resolveSupabaseWithdrawalMethod(
  opts: { id?: string | null; name?: string | null }
): Promise<WithdrawalMethodRow | null> {
  const id = (opts.id ?? "").trim();
  if (id) {
    const row = await fetchWithdrawalMethodById(id);
    if (row && row.is_active) return row;
  }

  const name = (opts.name ?? "").trim();
  if (!name) return null;
  return fetchWithdrawalMethodByName(name);
}

/* ------------------------------- read helpers ------------------------------- */

function dataError(context: string, message: string): ApiError {
  return new ApiError(`Supabase data backend error: ${message} (${context})`, 500);
}

/** users row by id. Null when the row does not exist. */
export async function fetchUserById(id: string): Promise<AppUser | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("users")
    .select(
      "id,name,email,password_hash,role,referral_code,referred_by_id,is_banned,ip_address,fingerprint,supabase_auth_id,recovery_email,last_login_at,created_at,updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError("users lookup", error.message);
  return data ? mapUserRow(data as UserRow) : null;
}

/** users row by (lowercased) email. Null when the row does not exist. */
export async function fetchUserByEmail(email: string): Promise<AppUser | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("users")
    .select(
      "id,name,email,password_hash,role,referral_code,referred_by_id,is_banned,ip_address,fingerprint,supabase_auth_id,recovery_email,last_login_at,created_at,updated_at"
    )
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw dataError("users lookup by email", error.message);
  return data ? mapUserRow(data as UserRow) : null;
}

/** wallet row by user id — null when the wallet does not exist. */
export async function fetchWalletOrNull(userId: string): Promise<WalletData | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("wallets")
    .select("user_id,task_balance,withdrawable_balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dataError("wallet lookup", error.message);
  return data ? mapWalletRow(data as WalletRow) : null;
}

/** plan row by id (with `is_active`). Null when missing. */
export async function fetchPlanRow(planId: string): Promise<PlanRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("plans")
    .select("id,name,description,price,reward_per_task,daily_task_limit,duration_days,is_active,sort_order")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw dataError("plan lookup", error.message);
  return (data as PlanRow | null) ?? null;
}

/** task row by id (with `is_active`, reward override + target plan). Null when missing. */
export async function fetchTaskRow(taskId: string): Promise<TaskRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("tasks")
    .select("id,title,description,url,duration_seconds,reward_amount,plan_id,is_active,sort_order")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw dataError("task lookup", error.message);
  return (data as TaskRow | null) ?? null;
}

/** The single active (non-expired) user_plan of a user, joined with the plan. */
export async function fetchActiveUserPlan(userId: string): Promise<ActiveUserPlanRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("user_plans")
    .select(
      "id,plan_id,status,started_at,expires_at,plans(name,reward_per_task,daily_task_limit,duration_days)"
    )
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dataError("active plan lookup", error.message);
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    plan_id: string;
    status: string;
    started_at: string;
    expires_at: string;
    plans: {
      name: string;
      reward_per_task: number;
      daily_task_limit: number;
      duration_days: number;
    } | null;
  };
  if (!row.plans) return null;
  return {
    id: row.id,
    plan_id: row.plan_id,
    status: row.status,
    started_at: row.started_at,
    expires_at: row.expires_at,
    plan_name: row.plans.name,
    reward_per_task: row.plans.reward_per_task,
    daily_task_limit: row.plans.daily_task_limit,
    duration_days: row.plans.duration_days,
  };
}

/** Today's user_task row for (user, task). Null when the user never started it. */
export async function fetchUserTaskToday(
  userId: string,
  taskId: string,
  date: string
): Promise<UserTaskTodayRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("user_tasks")
    .select("id,user_id,task_id,date,started_at,completed_at")
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw dataError("user task lookup", error.message);
  return (data as UserTaskTodayRow | null) ?? null;
}

/** Count of tasks completed today by a user (UTC date). */
export async function countCompletedToday(userId: string, date: string): Promise<number> {
  const client = requireSupabaseAdmin();
  const { count, error } = await client
    .from("user_tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("date", date)
    .not("completed_at", "is", null);
  if (error) throw dataError("completed-today count", error.message);
  return count ?? 0;
}

/** True when the user completed this task within the last 24 hours (rolling window). */
export async function claimedTaskWithin24h(userId: string, taskId: string): Promise<boolean> {
  const client = requireSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from("user_tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("task_id", taskId)
    .not("completed_at", "is", null)
    .gt("completed_at", since);
  if (error) throw dataError("24h claim lookup", error.message);
  return (count ?? 0) > 0;
}

/** True when the user already has a pending withdrawal. */
export async function hasPendingWithdrawal(userId: string): Promise<boolean> {
  const client = requireSupabaseAdmin();
  const { count, error } = await client
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "withdrawal")
    .eq("status", "pending");
  if (error) throw dataError("pending withdrawal check", error.message);
  return (count ?? 0) > 0;
}

/** Raw transaction row by id (for admin approve/reject pre-checks). */
export async function fetchTransactionRow(id: string): Promise<TransactionRow | null> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("transactions")
    .select("id,user_id,related_user_id,type,amount,status,description,meta,processed_at,created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw dataError("transaction lookup", error.message);
  return (data as TransactionRow | null) ?? null;
}

/**
 * Read all settings with the SAME defaults semantics as src/lib/settings.ts:
 * start from SETTING_DEFAULTS, overlay every row of system_settings.
 */
export async function getSupabaseSettings(): Promise<Record<string, string>> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client.from("system_settings").select("key,value");
  if (error) throw dataError("settings read", error.message);
  const map: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const row of (data ?? []) as { key: string; value: string }[]) {
    map[row.key] = row.value;
  }
  return map;
}

/** Whitelisted settings upsert (mirrors POST /api/admin/settings semantics). */
export async function upsertSupabaseSettings(
  updates: { key: string; value: string }[]
): Promise<void> {
  const client = requireSupabaseAdmin();
  for (const { key, value } of updates) {
    const { error } = await client
      .from("system_settings")
      .upsert({ key, value }, { onConflict: "key" });
    if (error) throw dataError("settings upsert", error.message);
  }
}
