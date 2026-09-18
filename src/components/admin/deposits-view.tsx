"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bitcoin,
  Check,
  Crown,
  Eye,
  Info,
  Loader2,
  Package as PackageIcon,
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
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
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
import type { PackageDTO, TransactionDTO } from "@/lib/types";

interface DepositsPayload {
  deposits: TransactionDTO[];
}

interface PackagesLookupPayload {
  packages: PackageDTO[];
}

/** The live terms of the package attached to a payment request — resolved from
 * the existing admin Packages list (the package row is the source of truth),
 * so the Admin sees exactly what approving means: the daily earning the member
 * will receive. null when the package is unknown (e.g. deleted). */
interface PackageTerms {
  title: string;
  dailyEarning: number;
  durationDays: number;
}

interface ProofPayload {
  id: string;
  proof: string | null;
}

/* --------------------------------- helpers --------------------------------- */

function prettyMethod(method: string): string {
  if (method === "easypaisa") return "EasyPaisa";
  if (method === "jazzcash") return "JazzCash";
  if (method === "usdt") return "USDT";
  return method || "—";
}

function MethodIcon({ method }: { method: string }) {
  if (method === "usdt") {
    return <Bitcoin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  return <Smartphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
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
      aria-label="Filter submissions by status"
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

/* ----------------------------- confirm dialogs ----------------------------- */

interface ConfirmState {
  tx: TransactionDTO;
  action: "approve" | "reject";
}

function ConfirmDialog({
  state,
  submitting,
  note,
  packageTerms,
  onNoteChange,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState | null;
  submitting: boolean;
  note: string;
  packageTerms: PackageTerms | null;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onConfirm: (state: ConfirmState) => void;
}) {
  if (!state) return null;
  const { tx, action } = state;
  const approving = action === "approve";
  const name = tx.userName ?? tx.userEmail ?? "this member";
  const purpose = typeof tx.meta?.purpose === "string" ? tx.meta.purpose : "";
  const itemLabel =
    purpose === "package"
      ? (typeof tx.meta?.packageTitle === "string" ? tx.meta.packageTitle : "package")
      : purpose === "plan"
        ? (typeof tx.meta?.planName === "string" ? tx.meta.planName : "VIP plan")
        : "Wallet top-up";

  return (
    <AlertDialog open onOpenChange={(open) => !open && !submitting && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{approving ? "Confirm approval" : "Confirm rejection"}</AlertDialogTitle>
          <AlertDialogDescription>
            {approving
              ? purpose === "package"
                ? packageTerms
                  ? `Approve ${formatPKR(tx.amount)} for the ${itemLabel} from ${name}? The package activates instantly — ${name} automatically earns ${formatPKR(packageTerms.dailyEarning)} daily for ${packageTerms.durationDays.toLocaleString("en-US")} days. No wallet balance is deducted.`
                  : `Approve ${formatPKR(tx.amount)} for the ${itemLabel} from ${name}? The investment activates instantly and starts earning its daily income — no wallet balance is deducted.`
                : `Approve ${formatPKR(tx.amount)} for the ${itemLabel} from ${name}? The plan activates and the inviter's referral unlock fires automatically.`
              : `Reject ${formatPKR(tx.amount)} from ${name}? No money moves and nothing is activated — the member can resubmit with a new transaction ID.`}
          </AlertDialogDescription>
          {!approving ? (
            <div className="space-y-2 pt-1">
              <Label htmlFor="reject-note">Note for the member (optional)</Label>
              <Textarea
                id="reject-note"
                value={note}
                disabled={submitting}
                rows={3}
                maxLength={300}
                placeholder="e.g. TxID not found — please double-check and resubmit."
                onChange={(e) => onNoteChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Shown with the rejected transaction on the member&apos;s wallet history.
              </p>
            </div>
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

/* ------------------------------ proof dialog ------------------------------- */

function ProofDialog({ tx, onClose }: { tx: TransactionDTO | null; onClose: () => void }) {
  const proofQuery = useQuery({
    queryKey: ["admin", "deposit-proof", tx?.id],
    queryFn: () =>
      apiFetch<ProofPayload>(`/api/admin/deposits?id=${encodeURIComponent(tx?.id ?? "")}`, {
        method: "PUT",
      }),
    enabled: tx !== null,
    staleTime: 60_000,
  });

  if (!tx) return null;

  return (
    <Dialog open={Boolean(tx)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment proof</DialogTitle>
          <DialogDescription>
            {tx.userName ?? tx.userEmail ?? "Member"} · {formatPKR(tx.amount)} · TID{" "}
            <span className="font-mono">{metaStr(tx.meta, "txId") ?? "—"}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] items-center justify-center overflow-auto rounded-lg border bg-muted/40 p-3">
          {proofQuery.isPending ? (
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-label="Loading proof" />
          ) : proofQuery.isError ? (
            <p className="text-sm text-destructive">Could not load the screenshot.</p>
          ) : proofQuery.data?.proof ? (
            <img
              src={proofQuery.data.proof}
              alt="Payment proof screenshot"
              className="max-h-[54vh] w-auto rounded-md"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No screenshot attached to this submission.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function DepositsView() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TxFilter>("pending");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [note, setNote] = useState("");
  const [proofTx, setProofTx] = useState<TransactionDTO | null>(null);

  const depositsQuery = useQuery({
    queryKey: ["admin", "deposits"],
    queryFn: () => apiFetch<DepositsPayload>("/api/admin/deposits"),
    refetchInterval: 10_000,
  });

  // Live package terms for package payment requests — the SAME cached admin
  // packages list the Packages page uses (shared query key), so the package
  // row stays the single source of truth: no package data is copied onto the
  // request, it is looked up from the catalog at render time.
  const packagesQuery = useQuery({
    queryKey: ["admin", "packages"],
    queryFn: () => apiFetch<PackagesLookupPayload>("/api/admin/packages"),
    staleTime: 30_000,
  });
  const packagesById = useMemo(() => {
    const map = new Map<string, PackageDTO>();
    for (const pkg of packagesQuery.data?.packages ?? []) map.set(pkg.id, pkg);
    return map;
  }, [packagesQuery.data]);

  /** Resolve the live terms of the package attached to a request (null when
   * the request carries no package reference or the package is unknown). */
  const resolvePackageTerms = (tx: TransactionDTO): PackageTerms | null => {
    const purpose = typeof tx.meta?.purpose === "string" ? tx.meta.purpose : "";
    const packageId = metaStr(tx.meta, "packageId");
    const pkg = packageId ? packagesById.get(packageId) : undefined;
    if (purpose !== "package" || !pkg) return null;
    return { title: pkg.title, dailyEarning: pkg.dailyEarning, durationDays: pkg.durationDays };
  };

  const mutation = useMutation({
    mutationFn: (payload: { id: string; action: "approve" | "reject"; note?: string }) =>
      apiFetch<unknown>("/api/admin/deposits", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      if (payload.action === "approve") toast.success("Payment approved");
      else toast("Payment rejected");
      setConfirm(null);
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "deposits"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deposits = depositsQuery.data?.deposits ?? [];
  const pendingCount = deposits.filter((d) => d.status === "pending").length;

  const filtered = useMemo(() => {
    if (filter === "pending") return deposits.filter((d) => d.status === "pending");
    if (filter === "processed") return deposits.filter((d) => d.status !== "pending");
    return deposits;
  }, [deposits, filter]);

  const handleConfirm = (state: ConfirmState) => {
    mutation.mutate({
      id: state.tx.id,
      action: state.action,
      ...(state.action === "reject" && note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          value={filter}
          onChange={setFilter}
          pendingCount={pendingCount}
          processedCount={deposits.length - pendingCount}
          totalCount={deposits.length}
        />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Approving activates the package/plan and records your review. Package payments always need
          manual approval.
        </p>
      </div>

      <Card className="overflow-hidden py-0">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Payment requests</CardTitle>
              <CardDescription>
                Package purchases, VIP plan payments and top-ups awaiting review — with their
                transaction IDs and payment screenshots.
              </CardDescription>
            </div>
            {pendingCount > 0 ? (
              <Badge className="gap-1.5 tabular-nums">
                <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" aria-hidden="true" />
                {pendingCount} pending
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {depositsQuery.isPending ? (
            <TableSkeleton rows={5} columns={7} />
          ) : depositsQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load payment requests"
                message={depositsQuery.error.message}
                onRetry={() => void depositsQuery.refetch()}
              />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title={
                filter === "pending"
                  ? "No pending payments — all caught up"
                  : filter === "processed"
                    ? "No processed payments yet"
                    : "No payment submissions yet"
              }
              description="Package checkout submissions, plan payments and wallet top-ups will show up here."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">User</TableHead>
                    <TableHead>Package / Plan</TableHead>
                    <TableHead className="text-right">Amount (PKR)</TableHead>
                    <TableHead>Gateway</TableHead>
                    <TableHead>TxID</TableHead>
                    <TableHead className="hidden md:table-cell">Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((tx) => {
                    const purpose = metaStr(tx.meta, "purpose");
                    const isPlan = purpose === "plan" || tx.type === "plan_purchase";
                    const isPackage = purpose === "package" || (tx.type === "package_purchase" && !metaStr(tx.meta, "userPackageId"));
                    const itemLabel = isPackage
                      ? (metaStr(tx.meta, "packageTitle") ?? "Package")
                      : isPlan
                        ? (metaStr(tx.meta, "planName") ?? metaStr(tx.meta, "plan") ?? "VIP plan")
                        : "Wallet top-up";
                    const method = metaStr(tx.meta, "paymentMethod");
                    const txId = metaStr(tx.meta, "txId");
                    const rejectNote = metaStr(tx.meta, "note");
                    const reviewedBy = metaStr(tx.meta, "reviewedBy");
                    return (
                      <TableRow key={tx.id}>
                        <TableCell className="pl-6">
                          <div className="max-w-[210px]">
                            <p className="truncate text-sm font-medium">{tx.userName ?? "Unknown user"}</p>
                            <p className="truncate text-xs text-muted-foreground">{tx.userEmail ?? ""}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {isPackage ? (
                            <div className="space-y-1">
                              <Badge variant="secondary" className="gap-1 bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                <PackageIcon aria-hidden="true" />
                                <span className="max-w-[150px] truncate">{itemLabel}</span>
                              </Badge>
                              {/* Live terms straight from the package record — what
                                  the member will earn once approved. */}
                              {(() => {
                                const terms = resolvePackageTerms(tx);
                                return terms ? (
                                  <p className="whitespace-nowrap text-[11px] text-muted-foreground">
                                    <span className="font-semibold text-primary">{formatPKR(terms.dailyEarning)}/day</span>
                                    <span aria-hidden="true"> · </span>
                                    {terms.durationDays.toLocaleString("en-US")} days
                                  </p>
                                ) : null;
                              })()}
                            </div>
                          ) : isPlan ? (
                            <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                              <Crown aria-hidden="true" />
                              <span className="max-w-[150px] truncate">{itemLabel}</span>
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-muted-foreground">Top-up</Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                          {formatPKR(tx.amount)}
                        </TableCell>
                        <TableCell>
                          {method ? (
                            <span className="flex items-center gap-1.5 text-sm">
                              <MethodIcon method={method} />
                              {prettyMethod(method)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          {tx.hasProof ? (
                            <button
                              type="button"
                              onClick={() => setProofTx(tx)}
                              className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                            >
                              <Eye className="size-3" aria-hidden="true" />
                              View proof
                            </button>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[150px]">
                          {txId ? (
                            <span className="block truncate font-mono text-xs" title={txId}>
                              {txId}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                          <span title={formatDate(tx.createdAt)}>{timeAgo(tx.createdAt)}</span>
                          {tx.processedAt ? (
                            <span
                              className="mt-0.5 block text-[11px]"
                              title={formatDate(tx.processedAt)}
                            >
                              {tx.status === "approved" || tx.status === "completed"
                                ? `Approved ${timeAgo(tx.processedAt)}`
                                : `${tx.status === "rejected" ? "Rejected" : "Processed"} ${timeAgo(tx.processedAt)}`}
                              {reviewedBy ? ` · ${reviewedBy}` : ""}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <TxStatusBadge status={tx.status} />
                            {rejectNote && tx.status === "rejected" ? (
                              <p className="max-w-[170px] text-[11px] text-muted-foreground" title={rejectNote}>
                                “{rejectNote}”
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="pr-6">
                          {tx.status !== "pending" ? (
                            <span className="block pr-4 text-right text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                className="h-9 gap-1.5"
                                disabled={mutation.isPending}
                                aria-label={`Approve ${formatPKR(tx.amount)} payment for ${tx.userName ?? "member"}`}
                                onClick={() => {
                                  setNote("");
                                  setConfirm({ tx, action: "approve" });
                                }}
                              >
                                <Check className="h-4 w-4" aria-hidden="true" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={mutation.isPending}
                                aria-label={`Reject ${formatPKR(tx.amount)} payment for ${tx.userName ?? "member"}`}
                                onClick={() => {
                                  setNote("");
                                  setConfirm({ tx, action: "reject" });
                                }}
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        state={confirm}
        submitting={mutation.isPending}
        note={note}
        packageTerms={confirm ? resolvePackageTerms(confirm.tx) : null}
        onNoteChange={setNote}
        onCancel={() => setConfirm(null)}
        onConfirm={handleConfirm}
      />

      <ProofDialog tx={proofTx} onClose={() => setProofTx(null)} />
    </div>
  );
}
