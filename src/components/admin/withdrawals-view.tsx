"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Bitcoin,
  Check,
  Clock,
  Copy,
  Eye,
  Info,
  Landmark,
  Loader2,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/dashboard/copy-button";
import { WithdrawalMethodLogo } from "@/components/dashboard/withdrawal-method-select";
import {
  EmptyState,
  SectionError,
  TableSkeleton,
  TableWrap,
  TxStatusBadge,
  metaStr,
} from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { formatDate, formatPKR, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TransactionDTO, WithdrawalMethodDTO } from "@/lib/types";

interface TransactionsPayload {
  withdrawals: TransactionDTO[];
  deposits: TransactionDTO[];
}

/* --------------------------------- helpers --------------------------------- */

function prettyMethod(method: string): string {
  if (method === "easypaisa") return "EasyPaisa";
  if (method === "jazzcash") return "JazzCash";
  if (method === "usdt") return "USDT";
  return method;
}

function UserCell({ tx }: { tx: TransactionDTO }) {
  return (
    <div className="max-w-[200px]">
      <p className="truncate text-sm font-medium">{tx.userName ?? "Unknown user"}</p>
      <p className="truncate text-xs text-muted-foreground">{tx.userEmail ?? ""}</p>
    </div>
  );
}

function MethodCell({ tx }: { tx: TransactionDTO }) {
  const method = metaStr(tx.meta, "paymentMethod");
  const details = metaStr(tx.meta, "accountDetails");
  if (!method && !details) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="max-w-[180px]">
      <span className="flex items-center gap-1.5 text-sm">
        {method === "usdt" ? (
          <Bitcoin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Smartphone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        {method ? prettyMethod(method) : "—"}
      </span>
      {details ? <p className="truncate text-xs text-muted-foreground">{details}</p> : null}
    </div>
  );
}

function StatusCell({ tx }: { tx: TransactionDTO }) {
  return (
    <div className="space-y-1">
      <TxStatusBadge status={tx.status} />
      {tx.status !== "pending" && tx.processedAt ? (
        <p className="whitespace-nowrap text-[11px] text-muted-foreground">
          processed {timeAgo(tx.processedAt)}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------- withdrawal details view ------------------------- */

/** One label + value line inside the withdrawal details dialog. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-sm">{children}</div>
    </div>
  );
}

/**
 * THE withdrawal review surface: everything the admin needs to pay out —
 * WHO requested, HOW MUCH, WHICH channel, WHERE the money must be sent
 * (the destination snapshot captured with the request — it never silently
 * changes if the member's later requests use a different account), WHEN it
 * was requested and its CURRENT status — with Approve/Reject actions that
 * are only reachable after the destination is on screen. Approving is
 * blocked when the required payment details are missing (the server rejects
 * such approvals too). Works without horizontal scrolling on mobile.
 */
function WithdrawalDetailsDialog({
  tx,
  channel,
  submitting,
  onClose,
  onApprove,
  onReject,
}: {
  tx: TransactionDTO | null;
  /** Admin-managed payout channel resolved from meta.paymentMethodId/name. */
  channel: WithdrawalMethodDTO | null;
  submitting: boolean;
  onClose: () => void;
  onApprove: (tx: TransactionDTO) => void;
  onReject: (tx: TransactionDTO) => void;
}) {
  if (!tx) return null;

  const method = metaStr(tx.meta, "paymentMethod");
  const destination = metaStr(tx.meta, "accountDetails");
  const rejectNote = metaStr(tx.meta, "note");
  const pending = tx.status === "pending";
  const isBank = channel?.kind === "bank";
  const channelName = channel?.name ?? (method ? prettyMethod(method) : null);
  const destinationValid = (destination ?? "").trim().length >= 5;

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdrawal details</DialogTitle>
          <DialogDescription>
            {tx.userName ?? "Member"} · {formatPKR(tx.amount)} ·{" "}
            {channelName ?? "Unknown method"}
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y">
          <DetailRow label="Member">
            <p className="font-medium">{tx.userName ?? "Unknown user"}</p>
            {tx.userEmail ? (
              <p className="truncate text-xs text-muted-foreground" title={tx.userEmail}>
                {tx.userEmail}
              </p>
            ) : null}
          </DetailRow>
          <DetailRow label="Member ID">
            <span className="flex items-center justify-end gap-1.5">
              <code className="break-all font-mono text-xs text-muted-foreground">{tx.userId}</code>
              <CopyButton
                value={tx.userId}
                toastLabel="Member ID copied"
                label="Copy member ID"
                variant="ghost"
                size="icon"
                className="size-7"
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </CopyButton>
            </span>
          </DetailRow>
          <DetailRow label="Withdrawal amount">
            <span className="font-bold tabular-nums">{formatPKR(tx.amount)}</span>
          </DetailRow>
          <DetailRow label="Payment method">
            {channelName ? (
              <span className="flex items-center justify-end gap-2">
                {channel ? (
                  <WithdrawalMethodLogo method={channel} className="size-7" iconClassName="size-4" />
                ) : null}
                <span className="font-medium">{channelName}</span>
                <Badge variant="secondary" className="gap-1 text-[11px]">
                  {isBank ? (
                    <>
                      <Landmark className="size-3" aria-hidden="true" /> Bank
                    </>
                  ) : channel ? (
                    <>
                      <Smartphone className="size-3" aria-hidden="true" /> Mobile wallet
                    </>
                  ) : (
                    "Channel"
                  )}
                </Badge>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Unknown / deleted channel</span>
            )}
          </DetailRow>
        </div>

        {/* Payment destination — the snapshot taken when the member submitted */}
        <section
          aria-label="Payment destination"
          className="rounded-xl border bg-muted/30 p-3.5"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Payment destination
          </p>
          {destinationValid && destination ? (
            <>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {isBank ? "Bank account number / IBAN" : "Account / mobile number"}
              </p>
              <div className="mt-1.5 flex items-start justify-between gap-2">
                <code className="break-all font-mono text-sm font-semibold">{destination}</code>
                <CopyButton
                  value={destination}
                  toastLabel="Payment destination copied"
                  label="Copy payment destination"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2.5"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                </CopyButton>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Exactly as the member submitted it with this request — send the payout to this
                account.
              </p>
            </>
          ) : (
            <Alert variant="destructive" className="mt-2">
              <AlertTitle>Payment details are missing</AlertTitle>
              <AlertDescription>
                Payment details are missing for this withdrawal. Please resolve the member&apos;s
                payment details before approving.
              </AlertDescription>
            </Alert>
          )}
        </section>

        <div className="divide-y">
          <DetailRow label="Request date">
            <span title={formatDate(tx.createdAt)}>
              {formatDate(tx.createdAt)} · {timeAgo(tx.createdAt)}
            </span>
          </DetailRow>
          <DetailRow label="Status">
            <span className="flex flex-col items-end gap-1">
              <TxStatusBadge status={tx.status} />
              {tx.processedAt ? (
                <span className="text-[11px] text-muted-foreground">
                  {tx.status === "rejected" ? "Rejected" : "Processed"} {timeAgo(tx.processedAt)}
                </span>
              ) : null}
            </span>
          </DetailRow>
          {rejectNote && tx.status === "rejected" ? (
            <DetailRow label="Rejection note">
              <span className="text-xs text-muted-foreground">{rejectNote}</span>
            </DetailRow>
          ) : null}
        </div>

        {pending ? (
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={submitting}
              onClick={() => onReject(tx)}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <X className="size-4" aria-hidden="true" />
              )}
              Reject — refund balance
            </Button>
            <Button className="gap-1.5" disabled={submitting || !destinationValid} onClick={() => onApprove(tx)}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Approve payout
            </Button>
          </div>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            This request is already processed.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

type TxFilter = "all" | "pending" | "processed";

function FilterChips({
  value,
  onChange,
  pendingCount,
  processedCount,
  totalCount,
}: {
  value: TxFilter;
  onChange: (value: TxFilter) => void;
  pendingCount: number;
  processedCount: number;
  totalCount: number;
}) {
  const chips: { key: TxFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: totalCount },
    { key: "pending", label: "Pending", count: pendingCount },
    { key: "processed", label: "Processed", count: processedCount },
  ];
  return (
    <div
      role="group"
      aria-label="Filter transactions by status"
      className="flex w-full gap-1 rounded-lg bg-muted/60 p-1 sm:w-auto"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          aria-pressed={value === chip.key}
          onClick={() => onChange(chip.key)}
          className={cn(
            "flex min-h-[34px] flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            value === chip.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {chip.label}
          <span className={cn("text-xs tabular-nums", value === chip.key ? "text-primary" : "text-muted-foreground")}>
            {chip.count}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ confirm dialog ----------------------------- */

interface ConfirmState {
  tx: TransactionDTO;
  action: "approve" | "reject";
}

function ConfirmDialog({
  state,
  submitting,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (state: ConfirmState) => void;
}) {
  if (!state) return null;
  const { tx, action } = state;
  const approving = action === "approve";
  const name = tx.userName ?? "this member";

  const title = approving ? "Confirm approval" : "Confirm rejection";
  const description = approving
    ? `Approve ${formatPKR(tx.amount)} deposit from ${name}?`
    : `Reject ${formatPKR(tx.amount)} deposit from ${name}?`;

  return (
    <AlertDialog open onOpenChange={(open) => !open && !submitting && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {approving ? (
            <AlertDialogDescription>
              Plan deposits activate the user's plan and trigger the inviter's referral unlock
              automatically.
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={approving ? undefined : "bg-destructive text-white hover:bg-destructive/90"}
            disabled={submitting}
            onClick={(e) => {
              e.preventDefault(); // keep the dialog open until the mutation settles
              onConfirm(state);
            }}
          >
            {submitting ? "Working…" : approving ? "Approve" : "Reject"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function WithdrawalsView() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TxFilter>("all");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [detailsTx, setDetailsTx] = useState<TransactionDTO | null>(null);

  const withdrawalsQuery = useQuery({
    queryKey: ["admin", "withdrawals"],
    queryFn: () => apiFetch<Pick<TransactionsPayload, "withdrawals">>("/api/admin/withdrawals"),
    refetchInterval: 10_000,
  });
  const depositsQuery = useQuery({
    queryKey: ["admin", "deposits"],
    queryFn: () => apiFetch<Pick<TransactionsPayload, "deposits">>("/api/admin/deposits"),
    refetchInterval: 10_000,
  });

  // Payout channels (shared cache with the Payment Methods manager) — used to
  // resolve each request's channel kind + logo in the details dialog from the
  // meta.paymentMethodId snapshot (falling back to the stored channel name).
  const methodsQuery = useQuery({
    queryKey: ["admin", "withdrawal-methods"],
    queryFn: () => apiFetch<{ methods: WithdrawalMethodDTO[] }>("/api/admin/withdrawal-methods"),
    staleTime: 60_000,
  });
  const resolveChannel = (tx: TransactionDTO | null): WithdrawalMethodDTO | null => {
    if (!tx) return null;
    const list = methodsQuery.data?.methods ?? [];
    const id = metaStr(tx.meta, "paymentMethodId");
    const name = metaStr(tx.meta, "paymentMethod");
    return (
      (id ? list.find((m) => m.id === id) : undefined) ??
      (name ? list.find((m) => m.name.toLowerCase() === name.toLowerCase()) : undefined) ??
      null
    );
  };

  const withdrawalMutation = useMutation({
    mutationFn: (payload: { id: string; action: "approve" | "reject" }) =>
      apiFetch<unknown>("/api/admin/withdrawals", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      if (payload.action === "approve") toast.success("Payout approved");
      else toast("Rejected — balance refunded");
      setConfirm(null);
      setDetailsTx(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "withdrawals"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const depositMutation = useMutation({
    mutationFn: (payload: { id: string; action: "approve" | "reject" }) =>
      apiFetch<unknown>("/api/admin/deposits", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      if (payload.action === "approve") toast.success("Deposit approved");
      else toast("Deposit rejected");
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "deposits"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const withdrawals = withdrawalsQuery.data?.withdrawals ?? [];
  const deposits = depositsQuery.data?.deposits ?? [];

  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending").length;
  const pendingDeposits = deposits.filter((d) => d.status === "pending").length;

  const filteredWithdrawals = useMemo(() => {
    if (filter === "pending") return withdrawals.filter((w) => w.status === "pending");
    if (filter === "processed") return withdrawals.filter((w) => w.status !== "pending");
    return withdrawals;
  }, [withdrawals, filter]);

  const submitting = withdrawalMutation.isPending || depositMutation.isPending;

  const handleConfirm = (state: ConfirmState) => {
    depositMutation.mutate({ id: state.tx.id, action: state.action });
  };

  // Withdrawal rows: every action opens the DETAILS dialog first — the
  // payout destination is always on screen before Approve/Reject runs, and
  // Approve is disabled there when the required payment details are missing.
  const renderActions = (tx: TransactionDTO, kind: "withdrawal" | "deposit") => {
    if (kind === "withdrawal") {
      return (
        <div className="flex items-center justify-end gap-2 pr-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={submitting}
            aria-label={`View payment details for ${tx.userName ?? "member"}'s withdrawal`}
            onClick={() => setDetailsTx(tx)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">Details</span>
          </Button>
          {tx.status === "pending" ? (
            <>
              <Button
                size="sm"
                className="h-9 gap-1.5"
                disabled={submitting}
                aria-label={`Approve ${formatPKR(tx.amount)} withdrawal for ${tx.userName ?? "member"}`}
                onClick={() => setDetailsTx(tx)}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={submitting}
                aria-label={`Reject ${formatPKR(tx.amount)} withdrawal for ${tx.userName ?? "member"}`}
                onClick={() => setDetailsTx(tx)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Reject
              </Button>
            </>
          ) : null}
        </div>
      );
    }
    if (tx.status !== "pending") {
      return <span className="block pr-4 text-right text-xs text-muted-foreground">—</span>;
    }
    return (
      <div className="flex items-center justify-end gap-2 pr-2">
        <Button
          size="sm"
          className="h-9 gap-1.5"
          disabled={submitting}
          aria-label={`Approve ${formatPKR(tx.amount)} deposit for ${tx.userName ?? "member"}`}
          onClick={() => setConfirm({ tx, action: "approve" })}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={submitting}
          aria-label={`Reject ${formatPKR(tx.amount)} deposit for ${tx.userName ?? "member"}`}
          onClick={() => setConfirm({ tx, action: "reject" })}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Reject
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="withdrawals">
        <TabsList className="h-auto w-full sm:w-auto">
          <TabsTrigger value="withdrawals" className="gap-2">
            <Banknote className="h-4 w-4" aria-hidden="true" />
            Withdrawals
            {pendingWithdrawals > 0 ? (
              <Badge className="ml-0.5 bg-primary px-1.5 tabular-nums hover:bg-primary">
                {pendingWithdrawals}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="deposits" className="gap-2">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            Deposits
            {pendingDeposits > 0 ? (
              <Badge className="ml-0.5 bg-primary px-1.5 tabular-nums hover:bg-primary">
                {pendingDeposits}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* ------------------------------ withdrawals ----------------------------- */}
        <TabsContent value="withdrawals" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterChips
              value={filter}
              onChange={setFilter}
              pendingCount={pendingWithdrawals}
              processedCount={withdrawals.length - pendingWithdrawals}
              totalCount={withdrawals.length}
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Pending requests are held from the member's balance until resolved.
            </p>
          </div>

          <Card className="py-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Payout requests</CardTitle>
              <CardDescription>
                Open a request to see where the money must be sent. Approving marks the payout as
                paid; rejecting refunds the member&apos;s withdrawable balance.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {withdrawalsQuery.isPending ? (
                <TableSkeleton rows={5} columns={6} />
              ) : withdrawalsQuery.isError ? (
                <div className="p-6">
                  <SectionError
                    title="Could not load withdrawals"
                    message={withdrawalsQuery.error.message}
                    onRetry={() => void withdrawalsQuery.refetch()}
                  />
                </div>
              ) : filteredWithdrawals.length === 0 ? (
                <EmptyState
                  icon={Banknote}
                  title={
                    filter === "pending"
                      ? "No pending payouts — all caught up"
                      : filter === "processed"
                        ? "No processed payouts yet"
                        : "No withdrawal requests yet"
                  }
                  description={
                    filter === "pending"
                      ? "New requests appear here in real time."
                      : "Member payout requests will show up here."
                  }
                />
              ) : (
                <TableWrap>
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Requested</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="hidden md:table-cell">Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredWithdrawals.map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell className="whitespace-nowrap pl-6 text-xs text-muted-foreground">
                            {timeAgo(tx.createdAt)}
                          </TableCell>
                          <TableCell>
                            <UserCell tx={tx} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                            {formatPKR(tx.amount)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <MethodCell tx={tx} />
                          </TableCell>
                          <TableCell>
                            <StatusCell tx={tx} />
                          </TableCell>
                          <TableCell className="pr-6">{renderActions(tx, "withdrawal")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------- deposits ------------------------------- */}
        <TabsContent value="deposits" className="mt-4 space-y-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Plan deposits activate the user's plan and trigger the inviter's referral unlock
              automatically on approval.
            </span>
          </div>

          <Card className="py-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Deposit submissions</CardTitle>
              <CardDescription>
                Members submit their transaction ID after paying into your payment accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {depositsQuery.isPending ? (
                <TableSkeleton rows={5} columns={6} />
              ) : depositsQuery.isError ? (
                <div className="p-6">
                  <SectionError
                    title="Could not load deposits"
                    message={depositsQuery.error.message}
                    onRetry={() => void depositsQuery.refetch()}
                  />
                </div>
              ) : deposits.length === 0 ? (
                <EmptyState
                  icon={Wallet}
                  title="No deposits yet"
                  description="Plan payments and wallet top-ups submitted by members will show up here."
                />
              ) : (
                <TableWrap>
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Submitted</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Purpose</TableHead>
                        <TableHead className="hidden sm:table-cell">Method & TxID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-6 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deposits.map((tx) => {
                        const purpose = metaStr(tx.meta, "purpose");
                        const planName =
                          metaStr(tx.meta, "planName") ?? metaStr(tx.meta, "plan") ?? "VIP plan";
                        return (
                          <TableRow key={tx.id}>
                            <TableCell className="whitespace-nowrap pl-6 text-xs text-muted-foreground">
                              {timeAgo(tx.createdAt)}
                            </TableCell>
                            <TableCell>
                              <UserCell tx={tx} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                              {formatPKR(tx.amount)}
                            </TableCell>
                            <TableCell>
                              {purpose === "plan" ? (
                                <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                                  <Banknote aria-hidden="true" />
                                  <span className="max-w-[140px] truncate">Plan: {planName}</span>
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-muted-foreground">
                                  Top-up
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              <MethodCell tx={tx} />
                              {metaStr(tx.meta, "txId") ? (
                                <p className="mt-0.5 max-w-[180px] truncate font-mono text-[11px] text-muted-foreground">
                                  {metaStr(tx.meta, "txId")}
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <StatusCell tx={tx} />
                            </TableCell>
                            <TableCell className="pr-6">{renderActions(tx, "deposit")}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableWrap>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        state={confirm}
        submitting={submitting}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
      />

      <WithdrawalDetailsDialog
        tx={detailsTx}
        channel={resolveChannel(detailsTx)}
        submitting={withdrawalMutation.isPending}
        onClose={() => setDetailsTx(null)}
        onApprove={(tx) => withdrawalMutation.mutate({ id: tx.id, action: "approve" })}
        onReject={(tx) => withdrawalMutation.mutate({ id: tx.id, action: "reject" })}
      />
    </div>
  );
}
