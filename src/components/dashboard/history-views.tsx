"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Banknote,
  Clock3,
  Loader2,
  ReceiptText,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TxIcon, TxAmount } from "@/components/dashboard/tx-helpers";
import {
  EmptyState,
  HistorySkeleton,
  PageHeader,
  SectionEnter,
  StatusBadge,
  TransactionCard,
} from "@/components/dashboard/profile-ui";
import { apiFetch } from "@/lib/client-api";
import { formatDate, formatPKR, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  PaymentHistoryResponseDTO,
  TransactionDTO,
  WalletResponseDTO,
  WithdrawalsResponseDTO,
} from "@/lib/types";

/* ================================================================== */
/* Dedicated history pages (spec §5–7) — Withdrawal / Deposit /        */
/* Balance. Each transaction is its own clean card. Same data sources  */
/* as before (withdrawals: new additive endpoint; deposits: payments;  */
/* balance: wallet transactions).                                     */
/* ================================================================== */

function metaStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function HistoryError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex items-center gap-3">
        <span>{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/* ------------------------------------------------------------------ */
/* Withdrawal History (spec §5)                                        */
/* ------------------------------------------------------------------ */

export function WithdrawalHistoryView() {
  const query = useQuery({
    queryKey: ["withdrawals"],
    queryFn: () => apiFetch<WithdrawalsResponseDTO>("/api/wallet/withdrawals"),
    refetchInterval: 15_000,
  });

  const withdrawals = query.data?.withdrawals ?? [];

  return (
    <div className="space-y-6">
      <SectionEnter>
        <PageHeader
          title="Withdrawal History"
          subtitle="Your payout requests"
          right={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh withdrawal history"
              className="size-10 rounded-xl"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} aria-hidden="true" />
            </Button>
          }
        />
      </SectionEnter>

      <SectionEnter delay={0.05}>
        {query.isPending ? (
          <HistorySkeleton />
        ) : query.isError ? (
          <HistoryError
            title="Couldn't load your withdrawals"
            message="Check your connection and try again."
            onRetry={() => void query.refetch()}
          />
        ) : withdrawals.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No withdrawals yet"
            description="Payout requests you submit will appear here with their review status."
          />
        ) : (
          <div className="space-y-3">
            {withdrawals.map((tx) => {
              const method = metaStr(tx.meta, "paymentMethod");
              const account = metaStr(tx.meta, "accountDetails");
              return (
                <TransactionCard
                  key={tx.id}
                  icon={
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"
                    >
                      <Banknote className="size-5" />
                    </span>
                  }
                  title={tx.description}
                  subtitle={`${formatDate(tx.createdAt)} · ${timeAgo(tx.createdAt)}`}
                  status={<StatusBadge status={tx.status} />}
                  amount={<TxAmount tx={tx} className="text-base" />}
                  rows={[
                    ...(method ? [{ label: "Method", value: method }] : []),
                    ...(account
                      ? [{ label: "Account", value: <span className="font-mono break-all">{account}</span> }]
                      : []),
                    {
                      label: "Requested",
                      value: (
                        <span title={formatDate(tx.createdAt)}>
                          {timeAgo(tx.createdAt)}
                        </span>
                      ),
                    },
                  ]}
                />
              );
            })}
          </div>
        )}
      </SectionEnter>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deposit History (spec §6) — the member's payment requests           */
/* ------------------------------------------------------------------ */

function paymentPlanLabel(tx: TransactionDTO): { label: string; via?: string } {
  if (tx.type === "plan_purchase") {
    return { label: metaStr(tx.meta, "planName") ?? "VIP Plan", via: "Plan payment" };
  }
  if (tx.type === "package_purchase") {
    const walletBalance = !metaStr(tx.meta, "txId");
    return {
      label: metaStr(tx.meta, "packageTitle") ?? "Investment Package",
      via: walletBalance ? "Wallet balance" : "Package payment",
    };
  }
  return { label: "Wallet top-up", via: "Deposit" };
}

/** Money paid into the platform — absolute amount, status-tinted. */
function PaymentAmount({ tx }: { tx: TransactionDTO }) {
  const paid = Math.abs(tx.amount);
  const tone =
    tx.status === "approved" || tx.status === "completed"
      ? "text-primary"
      : tx.status === "rejected"
        ? "text-destructive"
        : "text-foreground";
  return (
    <span className={cn("text-base font-bold whitespace-nowrap tabular-nums", tone)}>
      {formatPKR(paid)}
    </span>
  );
}

export function DepositHistoryView() {
  const query = useQuery({
    queryKey: ["payments"],
    queryFn: () => apiFetch<PaymentHistoryResponseDTO>("/api/payments"),
    refetchInterval: 15_000,
  });

  const payments = query.data?.payments ?? [];

  return (
    <div className="space-y-6">
      <SectionEnter>
        <PageHeader
          title="Deposit History"
          subtitle="Payments you submitted for review"
          right={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh deposit history"
              className="size-10 rounded-xl"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} aria-hidden="true" />
            </Button>
          }
        />
      </SectionEnter>

      <SectionEnter delay={0.05}>
        {query.isPending ? (
          <HistorySkeleton />
        ) : query.isError ? (
          <HistoryError
            title="Couldn't load your payment history"
            message="Check your connection and try again."
            onRetry={() => void query.refetch()}
          />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No payment requests yet"
            description="Payments you submit for packages, plans and top-ups will appear here with their review status."
          />
        ) : (
          <div className="space-y-3">
            {payments.map((tx) => {
              const { label, via } = paymentPlanLabel(tx);
              const method = metaStr(tx.meta, "paymentMethod");
              const txId = metaStr(tx.meta, "txId");
              const rejectNote = metaStr(tx.meta, "note");
              return (
                <TransactionCard
                  key={tx.id}
                  icon={
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
                    >
                      <ArrowDownToLine className="size-5" />
                    </span>
                  }
                  title={label}
                  subtitle={`${formatDate(tx.createdAt)} · ${timeAgo(tx.createdAt)}`}
                  status={<StatusBadge status={tx.status} />}
                  amount={<PaymentAmount tx={tx} />}
                  rows={[
                    ...(method ? [{ label: "Method", value: method }] : []),
                    ...(txId
                      ? [
                          {
                            label: "Transaction ID",
                            value: (
                              <span className="font-mono break-all" title={txId}>
                                {txId}
                              </span>
                            ),
                          },
                        ]
                      : via
                        ? [{ label: "Paid via", value: via }]
                        : []),
                  ]}
                  footer={
                    tx.status === "rejected" ? (
                      <p className="text-xs leading-relaxed text-destructive" title={rejectNote ?? undefined}>
                        {rejectNote
                          ? `Reason: ${rejectNote}`
                          : "Rejected — no balance was credited. You can resubmit with a new transaction ID."}
                      </p>
                    ) : tx.status === "pending" ? (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" aria-hidden="true" />
                        Under review — usually completed within a few hours.
                      </p>
                    ) : null
                  }
                />
              );
            })}
          </div>
        )}
      </SectionEnter>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Balance History (spec §7) — credits vs debits                       */
/* ------------------------------------------------------------------ */

function isDebitTx(tx: TransactionDTO): boolean {
  return (
    tx.type === "withdrawal" || tx.type === "plan_purchase" || tx.type === "package_purchase" || tx.amount < 0
  );
}

export function BalanceHistoryView() {
  const query = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponseDTO>("/api/wallet"),
    refetchInterval: 10_000,
  });

  const transactions = query.data?.transactions ?? [];

  return (
    <div className="space-y-6">
      <SectionEnter>
        <PageHeader
          title="Balance History"
          subtitle="Credits and deductions on your account"
          right={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Refresh balance history"
              className="size-10 rounded-xl"
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} aria-hidden="true" />
            </Button>
          }
        />
      </SectionEnter>

      <SectionEnter delay={0.05}>
        {query.isPending ? (
          <HistorySkeleton />
        ) : query.isError ? (
          <HistoryError
            title="Couldn't load your transactions"
            message="Something went wrong while fetching your history."
            onRetry={() => void query.refetch()}
          />
        ) : transactions.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No transactions yet"
            description="Task rewards, referrals, deposits and withdrawals will appear here."
          />
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => {
              const debit = isDebitTx(tx);
              return (
                <TransactionCard
                  key={tx.id}
                  icon={<TxIcon type={tx.type} />}
                  title={tx.description}
                  subtitle={`${formatDate(tx.createdAt)} · ${timeAgo(tx.createdAt)}`}
                  status={
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide",
                        debit
                          ? "border-destructive/20 bg-destructive/10 text-destructive"
                          : "border-primary/20 bg-primary/10 text-primary",
                      )}
                    >
                      {debit ? "DEBIT" : "CREDIT"}
                    </span>
                  }
                  amount={<TxAmount tx={tx} className="text-base" />}
                  rows={[
                    {
                      label: "Date & time",
                      value: (
                        <span title={timeAgo(tx.createdAt)}>{formatDate(tx.createdAt)}</span>
                      ),
                    },
                  ]}
                />
              );
            })}
          </div>
        )}
      </SectionEnter>

      {query.isFetching && transactions.length > 0 ? (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Updating…
        </p>
      ) : null}
    </div>
  );
}
