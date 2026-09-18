"use client";

import { useQuery } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  Check,
  Flame,
  Package as PackageIcon,
  RefreshCw,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { formatDate, formatPKR, timeAgo } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PackageDTO, PackagesResponseDTO, UserPackageDTO } from "@/lib/types";

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

/** Slim custom scrollbar (same styling as the admin `scrollable` helper, vertical). */
const slimScroll =
  "overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

/** Date-only strings ("2026-09-09") parse as UTC — format them as local calendar dates. */
function displayDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  return formatDate(iso);
}

/** "Ends" label for an instance — very long horizons read as Lifetime. */
function endsLabel(up: UserPackageDTO): string {
  const days = Math.round(
    (new Date(up.endsAt).getTime() - new Date(up.startedAt).getTime()) / 86_400_000,
  );
  if (days > 3650) return "Lifetime";
  return formatDate(up.endsAt);
}

/* ------------------------------------------------------------------ */
/* Package card — premium investment-plan presentation                  */
/* (visual redesign only: same data source, same values, same handler)  */
/* ------------------------------------------------------------------ */

/**
 * Premium header gradients, cycled by card position in the list.
 * PURELY PRESENTATIONAL — no business meaning is attached to any color
 * and no package data is involved. Deterministic so the list always looks
 * the same for the same catalog.
 */
const HEADER_GRADIENTS = [
  "from-emerald-500 via-green-600 to-teal-700",
  "from-sky-500 via-blue-600 to-blue-800",
  "from-violet-500 via-purple-600 to-purple-800",
  "from-amber-400 via-orange-500 to-orange-700",
  "from-rose-400 via-rose-500 to-rose-700",
  "from-cyan-400 via-teal-500 to-teal-700",
] as const;

/** Badge amount typescale — keeps every real price inside the circle
 *  without clipping (e.g. "270" → large, "2,147,483,647" → compact). */
function badgeAmountClass(length: number): string {
  if (length <= 3) return "text-2xl";
  if (length <= 5) return "text-xl";
  if (length <= 7) return "text-lg";
  if (length <= 9) return "text-sm";
  return "text-[10px] tracking-tight";
}

function PackageCard({ pkg, index }: { pkg: PackageDTO; index: number }) {
  const gradient = HEADER_GRADIENTS[index % HEADER_GRADIENTS.length];
  const amount = pkg.price.toLocaleString("en-US");

  /* Deterministic per-card phase offsets so the ambient light motion of
   * neighbouring cards never moves in lockstep (feels organic, never
   * strobing). PURELY PRESENTATIONAL. */
  const sheenDelay = `${((index * 1.3) % 8).toFixed(1)}s`;
  const liquidDelay = `${((index * 2.1) % 11).toFixed(1)}s`;

  // Existing feature labels (unchanged) — real, already-supported perks.
  const features = ["Daily Withdrawal", "No Referral Required"];

  // Info rows — every value is the EXACT value from the existing API data.
  const rows: { label: string; value: string }[] = [
    { label: "Total Earning", value: formatPKR(pkg.totalReturn) },
    { label: "Net Profit", value: formatPKR(pkg.netProfit) },
    { label: "Package Duration", value: `${pkg.durationDays.toLocaleString("en-US")} Days` },
  ];

  return (
    <motion.div variants={item} className="h-full">
      <article className="flex h-full flex-col overflow-hidden rounded-[1.25rem] border bg-card shadow-md shadow-black/5 transition-[box-shadow,transform] duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-black/10">
        {/* ── Premium gradient header (~40% of the card) ── */}
        <div className={cn("relative overflow-hidden bg-gradient-to-br px-5 pt-7 pb-6", gradient)}>
          {/* soft light bloom from the top */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(130%_90%_at_50%_-15%,rgba(255,255,255,0.30),transparent_60%)]"
          />

          {/* Ambient premium motion — VERY subtle, white/alpha only so it
              adapts to every existing header gradient color. Both layers are
              decorative: pointer-transparent, GPU-composited transform/opacity
              CSS, and disabled under prefers-reduced-motion. They sit BELOW
              the card content (which is `relative`), so name, price badge and
              all information stay perfectly readable. */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {/* gentle liquid-light drift */}
            <div
              className="animate-card-liquid absolute -inset-16 bg-[radial-gradient(42%_34%_at_32%_24%,rgba(255,255,255,0.16),transparent_70%)] motion-reduce:animate-none"
              style={{ animationDelay: liquidDelay }}
            />
            {/* slow crystal light sweep */}
            <div className="absolute inset-y-0 left-0 w-1/2 overflow-visible">
              <div
                className="animate-card-sheen absolute inset-y-0 -left-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent motion-reduce:animate-none"
                style={{ animationDelay: sheenDelay }}
              />
            </div>
          </div>

          <div className="relative flex flex-col items-center gap-3.5">
            {/* Circular glass price badge with concentric rings */}
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-5 rounded-full border border-white/10"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-2.5 rounded-full border border-white/25"
              />
              <div
                className="flex size-24 flex-col items-center justify-center gap-0.5 rounded-full border border-white/40 bg-white/15 px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md"
              >
                <span
                  className={cn("whitespace-nowrap font-extrabold leading-none text-white tabular-nums", badgeAmountClass(amount.length))}
                >
                  {amount}
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/85">
                  PKR Price
                </span>
              </div>
            </div>

            {/* Package name (+ optional existing marketing blurb) */}
            <div className="min-w-0 text-center">
              <h3 className="truncate text-lg font-bold tracking-tight text-white drop-shadow-sm">
                {pkg.title}
              </h3>
              {pkg.description ? (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/85">{pkg.description}</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Clean information body ── */}
        <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
          {/* Daily earning — the headline metric, visually emphasized */}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/5 px-3.5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Daily Earning
            </span>
            <span className="text-lg font-extrabold leading-none text-primary tabular-nums">
              {formatPKR(pkg.dailyEarning)}
            </span>
          </div>

          {/* Compact info rows with subtle dividers */}
          <dl className="divide-y divide-border/70">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {row.label}
                </dt>
                <dd className="min-w-0 truncate text-sm font-semibold tabular-nums">{row.value}</dd>
              </div>
            ))}
          </dl>

          {/* Feature checklist (existing perks, circular check icons) */}
          <ul className="space-y-1.5">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-2.5 text-sm">
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                  aria-hidden="true"
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className="min-w-0 break-words">{feature}</span>
              </li>
            ))}
          </ul>

          {/* CTA — opens the multi-step checkout screen (Step 1: plan confirmation).
              EXISTING handler, EXISTING flow — presentation only. */}
          <div className="mt-auto pt-1">
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-gradient-to-b from-emerald-500 to-green-600 text-[15px] font-bold text-white shadow-lg shadow-emerald-600/25 transition-all hover:-translate-y-px hover:from-emerald-400 hover:to-green-500 hover:shadow-xl hover:shadow-emerald-600/30 active:translate-y-0 active:scale-[0.98]"
              onClick={() => navigateTo(`/dashboard/checkout/package/${pkg.id}`)}
            >
              {`Invest ${formatPKR(pkg.price)}`}
            </Button>
          </div>
        </div>
      </article>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* My Packages section                                                 */
/* ------------------------------------------------------------------ */

function MyPackagesSection({ data }: { data: PackagesResponseDTO }) {
  const { myPackages, totals } = data;
  if (myPackages.length === 0 && totals.activeCount === 0) return null;

  const chips: { label: string; value: string }[] = [
    { label: "Active Packages", value: String(totals.activeCount) },
    { label: "Daily Income", value: formatPKR(totals.dailyIncome) },
    { label: "Total Invested", value: formatPKR(totals.investedTotal) },
    { label: "Total Earned", value: formatPKR(totals.earnedTotal) },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.12, ease: "easeOut" }}
      aria-labelledby="my-packages-heading"
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 id="my-packages-heading" className="text-xl font-bold tracking-tight">
          My Packages
        </h2>
        <Badge variant="secondary" className="tabular-nums">
          {myPackages.length}
        </Badge>
      </div>

      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {chips.map((chip) => (
          <div key={chip.label} className="rounded-xl border bg-card p-3 shadow-sm">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:text-xs">
              {chip.label}
            </p>
            <p className="mt-1 text-lg font-bold text-primary tabular-nums">{chip.value}</p>
          </div>
        ))}
      </div>

      {/* Instance list */}
      <div className={cn("mt-4 max-h-96 rounded-xl border bg-card shadow-sm", slimScroll)}>
        <ul className="divide-y px-4">
          {myPackages.map((up) => (
            <li
              key={up.id}
              className={cn(
                "flex items-center gap-3 py-3 first:pt-3.5 last:pb-3.5",
                up.status === "completed" && "opacity-75",
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Flame className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="truncate text-sm font-medium">{up.packageTitle}</p>
                  {up.status === "active" ? (
                    <Badge className="gap-1.5">
                      <span
                        className="size-1.5 animate-pulse rounded-full bg-primary-foreground"
                        aria-hidden="true"
                      />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Completed</Badge>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-primary tabular-nums">
                    {formatPKR(up.dailyEarning)} daily
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Started {timeAgo(up.startedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Ends {endsLabel(up)}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {up.lastEarningDate
                    ? `Last credit ${displayDate(up.lastEarningDate)}`
                    : "First credit tonight"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Packages view                                                       */
/* ------------------------------------------------------------------ */

export function PackagesView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["packages"],
    queryFn: () => apiFetch<PackagesResponseDTO>("/api/packages"),
    refetchInterval: 30_000,
  });

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load packages</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          <span>Something went wrong while fetching investment packages.</span>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        {/* Skeletons mirror the redesigned card: gradient header with badge,
            emphasized daily row, info rows, feature list, invest button. */}
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="overflow-hidden rounded-[1.25rem] border bg-card shadow-md shadow-black/5">
              <div className="flex flex-col items-center gap-3.5 px-5 pt-7 pb-6">
                <Skeleton className="size-24 rounded-full" />
                <Skeleton className="h-5 w-28" />
              </div>
              <div className="flex flex-col gap-4 p-4 sm:p-5">
                <Skeleton className="h-12 w-full rounded-xl" />
                <div className="space-y-3 px-3.5">
                  {[0, 1, 2].map((j) => (
                    <Skeleton key={j} className="h-4 w-full" />
                  ))}
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-36" />
                </div>
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page header (scoped polish only — same title & description text) */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Investment Plans</h1>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          daily withdrawal — no referral required.
        </p>
      </header>

      {/* Catalog */}
      {data.packages.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <PackageIcon className="size-9 text-muted-foreground/60" aria-hidden="true" />
          <p className="font-medium">No investment packages available yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            New plans are on the way — check back soon.
          </p>
        </div>
      ) : (
        <motion.div
          variants={container}
          initial="hidden"
          animate="visible"
          className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3"
        >
          {data.packages.map((pkg, index) => (
            <PackageCard key={pkg.id} pkg={pkg} index={index} />
          ))}
        </motion.div>
      )}

      {/* My packages */}
      <MyPackagesSection data={data} />
    </div>
  );
}
