"use client";

/**
 * Shared building blocks for the admin control center views.
 * Kept local to src/components/admin to avoid touching shared libs.
 */

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Clock,
  Coins,
  Crown,
  Gift,
  Package,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { TransactionStatus, TransactionType } from "@/lib/types";

/* ---------------------------------- utils --------------------------------- */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

/** Safely read a string from the JSON `meta` object of a transaction. */
export function metaStr(
  meta: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* ------------------------------- tx badges -------------------------------- */

interface TxTypeMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

const TX_TYPE_META: Record<TransactionType, TxTypeMeta> = {
  task_reward: {
    label: "Task reward",
    icon: Coins,
    className: "bg-primary/10 text-primary border-transparent",
  },
  referral_unlock: {
    label: "Referral unlock",
    icon: Sparkles,
    className: "bg-primary/10 text-primary border-transparent",
  },
  referral_commission: {
    label: "Referral commission",
    icon: Sparkles,
    className: "bg-primary/10 text-primary border-transparent",
  },
  deposit: {
    label: "Deposit",
    icon: ArrowDownToLine,
    className: "bg-primary/10 text-primary border-transparent",
  },
  withdrawal: {
    label: "Withdrawal",
    icon: ArrowUpFromLine,
    className: "bg-secondary text-secondary-foreground border-transparent",
  },
  adjustment: {
    label: "Adjustment",
    icon: SlidersHorizontal,
    className: "bg-secondary text-amber-700 dark:text-amber-400 border-transparent",
  },
  plan_purchase: {
    label: "Plan purchase",
    icon: Crown,
    className: "bg-secondary text-secondary-foreground border-transparent",
  },
  package_purchase: {
    label: "Package purchase",
    icon: Package,
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-transparent",
  },
  daily_earning: {
    label: "Daily earnings",
    icon: TrendingUp,
    className: "bg-primary/10 text-primary border-transparent",
  },
  promo_reward: {
    label: "Promo reward",
    icon: Gift,
    className: "bg-primary/10 text-primary border-transparent",
  },
};

export function TxTypeBadge({ type, className }: { type: TransactionType; className?: string }) {
  const meta = TX_TYPE_META[type] ?? {
    label: type,
    icon: Coins,
    className: "bg-secondary text-secondary-foreground border-transparent",
  };
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("gap-1", meta.className, className)}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

interface TxStatusMeta {
  label: string;
  icon: LucideIcon;
  className: string;
}

const TX_STATUS_META: Record<TransactionStatus, TxStatusMeta> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-secondary text-amber-600 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    icon: Check,
    className: "bg-primary/10 text-primary",
  },
  approved: {
    label: "Approved",
    icon: Check,
    className: "bg-primary/10 text-primary",
  },
  rejected: {
    label: "Rejected",
    icon: X,
    className: "bg-destructive/10 text-destructive border-transparent",
  },
  blocked: {
    label: "Blocked",
    icon: ShieldAlert,
    className: "bg-destructive/10 text-destructive border-transparent",
  },
};

export function TxStatusBadge({ status, className }: { status: TransactionStatus; className?: string }) {
  const meta = TX_STATUS_META[status] ?? {
    label: status,
    icon: Clock,
    className: "bg-secondary text-secondary-foreground",
  };
  const Icon = meta.icon;
  return (
    <Badge variant="secondary" className={cn("gap-1", meta.className, className)}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

/**
 * Money flow coloring: money in = emerald/primary, money out = destructive,
 * neutral/manual = amber.
 */
export function flowClass(type: TransactionType, amount: number): string {
  if (type === "withdrawal" || type === "plan_purchase") return "text-destructive";
  if (type === "adjustment") {
    return amount < 0 ? "text-destructive" : "text-primary";
  }
  return "text-primary";
}

/* ------------------------------ active badge ------------------------------- */

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">Active</Badge>
  ) : (
    <Badge variant="secondary" className="gap-1 text-muted-foreground">
      Inactive
    </Badge>
  );
}

/* ------------------------------ empty / error ------------------------------ */

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function SectionError({
  message,
  onRetry,
  title = "Could not load data",
  className,
}: {
  message: string;
  onRetry: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <Alert variant="destructive" className={cn("items-start", className)}>
      <AlertTriangle aria-hidden="true" />
      <div className="flex-1">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="mt-1 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{message}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <RotateCcw aria-hidden="true" />
            Retry
          </Button>
        </AlertDescription>
      </div>
    </Alert>
  );
}

/* -------------------------------- skeletons -------------------------------- */

export function StatsRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-6 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex gap-4 pb-2">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-5 flex-1", c === 0 && "max-w-[160px]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3 rounded-xl border bg-card p-6", className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-64" />
      <Skeleton className="h-3 w-52" />
    </div>
  );
}

/* ------------------------------ misc helpers ------------------------------- */

/** Wrapper giving tables a consistent, slim custom scrollbar. */
export const scrollable = cn(
  "overflow-x-auto",
  "[scrollbar-width:thin]",
  "[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
);

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(scrollable, className)}>{children}</div>;
}
