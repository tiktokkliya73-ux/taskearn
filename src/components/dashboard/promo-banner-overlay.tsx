"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { cn } from "@/lib/utils";
import type { PromoBannerDTO } from "@/lib/types";

/* ================================================================== */
/* PROMOTIONAL BANNER OVERLAY — the premium member-side experience.     */
/*                                                                    */
/* Active admin-managed banners (GET /api/home/promo-banners) enter as */
/* a premium promotional card over the live page:                       */
/*                                                                    */
/*   page stays visible → backdrop subtly dims (+ very light blur) →   */
/*   card scales + fades + rises into place and settles smoothly →     */
/*   the promotional image is the clear visual focus, CTA beneath →    */
/*   member interacts with it or closes it.                            */
/*                                                                    */
/* Multiple banners become a focused carousel: one banner at a time,  */
/* swipe gestures on touch, chevrons on tablet/desktop, subtle dots,  */
/* a comfortable auto-slide interval that pauses while the member     */
/* interacts. Mobile-first: no horizontal overflow, safe-area aware,  */
/* GPU-only transform/opacity animations, reduced-motion respected.   */
/* ================================================================== */

/* ----------------------------- presentation ----------------------------- */

/** Comfortable auto-slide interval (only with 2+ banners). */
const AUTO_ADVANCE_MS = 6_000;
/** Auto-slide stays paused this long after a manual swipe/dot/chevron. */
const MANUAL_PAUSE_MS = 8_000;

/** One banner image that fades in as soon as it decodes. */
function BannerImage({ banner }: { banner: PromoBannerDTO }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={banner.imageUrl}
      alt={banner.title || "Promotional offer"}
      onLoad={() => setLoaded(true)}
      // object-contain: square, landscape and portrait art all fit cleanly —
      // never cropped, never distorted (same rule as the welcome popup).
      className={cn(
        "max-h-[62dvh] w-auto max-w-full select-none object-contain transition-opacity duration-300",
        loaded ? "opacity-100" : "opacity-0",
      )}
      draggable={false}
    />
  );
}

/**
 * The premium promotional overlay itself — a centered rounded card over a
 * subtly dimmed, lightly blurred backdrop. Fully controlled (`open` +
 * `onOpenChange`) so the admin Preview uses the exact same component the
 * member sees (`preview` only disables CTA navigation).
 */
export function PromoBannerOverlayDialog({
  open,
  onOpenChange,
  banners,
  preview = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banners: PromoBannerDTO[];
  /** Admin preview mode: the CTA explains itself instead of navigating. */
  preview?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const resumeAtRef = useRef(0);
  const [interacting, setInteracting] = useState(false);

  // Classic [index, direction] pair so slides know which way to travel.
  const [[index, direction], setSlide] = useState<[number, number]>([0, 0]);
  const count = banners.length;
  // Derived guard: if the banner list changes while open, the effective
  // index stays valid without any state-writing effect.
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const current = count > 0 ? banners[safeIndex] : null;

  const goTo = useCallback(
    (next: number, dir: number) => {
      if (count === 0) return;
      const wrapped = (next + count) % count;
      setSlide(([i]) => (wrapped === i ? [i, 0] : [wrapped, dir]));
      resumeAtRef.current = Date.now() + MANUAL_PAUSE_MS;
    },
    [count],
  );
  const next = useCallback(() => goTo(index + 1, 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1, -1), [goTo, index]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  /* ----- a11y: Esc to close, focus the card, trap Tab, restore focus,
           lock background scrolling while open ----- */
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the close button so keyboard users land inside the card.
    const focusTimer = setTimeout(() => closeRef.current?.focus(), 80);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, close]);

  /* ----- auto-slide: comfortable interval, paused while the member
           interacts (drag / hover / after manual navigation) and while
           the tab is hidden ----- */
  useEffect(() => {
    if (!open || count < 2) return;
    const id = window.setInterval(() => {
      if (interacting) return;
      if (Date.now() < resumeAtRef.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      setSlide(([i]) => [(i + 1) % count, 1]);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [open, count, interacting]);

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const swipeLeft = info.offset.x < -60 || info.velocity.x < -400;
    const swipeRight = info.offset.x > 60 || info.velocity.x > 400;
    if (swipeLeft) next();
    else if (swipeRight) prev();
  }

  function runCta(link: string) {
    if (preview) {
      toast.info(
        link
          ? "Preview — members will follow the configured link from this button."
          : "Preview — this is exactly how members see the promotional banner.",
      );
      return;
    }
    close();
    if (!link) return;
    if (/^https?:\/\//i.test(link)) {
      window.open(link, "_blank", "noopener,noreferrer");
    } else if (link.startsWith("/") && !link.startsWith("//")) {
      navigateTo(link);
    }
  }

  if (count === 0 || !current) return null;

  const multiple = count > 1;
  const hasTitle = Boolean(current.title.trim());
  const hasCta = Boolean(current.ctaText.trim());
  const ctaLink = current.ctaLink.trim();
  const hasFooter = hasTitle || hasCta || multiple;

  // Expo-out: smooth, deliberate settle without bouncing.
  const cardTransition = reduceMotion
    ? { duration: 0.15, ease: "easeOut" as const }
    : { duration: 0.42, ease: [0.16, 1, 0.3, 1] as const };
  const slideVariants = {
    enter: (dir: number) => ({ x: reduceMotion ? 0 : dir * 44, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: reduceMotion ? 0 : -dir * 44, opacity: 0 }),
  };

  return (
    <AnimatePresence>
      {open ? (
        <div key="promo-banner-overlay" className="fixed inset-0 z-[60]" role="presentation">
          {/* Backdrop — the page stays visible behind a subtle dim + very
              light blur, so the promotional card stays clearly dominant. */}
          <motion.div
            key="promo-backdrop"
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.25, ease: "easeOut" }}
            onClick={close}
            aria-hidden="true"
          />

          {/* Centered card — scale + fade + gentle upward rise. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              key="promo-card"
              ref={cardRef}
              role="dialog"
              aria-modal="true"
              aria-label={current.title.trim() || "Promotional offer"}
              initial={{ opacity: 0, scale: 0.92, y: reduceMotion ? 0 : 28 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: reduceMotion ? 0 : 12 }}
              transition={cardTransition}
              className={cn(
                "pointer-events-auto relative flex w-[min(92vw,26rem)] max-h-[86dvh] flex-col overflow-hidden",
                "rounded-[1.75rem] bg-card shadow-2xl ring-1 ring-black/10 dark:ring-white/10",
              )}
              onPointerDown={() => setInteracting(true)}
              onPointerUp={() => setInteracting(false)}
              onPointerLeave={() => setInteracting(false)}
              onMouseEnter={() => setInteracting(true)}
              onMouseLeave={() => setInteracting(false)}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Promotional image — the main visual focus. Swipeable. */}
              <div className="relative flex min-h-0 items-center justify-center overflow-hidden bg-muted/60">
                <AnimatePresence initial={false} custom={direction} mode="popLayout">
                  <motion.div
                    key={current.id}
                    custom={direction}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: reduceMotion ? 0.12 : 0.3, ease: "easeOut" }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.2}
                    onDragStart={() => setInteracting(true)}
                    onDragEnd={handleDragEnd}
                    className="flex min-h-0 w-full cursor-grab items-center justify-center active:cursor-grabbing"
                  >
                    <BannerImage banner={current} />
                  </motion.div>
                </AnimatePresence>

                {/* Position pill (multiple banners) */}
                {multiple ? (
                  <span
                    className={cn(
                      "absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold",
                      "tabular-nums text-white shadow-sm backdrop-blur-sm",
                    )}
                  >
                    {safeIndex + 1} / {count}
                  </span>
                ) : null}

                {/* Chevron controls — tablet / desktop (mobile swipes) */}
                {multiple ? (
                  <>
                    <button
                      type="button"
                      aria-label="Previous banner"
                      onClick={prev}
                      className={cn(
                        "absolute left-2 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full",
                        "bg-black/50 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:flex",
                      )}
                    >
                      <ChevronLeft className="size-5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next banner"
                      onClick={next}
                      className={cn(
                        "absolute right-2 top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full",
                        "bg-black/50 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/70",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:flex",
                      )}
                    >
                      <ChevronRight className="size-5" aria-hidden="true" />
                    </button>
                  </>
                ) : null}

                {/* Clear Close/X — always visible over any artwork (44px target) */}
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Close promotional banner"
                  onClick={close}
                  className={cn(
                    "absolute top-3 right-3 z-10 flex size-11 items-center justify-center rounded-full",
                    "bg-black/60 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/80",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                  )}
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>

              {/* CTA area — image first, prominent action beneath. */}
              {hasFooter ? (
                <div
                  className={cn(
                    "flex flex-col items-center gap-3 border-t px-5 py-4 text-center sm:px-6 sm:py-5",
                    !hasTitle && !hasCta && "border-t-0 pt-2",
                  )}
                >
                  {hasTitle ? (
                    <p className="text-lg font-bold leading-tight tracking-tight">{current.title.trim()}</p>
                  ) : null}
                  {hasCta ? (
                    <Button
                      type="button"
                      className={cn(
                        "h-12 w-full rounded-xl text-sm font-semibold sm:text-base",
                        "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25",
                        "transition-transform hover:from-emerald-500 hover:to-emerald-600 active:scale-[0.98]",
                      )}
                      onClick={() => runCta(ctaLink)}
                    >
                      <ArrowUpRight className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{current.ctaText.trim()}</span>
                    </Button>
                  ) : null}
                  {multiple ? (
                    <div className="flex items-center justify-center gap-1.5 pt-0.5" role="tablist" aria-label="Banners">
                      {banners.map((b, i) => (
                        <button
                          key={b.id}
                          type="button"
                          role="tab"
                          aria-selected={i === safeIndex}
                          aria-label={`Show banner ${i + 1} of ${count}`}
                          onClick={() => goTo(i, i > index ? 1 : -1)}
                          className={cn(
                            "h-2 rounded-full transition-all",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                            i === safeIndex
                              ? "w-4 bg-primary"
                              : "w-2 bg-muted-foreground/40 hover:bg-muted-foreground/70",
                          )}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </motion.div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------ auto-open ------------------------------ */

const SHOWN_SESSION_KEY = "taskearn.promo-banners.shown-session";
/** Let the Home content settle before the promotional card enters. */
const SHOW_DELAY_MS = 500;
const DIALOG_WAIT_STEP_MS = 350;
const DIALOG_WAIT_MAX_MS = 20_000;

/** Once per browser session (sessionStorage guard; fail-safe when blocked). */
function shouldShowThisSession(): boolean {
  try {
    return sessionStorage.getItem(SHOWN_SESSION_KEY) !== "1";
  } catch {
    return false;
  }
}

function markShownThisSession(): void {
  try {
    sessionStorage.setItem(SHOWN_SESSION_KEY, "1");
  } catch {
    /* storage blocked — nothing to guard */
  }
}

/**
 * Wait until no other dialog is open (e.g. the login welcome popup), then
 * run the callback — so the two overlays never stack. Cancels cleanly.
 */
function waitForQuietPage(cb: () => void): () => void {
  let cancelled = false;
  let waited = 0;
  const tick = () => {
    if (cancelled) return;
    const busy = document.querySelector('[role="dialog"], [data-radix-dialog-overlay]');
    if (!busy || waited >= DIALOG_WAIT_MAX_MS) {
      if (!cancelled) cb();
      return;
    }
    waited += DIALOG_WAIT_STEP_MS;
    window.setTimeout(tick, DIALOG_WAIT_STEP_MS);
  };
  const starter = window.setTimeout(tick, SHOW_DELAY_MS);
  return () => {
    cancelled = true;
    window.clearTimeout(starter);
  };
}

/**
 * Mounted on the member Home screen next to the Login Welcome Popup.
 * Fetches the ACTIVE admin-managed banners and auto-opens the premium
 * overlay once per session — after the page settles and any other popup
 * (welcome popup) is gone. Renders nothing when no active banners exist.
 */
export function PromoBannerOverlay() {
  const [open, setOpen] = useState(false);

  const { data } = usePromoBannersQuery();
  const banners = data?.banners ?? [];
  const hasBanners = banners.length > 0;

  // Auto-open once per browser session. Deliberately idempotent — no
  // one-shot ref: setOpen(true) is harmless on re-runs, React cleans up
  // the waiter when the effect deps change or the Home screen unmounts
  // (login navigation briefly bounces the route), and a remounted Home
  // screen simply re-evaluates the session guard below.
  useEffect(() => {
    if (!hasBanners) return;
    if (!shouldShowThisSession()) return;
    return waitForQuietPage(() => setOpen(true));
  }, [hasBanners]);

  // The once-per-session guard is stamped only when the overlay truly
  // RENDERS for the member — never when a waiter merely fires on an
  // instance that may unmount before displaying anything.
  useEffect(() => {
    if (open) markShownThisSession();
  }, [open]);

  if (!hasBanners) return null;

  return <PromoBannerOverlayDialog open={open} onOpenChange={setOpen} banners={banners} />;
}

/** Shared query for the ACTIVE member-facing banners (cached 30s). */
export function usePromoBannersQuery() {
  return useQuery({
    queryKey: ["promo-banners"],
    queryFn: () => apiFetch<{ banners: PromoBannerDTO[] }>("/api/home/promo-banners"),
    staleTime: 30_000,
    retry: 1,
  });
}
