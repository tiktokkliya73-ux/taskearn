"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  SectionError,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { useHashRoute } from "@/lib/hash-router";
import { timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AdminNotificationsPayloadDTO } from "@/lib/types";

const TITLE_MAX = 80;
const MESSAGE_MAX = 500;

interface SendResult {
  ok: true;
}

/**
 * Admin Notifications — compose one broadcast and every member receives it in
 * their existing dashboard notification bell. The audience is all members
 * (the only target the platform supports today), so there is nothing to
 * configure per send: write once → send → done.
 */
export function NotificationsView() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  // Dashboard quick action: #/admin/notifications?create=1 focuses the
  // compose form on arrival. One-time flag, stripped below.
  const { query: navQuery, navigate } = useHashRoute();
  const focusCompose = navQuery.get("create") === "1";

  // Sync-only effect: clears the one-time ?create=1 flag from the URL (an
  // external-system update — allowed inside an effect).
  useEffect(() => {
    if (navQuery.get("create") === "1") {
      navigate("/admin/notifications");
    }
  }, [navQuery, navigate]);

  const historyQuery = useQuery({
    queryKey: ["admin", "notifications", page],
    queryFn: () =>
      apiFetch<AdminNotificationsPayloadDTO>(`/api/admin/notifications?page=${page}`),
    placeholderData: keepPreviousData,
  });

  const data = historyQuery.data;
  const notifications = data?.notifications ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const switchingPage = historyQuery.isPlaceholderData && historyQuery.isFetching;

  const rangeLabel =
    total === 0
      ? "No notifications sent yet"
      : `Showing ${(page - 1) * (data?.pageSize ?? 25) + 1}–${Math.min(
          page * (data?.pageSize ?? 25),
          total,
        )} of ${total}`;

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");

  const valid = title.trim() !== "" && message.trim() !== "" &&
    title.trim().length <= TITLE_MAX && message.trim().length <= MESSAGE_MAX;

  const sendMutation = useMutation({
    mutationFn: () =>
      apiFetch<SendResult>("/api/admin/notifications", {
        method: "POST",
        json: { title: title.trim(), message: message.trim() },
      }),
    onSuccess: () => {
      toast.success("Notification sent to all members");
      setTitle("");
      setMessage("");
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["admin", "notifications"] });
      // Members' bells read from the dashboard cache — refresh-friendly.
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submitting = sendMutation.isPending;

  const submit = () => {
    if (!valid || submitting) return;
    sendMutation.mutate();
  };

  return (
    <div className="space-y-6">
      {/* compose */}
      <Card className="py-0">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Megaphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-base">Send a notification</CardTitle>
              <CardDescription>
                One message → every member&apos;s notification bell. No per-user sending.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="notif-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="notif-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. New package available"
                maxLength={TITLE_MAX}
                // Autofocus only when arriving via the dashboard quick action —
                // a one-time mount behavior (the flag is stripped right after).
                autoFocus={focusCompose}
                disabled={submitting}
                aria-invalid={title.trim() === "" ? undefined : title.trim().length > TITLE_MAX}
              />
              <p className="text-xs text-muted-foreground">
                {title.trim().length}/{TITLE_MAX} characters
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notif-message">
                Message <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="notif-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What should members know?"
                maxLength={MESSAGE_MAX}
                rows={3}
                disabled={submitting}
                aria-invalid={
                  message.trim() === "" ? undefined : message.trim().length > MESSAGE_MAX
                }
              />
              <p className="text-xs text-muted-foreground">
                {message.trim().length}/{MESSAGE_MAX} characters
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || (title === "" && message === "")}
                onClick={() => {
                  setTitle("");
                  setMessage("");
                }}
              >
                Clear
              </Button>
              <Button type="submit" disabled={!valid || submitting}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {submitting ? "Sending…" : "Send to all members"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* history */}
      <Card className="py-0 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Sent notifications</CardTitle>
              <CardDescription>Everything you&apos;ve broadcast, newest first.</CardDescription>
            </div>
            <Bell className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {historyQuery.isPending ? (
            <TableSkeleton rows={5} columns={4} />
          ) : historyQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load notifications"
                message={historyQuery.error.message}
                onRetry={() => void historyQuery.refetch()}
              />
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={Megaphone}
              title="No notifications sent yet"
              description="Your broadcasts will be listed here after you send the first one."
            />
          ) : (
            <TableWrap className="max-h-[55vh] overflow-y-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card">
              <Table className={cn("min-w-[640px]", switchingPage && "opacity-60 transition-opacity")}>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Notification</TableHead>
                    <TableHead className="hidden sm:table-cell">Sent by</TableHead>
                    <TableHead className="pr-6 text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notifications.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="max-w-[420px] pl-6">
                        <p className="truncate text-sm font-medium">{n.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={n.message}>
                          {n.message}
                        </p>
                      </TableCell>
                      <TableCell className="hidden max-w-[180px] sm:table-cell">
                        <p className="truncate text-xs text-muted-foreground">{n.createdBy}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap pr-6 text-right text-xs text-muted-foreground">
                        {timeAgo(n.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          )}

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
                  disabled={page <= 1 || historyQuery.isPending}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || historyQuery.isPending}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
