"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Gift,
  Loader2,
  Package as PackageIcon,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  Timer,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CountUp } from "@/components/dashboard/referral-credit-celebration";
import { SuccessCheckmark } from "@/components/dashboard/success-celebration";
import { useSession } from "@/components/providers";
import { animationEnabled } from "@/lib/animations";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { formatPKR } from "@/lib/money";
import type {
  PackageTaskCardDTO,
  PackageTaskClaimResponseDTO,
  PackageTasksResponseDTO,
  TaskDTO,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Task execution modal (Ads → Daily Tasks flow)                       */
/* ------------------------------------------------------------------ */

interface PackageTaskDialogProps {
  card: PackageTaskCardDTO | null;
  /** The admin-configured task content (iframe URL + countdown duration). */
  content: TaskDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The task experience, following the reference video:
 *  1. header: the plan/package name + close (X)
 *  2. the admin-configured task content (video / ad / external page) renders
 *     below it inside a sandboxed iframe
 *  3. footer: "Loading… Ns" countdown driven by the SERVER-registered
 *     startedAt (accurate across close/resume/refresh — the frontend timer
 *     alone is never trusted)
 *  4. when it hits 0 the footer morphs into the enabled "Claim Reward"
 *     button → "Claiming…" → success view "✓ Task Completed"
 *  5. claim → POST /api/package-tasks/complete → the reward is added through
 *     the EXISTING earning mechanism (withdrawable balance + daily_earning
 *     ledger row) and the card behind flips to "Claimed Today"
 * If the content fails to load, an "Unable to load task" state with Retry is
 * shown and the task is NOT marked completed.
 */
function PackageTaskDialog({ card, content, open, onOpenChange }: PackageTaskDialogProps) {
  const queryClient = useQueryClient();
  // Admin-controlled presentation switch (visual layer only — the claim
  // itself always works through the existing mechanism).
  const { animations } = useSession();
  const claimAnimEnabled = animationEnabled(animations, "taskClaim");
  // Lazy-initialized from the card at mount — the parent remounts this dialog
  // (keyed) for every open, so state is always fresh per attempt.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(() =>
    card?.startedAt ? new Date(card.startedAt).getTime() : null
  );
  const [now, setNow] = useState(() => Date.now());
  const [frameReady, setFrameReady] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [claimedReward, setClaimedReward] = useState<number | null>(null);
  const submittedRef = useRef(false);

  const duration = content?.durationSeconds ?? 0;

  // Register the task start server-side (starts the authoritative timer).
  // State is only updated from async callbacks (never synchronously in the
  // effect body).
  useEffect(() => {
    if (!open || !card || !content || startedAtMs != null) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await apiFetch<{ startedAt: string }>("/api/package-tasks/start", {
          method: "POST",
          json: { userPackageId: card.id },
        });
        if (!cancelled) {
          setStartedAtMs(new Date(res.startedAt).getTime());
          void queryClient.invalidateQueries({ queryKey: ["package-tasks"] });
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Couldn't start the task.");
          onOpenChange(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, card, content, startedAtMs, onOpenChange, queryClient]);

  // Local countdown ticker — only runs while the modal is open.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [open]);

  // Content load watchdog: if the iframe never reports ready, surface the
  // "Unable to load task" state with a Retry (the task is NOT completed —
  // the server timer and claim gates stay fully enforced).
  useEffect(() => {
    if (!open || frameReady || frameFailed || claimedReward != null) return;
    const id = window.setTimeout(() => setFrameFailed(true), 12_000);
    return () => window.clearTimeout(id);
  }, [open, frameReady, frameFailed, claimedReward, frameKey]);

  const remaining = useMemo(() => {
    if (startedAtMs == null) return duration;
    const elapsed = (now - startedAtMs) / 1000;
    return Math.min(duration, Math.max(0, duration - elapsed));
  }, [now, startedAtMs, duration]);
  const secondsLeft = Math.max(1, Math.ceil(remaining));
  const countdownDone = startedAtMs != null && remaining <= 0;

  const claim = useMutation({
    mutationFn: (userPackageId: string) =>
      apiFetch<PackageTaskClaimResponseDTO>("/api/package-tasks/complete", {
        method: "POST",
        json: { userPackageId },
      }),
    onSuccess: (res) => {
      setClaimedReward(res.reward);
      toast.success(`✓ Claimed ${formatPKR(res.reward)} added to your balance`);
      void queryClient.invalidateQueries({ queryKey: ["package-tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (err) => {
      // Safe retry: reset the single-flight guard and surface the message.
      submittedRef.current = false;
      toast.error(err instanceof Error ? err.message : "Claim failed. Please try again.");
    },
  });

  const rewardLabel = card ? formatPKR(card.reward) : "—";

  return (
    <Dialog open={open} onOpenChange={(next) => !claim.isPending && onOpenChange(next)}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        {card ? (
          <>
            <DialogHeader className="gap-1.5 border-b bg-muted/40 px-5 py-4">
              <DialogTitle className="flex items-center gap-2 pr-6 text-base">
                <Gift className="size-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{card.packageTitle}</span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-foreground/80">Investment Plan</span>
                <span className="inline-flex items-center gap-1 font-semibold text-primary">
                  <Wallet className="size-3.5" aria-hidden="true" />
                  {rewardLabel}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  One claim per day
                </span>
              </DialogDescription>
            </DialogHeader>

            {/* Task content / ad / video container */}
            <div className="relative h-[52vh] min-h-[300px] w-full bg-white">
              {claimedReward != null ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  {/* Premium in-place success presentation — the REAL claimed
                      reward from the existing claim response, animated once.
                      When the admin's animation switch is OFF the same facts
                      render statically (no animation timers/effects run). */}
                  {claimAnimEnabled ? (
                    <SuccessCheckmark size={64} />
                  ) : (
                    <span className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
                      <CheckCircle2 className="size-9" strokeWidth={2.2} aria-hidden="true" />
                    </span>
                  )}
                  <p className="text-lg font-bold tracking-tight">Task Completed</p>
                  <p
                    className="text-2xl font-extrabold text-emerald-600 tabular-nums dark:text-emerald-400"
                    aria-hidden="true"
                  >
                    {claimAnimEnabled ? (
                      <CountUp
                        key={`task-reward-${card.id}`}
                        from={0}
                        to={claimedReward}
                        duration={1100}
                        format={(n) => formatPKR(n)}
                      />
                    ) : (
                      formatPKR(claimedReward)
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">added to your balance.</p>
                </div>
              ) : frameFailed ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/60 px-6 text-center">
                  <p className="text-sm font-semibold text-foreground">Unable to load task</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFrameFailed(false);
                        setFrameReady(false);
                        setFrameKey((k) => k + 1);
                      }}
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                      Retry
                    </Button>
                    {content ? (
                      <a
                        href={content.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-md px-3 text-sm font-medium text-primary underline-offset-2 hover:underline"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                        Open in a new tab
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  {!frameReady ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/60">
                      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground">Opening task page…</p>
                    </div>
                  ) : null}
                  {content ? (
                    <iframe
                      key={frameKey}
                      src={content.url}
                      title={`Task page: ${card.packageTitle}`}
                      className="size-full border-0"
                      referrerPolicy="no-referrer"
                      sandbox="allow-scripts allow-popups allow-forms"
                      onLoad={() => setFrameReady(true)}
                    />
                  ) : null}
                </>
              )}
            </div>
            {claimedReward == null && content && !frameFailed ? (
              <p className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
                <span>Keep this window open until the timer completes — that&apos;s what earns your reward.</span>
                <a
                  href={content.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open in a new tab
                </a>
              </p>
            ) : null}

            {/* Countdown → Claim morph bar */}
            <div className="flex items-center justify-center border-t bg-card px-5 py-4">
              <AnimatePresence mode="wait" initial={false}>
                {claimedReward != null ? (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full"
                  >
                    <Button type="button" size="lg" className="h-12 w-full rounded-xl text-base font-bold" onClick={() => onOpenChange(false)}>
                      Done
                    </Button>
                  </motion.div>
                ) : !countdownDone ? (
                  <motion.div
                    key="countdown"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
                    className="w-full space-y-2"
                    role="timer"
                    aria-live="off"
                    aria-label={`${secondsLeft} seconds remaining`}
                  >
                    <p className="flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground">
                      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                      Loading… {startedAtMs == null ? "starting" : `${secondsLeft}s`}
                    </p>
                    <Progress
                      value={duration > 0 ? ((duration - remaining) / duration) * 100 : 100}
                      aria-hidden="true"
                      className="h-1.5"
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="claim"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: "spring", stiffness: 320, damping: 22 }}
                    className="w-full"
                  >
                    <Button
                      type="button"
                      size="lg"
                      disabled={claim.isPending}
                      className="h-12 w-full rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90"
                      onClick={() => {
                        if (submittedRef.current) return;
                        submittedRef.current = true;
                        claim.mutate(card.id);
                      }}
                    >
                      {claim.isPending ? (
                        <>
                          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                          Claiming…
                        </>
                      ) : (
                        <>
                          <Gift className="size-5" aria-hidden="true" />
                          Claim {rewardLabel}
                        </>
                      )}
                    </Button>
                    <p className="mt-1.5 text-center text-xs text-muted-foreground">
                      Reward lands in your withdrawable balance instantly.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Daily Tasks view (the Ads tab)                                      */
/* ------------------------------------------------------------------ */

export function TasksView() {
  const [activeCard, setActiveCard] = useState<PackageTaskCardDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogId, setDialogId] = useState(0);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["package-tasks"],
    queryFn: () => apiFetch<PackageTasksResponseDTO>("/api/package-tasks"),
    refetchInterval: 15_000,
  });

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeading state="none" />
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load tasks</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>Something went wrong while fetching your daily tasks.</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid gap-4 sm:max-w-lg">
          <Card>
            <CardContent className="space-y-3 py-5">
              <div className="flex items-start justify-between gap-2">
                <Skeleton className="size-11 rounded-xl" />
                <Skeleton className="h-9 w-20" />
              </div>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const { tasks, content } = data;
  // ONE daily task — never one card per package.
  const task = tasks[0] ?? null;

  function openTask(card: PackageTaskCardDTO) {
    setActiveCard(card);
    setDialogId((n) => n + 1); // remount the modal so its timer state resets
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeading state={task ? (task.claimedToday ? "claimed" : "available") : "none"} />

      {/* No active package → guide the member to the existing Packages page. */}
      {!task ? (
        <Card className="border-dashed sm:max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <PackageIcon className="size-7 text-primary" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="font-semibold">No active package yet</p>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                Activate an investment package to unlock your daily task — its admin-configured daily
                earning is your reward.
              </p>
            </div>
            <Button onClick={() => navigateTo("/dashboard/packages")}>
              <PackageIcon className="size-4" aria-hidden="true" />
              View Packages
            </Button>
          </CardContent>
        </Card>
      ) : content ? null : (
        // Admin has no active task configured — the task cannot start or claim.
        <Alert variant="destructive" className="sm:max-w-lg">
          <AlertTitle>Unable to load task</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>No task content is configured right now. Please try again later.</span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* THE one daily task card — reward from the applicable active package. */}
      {task ? (
        <div className="grid gap-4 sm:max-w-lg">
          {(() => {
            const claimed = task.claimedToday;
            const inProgress = !claimed && Boolean(task.startedAt);

            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <Card
                  className={
                    claimed
                      ? "gap-4 border-primary/15 py-5 opacity-80 shadow-sm"
                      : "gap-4 border-primary/15 py-5 shadow-sm transition-shadow hover:shadow-md"
                  }
                >
                  <CardContent className="flex h-full flex-col gap-3 px-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Gift className="size-5.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold leading-tight">{task.packageTitle}</h3>
                          <p className="mt-0.5 text-xs font-medium text-muted-foreground">Investment Plan</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reward</p>
                        <p className="text-xl font-bold tabular-nums leading-tight text-primary">
                          {formatPKR(task.reward)}
                        </p>
                      </div>
                    </div>

                    <div className="flex-1" />

                    <div className="flex flex-col gap-2">
                      {claimed ? (
                        <Button variant="secondary" className="w-full gap-1.5" disabled>
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                          Claimed Today
                        </Button>
                      ) : !content ? (
                        <Button variant="outline" className="w-full gap-1.5" disabled title="No task content configured">
                          <Timer className="size-4" aria-hidden="true" />
                          Task unavailable
                        </Button>
                      ) : (
                        <Button
                          className="w-full gap-1.5 font-semibold"
                          variant={inProgress ? "secondary" : "default"}
                          onClick={() => openTask(task)}
                        >
                          {inProgress ? (
                            <>
                              <Clock className="size-4" aria-hidden="true" />
                              Resume Task
                            </>
                          ) : (
                            <>
                              <PlayCircle className="size-4" aria-hidden="true" />
                              Start Task
                            </>
                          )}
                        </Button>
                      )}
                      {inProgress ? (
                        <p className="text-center text-xs text-muted-foreground">In progress — timer is running</p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })()}
        </div>
      ) : null}

      <PackageTaskDialog
        key={dialogId}
        card={activeCard}
        content={content}
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setActiveCard(null);
            void refetch();
          }
        }}
      />
    </div>
  );
}

function PageHeading({ state }: { state: "available" | "claimed" | "none" }) {
  return (
    <div className="space-y-1">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
        <Timer className="size-6 text-primary sm:size-7" aria-hidden="true" />
        Daily Tasks
      </h1>
      <p className="text-sm text-muted-foreground">
        {state === "available"
          ? "Watch the task, wait for the timer, then claim your reward."
          : state === "claimed"
            ? "Today's task is complete — come back tomorrow."
            : "Activate a package to unlock your daily task."}
      </p>
    </div>
  );
}
