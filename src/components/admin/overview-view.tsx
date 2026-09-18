"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coins,
  CreditCard,
  Crown,
  Headset,
  ListChecks,
  Megaphone,
  Package,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldAlert,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/client-api";
import { formatPKR, timeAgo } from "@/lib/money";
import { useHashRoute } from "@/lib/hash-router";
import { cn } from "@/lib/utils";
import type { AdminStatsDTO } from "@/lib/types";

import {
  EmptyState,
  SectionError,
  StatsRowSkeleton,
  TableSkeleton,
  TableWrap,
  TxStatusBadge,
  TxTypeBadge,
  flowClass,
} from "@/components/admin/shared";

/* ------------------------------ motion helper ------------------------------ */

function FadeIn({ delay = 0, children, className }: { delay?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* --------------------------- needs your attention --------------------------- */

interface AttentionItem {
  key: string;
  icon: LucideIcon;
  label: string;
  count: number;
  /** Financial items — the amount awaiting the admin's decision. */
  amount?: number;
  /** Non-financial override for the sub-line (e.g. support requests). */
  detail?: string;
  cta: string;
  to: string;
}

/**
 * The single most important admin question — "what needs me right now?" —
 * answered with REAL pending counts straight from the existing ledger, each
 * with a one-click jump to the matching management page.
 */
function AttentionCard({ stats }: { stats: AdminStatsDTO }) {
  const { navigate } = useHashRoute();

  const items: AttentionItem[] = [];
  if (stats.pendingPayoutsCount > 0) {
    items.push({
      key: "withdrawals",
      icon: Banknote,
      label: "Pending withdrawals",
      count: stats.pendingPayoutsCount,
      amount: stats.pendingPayoutsAmount,
      cta: "View Withdrawals",
      to: "/admin/withdrawals",
    });
  }
  if (stats.pendingDepositsCount > 0) {
    items.push({
      key: "deposits",
      icon: Wallet,
      label: "Pending deposits",
      count: stats.pendingDepositsCount,
      amount: stats.pendingDepositsAmount,
      cta: "View Deposits",
      to: "/admin/deposits",
    });
  }
  if (stats.openSupportCount > 0) {
    items.push({
      key: "support",
      icon: Headset,
      label: "Open support requests",
      count: stats.openSupportCount,
      detail: "member messages waiting for your reply",
      cta: "View Support",
      to: "/admin/support",
    });
  }

  const calm = items.length === 0;

  return (
    <Card
      className={cn(
        "py-0",
        !calm && "border-amber-500/40 dark:border-amber-500/30",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                calm ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              {calm ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Clock className="h-4 w-4" aria-hidden="true" />}
            </span>
            <div>
              <CardTitle className="text-base">Needs your attention</CardTitle>
              <CardDescription>
                {calm ? "Nothing is waiting on you" : `${items.length} pending item${items.length === 1 ? "" : "s"} to review`}
              </CardDescription>
            </div>
          </div>
          {!calm ? (
            <Badge variant="secondary" className="gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Action required
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        {calm ? (
          <p className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
            All caught up — no pending withdrawals or deposits right now. New member requests will
            surface here the moment they arrive.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.key}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.count} request{item.count === 1 ? "" : "s"}
                        {item.detail ? (
                          <> · {item.detail}</>
                        ) : item.amount !== undefined ? (
                          <>
                            {" · "}
                            <span className="font-medium tabular-nums text-foreground">
                              {formatPKR(item.amount)}
                            </span>{" "}
                            awaiting your decision
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="w-full shrink-0 sm:w-auto"
                    onClick={() => navigate(item.to)}
                  >
                    {item.cta}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ quick actions ------------------------------ */

const QUICK_ACTIONS: { icon: LucideIcon; label: string; to: string }[] = [
  { icon: Package, label: "Add Package", to: "/admin/packages?create=1" },
  { icon: ListChecks, label: "Create Task", to: "/admin/tasks?create=1" },
  { icon: Crown, label: "Add VIP Plan", to: "/admin/plans?create=1" },
  { icon: Megaphone, label: "Send Notification", to: "/admin/notifications?create=1" },
  { icon: Users, label: "Manage Users", to: "/admin/users" },
  { icon: CreditCard, label: "Payment Methods", to: "/admin/payment-methods" },
  { icon: Settings, label: "Site Settings", to: "/admin/settings" },
];

/** One-click jumps to existing admin functionality — no duplicated pages. */
function QuickActions() {
  const { navigate } = useHashRoute();
  return (
    <Card className="py-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quick actions</CardTitle>
        <CardDescription>Jump straight to the things you manage most</CardDescription>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.to)}
                className={cn(
                  "flex min-h-[64px] flex-col items-start justify-between gap-2 rounded-lg border bg-card p-3 text-left transition-colors",
                  "hover:border-primary/40 hover:bg-primary/5",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="flex w-full items-center justify-between gap-1 text-[13px] font-medium leading-tight">
                  <span>{action.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- stat cards -------------------------------- */

interface StatCardProps {
  title: string;
  value: string;
  caption?: ReactNode;
  icon: LucideIcon;
  iconClass: string;
}

function StatCard({ title, value, caption, icon: Icon, iconClass }: StatCardProps) {
  return (
    <Card className="py-0 transition-shadow hover:shadow-md">
      <CardContent className="flex items-start gap-4 p-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", iconClass)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CompactStat({ label, value, icon: Icon, iconClass }: { label: string; value: ReactNode; icon: LucideIcon; iconClass: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5">
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", iconClass)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
      </div>
    </div>
  );
}

/* ---------------------------------- chart ---------------------------------- */

const chartConfig = {
  deposits: { label: "Deposits", color: "#10b981" },
  withdrawals: { label: "Withdrawals", color: "#a1a1aa" },
  rewards: { label: "Task rewards", color: "#f59e0b" },
} satisfies ChartConfig;

const CHART_LEGEND: { key: keyof typeof chartConfig; label: string; dotClass: string }[] = [
  { key: "deposits", label: "Deposits", dotClass: "bg-emerald-500" },
  { key: "withdrawals", label: "Withdrawals", dotClass: "bg-zinc-400" },
  { key: "rewards", label: "Task rewards", dotClass: "bg-amber-500" },
];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
  const day = d.toLocaleDateString("en-GB", { day: "numeric" });
  return `${weekday} ${day}`;
}

function ActivityChart({ series }: { series: AdminStatsDTO["series"] }) {
  const data = useMemo(
    () =>
      series.map((point) => ({
        label: dayLabel(point.date),
        deposits: point.deposits,
        withdrawals: point.withdrawals,
        rewards: point.rewards,
      })),
    [series],
  );

  if (data.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No activity recorded yet"
        description="Deposit, withdrawal and task reward totals for the last 7 days will appear here."
      />
    );
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[240px] w-full sm:h-[280px]">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap="28%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} minTickGap={4} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => {
                const key = String(name);
                const label =
                  key === "deposits"
                    ? "Deposits"
                    : key === "withdrawals"
                      ? "Withdrawals"
                      : key === "rewards"
                        ? "Task rewards"
                        : key;
                return (
                  <div className="flex min-w-[10rem] items-center justify-between gap-6 leading-none">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatPKR(Number(value))}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Bar dataKey="deposits" fill="var(--color-deposits)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="withdrawals" fill="var(--color-withdrawals)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="rewards" fill="var(--color-rewards)" radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

/* ------------------------------ recent activity ----------------------------- */

function RecentTransactions({ transactions }: { transactions: AdminStatsDTO["recentTransactions"] }) {
  const { navigate } = useHashRoute();
  return (
    <Card className="py-0 overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Recent transactions</CardTitle>
            <CardDescription>Latest ledger entries across the platform</CardDescription>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("/admin/transactions")}>
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">View all transactions</span>
            <span className="sm:hidden">View all</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {transactions.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="Deposits, rewards and payouts will show up here as members use the platform."
          />
        ) : (
          <TableWrap>
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap pl-6 text-xs text-muted-foreground">
                      {timeAgo(tx.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm font-medium">{tx.userName ?? "Unknown user"}</p>
                      <p className="truncate text-xs text-muted-foreground">{tx.userEmail ?? ""}</p>
                    </TableCell>
                    <TableCell>
                      <TxTypeBadge type={tx.type} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap text-right font-medium tabular-nums",
                        flowClass(tx.type, tx.amount),
                      )}
                    >
                      {formatPKR(tx.amount)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <TxStatusBadge status={tx.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- view ----------------------------------- */

interface SettingsPayload {
  settings: Record<string, string>;
}

export function AdminOverviewView() {
  const statsQuery = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiFetch<AdminStatsDTO>("/api/admin/stats"),
    refetchInterval: 10_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiFetch<SettingsPayload>("/api/admin/settings"),
    staleTime: 60_000,
  });

  if (statsQuery.isPending) {
    return (
      <div className="space-y-6">
        <div className="h-[188px] rounded-xl border bg-card" />
        <StatsRowSkeleton />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[68px] rounded-xl border bg-card" />
          ))}
        </div>
        <div className="h-[380px] rounded-xl border bg-card" />
        <div className="rounded-xl border bg-card">
          <TableSkeleton rows={6} columns={5} />
        </div>
      </div>
    );
  }

  if (statsQuery.isError) {
    return (
      <SectionError
        title="Could not load admin stats"
        message={statsQuery.error.message}
        onRetry={() => void statsQuery.refetch()}
      />
    );
  }

  const stats = statsQuery.data;
  const autoApprove = settingsQuery.data?.settings?.auto_approve_deposits === "true";

  return (
    <div className="space-y-6">
      {/* pending admin work — the control-center entry point */}
      <FadeIn delay={0}>
        <AttentionCard stats={stats} />
      </FadeIn>

      {/* one-click jumps to existing management pages */}
      <FadeIn delay={0.05}>
        <QuickActions />
      </FadeIn>

      {/* primary stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FadeIn delay={0.05}>
          <StatCard
            title="Total Users"
            value={String(stats.totalUsers)}
            caption={`${stats.activeUsers} active · ${stats.bannedUsers} banned`}
            icon={Users}
            iconClass="bg-primary/10 text-primary"
          />
        </FadeIn>
        <FadeIn delay={0.1}>
          <StatCard
            title="Total Deposited"
            value={formatPKR(stats.totalDeposited)}
            icon={ArrowDownToLine}
            iconClass="bg-primary/10 text-primary"
            caption="Funds in across all approved deposits"
          />
        </FadeIn>
        <FadeIn delay={0.15}>
          <StatCard
            title="Total Withdrawn"
            value={formatPKR(stats.totalWithdrawn)}
            icon={Banknote}
            iconClass="bg-destructive/10 text-destructive"
            caption="Payouts sent to members"
          />
        </FadeIn>
        <FadeIn delay={0.2}>
          <StatCard
            title="Task Rewards Paid"
            value={formatPKR(stats.taskRewardsPaid)}
            icon={Coins}
            iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            caption="Earned by members for completed tasks"
          />
        </FadeIn>
      </div>

      {/* secondary stats strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FadeIn delay={0.1}>
          <CompactStat
            label="Active Packages"
            value={`${stats.activePackages} live`}
            icon={Package}
            iconClass="bg-primary/10 text-primary"
          />
        </FadeIn>
        <FadeIn delay={0.15}>
          <CompactStat
            label="Active Tasks"
            value={`${stats.activeTasks} live`}
            icon={ListChecks}
            iconClass="bg-primary/10 text-primary"
          />
        </FadeIn>
        <FadeIn delay={0.2}>
          <CompactStat
            label="Deposit Policy"
            value={
              <span className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={
                    autoApprove
                      ? "bg-primary/10 text-primary"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  {autoApprove ? "Auto-approve ON" : "Manual review"}
                </Badge>
              </span>
            }
            icon={Zap}
            iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          />
        </FadeIn>
        <FadeIn delay={0.25}>
          <CompactStat label="Banned Users" value={stats.bannedUsers} icon={ShieldAlert} iconClass="bg-destructive/10 text-destructive" />
        </FadeIn>
      </div>

      {/* activity chart */}
      <FadeIn delay={0.1}>
        <Card className="py-0">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Platform activity</CardTitle>
                <CardDescription>Deposits, withdrawals and task rewards — last 7 days</CardDescription>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Live · refreshes every 10s
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-1">
              {CHART_LEGEND.map((item) => (
                <span key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("h-2.5 w-2.5 rounded-[3px]", item.dotClass)} aria-hidden="true" />
                  {item.label}
                </span>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pb-6 pt-2">
            <ActivityChart series={stats.series} />
          </CardContent>
        </Card>
      </FadeIn>

      {/* recent transactions */}
      <FadeIn delay={0.15}>
        <RecentTransactions transactions={stats.recentTransactions} />
      </FadeIn>

      {/* subtle refresh affordance */}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void statsQuery.refetch()}
          disabled={statsQuery.isFetching}
          className="text-muted-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", statsQuery.isFetching && "animate-spin")} aria-hidden="true" />
          {statsQuery.isFetching ? "Refreshing…" : "Refresh stats"}
        </Button>
      </div>
    </div>
  );
}
