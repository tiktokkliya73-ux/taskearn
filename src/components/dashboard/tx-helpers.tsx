"use client";

import type { ReactNode } from "react";
import {
  ArrowDownToLine,
  Banknote,
  CheckCircle2,
  Crown,
  Gift,
  Package,
  Settings2,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPKR } from "@/lib/money";
import type { TransactionDTO, TransactionStatus, TransactionType } from "@/lib/types";

const TX_ICONS: Record<TransactionType, ReactNode> = {
  task_reward: <CheckCircle2 className="size-5" aria-hidden="true" />,
  referral_unlock: <Users className="size-5" aria-hidden="true" />,
  referral_commission: <Users className="size-5" aria-hidden="true" />,
  deposit: <ArrowDownToLine className="size-5" aria-hidden="true" />,
  withdrawal: <Banknote className="size-5" aria-hidden="true" />,
  adjustment: <Settings2 className="size-5" aria-hidden="true" />,
  plan_purchase: <Crown className="size-5" aria-hidden="true" />,
  package_purchase: <Package className="size-5" aria-hidden="true" />,
  daily_earning: <TrendingUp className="size-5" aria-hidden="true" />,
  promo_reward: <Gift className="size-5" aria-hidden="true" />,
};

const TX_LABELS: Record<TransactionType, string> = {
  task_reward: "Task reward",
  referral_unlock: "Referral unlock",
  referral_commission: "Referral commission",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  adjustment: "Adjustment",
  plan_purchase: "Plan purchase",
  package_purchase: "Package purchase",
  daily_earning: "Daily earnings",
  promo_reward: "Promo reward",
};

/** Tinted icon square for a transaction type. */
export function TxIcon({ type, className }: { type: TransactionType; className?: string }) {
  const debit =
    type === "withdrawal" || type === "plan_purchase" || type === "package_purchase";
  return (
    <span
      aria-hidden="true"
      className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
        debit ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
      } ${className ?? ""}`}
    >
      {TX_ICONS[type] ?? <Wallet className="size-5" />}
    </span>
  );
}

/** Human label for a transaction type. */
export function txTypeLabel(type: TransactionType): string {
  return TX_LABELS[type] ?? "Transaction";
}

/** Signed, colored PKR amount — credits emerald, debits destructive. */
export function TxAmount({ tx, className }: { tx: TransactionDTO; className?: string }) {
  const isDebit = tx.type === "withdrawal" || tx.type === "plan_purchase" || tx.type === "package_purchase";
  const isAdjustment = tx.type === "adjustment";
  const negative = isDebit || tx.amount < 0;
  const display = isDebit ? Math.abs(tx.amount) * -1 : tx.amount;
  const tone = negative ? "text-destructive" : isAdjustment && tx.amount === 0 ? "text-muted-foreground" : "text-primary";
  return (
    <span className={`font-semibold tabular-nums ${tone} ${className ?? ""}`}>
      {formatPKR(display, { sign: !negative })}
    </span>
  );
}

const STATUS_VARIANTS: Record<TransactionStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  completed: "default",
  approved: "default",
  rejected: "destructive",
  blocked: "destructive",
};

const STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  approved: "Approved",
  rejected: "Rejected",
  blocked: "Blocked",
};

/** Status badge — emerald for approved/completed, red for rejected/blocked. */
export function TxStatusBadge({ status }: { status: TransactionStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "outline"} className="capitalize">
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
