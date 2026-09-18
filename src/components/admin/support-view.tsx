"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Eye,
  Headset,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  SectionError,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { formatDate, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { SupportTicketDTO, SupportTicketStatus } from "@/lib/types";

/* ================================================================== */
/* Admin Support — the admin side of the member help channel.          */
/*                                                                    */
/* One table of incoming requests (member, subject, status, date) and */
/* one details dialog that carries the full message plus the admin    */
/* reply + status controls. Deliberately simple: no complex filters,  */
/* no chat, no realtime — just what the admin needs to read and       */
/* answer each request.                                               */
/* ================================================================== */

interface SupportPayload {
  tickets: SupportTicketDTO[];
}

const STATUS_META: Record<SupportTicketStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  in_progress: { label: "In progress", className: "border-primary/30 bg-primary/10 text-primary" },
  resolved: { label: "Resolved", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  closed: { label: "Closed", className: "border-muted bg-muted/60 text-muted-foreground" },
};

const STATUS_OPTIONS: { value: SupportTicketStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

function SupportStatusBadge({ status }: { status: SupportTicketStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.closed;
  return (
    <Badge variant="outline" className={cn("px-2 py-0.5 text-[10px] font-bold tracking-wide", meta.className)}>
      {meta.label.toUpperCase()}
    </Badge>
  );
}

type TxFilter = "all" | "open" | "resolved";

function FilterChips({
  value,
  onChange,
  counts,
}: {
  value: TxFilter;
  onChange: (value: TxFilter) => void;
  counts: Record<TxFilter, number>;
}) {
  const chips: { key: TxFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "resolved", label: "Resolved" },
  ];
  return (
    <div
      role="group"
      aria-label="Filter support requests by status"
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
            {counts[chip.key]}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The ticket details + reply form — one dialog, one Save. */
function TicketDialog({
  ticket,
  submitting,
  onClose,
  onSave,
}: {
  ticket: SupportTicketDTO | null;
  submitting: boolean;
  onClose: () => void;
  onSave: (payload: { id: string; status: SupportTicketStatus; reply: string }) => void;
}) {
  const [status, setStatus] = useState<SupportTicketStatus>("open");
  const [reply, setReply] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Sync the editable fields whenever a DIFFERENT ticket is opened (never
  // while typing — the state below is the draft the admin is editing). The
  // null branch resets the flag on close so re-opening the SAME ticket after
  // a save re-syncs from the refreshed row, never shows a stale draft.
  if (!ticket && loadedFor !== null) {
    setLoadedFor(null);
  }
  if (ticket && loadedFor !== ticket.id) {
    setLoadedFor(ticket.id);
    setStatus(ticket.status);
    setReply(ticket.reply ?? "");
  }

  if (!ticket) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && !submitting && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-8">Support request</DialogTitle>
          <DialogDescription>
            {ticket.userName ?? "Member"}
            {ticket.userEmail ? ` · ${ticket.userEmail}` : ""} · {formatDate(ticket.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Subject
            </p>
            <p className="mt-1 text-sm font-semibold">{ticket.subject}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Member message
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words rounded-xl border bg-muted/30 p-3.5 text-sm leading-relaxed">
              {ticket.message}
            </p>
            {ticket.repliedAt && ticket.reply ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Last reply sent {timeAgo(ticket.repliedAt)} — editing it below updates the member&apos;s
                ticket.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-reply">Reply to the member</Label>
            <Textarea
              id="support-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              maxLength={2000}
              disabled={submitting}
              placeholder="Write the answer the member will see on their Support page…"
            />
            <p className="text-xs text-muted-foreground">
              {reply.length}/2000 — shown to the member on their ticket.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-status">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as SupportTicketStatus)}
              disabled={submitting}
            >
              <SelectTrigger id="support-status" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="gap-1.5"
            disabled={submitting}
            onClick={() => onSave({ id: ticket.id, status, reply: reply.trim() })}
          >
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Save reply & status
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function SupportView() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TxFilter>("all");
  const [detailsTicket, setDetailsTicket] = useState<SupportTicketDTO | null>(null);

  const ticketsQuery = useQuery({
    queryKey: ["admin", "support"],
    queryFn: () => apiFetch<SupportPayload>("/api/admin/support"),
    refetchInterval: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string; status: SupportTicketStatus; reply: string }) =>
      apiFetch<unknown>("/api/admin/support", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success("Support request updated");
      setDetailsTicket(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "support"] });
      // A reply/status change also marks the message seen → refresh the badge.
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // SEEN = the admin opened this individual message (no reply required).
  // Fired the moment the details dialog opens for an unseen ticket; the
  // first-seen timestamp is recorded server-side and never re-stamped.
  const seenMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<unknown>("/api/admin/support", { method: "POST", json: { id, seen: true } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "support"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
  });

  function openTicket(ticket: SupportTicketDTO) {
    setDetailsTicket(ticket);
    if (!ticket.adminSeenAt) seenMutation.mutate(ticket.id);
  }

  const tickets = ticketsQuery.data?.tickets ?? [];
  const counts: Record<TxFilter, number> = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === "open" || t.status === "in_progress").length,
    resolved: tickets.filter((t) => t.status === "resolved" || t.status === "closed").length,
  };

  const filtered = useMemo(() => {
    if (filter === "open") {
      return tickets.filter((t) => t.status === "open" || t.status === "in_progress");
    }
    if (filter === "resolved") {
      return tickets.filter((t) => t.status === "resolved" || t.status === "closed");
    }
    return tickets;
  }, [tickets, filter]);

  const submitting = updateMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips value={filter} onChange={setFilter} counts={counts} />
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw
            className={cn("size-3.5", ticketsQuery.isFetching && "animate-spin")}
            aria-hidden="true"
          />
          {counts.open > 0
            ? `${counts.open} request${counts.open === 1 ? "" : "s"} awaiting your reply`
            : "No open requests — all caught up"}
        </p>
      </div>

      <Card className="overflow-hidden py-0">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Member support requests</CardTitle>
              <CardDescription>
                Read each request, reply to the member and track its status — the member sees your
                reply on their Support page.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {ticketsQuery.isPending ? (
            <TableSkeleton rows={5} columns={5} />
          ) : ticketsQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load support requests"
                message={ticketsQuery.error.message}
                onRetry={() => void ticketsQuery.refetch()}
              />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={tickets.length === 0 ? Headset : MessageSquareText}
              title={
                tickets.length === 0
                  ? "No support requests yet"
                  : filter === "open"
                    ? "No open requests — all caught up"
                    : "No resolved requests yet"
              }
              description="Messages members send from their Support page will show up here."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[700px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Member</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Received</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell className="pl-6">
                        <div className="max-w-[200px]">
                          <p className="truncate text-sm font-medium">
                            {ticket.userName ?? "Unknown user"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {ticket.userEmail ?? ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[260px]">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                            {!ticket.adminSeenAt ? (
                              <span
                                className="inline-flex size-2 shrink-0 rounded-full bg-primary"
                                aria-hidden="true"
                                title="New — not seen yet"
                              />
                            ) : null}
                            {ticket.subject}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {ticket.message}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <SupportStatusBadge status={ticket.status} />
                          {ticket.reply ? (
                            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                              replied
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell">
                        <span title={formatDate(ticket.createdAt)}>{timeAgo(ticket.createdAt)}</span>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 gap-1.5"
                          disabled={submitting}
                          aria-label={`Open support request from ${ticket.userName ?? "member"}`}
                          onClick={() => openTicket(ticket)}
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      <TicketDialog
        ticket={detailsTicket}
        submitting={submitting}
        onClose={() => setDetailsTicket(null)}
        onSave={(payload) => updateMutation.mutate(payload)}
      />
    </div>
  );
}
