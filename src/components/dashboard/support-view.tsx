"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Headset, Loader2, MessageSquareText, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  FormField,
  PrimaryButton,
  SectionEnter,
} from "@/components/dashboard/profile-ui";
import { apiFetch } from "@/lib/client-api";
import { formatDate, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { SupportListResponseDTO, SupportTicketDTO, SupportTicketStatus } from "@/lib/types";

/* ================================================================== */
/* Support page — the simple member → admin help channel.              */
/*                                                                    */
/* One subject + message form, one list of the member's OWN requests   */
/* (server-side scoped by the session userId — a member never sees     */
/* another member's tickets), each showing its live status and the     */
/* admin's reply once one arrives. Same toast/error patterns as the    */
/* rest of the member panel; nothing else about the site changes.      */
/* ================================================================== */

const STATUS_STYLES: Record<SupportTicketStatus, string> = {
  open: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  in_progress: "border-primary/30 bg-primary/10 text-primary",
  resolved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  closed: "border-muted bg-muted/60 text-muted-foreground",
};

const STATUS_TEXT: Record<SupportTicketStatus, string> = {
  open: "OPEN",
  in_progress: "IN PROGRESS",
  resolved: "RESOLVED",
  closed: "CLOSED",
};

function SupportStatusBadge({ status }: { status: SupportTicketStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide",
        STATUS_STYLES[status] ?? STATUS_STYLES.closed,
      )}
    >
      {STATUS_TEXT[status] ?? status.toUpperCase()}
    </span>
  );
}

/** One submitted request — subject, message, status and the admin reply. */
function TicketCard({ ticket }: { ticket: SupportTicketDTO }) {
  return (
    <article className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
          {ticket.subject}
        </p>
        <SupportStatusBadge status={ticket.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground" title={formatDate(ticket.createdAt)}>
        {formatDate(ticket.createdAt)} · {timeAgo(ticket.createdAt)}
      </p>

      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
        {ticket.message}
      </p>

      {ticket.reply ? (
        <div className="mt-3.5 rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Headset className="size-3.5" aria-hidden="true" />
            Admin reply
            {ticket.repliedAt ? (
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                · {timeAgo(ticket.repliedAt)}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {ticket.reply}
          </p>
        </div>
      ) : ticket.status === "open" || ticket.status === "in_progress" ? (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          Our team will review your request and reply here.
        </p>
      ) : null}
    </article>
  );
}

export function SupportView() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ subject?: string; message?: string }>({});

  const ticketsQuery = useQuery({
    queryKey: ["support"],
    queryFn: () => apiFetch<SupportListResponseDTO>("/api/support"),
    refetchInterval: 30_000,
  });

  const submit = useMutation({
    mutationFn: (vars: { subject: string; message: string }) =>
      apiFetch<{ ticket: SupportTicketDTO }>("/api/support", { method: "POST", json: vars }),
    onSuccess: () => {
      toast.success("Support request sent");
      setSubject("");
      setMessage("");
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["support"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not send your request.");
    },
  });

  const tickets = ticketsQuery.data?.tickets ?? [];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submit.isPending) return;

    const errors: { subject?: string; message?: string } = {};
    const s = subject.trim();
    const m = message.trim();
    if (s.length < 3 || s.length > 120) errors.subject = "Subject must be 3–120 characters.";
    if (m.length < 5 || m.length > 2000) errors.message = "Message must be 5–2000 characters.";
    setFieldErrors(errors);
    if (errors.subject || errors.message) return;

    submit.mutate({ subject: s, message: m });
  }

  return (
    <div className="space-y-6">
      <SectionEnter>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <Headset className="size-6 text-primary sm:size-7" aria-hidden="true" />
              Support
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Having a problem? Send us a message and we&apos;ll get back to you.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Refresh support requests"
            className="size-10 shrink-0 rounded-xl"
            onClick={() => void ticketsQuery.refetch()}
          >
            <RefreshCw
              className={cn("size-4", ticketsQuery.isFetching && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
        </div>
      </SectionEnter>

      {/* New request */}
      <SectionEnter delay={0.05}>
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label="Send a support request"
          className="space-y-5 rounded-2xl border bg-card p-4 shadow-sm sm:p-6"
        >
          <FormField
            label="Subject"
            htmlFor="support-subject"
            error={fieldErrors.subject}
            hint="A short summary of your issue."
          >
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Withdrawal not received"
              maxLength={120}
              className="h-12 rounded-xl text-base"
              aria-invalid={Boolean(fieldErrors.subject)}
            />
          </FormField>

          <FormField
            label="Message"
            htmlFor="support-message"
            error={fieldErrors.message}
            hint="Describe the problem — include any details that help us resolve it faster."
          >
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what happened…"
              rows={5}
              maxLength={2000}
              className="rounded-xl text-base"
              aria-invalid={Boolean(fieldErrors.message)}
            />
          </FormField>

          <PrimaryButton type="submit" icon={Send} disabled={submit.isPending}>
            {submit.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : (
              "Send Request"
            )}
          </PrimaryButton>
        </form>
      </SectionEnter>

      {/* My requests */}
      <SectionEnter delay={0.1}>
        <section aria-label="My support requests" className="space-y-3">
          <h2 className="text-lg font-bold tracking-tight">My Requests</h2>
          {ticketsQuery.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          ) : ticketsQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load your requests</AlertTitle>
              <AlertDescription className="flex items-center gap-3">
                <span>Check your connection and try again.</span>
                <Button variant="outline" size="sm" onClick={() => void ticketsQuery.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : tickets.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title="No support requests yet"
              description="Requests you send will appear here with their status and our reply."
            />
          ) : (
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <TicketCard key={ticket.id} ticket={ticket} />
              ))}
            </div>
          )}
        </section>
      </SectionEnter>
    </div>
  );
}
