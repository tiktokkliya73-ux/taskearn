"use client";

import { useQuery } from "@tanstack/react-query";
import { Banknote } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { formatPKR, timeAgo } from "@/lib/money";
import type { PayoutDTO } from "@/lib/types";

/**
 * Emerald "LIVE PAYOUTS" marquee strip. Content is duplicated and translated
 * -50% in a loop (CSS keyframes injected below); hovering pauses the track.
 */
export function PayoutsTicker() {
  const { data } = useQuery({
    queryKey: ["public", "payouts"],
    queryFn: () => apiFetch<{ payouts: PayoutDTO[] }>("/api/public/payouts"),
    refetchInterval: 30_000,
  });

  const payouts = data?.payouts ?? [];

  if (data && payouts.length === 0) return null;

  return (
    <div
      className="w-full bg-emerald-700 text-emerald-50 dark:bg-primary dark:text-primary-foreground"
      role="marquee"
      aria-label="Recent payouts"
    >
      <style>{`@keyframes te-marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}`}</style>
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary-foreground/15 px-2.5 py-1 text-[11px] font-semibold tracking-wider uppercase">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary-foreground" />
          </span>
          <span className="hidden sm:inline">Live payouts</span>
          <span className="sm:hidden">Live</span>
        </span>

        {payouts.length === 0 ? (
          <div className="flex w-full items-center gap-8 overflow-hidden">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-4 w-40 shrink-0 animate-pulse rounded-full bg-primary-foreground/20" />
            ))}
          </div>
        ) : (
          <div className="group relative flex-1 overflow-hidden">
            <div
              className="flex w-max [animation:te-marquee_36s_linear_infinite] group-hover:[animation-play-state:paused] motion-reduce:animate-none"
              aria-hidden={false}
            >
              {[...payouts, ...payouts].map((p, i) => (
                <span key={`${p.id}-${i}`} className="flex items-center gap-2 pr-10 text-sm whitespace-nowrap">
                  <Banknote className="size-4 shrink-0 opacity-90" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold">{p.name}</strong> withdrew{" "}
                    <strong className="font-semibold tabular-nums">{formatPKR(p.amount)}</strong> · {p.method} ·{" "}
                    {timeAgo(p.at)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
