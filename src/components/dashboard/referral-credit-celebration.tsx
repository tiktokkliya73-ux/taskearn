"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Coins, X } from "lucide-react";
import { useSession } from "@/components/providers";
import { animationEnabled } from "@/lib/animations";
import { apiFetch } from "@/lib/client-api";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ReferralCreditsResponseDTO, TransactionDTO, WalletData } from "@/lib/types";

/* ================================================================== */
/* REFERRAL COMMISSION PRESENTATION — visual only, one time per credit. */
/*                                                                    */
/* The referral/commission/wallet SYSTEM is untouched: it keeps being  */
/* the single source of truth that decides who earns what, when and    */
/* where. This module only makes an ALREADY-CREDITED commission row    */
/* (fetched read-only from /api/wallet/referral-credits) look premium  */
/* the first time the member views their balance area:                 */
/*                                                                    */
/*   • the exact amount comes from the real transaction row            */
/*   • each credit is identified by its existing transaction id        */
/*   • a localStorage presented-set (keyed by member id + tx id) makes */
/*     sure the SAME credit can never animate again after refresh,     */
/*     navigation or re-login — while a genuinely NEW commission       */
/*     still gets its own celebration                                  */
/*   • no money is ever added, removed or recalculated here            */
/* ================================================================== */

/* ------------------------- presented-credit store ------------------------- */

const PRESENTED_KEY = "taskearn.referral-credits.presented";
/** Keep the stored set small — only the newest N transaction ids per member. */
const MAX_TRACKED_IDS = 200;

type PresentedMap = { users: Record<string, string[]> };

/** Module-level cache: survives route changes within the session and acts as
 *  the in-memory fallback when localStorage is blocked (private mode etc.). */
const memoryPresented = new Map<string, Set<string>>();

function presentedSet(userId: string): Set<string> {
  const cached = memoryPresented.get(userId);
  if (cached) return cached;
  const ids = new Set<string>();
  try {
    const raw = localStorage.getItem(PRESENTED_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PresentedMap;
      const list = parsed?.users?.[userId];
      if (Array.isArray(list)) for (const id of list) ids.add(id);
    }
  } catch {
    /* storage blocked or corrupted — start empty (fail-safe) */
  }
  memoryPresented.set(userId, ids);
  return ids;
}

function markPresented(userId: string, txIds: string[]): void {
  if (txIds.length === 0) return;
  const set = presentedSet(userId);
  for (const id of txIds) set.add(id);
  let list = [...set];
  if (list.length > MAX_TRACKED_IDS) list = list.slice(list.length - MAX_TRACKED_IDS);
  try {
    const raw = localStorage.getItem(PRESENTED_KEY);
    const base = raw ? (JSON.parse(raw) as PresentedMap) : { users: {} };
    base.users = base.users && typeof base.users === "object" ? base.users : {};
    base.users[userId] = list;
    localStorage.setItem(PRESENTED_KEY, JSON.stringify(base));
  } catch {
    /* storage blocked — the memory cache still guards this session */
  }
}

/* ------------------------------ data + trigger ----------------------------- */

/** Read-only feed of the member's completed referral commissions.
 *  Near-zero staleTime: every mount of a balance area (Home / Profile)
 *  re-validates the feed so a freshly credited commission is presented the
 *  moment the member opens the area; the interval keeps presenting new
 *  credits live while the member stays on the page. */
export function useReferralCreditsQuery() {
  return useQuery({
    queryKey: ["referral-credits"],
    queryFn: () => apiFetch<ReferralCreditsResponseDTO>("/api/wallet/referral-credits"),
    staleTime: 2_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

/** One batch of REAL new credits being presented, newest first. */
export interface ReferralCreditPresentation {
  credits: TransactionDTO[];
  /** Exact sum of the credited amounts — never recalculated, just summed. */
  gain: number;
  /** Fresh post-credit wallet snapshot (display only). */
  wallet: WalletData;
  /** First credit's transaction id — stable restart key for count-ups. */
  key: string;
}

/** Let the page settle before the earning presentation enters. */
const PRESENT_DELAY_MS = 1_200;
/** Quiet-page polling: a dialog that appears mid-window (the login welcome
 *  popup opens after its own slower settings fetch) resets the wait, so the
 *  earning card never renders underneath another overlay. */
const QUIET_STEP_MS = 600;
const QUIET_STEPS_REQUIRED = 2;
const QUIET_MAX_MS = 20_000;

/**
 * The presentation engine. Mounted inside the member's balance area
 * (Home overview + Profile). A batch becomes "active" only when the feed
 * contains credits that have never been presented to this member — the
 * moment it activates, every credit id in the batch is persisted as
 * presented, so an interrupted animation can never replay either.
 */
export function useReferralCreditPresentation() {
  const { user, refresh, animations } = useSession();
  const { data } = useReferralCreditsQuery();
  const [active, setActive] = useState<ReferralCreditPresentation | null>(null);
  // Admin's Animation & User Experience switch (visual layer only — the
  // commission itself is always credited by the untouched business system).
  const referralAnimEnabled = animationEnabled(animations, "referralCommission");

  const pending = useMemo(() => {
    if (!user || !data) return [] as TransactionDTO[];
    const seen = presentedSet(user.id);
    return data.credits.filter((c) => !seen.has(c.id));
  }, [user, data]);

  useEffect(() => {
    // Presentation disabled by the admin: silently consume the pending
    // credits (mark them presented WITHOUT showing anything) so a later
    // re-enable never replays old commissions — and no presentation
    // timers/effects run at all while OFF.
    if (!referralAnimEnabled) {
      if (user && pending.length > 0) {
        markPresented(user.id, pending.map((c) => c.id));
      }
      return;
    }
    if (active || !user || !data || pending.length === 0) return;
    let cancelled = false;
    let waited = 0;
    let quietSteps = 0;

    const present = () => {
      if (cancelled || pending.length === 0) return;
      // Mark every credit as presented THE MOMENT it is shown — the same
      // real credit must never animate again (refresh / navigation / re-login).
      markPresented(user.id, pending.map((c) => c.id));
      setActive({
        credits: pending,
        gain: pending.reduce((sum, c) => sum + (c.amount > 0 ? c.amount : 0), 0),
        wallet: data.wallet,
        key: pending[0].id,
      });
      // Read-only session refetch so every other balance display (sidebar
      // mini cards, profile header) reflects the fresh number immediately.
      void refresh();
    };

    const tick = () => {
      if (cancelled) return;
      const busy = document.querySelector('[role="dialog"], [data-radix-dialog-overlay]');
      quietSteps = busy ? 0 : quietSteps + 1;
      if (quietSteps >= QUIET_STEPS_REQUIRED || waited >= QUIET_MAX_MS) {
        present();
        return;
      }
      waited += QUIET_STEP_MS;
      window.setTimeout(tick, QUIET_STEP_MS);
    };

    const start = window.setTimeout(tick, PRESENT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [referralAnimEnabled, active, user, data, pending, refresh]);

  const dismiss = useCallback(() => setActive(null), []);

  return { presentation: active, dismiss };
}

/* ------------------------------- count-up ---------------------------------- */

/**
 * Smooth integer count-up (easeOutCubic) — pure presentation. It never
 * alters the value it is given, only how that value is displayed for a
 * moment. Reduced-motion users see the final value instantly.
 */
export function CountUp({
  from,
  to,
  duration = 1500,
  format,
  className,
}: {
  from: number;
  to: number;
  duration?: number;
  format: (value: number) => string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const instant = Boolean(reduceMotion) || from === to;
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (instant) return; // reduced motion / static — the final value renders directly
    let raf = 0;
    let started = 0;
    const tick = (now: number) => {
      if (!started) started = now;
      const p = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, duration, instant]);

  return <span className={className}>{format(instant ? to : value)}</span>;
}

/* ---------------------------- sparkle + confetti --------------------------- */

/** One gentle burst of tiny white dots around the balance digits. */
export function BalanceSparkles({ count = 7 }: { count?: number }) {
  const dots = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (Math.PI * 2 * i) / count + 0.35;
        const dist = 34 + Math.random() * 26;
        const size = 3 + Math.round(Math.random() * 2);
        return { id: i, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.5, size };
      }),
    [count],
  );
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true">
      {dots.map((d) => (
        <motion.span
          key={d.id}
          className="absolute top-1/2 left-1/2 rounded-full bg-white/90 shadow-sm"
          style={{ width: d.size, height: d.size }}
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], x: d.x, y: d.y }}
          transition={{ duration: 0.85, delay: 0.18, ease: "easeOut" }}
        />
      ))}
    </span>
  );
}

/** Restrained confetti palette — emerald, soft gold and white. */
const CONFETTI_COLORS = ["#34d399", "#10b981", "#fbbf24", "#fcd34d", "#ffffff"];

/** A single subtle confetti burst inside the earning-card header. */
function ConfettiBurst() {
  const reduceMotion = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.5;
        const dist = 46 + Math.random() * 42;
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.7 - 22,
          rotate: (Math.random() * 2 - 1) * 200,
          scale: 0.6 + Math.random() * 0.6,
          delay: Math.random() * 0.12,
          round: i % 3 === 0,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        };
      }),
    [],
  );
  if (reduceMotion) return null;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-6 left-6 sm:top-7 sm:left-7"
          style={{ backgroundColor: p.color }}
          initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 1, 0], x: p.x, y: p.y, rotate: p.rotate, scale: p.scale }}
          transition={{ duration: 1.35, delay: 0.12 + p.delay, ease: "easeOut", times: [0, 0.15, 0.7, 1] }}
        >
          {p.round ? (
            <span className="block size-1.5 rounded-full" />
          ) : (
            <span className="block h-2 w-1 rounded-[1px]" />
          )}
        </motion.span>
      ))}
    </div>
  );
}

/* ------------------------------ the earning card --------------------------- */

/** The card auto-completes itself so the presentation always "finishes". */
const AUTO_DISMISS_MS = 14_000;

function ReferralCreditEarnCard({
  presentation,
  onDismiss,
}: {
  presentation: ReferralCreditPresentation;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { credits, gain, wallet, key: restartKey } = presentation;
  const multiple = credits.length > 1;
  const withdrawableFrom = Math.max(0, wallet.withdrawableBalance - gain);

  useEffect(() => {
    // Gentle auto-dismiss so the presentation "completes" on its own. The
    // countdown pauses while another overlay (welcome popup / promo banner)
    // covers the page — the member still gets the full presentation after
    // closing it. (Manual X works any time; the credit ids were already
    // marked presented when the card was shown, so dismissing never affects
    // the one-time guarantee.)
    let remaining = AUTO_DISMISS_MS;
    const id = window.setInterval(() => {
      if (document.querySelector('[role="dialog"], [data-radix-dialog-overlay]')) return;
      remaining -= 1000;
      if (remaining <= 0) {
        window.clearInterval(id);
        onDismiss();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [onDismiss, restartKey]);

  return (
    <motion.section
      key="referral-credit-earn"
      role="status"
      aria-live="polite"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 18, scale: reduceMotion ? 1 : 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : -10, scale: reduceMotion ? 1 : 0.98 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-card shadow-xl shadow-emerald-600/10"
    >
      {/* Screen-reader summary — the counting digits themselves stay silent. */}
      <p className="sr-only">
        {multiple
          ? `${credits.length} new referral commissions received, total ${formatPKR(gain, { sign: true })}.`
          : `Referral commission received, ${formatPKR(gain, { sign: true })}.`}{" "}
        New withdrawable balance {formatPKR(wallet.withdrawableBalance)}.
      </p>

      {/* Header — emerald wash, coin badge, the REAL credited amount */}
      <div className="relative bg-gradient-to-br from-emerald-500/[0.12] via-emerald-500/[0.04] to-transparent px-4 pt-4 pb-4 sm:px-6 sm:pt-5">
        <ConfettiBurst />
        <div className="flex items-start gap-3.5 sm:gap-4">
          <motion.span
            aria-hidden="true"
            className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/30 sm:size-14"
            initial={reduceMotion ? undefined : { scale: 0.7, opacity: 0 }}
            animate={reduceMotion ? undefined : { scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <motion.span
              className="flex items-center justify-center"
              animate={reduceMotion ? undefined : { scale: [1, 1.07, 1] }}
              transition={{ duration: 1.8, repeat: 1, delay: 0.5, ease: "easeInOut" }}
            >
              <Coins className="size-6 sm:size-7" aria-hidden="true" />
            </motion.span>
          </motion.span>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-emerald-600 uppercase dark:text-emerald-400">
              {multiple ? "Referral commissions received" : "Referral commission received"}
            </p>
            <p
              className="mt-1 text-3xl font-extrabold tracking-tight text-emerald-600 tabular-nums sm:text-4xl dark:text-emerald-400"
              aria-hidden="true"
            >
              <CountUp
                key={`gain-${restartKey}`}
                from={0}
                to={gain}
                duration={1300}
                format={(n) => formatPKR(n, { sign: true })}
              />
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {multiple
                ? `${credits.length} new commissions · added to your Withdrawable Balance`
                : "Added to your Withdrawable Balance"}
            </p>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss earning notification"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Balance transition — old value → smoothly counting new value */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-emerald-500/20 px-4 py-3.5 sm:px-6">
        <span className="text-xs font-medium text-muted-foreground">Withdrawable balance</span>
        <span className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground/80 line-through decoration-muted-foreground/30">
            {formatPKR(withdrawableFrom)}
          </span>
          <ArrowRight className="size-3.5 text-emerald-500" aria-hidden="true" />
          <span
            className="text-lg font-bold text-emerald-600 tabular-nums dark:text-emerald-400"
            aria-hidden="true"
          >
            <CountUp
              key={`bal-${restartKey}`}
              from={withdrawableFrom}
              to={wallet.withdrawableBalance}
              duration={1500}
              format={(n) => formatPKR(n)}
            />
          </span>
        </span>
      </div>

      {/* Per-credit detail — each row is the REAL transaction data */}
      {multiple ? (
        <ul
          className="max-h-44 space-y-2.5 overflow-y-auto border-t border-emerald-500/20 px-4 py-3.5 sm:px-6"
          aria-label="Commission details"
        >
          {credits.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-xs leading-relaxed text-muted-foreground">{c.description}</span>
              <span className="shrink-0 text-xs font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                {formatPKR(c.amount, { sign: true })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-emerald-500/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground sm:px-6">
          {credits[0].description}
        </p>
      )}
    </motion.section>
  );
}

/** AnimatePresence wrapper — mount wherever the balance area lives. */
export function ReferralCreditCelebration({
  presentation,
  onDismiss,
  className,
}: {
  presentation: ReferralCreditPresentation | null;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      <AnimatePresence>
        {presentation ? (
          <ReferralCreditEarnCard key={presentation.key} presentation={presentation} onDismiss={onDismiss} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
