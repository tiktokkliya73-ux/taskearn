"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ReceiptText,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  EmptyState,
  SectionError,
  TableSkeleton,
  TableWrap,
  TxStatusBadge,
  TxTypeBadge,
  flowClass,
} from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { formatPKR, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { TransactionDTO } from "@/lib/types";

interface TransactionsPayload {
  transactions: TransactionDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "task_reward", label: "Task reward" },
  { value: "referral_unlock", label: "Referral unlock" },
  { value: "referral_commission", label: "Referral commission" },
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "plan_purchase", label: "Plan purchase" },
  { value: "package_purchase", label: "Package purchase" },
  { value: "daily_earning", label: "Daily earnings" },
  { value: "promo_reward", label: "Promo reward" },
  { value: "adjustment", label: "Adjustment" },
];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "blocked", label: "Blocked" },
];

export function TransactionsView() {
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  // Debounce the search parameter (same pattern as Users).
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change returns to the first page — render-phase reset (the
  // official React "adjust state when inputs change" pattern, no effect).
  const filterKey = `${query}|${typeFilter}|${statusFilter}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const txnsQuery = useQuery({
    queryKey: ["admin", "transactions", query, typeFilter, statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      params.set("page", String(page));
      return apiFetch<TransactionsPayload>(`/api/admin/transactions?${params.toString()}`);
    },
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const data = txnsQuery.data;
  const transactions = data?.transactions ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const switchingPage = txnsQuery.isPlaceholderData && txnsQuery.isFetching;

  const rangeLabel = useMemo(() => {
    if (total === 0) return "No transactions";
    const from = (page - 1) * (data?.pageSize ?? 25) + 1;
    const to = Math.min(page * (data?.pageSize ?? 25), total);
    return `Showing ${from}–${to} of ${total}`;
  }, [data, page, total]);

  return (
    <div className="space-y-6">
      {/* filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="w-full lg:max-w-xs">
          <Label htmlFor="txn-search" className="sr-only">
            Search transactions by member
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="txn-search"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by member name or email…"
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
        <div className="w-full sm:w-48">
          <Label htmlFor="txn-type" className="sr-only">
            Filter by transaction type
          </Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger id="txn-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <Label htmlFor="txn-status" className="sr-only">
            Filter by transaction status
          </Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="txn-status" className="w-full">
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
          {rangeLabel}
        </p>
      </div>

      {/* ledger table */}
      <Card className="py-0 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">All transactions</CardTitle>
              <CardDescription>
                The complete platform ledger — every reward, commission, deposit and payout.
              </CardDescription>
            </div>
            <ReceiptText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {txnsQuery.isPending ? (
            <TableSkeleton rows={8} columns={6} />
          ) : txnsQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load transactions"
                message={txnsQuery.error.message}
                onRetry={() => void txnsQuery.refetch()}
              />
            </div>
          ) : transactions.length === 0 ? (
            <EmptyState
              icon={query || typeFilter !== "all" || statusFilter !== "all" ? Search : ReceiptText}
              title={
                query || typeFilter !== "all" || statusFilter !== "all"
                  ? "No transactions match these filters"
                  : "No transactions yet"
              }
              description={
                query || typeFilter !== "all" || statusFilter !== "all"
                  ? "Try a different member, type or status."
                  : "Ledger entries will appear here as members earn, deposit and withdraw."
              }
            />
          ) : (
            <TableWrap className="max-h-[70vh] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card">
              <Table className={cn("min-w-[760px]", switchingPage && "opacity-60 transition-opacity")}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Time</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="hidden lg:table-cell">Description</TableHead>
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
                      <TableCell className="max-w-[280px] hidden lg:table-cell">
                        <p className="truncate text-xs text-muted-foreground" title={tx.description}>
                          {tx.description || "—"}
                        </p>
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

        {/* pagination */}
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
                disabled={page <= 1 || txnsQuery.isPending}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || txnsQuery.isPending}
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
