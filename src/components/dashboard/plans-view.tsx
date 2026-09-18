"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import { CheckCircle2, Crown, RefreshCw, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DashboardDTO, PlanDTO } from "@/lib/types";

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

/* ------------------------------------------------------------------ */
/* Plan card                                                           */
/* ------------------------------------------------------------------ */

function PlanCard({
  plan,
  isCurrent,
  onActivate,
}: {
  plan: PlanDTO;
  isCurrent: boolean;
  onActivate: (plan: PlanDTO) => void;
}) {
  const dailyEarning = plan.rewardPerTask * plan.dailyTaskLimit;
  const totalPotential = dailyEarning * plan.durationDays;

  return (
    <motion.article variants={item} className="h-full">
      <div
        className={cn(
          "flex h-full flex-col rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md",
          isCurrent && "border-primary/60 ring-1 ring-primary/30",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
          <div className="flex items-center gap-3">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"
              aria-hidden="true"
            >
              <Crown className="size-6" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold tracking-tight">{plan.name}</h3>
              <p className="text-xs text-muted-foreground">
                {plan.dailyTaskLimit} tasks/day <span aria-hidden="true">·</span> {plan.durationDays} days
              </p>
            </div>
          </div>
          {isCurrent ? (
            <Badge className="gap-1.5">
              <span className="size-1.5 animate-pulse rounded-full bg-primary-foreground" aria-hidden="true" />
              Active
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="text-center">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
              Activation price
            </p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-primary">{formatPKR(plan.price)}</p>
          </div>

          <div className="grid grid-cols-3 rounded-xl bg-muted p-3 dark:bg-muted/60">
            <div className="flex flex-col items-center justify-center px-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
                Per task
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{formatPKR(plan.rewardPerTask)}</p>
            </div>
            <div className="flex flex-col items-center justify-center border-l border-border px-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
                Daily
              </p>
              <p className="mt-1 text-sm font-bold tabular-nums text-primary">{formatPKR(dailyEarning)}</p>
            </div>
            <div className="flex flex-col items-center justify-center border-l border-border px-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
                Potential
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{formatPKR(totalPotential)}</p>
            </div>
          </div>

          {plan.description ? <p className="text-sm text-muted-foreground">{plan.description}</p> : null}

          <ul className="space-y-1.5">
            {[
              "Daily tasks credited to your Task Balance",
              "Referral unlock for your inviter on approval",
              "Withdraw unlocked earnings anytime",
            ].map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 break-words">{feature}</span>
              </li>
            ))}
          </ul>

          <div className="mt-auto pt-1">
            <Button
              type="button"
              className="h-11 w-full"
              onClick={() => onActivate(plan)}
              disabled={isCurrent}
            >
              {isCurrent ? "Your current plan" : "Activate Plan"}
            </Button>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

/* ------------------------------------------------------------------ */
/* Plans view                                                          */
/* ------------------------------------------------------------------ */

export function PlansView() {
  const plans = useQuery({
    queryKey: ["public", "plans"],
    queryFn: () => apiFetch<{ plans: PlanDTO[] }>("/api/public/plans"),
  });

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardDTO>("/api/dashboard"),
  });

  const activePlanName = dashboard.data?.activePlan?.name ?? null;
  const planList = plans.data?.plans ?? [];

  function openPurchase(plan: PlanDTO) {
    // Multi-step checkout: Step 1 (plan confirmation) is its own screen.
    navigateTo(`/dashboard/checkout/plan/${plan.id}`);
  }

  if (plans.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load plans</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          <span>Something went wrong while fetching the VIP plans.</span>
          <Button variant="outline" size="sm" onClick={() => void plans.refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (plans.isLoading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <Skeleton className="h-[84px] rounded-none" />
              <div className="space-y-4 p-5">
                <Skeleton className="mx-auto h-9 w-32" />
                <Skeleton className="h-[72px] w-full rounded-xl" />
                <Skeleton className="h-11 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">VIP Plans</h1>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          {activePlanName
            ? `Your plan: ${activePlanName} — purchase a new plan after it expires.`
            : "Pick a plan, pay via EasyPaisa / JazzCash / USDT and unlock daily tasks."}
        </p>
      </header>

      {planList.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <Crown className="size-9 text-muted-foreground/60" aria-hidden="true" />
          <p className="font-medium">No plans available yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            New VIP plans are on the way — check back soon.
          </p>
        </div>
      ) : (
        <motion.div
          variants={container}
          initial="hidden"
          animate="visible"
          className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {planList.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={activePlanName === plan.name}
              onActivate={openPurchase}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}
