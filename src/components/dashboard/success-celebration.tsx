"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/dashboard/referral-credit-celebration";
import { formatPKR } from "@/lib/money";

/* ================================================================== */
/* PREMIUM SUCCESS PRESENTATION — visual layer only.                    */
/*                                                                    */
/* Every value shown here comes from the EXISTING successful response  */
/* (real plan name, real daily earning, real credited amount). This    */
/* module never calls an API, never mutates state elsewhere and never  */
/* decides what "success" means — the caller only invokes it from an   */
/* EXISTING mutation's confirmed onSuccess handler.                    */
/*                                                                    */
/*   • SuccessCelebration  — elegant centered card over a soft dim     */
/*     backdrop: animated stroke-drawn checkmark, gentle glow ring,    */
/*     one restrained confetti burst, smooth scale-in, count-up        */
/*     metric, auto-completes itself (7s) so it can never block the UI */
/*   • SuccessCheckmark    — the animated check, reusable in place     */
/*     (e.g. inside an already-open dialog result panel)              */
/*   • SuccessConfetti     — the subtle burst, reusable in place       */
/*                                                                    */
/* Reduced-motion users get the same information instantly, without   */
/* confetti or counting. Decorative layers never intercept pointers.  */
/* ================================================================== */

/** What to celebrate — filled exclusively with REAL response values. */
export interface SuccessCelebrationData {
  /** Stable restart key — an existing id from the successful response. */
  key: string;
  /** Small caps label, e.g. "Plan Activated". */
  heading: string;
  /** The headline — e.g. the REAL package/plan name. */
  title: string;
  /** Optional: render the title as an animated count-up of a REAL amount. */
  titleCountUpTo?: number;
  /** Optional metric row, e.g. Daily earning (REAL value, count-up display). */
  metric?: {
    label: string;
    value: number;
    suffix?: string;
  };
  /** Optional muted footnote. */
  note?: string;
}

/* ----------------------------- the checkmark ------------------------------- */

/** Animated stroke-drawn check in an emerald disc with a one-shot glow ring. */
export function SuccessCheckmark({ size = 76 }: { size?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <span className="relative inline-flex items-center justify-center">
      {/* one-shot soft glow ring */}
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-emerald-500/25"
        initial={reduceMotion ? undefined : { scale: 0.85, opacity: 0.9 }}
        animate={reduceMotion ? undefined : { scale: 1.4, opacity: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <motion.span
        aria-hidden="true"
        className="flex items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 ring-2 ring-emerald-400/30"
        style={{ width: size, height: size }}
        initial={reduceMotion ? undefined : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={
          reduceMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 280, damping: 18, delay: 0.05 }
        }
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          width={Math.round(size * 0.46)}
          height={Math.round(size * 0.46)}
        >
          <motion.path
            d="M5 12.5l4.2 4.2L19 7.5"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduceMotion ? undefined : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={
              reduceMotion
                ? { duration: 0.01 }
                : { duration: 0.45, delay: 0.22, ease: "easeOut" }
            }
          />
        </svg>
      </motion.span>
    </span>
  );
}

/* ------------------------------- confetti ---------------------------------- */

/** Restrained confetti palette — emerald, soft gold and white. */
const CONFETTI_COLORS = ["#34d399", "#10b981", "#fbbf24", "#fcd34d", "#ffffff"];

/** A single subtle confetti burst around the top of its container. */
export function SuccessConfetti({ pieces = 14 }: { pieces?: number }) {
  const reduceMotion = useReducedMotion();
  const confetti = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.5;
        const dist = 52 + Math.random() * 46;
        return {
          id: i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.62 - 26,
          rotate: (Math.random() * 2 - 1) * 200,
          scale: 0.6 + Math.random() * 0.55,
          delay: Math.random() * 0.14,
          round: i % 3 === 0,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        };
      }),
    [pieces],
  );
  if (reduceMotion) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-6" aria-hidden="true">
      {confetti.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-0"
          style={{ backgroundColor: p.color }}
          initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 1, 0], x: p.x, y: p.y, rotate: p.rotate, scale: p.scale }}
          transition={{
            duration: 1.3,
            delay: 0.18 + p.delay,
            ease: "easeOut",
            times: [0, 0.15, 0.7, 1],
          }}
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

/* --------------------------- the overlay itself ---------------------------- */

/** The card auto-completes itself so the presentation always finishes. */
const AUTO_COMPLETE_MS = 7_000;

/**
 * The premium success moment. Render with `data` derived ONLY from a
 * confirmed, existing SUCCESS response; render with `null` for nothing.
 * It never blocks the app longer than AUTO_COMPLETE_MS and never appears
 * for pending / failed actions — that decision stays with the caller.
 */
export function SuccessCelebration({
  data,
  onComplete,
}: {
  data: SuccessCelebrationData | null;
  onComplete: () => void;
}) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!data) return;
    const id = window.setTimeout(onComplete, AUTO_COMPLETE_MS);
    return () => window.clearTimeout(id);
  }, [data, onComplete]);

  return (
    <AnimatePresence>
      {data ? (
        <div key={data.key} className="fixed inset-0 z-[70]" role="presentation">
          {/* Screen-reader summary — the animated digits stay silent. */}
          <p className="sr-only" role="status" aria-live="polite">
            {`${data.heading}. ${data.title}${
              data.metric ? `. ${data.metric.label} ${formatPKR(data.metric.value)}${data.metric.suffix ?? ""}` : ""
            }.`}
          </p>

          {/* Soft dim + very light blur; tap anywhere to continue. */}
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.25, ease: "easeOut" }}
            onClick={onComplete}
            aria-hidden="true"
          />

          {/* Centered elegant card — scale + fade + gentle rise. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <motion.section
              className="pointer-events-auto relative w-[min(92vw,24rem)] overflow-hidden rounded-[1.5rem] border border-emerald-500/40 bg-card px-5 py-7 text-center shadow-2xl shadow-emerald-600/10 sm:px-7"
              initial={{ opacity: 0, scale: 0.94, y: reduceMotion ? 0 : 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: reduceMotion ? 0 : 10 }}
              transition={
                reduceMotion
                  ? { duration: 0.15, ease: "easeOut" }
                  : { duration: 0.42, ease: [0.16, 1, 0.3, 1] }
              }
            >
              <SuccessConfetti />

              <SuccessCheckmark />

              <p className="mt-4 text-[11px] font-semibold tracking-[0.18em] text-emerald-600 uppercase dark:text-emerald-400">
                {data.heading}
              </p>

              <p className="mt-1.5 text-2xl font-extrabold tracking-tight break-words" aria-hidden="true">
                {data.titleCountUpTo != null ? (
                  <CountUp
                    key={`title-${data.key}`}
                    from={0}
                    to={data.titleCountUpTo}
                    duration={1100}
                    format={(n) => formatPKR(n)}
                  />
                ) : (
                  data.title
                )}
              </p>

              {data.metric ? (
                <div className="mx-auto mt-5 flex max-w-[19rem] items-center justify-between gap-3 rounded-xl border bg-primary/[0.05] px-4 py-3 text-left">
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    {data.metric.label}
                  </span>
                  <span
                    className="text-lg font-extrabold text-primary tabular-nums"
                    aria-hidden="true"
                  >
                    <CountUp
                      key={`metric-${data.key}`}
                      from={0}
                      to={data.metric.value}
                      duration={1200}
                      format={(n) => formatPKR(n)}
                    />
                    {data.metric.suffix ?? null}
                  </span>
                </div>
              ) : null}

              {data.note ? (
                <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">{data.note}</p>
              ) : null}

              <Button
                type="button"
                className="mt-6 h-12 w-full rounded-xl bg-gradient-to-b from-emerald-500 to-green-600 text-[15px] font-bold text-white shadow-lg shadow-emerald-600/25 transition-all hover:from-emerald-400 hover:to-green-500 hover:shadow-xl hover:shadow-emerald-600/30 active:translate-y-0 active:scale-[0.98]"
                onClick={onComplete}
              >
                Continue
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </motion.section>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
