"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Coins,
  Package as PackageIcon,
  Search,
  ShieldCheck,
  Users as UsersIcon,
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  SectionError,
  TableSkeleton,
  TableWrap,
  initials,
} from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { formatPKR, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AdminUserDTO, AdminUsersPayloadDTO } from "@/lib/types";

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "banned", label: "Banned" },
] as const;

/* --------------------------- adjust balance dialog -------------------------- */

interface AdjustDialogProps {
  open: boolean;
  user: AdminUserDTO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    userId: string;
    action: "adjust";
    balanceType: "task" | "withdrawable";
    amount: number;
    reason: string;
  }) => void;
  submitting: boolean;
}

function AdjustBalanceDialog({ open, user, onOpenChange, onSubmit, submitting }: AdjustDialogProps) {
  // Remounted (via key) every time the dialog is opened, so these values are
  // always fresh — no reset effects needed.
  const [balanceType, setBalanceType] = useState<"task" | "withdrawable">("withdrawable");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const parsedAmount = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isInteger(parsedAmount) && parsedAmount !== 0;

  const currentBalance = user
    ? balanceType === "task"
      ? user.taskBalance
      : user.withdrawableBalance
    : 0;
  const nextBalance = currentBalance + (validAmount ? parsedAmount : 0);
  const goesNegative = validAmount && nextBalance < 0;

  const submit = () => {
    if (!user || !validAmount || goesNegative) return;
    onSubmit({
      userId: user.id,
      action: "adjust",
      balanceType,
      amount: parsedAmount,
      reason: reason.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust balance</DialogTitle>
          <DialogDescription>
            Manually credit or debit {user?.name ?? "member"}'s wallet. Every adjustment is written to
            the transaction ledger.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="adjust-balance-type">Balance type</Label>
            <Select
              value={balanceType}
              onValueChange={(v) => setBalanceType(v === "task" ? "task" : "withdrawable")}
              disabled={submitting}
            >
              <SelectTrigger id="adjust-balance-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="withdrawable">Withdrawable Balance</SelectItem>
                <SelectItem value="task">Task Balance</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Current: {formatPKR(currentBalance)} ·{" "}
              {balanceType === "task"
                ? "earned from tasks, unlocks when referrals activate"
                : "available for withdrawal requests"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-amount">Amount (PKR)</Label>
            <Input
              id="adjust-amount"
              type="number"
              step={1}
              inputMode="numeric"
              placeholder="e.g. 500 or -250"
              value={amount}
              aria-invalid={amount.trim() !== "" && !validAmount ? true : undefined}
              disabled={submitting}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Positive to credit, negative to debit.</p>
            {amount.trim() !== "" && !validAmount ? (
              <p className="text-xs text-destructive">Enter a non-zero whole number.</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjust-reason">Reason (optional)</Label>
            <Input
              id="adjust-reason"
              value={reason}
              placeholder="e.g. Support case #142 refund"
              disabled={submitting}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {validAmount ? (
            <div
              aria-live="polite"
              className={cn(
                "rounded-lg border p-3 text-xs",
                goesNegative ? "border-destructive/40 bg-destructive/5" : "border-primary/30 bg-primary/5",
              )}
            >
              <span className={cn("font-medium tabular-nums", goesNegative ? "text-destructive" : "text-primary")}>
                {parsedAmount > 0 ? formatPKR(parsedAmount, { sign: true }) : formatPKR(parsedAmount)}
              </span>
              <span className="text-muted-foreground">
                {" "}
                → New {balanceType === "task" ? "task" : "withdrawable"} balance:{" "}
              </span>
              <span className="font-medium tabular-nums">
                {formatPKR(nextBalance)}
              </span>
              {goesNegative ? (
                <p className="mt-1 text-destructive">
                  This would make the balance negative — not allowed.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !validAmount || goesNegative}>
            {submitting ? "Applying…" : "Apply adjustment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function UsersView() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // debounce the search parameter
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any search/filter change returns to the first page — render-phase reset
  // (the official React "adjust state when inputs change" pattern, no effect).
  const filterKey = `${query}|${statusFilter}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  // Server-side search + filter + pagination: only ONE page of users is ever
  // fetched, so the list stays fast no matter how large the member base grows.
  // No polling — refreshes via invalidation and window focus (§ scalability).
  const usersQuery = useQuery({
    queryKey: ["admin", "users", query, statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("page", String(page));
      return apiFetch<AdminUsersPayloadDTO>(`/api/admin/users?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const data = usersQuery.data;
  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const switchingPage = usersQuery.isPlaceholderData && usersQuery.isFetching;

  const rangeLabel = useMemo(() => {
    if (total === 0) return "No users";
    const from = (page - 1) * (data?.pageSize ?? 25) + 1;
    const to = Math.min(page * (data?.pageSize ?? 25), total);
    return `Showing ${from}–${to} of ${total}`;
  }, [data, page, total]);

  const [banTarget, setBanTarget] = useState<AdminUserDTO | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<AdminUserDTO | null>(null);
  const [adjustSession, setAdjustSession] = useState(0);

  type UserMutationInput =
    | { kind: "ban"; user: AdminUserDTO }
    | { kind: "unban"; user: AdminUserDTO }
    | {
        kind: "adjust";
        user: AdminUserDTO;
        balanceType: "task" | "withdrawable";
        amount: number;
        reason: string;
      };

  const userMutation = useMutation({
    mutationFn: async (input: UserMutationInput) => {
      const payload: Record<string, unknown> = { userId: input.user.id, action: input.kind };
      if (input.kind === "adjust") {
        payload.balanceType = input.balanceType;
        payload.amount = input.amount;
        if (input.reason) payload.reason = input.reason;
      }
      return apiFetch<{ ok: true }>("/api/admin/users", { method: "POST", json: payload });
    },
    onSuccess: (_data, input) => {
      if (input.kind === "ban") toast.success(`${input.user.name} has been banned`);
      else if (input.kind === "unban") toast.success(`${input.user.name} has been unbanned`);
      else toast.success(`Balance adjusted for ${input.user.name}`);
      setBanTarget(null);
      setAdjustOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitting = userMutation.isPending;

  const handleAdjust = (input: {
    userId: string;
    action: "adjust";
    balanceType: "task" | "withdrawable";
    amount: number;
    reason: string;
  }) => {
    const user = users.find((u) => u.id === input.userId) ?? adjustTarget;
    if (!user) return;
    userMutation.mutate({
      kind: "adjust",
      user,
      balanceType: input.balanceType,
      amount: input.amount,
      reason: input.reason,
    });
  };

  const summary = useMemo(() => {
    const banned = data?.bannedTotal ?? 0;
    const suffix =
      statusFilter === "banned" ? " · filtered to banned" : statusFilter === "active" ? " · filtered to active" : "";
    return `${total} user${total === 1 ? "" : "s"}${banned > 0 ? ` · ${banned} banned` : ""}${suffix}`;
  }, [data, statusFilter, total]);

  return (
    <div className="space-y-6">
      {/* search + status filter (server-side) */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="w-full lg:max-w-xs">
          <Label htmlFor="user-search" className="sr-only">
            Search users by name or email
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="user-search"
              type="search"
              role="searchbox"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or email…"
              className="pl-9"
            />
            {searchInput !== "" ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="w-full sm:w-44">
          <Label htmlFor="user-status" className="sr-only">
            Filter users by account status
          </Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="user-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground lg:ml-auto" aria-live="polite">
          {summary}
        </p>
      </div>

      <TooltipProvider delayDuration={200}>
        <Card className="py-0 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">User accounts</CardTitle>
            <CardDescription>
              Wallets, plan status and the signup signals used for anti-fraud checks.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {usersQuery.isPending ? (
              <TableSkeleton rows={8} columns={6} />
            ) : usersQuery.isError ? (
              <div className="p-6">
                <SectionError
                  title="Could not load users"
                  message={usersQuery.error.message}
                  onRetry={() => void usersQuery.refetch()}
                />
              </div>
            ) : users.length === 0 ? (
              <EmptyState
                icon={query || statusFilter !== "all" ? Search : UsersIcon}
                title={
                  query || statusFilter !== "all"
                    ? "No users match these filters"
                    : "No users yet"
                }
                description={
                  query || statusFilter !== "all"
                    ? "Try a different name, email or status."
                    : "Signups will appear here as people join the platform."
                }
              />
            ) : (
              <TableWrap className="max-h-[65vh] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card">
                <Table className={cn("min-w-[980px]", switchingPage && "opacity-60 transition-opacity")}>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">User</TableHead>
                      <TableHead className="hidden sm:table-cell">Role</TableHead>
                      <TableHead>Balances</TableHead>
                      <TableHead className="hidden md:table-cell">Package / Plan</TableHead>
                      <TableHead className="hidden xl:table-cell text-right">Referrals</TableHead>
                      <TableHead className="hidden lg:table-cell">IP Address</TableHead>
                      <TableHead className="hidden lg:table-cell">Fingerprint</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Last Login</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="max-w-[220px] pl-6">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarFallback
                                className={cn(
                                  "text-xs font-semibold",
                                  u.role === "admin"
                                    ? "bg-primary/15 text-primary"
                                    : "bg-secondary text-secondary-foreground",
                                )}
                              >
                                {initials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{u.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          {u.role === "admin" ? (
                            <Badge variant="secondary">admin</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-muted-foreground">
                              user
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-0.5 text-xs">
                            <p className="flex items-center gap-1.5">
                              <Coins className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                              <span className="text-muted-foreground">Task</span>
                              <span className="font-medium tabular-nums">{formatPKR(u.taskBalance)}</span>
                            </p>
                            <p className="flex items-center gap-1.5">
                              <Wallet className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                              <span className="text-muted-foreground">Withdraw</span>
                              <span className="font-medium tabular-nums text-primary">
                                {formatPKR(u.withdrawableBalance)}
                              </span>
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="space-y-1">
                            {u.activePackages.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge
                                  variant="secondary"
                                  className="max-w-[130px] truncate bg-primary/10 text-primary"
                                >
                                  <PackageIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                                  {u.activePackages[0]}
                                </Badge>
                                {u.activePackages.length > 1 ? (
                                  <Badge variant="secondary" className="text-muted-foreground">
                                    +{u.activePackages.length - 1}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : null}
                            {u.activePlanName ? (
                              <p className="max-w-[150px] truncate text-[11px] text-muted-foreground">
                                VIP: {u.activePlanName}
                              </p>
                            ) : u.activePackages.length === 0 ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums xl:table-cell">
                          {u.referralCount}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help font-mono text-xs text-muted-foreground">
                                {u.ipAddress ?? "—"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-[220px]">Captured at signup — used for anti-fraud</p>
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {u.fingerprint ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help font-mono text-xs text-muted-foreground">
                                  {u.fingerprint.slice(0, 10)}…
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-[260px] break-all font-mono text-[11px]">
                                  {u.fingerprint}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.isBanned ? (
                            <Badge variant="destructive" className="gap-1">
                              <Ban aria-hidden="true" />
                              Banned
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                              <ShieldCheck aria-hidden="true" />
                              Active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                          {u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}
                        </TableCell>
                        <TableCell className="pr-6">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 gap-1.5"
                              disabled={submitting}
                              aria-label={`Adjust balance for ${u.name}`}
                              onClick={() => {
                                setAdjustTarget(u);
                                setAdjustSession((s) => s + 1);
                                setAdjustOpen(true);
                              }}
                            >
                              <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                              <span className="hidden lg:inline">Adjust Balance</span>
                              <span className="lg:hidden">Adjust</span>
                            </Button>
                            {u.isBanned ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-primary hover:text-primary"
                                disabled={submitting}
                                aria-label={`Unban ${u.name}`}
                                title={`Unban ${u.name}`}
                                onClick={() => setBanTarget(u)}
                              >
                                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-destructive hover:text-destructive"
                                disabled={submitting}
                                aria-label={`Ban ${u.name}`}
                                title={`Ban ${u.name}`}
                                onClick={() => setBanTarget(u)}
                              >
                                <Ban className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </CardContent>

          {/* pagination (server-side — one page of users per request) */}
          {total > 0 ? (
            <div className="flex items-center justify-between gap-2 border-t px-6 py-3">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Page {page} of {totalPages} · {rangeLabel}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || usersQuery.isPending}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || usersQuery.isPending}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </TooltipProvider>

      {/* ban / unban confirmation */}
      <AlertDialog
        open={banTarget !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setBanTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {banTarget?.isBanned ? `Unban ${banTarget?.name ?? "user"}?` : `Ban ${banTarget?.name ?? "user"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {banTarget?.isBanned
                ? "They will be able to sign in and use the platform again."
                : "They will be signed out and blocked from the platform."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                banTarget?.isBanned ? undefined : "bg-destructive text-white hover:bg-destructive/90"
              }
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the mutation settles
                if (banTarget) {
                  userMutation.mutate({
                    kind: banTarget.isBanned ? "unban" : "ban",
                    user: banTarget,
                  });
                }
              }}
            >
              {submitting ? "Working…" : banTarget?.isBanned ? "Unban user" : "Ban user"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AdjustBalanceDialog
        key={`adjust-dialog-${adjustSession}`}
        open={adjustOpen}
        user={adjustTarget}
        onOpenChange={(open) => {
          if (!open) setAdjustOpen(false);
        }}
        onSubmit={handleAdjust}
        submitting={submitting}
      />
    </div>
  );
}
