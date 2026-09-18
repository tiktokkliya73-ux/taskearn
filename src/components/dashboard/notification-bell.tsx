"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  CheckCircle2,
  Clock3,
  Info,
  Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { apiFetch } from "@/lib/client-api";
import { formatPKR, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DashboardDTO, NotificationDTO, TransactionDTO } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Notification model — admin broadcasts (top) + the member's recent   */
/* transactions (below), so no second member-facing endpoint is        */
/* required (strictly additive upgrade).                               */
/* ------------------------------------------------------------------ */

type Tone = "broadcast" | "pending" | "credit" | "info";

interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: Tone;
}

const TONE_META: Record<Tone, { icon: typeof Clock3; className: string }> = {
  broadcast: { icon: Megaphone, className: "text-primary" },
  pending: { icon: Clock3, className: "text-amber-600 dark:text-amber-400" },
  credit: { icon: CheckCircle2, className: "text-primary" },
  info: { icon: Info, className: "text-muted-foreground" },
};

function toNotification(tx: TransactionDTO): NotificationItem | null {
  const money = formatPKR(Math.abs(tx.amount));
  switch (tx.type) {
    case "withdrawal":
      return tx.status === "pending"
        ? { id: tx.id, title: "Withdrawal pending approval", detail: `${money} requested — reviewing now.`, at: tx.createdAt, tone: "pending" }
        : { id: tx.id, title: tx.status === "rejected" ? "Withdrawal rejected" : "Withdrawal approved", detail: `${money} ${tx.status === "rejected" ? "was returned to your balance." : "is on its way to your account."}`, at: tx.createdAt, tone: tx.status === "rejected" ? "info" : "credit" };
    case "deposit":
      return tx.status === "pending"
        ? { id: tx.id, title: "Deposit pending approval", detail: `${money} submitted for review.`, at: tx.createdAt, tone: "pending" }
        : { id: tx.id, title: "Deposit approved", detail: `${money} added to your balance.`, at: tx.createdAt, tone: "credit" };
    case "daily_earning":
      return { id: tx.id, title: "Daily package earnings credited", detail: `${money} from your active packages.`, at: tx.createdAt, tone: "credit" };
    case "task_reward":
      return { id: tx.id, title: "Task reward received", detail: `${money} for completing a daily task.`, at: tx.createdAt, tone: "credit" };
    case "referral_unlock":
      return { id: tx.id, title: "Referral unlock", detail: `${money} unlocked from a referral activation.`, at: tx.createdAt, tone: "credit" };
    case "referral_commission":
      return { id: tx.id, title: "Referral commission received", detail: `${money} from a referral's package activation — withdrawable.`, at: tx.createdAt, tone: "credit" };
    case "package_purchase":
      return { id: tx.id, title: "Package activated", detail: `${money} invested — daily income started.`, at: tx.createdAt, tone: "info" };
    case "plan_purchase":
      return { id: tx.id, title: "VIP plan activated", detail: `${money} — daily tasks unlocked.`, at: tx.createdAt, tone: "info" };
    case "promo_reward":
      return { id: tx.id, title: "Promo reward credited", detail: `${money} added to your withdrawable balance.`, at: tx.createdAt, tone: "credit" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */

function broadcastToNotification(n: NotificationDTO): NotificationItem {
  return {
    id: n.id,
    title: n.title,
    detail: n.message,
    at: n.createdAt,
    tone: "broadcast",
  };
}

export function NotificationBell() {
  // Shares the ["dashboard"] cache with the Home view — no extra polling
  // of its own; refreshes with the global staleTime / window focus.
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardDTO>("/api/dashboard"),
    staleTime: 15_000,
  });

  // Admin broadcasts first, then the newest transaction-derived items.
  const notifications = [
    ...(data?.notifications ?? []).map(broadcastToNotification),
    ...(data?.recentTransactions ?? [])
      .map(toNotification)
      .filter((n): n is NotificationItem => n !== null),
  ].slice(0, 8);
  const pendingCount = notifications.filter((n) => n.tone === "pending").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${pendingCount > 0 ? ` — ${pendingCount} pending` : ""}`}
          className="relative"
        >
          <Bell className="size-5" aria-hidden="true" />
          {pendingCount > 0 ? (
            <span
              className="absolute top-1.5 right-1.5 flex size-2 items-center justify-center"
              aria-hidden="true"
            >
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {pendingCount > 0 ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {pendingCount} pending
            </span>
          ) : null}
        </div>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <BellOff className="size-7 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
          </div>
        ) : (
          <ul
            className="max-h-80 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
            aria-label="Recent notifications"
          >
            {notifications.map((n) => {
              const meta = TONE_META[n.tone];
              const Icon = meta.icon;
              return (
                <li key={n.id} className="flex gap-3 border-b px-4 py-3 last:border-b-0">
                  <Icon className={cn("mt-0.5 size-4.5 shrink-0", meta.className)} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.detail}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground/70">{timeAgo(n.at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
