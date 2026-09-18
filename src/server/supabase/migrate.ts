import { db } from "@/lib/db";
import { requireSupabaseAdmin } from "@/server/supabase/core";

/**
 * Local → Supabase migration (Task 8, POST /api/admin/supabase action=migrate).
 *
 * Copies every local Prisma row to the Supabase project via PostgREST upserts
 * in FK-safe order. `id` is the default conflict target (rows already present
 * remotely — e.g. the seeded admin — are ignored), wallets key on user_id,
 * user_tasks on (user_id, task_id, date), and system_settings upserts with
 * merge semantics so LOCAL values win. Transactions.meta is JSON.parse'd from
 * the local string into a jsonb object; all dates become ISO strings.
 */

const CHUNK_SIZE = 500;

function chunk<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    out.push(rows.slice(i, i + CHUNK_SIZE));
  }
  return out;
}

/** Safely parse the local meta JSON string into an object (jsonb value). */
function parseMeta(meta: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(meta ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface MigrationCounts {
  users: number;
  wallets: number;
  plans: number;
  tasks: number;
  userPlans: number;
  userTasks: number;
  investmentPackages: number;
  userPackages: number;
  packageTaskLogs: number;
  transactions: number;
  settings: number;
  paymentMethods: number;
}

export async function migrateLocalToSupabase(): Promise<MigrationCounts> {
  const client = requireSupabaseAdmin();

  const [
    users,
    wallets,
    plans,
    tasks,
    userPlans,
    userTasks,
    investmentPackages,
    userPackages,
    packageTaskLogs,
    txns,
    settings,
    paymentMethods,
  ] = await Promise.all([
    // Inviters are always created before their invitees → createdAt asc keeps
    // the self-referencing users FK valid within a single insert statement.
    db.user.findMany({ orderBy: { createdAt: "asc" } }),
    db.wallet.findMany(),
    db.plan.findMany(),
    db.task.findMany(),
    db.userPlan.findMany(),
    db.userTask.findMany(),
    db.investmentPackage.findMany(),
    db.userPackage.findMany(),
    db.packageTaskLog.findMany(),
    db.transaction.findMany(),
    db.systemSetting.findMany(),
    db.paymentMethod.findMany(),
  ]);

  async function upsertChunks(
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
    ignoreDuplicates: boolean
  ): Promise<void> {
    for (const part of chunk(rows)) {
      const { error } = await client
        .from(table)
        .upsert(part, { onConflict, ignoreDuplicates });
      if (error) {
        throw new Error(`Supabase migration failed on "${table}": ${error.message}`);
      }
    }
  }

  // 1. users — include passwordHash + supabaseAuthId; dates → ISO strings.
  await upsertChunks(
    "users",
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      password_hash: u.passwordHash,
      role: u.role,
      referral_code: u.referralCode,
      referred_by_id: u.referredById,
      is_banned: u.isBanned,
      ip_address: u.ipAddress,
      fingerprint: u.fingerprint,
      supabase_auth_id: u.supabaseAuthId,
      last_login_at: iso(u.lastLoginAt),
      created_at: u.createdAt.toISOString(),
      updated_at: u.updatedAt.toISOString(),
    })),
    "id",
    true
  );

  // 2. wallets — conflict on user_id.
  await upsertChunks(
    "wallets",
    wallets.map((w) => ({
      id: w.id,
      user_id: w.userId,
      task_balance: w.taskBalance,
      withdrawable_balance: w.withdrawableBalance,
    })),
    "user_id",
    true
  );

  // 3. plans
  await upsertChunks(
    "plans",
    plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      reward_per_task: p.rewardPerTask,
      daily_task_limit: p.dailyTaskLimit,
      duration_days: p.durationDays,
      is_active: p.isActive,
      sort_order: p.sortOrder,
    })),
    "id",
    true
  );

  // 4. tasks
  await upsertChunks(
    "tasks",
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      url: t.url,
      duration_seconds: t.durationSeconds,
      reward_amount: t.rewardAmount,
      plan_id: t.planId,
      is_active: t.isActive,
      sort_order: t.sortOrder,
    })),
    "id",
    true
  );

  // 5. user_plans
  await upsertChunks(
    "user_plans",
    userPlans.map((up) => ({
      id: up.id,
      user_id: up.userId,
      plan_id: up.planId,
      status: up.status,
      started_at: up.startedAt.toISOString(),
      expires_at: up.expiresAt.toISOString(),
    })),
    "id",
    true
  );

  // 6. user_tasks — conflict on (user_id, task_id, date).
  await upsertChunks(
    "user_tasks",
    userTasks.map((ut) => ({
      id: ut.id,
      user_id: ut.userId,
      task_id: ut.taskId,
      date: ut.date,
      started_at: iso(ut.startedAt),
      completed_at: iso(ut.completedAt),
      reward_amount: ut.rewardAmount,
      created_at: ut.createdAt.toISOString(),
    })),
    "user_id,task_id,date",
    true
  );

  // 7. investment_packages + user_packages (Task 12) — before transactions so
  //    package_purchase/daily_earning ledger rows can reference nothing extra
  //    (transactions are self-contained, but instances must exist first anyway).
  await upsertChunks(
    "investment_packages",
    investmentPackages.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      price: p.price,
      daily_earning: p.dailyEarning,
      duration_days: p.durationDays,
      total_return: p.totalReturn,
      net_profit: p.netProfit,
      is_active: p.isActive,
      sort_order: p.sortOrder,
    })),
    "id",
    true
  );

  await upsertChunks(
    "user_packages",
    userPackages.map((up) => ({
      id: up.id,
      user_id: up.userId,
      package_id: up.packageId,
      invest_amount: up.investAmount,
      daily_earning: up.dailyEarning,
      status: up.status,
      last_earning_date: up.lastEarningDate,
      started_at: up.startedAt.toISOString(),
      ends_at: up.endsAt.toISOString(),
      created_at: up.createdAt.toISOString(),
    })),
    "id",
    true
  );

  // 7b. package_task_logs (Ads → Daily Tasks flow) — after user_packages so
  //      the FK holds; conflict on (user_id, user_package_id, date) so a
  //      claimed-today state carries over the backend flip.
  await upsertChunks(
    "package_task_logs",
    packageTaskLogs.map((l) => ({
      id: l.id,
      user_id: l.userId,
      user_package_id: l.userPackageId,
      date: l.date,
      started_at: l.startedAt.toISOString(),
      completed_at: iso(l.completedAt),
      reward_amount: l.rewardAmount,
      created_at: l.createdAt.toISOString(),
    })),
    "user_id,user_package_id,date",
    true
  );

  // 8. transactions — meta JSON string → jsonb object.
  await upsertChunks(
    "transactions",
    txns.map((t) => ({
      id: t.id,
      user_id: t.userId,
      related_user_id: t.relatedUserId,
      type: t.type,
      amount: t.amount,
      status: t.status,
      description: t.description,
      meta: parseMeta(t.meta),
      processed_at: iso(t.processedAt),
      created_at: t.createdAt.toISOString(),
    })),
    "id",
    true
  );

  // 9. system_settings — upsert ALL keys WITHOUT ignoreDuplicates:
  //    local values win (merge on conflict).
  if (settings.length > 0) {
    await upsertChunks(
      "system_settings",
      settings.map((s) => ({ key: s.key, value: s.value })),
      "key",
      false
    );
  }

  // 10. payment_methods (Task 17) — local rows win; when the local table was
  //     still empty, the Supabase seed RPC fills it from the settings above.
  if (paymentMethods.length > 0) {
    await upsertChunks(
      "payment_methods",
      paymentMethods.map((m) => ({
        id: m.id,
        name: m.name,
        account_number: m.accountNumber,
        account_title: m.accountTitle,
        instructions: m.instructions,
        logo_url: m.logoUrl,
        sort_order: m.sortOrder,
        is_active: m.isActive,
      })),
      "name",
      true
    );
  } else {
    await client.rpc("ensure_payment_methods_seeded");
  }

  return {
    users: users.length,
    wallets: wallets.length,
    plans: plans.length,
    tasks: tasks.length,
    userPlans: userPlans.length,
    userTasks: userTasks.length,
    investmentPackages: investmentPackages.length,
    userPackages: userPackages.length,
    packageTaskLogs: packageTaskLogs.length,
    transactions: txns.length,
    settings: settings.length,
    paymentMethods: paymentMethods.length,
  };
}
