"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, type Variants } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Copy,
  Crown,
  ExternalLink,
  Gift,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/dashboard/copy-button";
import { WelcomePopup } from "@/components/dashboard/welcome-popup";
import { PromoBannerOverlay } from "@/components/dashboard/promo-banner-overlay";
import {
  BalanceSparkles,
  CountUp,
  ReferralCreditCelebration,
  useReferralCreditPresentation,
} from "@/components/dashboard/referral-credit-celebration";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { formatDate, formatPKR } from "@/lib/money";
import type {
  DashboardDTO,
  HomeResponseDTO,
  PromoClaimResponseDTO,
} from "@/lib/types";

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: "easeOut" },
  },
};

/* ------------------------------------------------------------------ */
/* 1. Total balance hero — simple premium card:                        */
/*    TOTAL BALANCE / PKR [real balance] / Withdraw                    */
/*    While a NEW referral commission is being presented, the existing */
/*    digits count up from the pre-credit total and the card wears a   */
/*    brief celebratory glow — presentation only, the value itself is  */
/*    the real wallet number.                                          */
/* ------------------------------------------------------------------ */

function TotalBalanceCard({
  taskBalance,
  withdrawableBalance,
  celebration,
}: {
  taskBalance: number;
  withdrawableBalance: number;
  /** Active referral-credit presentation (visual only). */
  celebration?: { id: string; gain: number; total: number };
}) {
  const total = taskBalance + withdrawableBalance;
  const active = celebration && celebration.gain > 0 ? celebration : null;

  return (
    <motion.div variants={item}>
      <section
        aria-label="Total balance"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-emerald-500 via-green-600 to-teal-700 p-5 text-white shadow-xl shadow-emerald-900/25 ring-1 ring-emerald-400/30 sm:p-7"
      >
        {/* Soft decorative depth — faint blobs + watermark, never content */}
        <div
          className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-white/10"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-14 size-48 rounded-full bg-black/10"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
          aria-hidden="true"
        />
        {/* Gentle light drift — a very slow, low-opacity sheen sweep
            (9s cycle, mostly resting). Disabled for reduced-motion users. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2 animate-balance-sheen bg-gradient-to-r from-transparent via-white/10 to-transparent"
          aria-hidden="true"
        />
        <Banknote
          className="pointer-events-none absolute right-5 bottom-16 size-24 text-white/10 sm:right-7 sm:size-28"
          aria-hidden="true"
        />

        <div className="relative">
          {/* Celebratory glow — a brief white pulse while the digits count up */}
          {active ? (
            <motion.div
              className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-white/80 shadow-[inset_0_0_50px_rgba(255,255,255,0.15)]"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.9, 0.35, 0.7, 0] }}
              transition={{ duration: 2.8, times: [0, 0.1, 0.45, 0.75, 1], ease: "easeInOut" }}
              aria-hidden="true"
            />
          ) : null}
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/75 uppercase sm:text-xs">
            Total Balance
          </p>
          <p className="relative mt-2 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">
            <span className="mr-2 align-middle text-xl font-bold text-white/85 sm:text-2xl">PKR</span>
            {active ? (
              <CountUp
                key={`hero-${active.id}`}
                from={Math.max(0, active.total - active.gain)}
                to={active.total}
                format={(n) => n.toLocaleString("en-US")}
              />
            ) : (
              total.toLocaleString("en-US")
            )}

            {/* Floating "+ Rs X" indicator — rises above the digits once */}
            {active ? (
              <motion.span
                className="absolute -top-1 right-0 rounded-full bg-white px-2.5 py-1 text-xs font-extrabold text-emerald-700 shadow-lg shadow-black/20"
                initial={{ opacity: 0, y: 12, scale: 0.85 }}
                animate={{ opacity: [0, 1, 1, 0], y: -26, scale: [0.85, 1, 1, 1] }}
                transition={{ duration: 2.4, times: [0, 0.12, 0.72, 1], ease: "easeOut" }}
                aria-hidden="true"
              >
                {formatPKR(active.gain, { sign: true })}
              </motion.span>
            ) : null}

            {/* Soft sparkle burst around the counting digits */}
            {active ? <BalanceSparkles /> : null}
          </p>

          <Button
            size="lg"
            className="mt-6 h-12 w-full rounded-full border border-white/25 bg-white/15 px-10 text-base font-semibold text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:ring-white sm:w-auto"
            onClick={() => navigateTo("/dashboard/withdraw")}
          >
            <ArrowDownToLine className="size-5" aria-hidden="true" />
            Withdraw
          </Button>
        </div>
      </section>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Dynamic announcement & lucky draw (admin-managed)                */
/*    Hierarchy: greeting (prominent) → message → small note → date    */
/* ------------------------------------------------------------------ */

function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T23:59:59`).getTime();
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/** Split a leading "Assalam-o-Alaikum" greeting out of the Urdu text so it
 *  can be rendered as the prominent card heading (reference hierarchy). */
function splitUrduGreeting(text: string): { greeting: string; body: string } {
  const m = text.match(/^(السلام[\s\u200c]*(?:علیکم|عليكم)[\s]*[!،.،!]*)/u);
  if (m && m[1].trim()) {
    const body = text.slice(m[1].length).trim();
    if (body.length > 0) return { greeting: m[1].trim().replace(/[!،.،!]+$/u, ""), body };
  }
  return { greeting: "السلام علیکم", body: text };
}

function AnnouncementCard({ home }: { home: HomeResponseDTO }) {
  const drawDate = home.luckyDrawDate;
  const daysLeft = drawDate ? daysUntil(drawDate) : null;
  const hasAnnouncement = home.announcementUr.length > 0 || home.announcementEn.length > 0;

  if (!hasAnnouncement && !drawDate) return null;

  const { greeting, body } = splitUrduGreeting(home.announcementUr);

  return (
    <motion.section variants={item} aria-label="Announcements">
      <div className="relative overflow-hidden rounded-2xl border border-amber-500/40 bg-gradient-to-br from-slate-900 via-[#0b1526] to-slate-900 p-5 text-white shadow-md">
        <div
          className="pointer-events-none absolute -top-10 -left-10 size-32 rounded-full bg-amber-500/10"
          aria-hidden="true"
        />
        <div className="relative">
          {/* Prominent Urdu greeting */}
          {hasAnnouncement ? (
            <h3
              className="font-urdu text-center text-2xl font-bold leading-relaxed text-amber-300 sm:text-[26px]"
              dir="rtl"
            >
              {greeting}
            </h3>
          ) : null}

          {/* Main announcement message */}
          {body ? (
            <p
              className="font-urdu mt-3 text-right text-[15px] leading-loose text-amber-50 sm:text-base"
              dir="rtl"
            >
              {body}
            </p>
          ) : null}

          {/* Small supporting note / disclaimer */}
          {home.announcementEn ? (
            <p className="mt-3 text-xs leading-relaxed text-white/60">{home.announcementEn}</p>
          ) : null}

          {/* Date — clean footer badge */}
          {drawDate ? (
            <div className="mt-4 flex justify-center border-t border-amber-500/20 pt-3.5">
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3.5 py-1.5 text-xs font-semibold text-amber-300">
                <Gift className="size-3.5 shrink-0" aria-hidden="true" />
                Lucky Draw Date: {formatDate(drawDate)}
                {daysLeft != null && daysLeft > 0 ? (
                  <span className="text-amber-300/70">({daysLeft}d)</span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Team leader offer (dynamic target + live progress)               */
/* ------------------------------------------------------------------ */

function TeamLeaderCard({ home }: { home: HomeResponseDTO }) {
  const { targetAmount, applyEnabled, teamInvestment } = home.teamLeader;
  const progress = targetAmount > 0
    ? Math.min(100, Math.round((teamInvestment / targetAmount) * 100))
    : 0;
  const eligible = applyEnabled && teamInvestment >= targetAmount && targetAmount > 0;
  const remaining = Math.max(0, targetAmount - teamInvestment);

  return (
    <motion.section variants={item} aria-label="Team leader offer">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 p-5 text-amber-950 shadow-md">
        <div
          className="pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-white/20"
          aria-hidden="true"
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/30 text-amber-900">
              <Gift className="size-5" aria-hidden="true" />
            </span>
            <span className="text-[11px] font-bold tracking-[0.14em] text-amber-900/80 uppercase">
              Team Leader Offer
            </span>
          </div>

          <h3 className="mt-3 text-lg font-bold">Only 20 Team Leaders</h3>
          <p className="text-xs font-medium text-amber-900/80">
            New team investment of {formatPKR(targetAmount)} required
          </p>

          {/* Dynamic progress: team investment vs target */}
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>New Team Investment</span>
              <span className="tabular-nums">
                {formatPKR(teamInvestment)} / {formatPKR(targetAmount)}
              </span>
            </div>
            <Progress
              value={progress}
              aria-label={`Team investment progress: ${formatPKR(teamInvestment)} of ${formatPKR(targetAmount)}`}
              className="h-2.5 bg-amber-900/15 [&>div]:bg-amber-900"
            />
            <p className="text-[11px] text-amber-900/75">
              Only investments made after this offer started are counted.
            </p>
          </div>

          <Button
            size="sm"
            disabled={!eligible}
            className="mt-3.5 w-full bg-amber-900 font-semibold text-amber-50 hover:bg-amber-800 sm:w-auto"
            onClick={() => {
              toast.success(
                "You qualify for the Team Leader offer! Contact support on Telegram to complete your application.",
              );
              window.open(home.social.telegramUrl || "https://t.me/TaskEarnHub", "_blank", "noopener,noreferrer");
            }}
            aria-describedby="team-leader-apply-note"
          >
            {eligible ? (
              <Crown className="size-4" aria-hidden="true" />
            ) : (
              <Lock className="size-4" aria-hidden="true" />
            )}
            Apply for the Offer
          </Button>
          {!eligible ? (
            <p id="team-leader-apply-note" className="mt-2 text-[11px] leading-snug text-amber-900/75">
              {applyEnabled
                ? `${formatPKR(remaining)} more new team investment needed to apply.`
                : "Applications are currently closed by the admin."}
            </p>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}

/* White companion card shown while the offer is locked (reference layout) */
function OfferLockedCard({ home }: { home: HomeResponseDTO }) {
  const { targetAmount, applyEnabled, teamInvestment } = home.teamLeader;
  if (!applyEnabled || targetAmount <= 0 || teamInvestment >= targetAmount) return null;

  return (
    <motion.section variants={item} aria-label="Offer locked">
      <div className="rounded-2xl border bg-card p-5 text-center shadow-sm">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-sm font-bold">Offer Locked</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your new team investment is {formatPKR(teamInvestment)}. A total of{" "}
          {formatPKR(targetAmount)} is required to apply.
        </p>
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Team salary banner                                               */
/* ------------------------------------------------------------------ */

function TeamSalaryBanner({ home }: { home: HomeResponseDTO }) {
  const { text, link, image } = home.teamSalary;
  const [imgFailed, setImgFailed] = useState(false);
  if (!text) return null;

  const href = link || "/dashboard/referrals";
  const internal = href.startsWith("/dashboard");

  // Admin text may carry "Title — subtitle" (e.g. "Team Salary System — Earn
  // up to PKR 13,000 every week"); split for the reference hierarchy.
  const dashIdx = text.indexOf("—") >= 0 ? text.indexOf("—") : text.indexOf(" - ");
  const title = dashIdx > 0 ? text.slice(0, dashIdx).trim() : "Team Salary System";
  const subtitle = dashIdx > 0 ? text.slice(dashIdx + (text[dashIdx] === "—" ? 1 : 3)).trim() : text;

  // Optional admin-uploaded banner visual: replaces the default trophy tile,
  // falling back to it when unset or unloadable (same pattern as payment logos).
  const showImage = Boolean(image) && !imgFailed;

  return (
    <motion.section variants={item} aria-label="Team salary banner">
      <button
        type="button"
        onClick={() => (internal ? navigateTo(href) : window.open(href, "_blank", "noopener,noreferrer"))}
        className="group relative block w-full overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-purple-700 to-fuchsia-700 p-5 text-left text-white shadow-md transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[0.99]"
        aria-label={`${title} — ${subtitle}`}
      >
        <div
          className="pointer-events-none absolute -top-14 -right-14 size-44 rounded-full bg-white/10"
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/20">
            {showImage && image ? (
              <img
                src={image}
                alt=""
                onError={() => setImgFailed(true)}
                className="size-full object-contain"
              />
            ) : (
              <Trophy className="size-5.5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold sm:text-lg">{title}</h3>
              <Badge className="border-white/25 bg-white/20 text-[10px] font-bold tracking-wide text-white">
                <Sparkles className="size-3" aria-hidden="true" />
                NEW
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-white/75 sm:text-sm">{subtitle}</p>
          </div>
          <ArrowRight
            className="size-5 shrink-0 text-white/80 transition-transform group-hover:translate-x-1"
            aria-hidden="true"
          />
        </div>
      </button>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* 5. 4-grid quick stats + promo code claim                            */
/* ------------------------------------------------------------------ */

function StatTile({
  icon,
  label,
  value,
  onClick,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onClick?: () => void;
  tone: string;
}) {
  const inner = (
    <>
      <span
        className={`flex size-10 items-center justify-center rounded-xl ${tone}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tracking-tight tabular-nums sm:text-2xl">{value}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`${label}: ${value}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-sm">{inner}</div>
  );
}

/* Promo claim dialog (session-keyed remount resets state without effects). */
function PromoClaimDialog({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  session: number;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");

  const claim = useMutation({
    mutationFn: () =>
      apiFetch<PromoClaimResponseDTO>("/api/home/promo", {
        method: "POST",
        json: { code: code.trim() },
      }),
    onSuccess: (data) => {
      toast.success(`${formatPKR(data.reward)} promo reward credited!`);
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (claim.isPending) return;
    const trimmed = code.trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(trimmed)) return; // inline error handles guidance
    claim.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={session} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-5 text-primary" aria-hidden="true" />
            Claim Promo Code
          </DialogTitle>
          <DialogDescription>
            Enter the code you received — the reward is credited to your withdrawable balance instantly.
          </DialogDescription>
        </DialogHeader>

        {claim.isSuccess ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 className="size-10 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold">{formatPKR(claim.data.reward)} credited!</p>
            <p className="text-xs text-muted-foreground">
              Code {claim.data.code} redeemed — the reward is now withdrawable.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. WELCOME50"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="text-center font-mono text-base font-semibold tracking-[0.2em]"
              aria-label="Promo code"
              aria-invalid={claim.isError}
            />
            {claim.isError ? (
              <p className="text-center text-sm text-destructive" role="alert">
                {claim.error instanceof Error ? claim.error.message : "Claim failed. Try again."}
              </p>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                One claim per code, per account.
              </p>
            )}
            <DialogFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={claim.isPending || code.trim().length < 3}
              >
                {claim.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Gift className="size-4" aria-hidden="true" />}
                Claim Reward
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickStatsGrid({ home, onOpenPromo }: { home: HomeResponseDTO; onOpenPromo: () => void }) {
  const stats = home.stats;

  return (
    <motion.section variants={item} aria-label="Quick stats" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatTile
        icon={<TrendingUp className="size-5" aria-hidden="true" />}
        label="Total Earnings"
        value={formatPKR(stats.totalEarnings)}
        onClick={() => navigateTo("/dashboard/history/balance")}
        tone="bg-primary/10 text-primary"
      />
      <StatTile
        icon={<CalendarDays className="size-5" aria-hidden="true" />}
        label="Today Task Earning"
        value={formatPKR(stats.todayTaskEarning)}
        onClick={() => navigateTo("/dashboard/tasks")}
        tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
      />
      <StatTile
        icon={<Users className="size-5" aria-hidden="true" />}
        label="Referral Earnings"
        value={formatPKR(stats.referralEarnings)}
        onClick={() => navigateTo("/dashboard/referrals")}
        tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
      />
      <button
        type="button"
        onClick={onOpenPromo}
        className="group flex flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label="Promo code — claim your reward"
      >
        <span
          className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Gift className="size-5" />
        </span>
        <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Promo Code
        </p>
        <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-transform group-hover:scale-[1.02]">
          Claim Promo Code
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </button>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* 6. Channel visit rewards (WhatsApp / Telegram)                      */
/*    Honest visit-task flow: open channel -> user returns -> claim.   */
/*    The marker below is ONLY a UI hint for which button to show —    */
/*    the server re-verifies eligibility, amount and one-claim-per-    */
/*    user on every claim request (it never trusts this state).        */
/* ------------------------------------------------------------------ */

type ChannelKey = "whatsapp" | "telegram";

const VISIT_MARKER_PREFIX = "teh_channel_visit:";

function readVisitMarkers(): Record<ChannelKey, boolean> {
  try {
    return {
      whatsapp: sessionStorage.getItem(`${VISIT_MARKER_PREFIX}whatsapp`) === "1",
      telegram: sessionStorage.getItem(`${VISIT_MARKER_PREFIX}telegram`) === "1",
    };
  } catch {
    return { whatsapp: false, telegram: false };
  }
}

/**
 * Lifecycle for the visit-channel tasks:
 *  1. markVisit() records that the user initiated a channel visit (opens
 *     the exact admin-configured URL — never modified or proxied).
 *  2. When the page becomes visible/focused again (user back from the
 *     WhatsApp/Telegram app or tab), the Claim button becomes available.
 * Clicking Join alone never reveals Claim — only the return does.
 */
function useChannelVisit() {
  // Markers survive in-page reloads (bfcache drop / refresh) via sessionStorage.
  const [returned, setReturned] = useState<Record<ChannelKey, boolean>>(readVisitMarkers);

  useEffect(() => {
    const onPageActive = () => {
      if (document.visibilityState === "visible") {
        setReturned(readVisitMarkers());
      }
    };
    window.addEventListener("focus", onPageActive);
    document.addEventListener("visibilitychange", onPageActive);
    return () => {
      window.removeEventListener("focus", onPageActive);
      document.removeEventListener("visibilitychange", onPageActive);
    };
  }, []);

  const markVisit = (channel: ChannelKey) => {
    try {
      sessionStorage.setItem(`${VISIT_MARKER_PREFIX}${channel}`, "1");
    } catch {
      // Private-mode browsers without storage still work via the focus listener.
    }
  };

  const clearVisit = (channel: ChannelKey) => {
    try {
      sessionStorage.removeItem(`${VISIT_MARKER_PREFIX}${channel}`);
    } catch {
      /* ignore */
    }
    setReturned((prev) => ({ ...prev, [channel]: false }));
  };

  return { returned, markVisit, clearVisit };
}

interface ChannelCardProps {
  channel: ChannelKey;
  title: string;
  subtitle: string;
  url: string;
  rewardAmount: number;
  claimed: boolean;
  /** Accent palette: "whatsapp" (solid green) or "telegram" (blue gradient). */
  icon: ReactNode;
  returned: boolean;
  onJoin: () => void;
  onClaim: () => void;
  claimPending: boolean;
  showCopyLink?: boolean;
}

function ChannelRewardCard({
  channel,
  title,
  subtitle,
  url,
  rewardAmount,
  claimed,
  icon,
  returned,
  onJoin,
  onClaim,
  claimPending,
  showCopyLink,
}: ChannelCardProps) {
  const isWhatsapp = channel === "whatsapp";
  const claimAvailable = returned && rewardAmount > 0;
  const linkConfigured = url.length > 0;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl p-5 text-white shadow-md ${
        isWhatsapp ? "bg-green-600" : "bg-gradient-to-b from-sky-500 to-blue-700"
      }`}
    >
      <div
        className="pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-white/10"
        aria-hidden="true"
      />
      <div className="relative flex h-full flex-col gap-3">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold">{title}</h3>
            <p className="text-xs text-white/80">{subtitle}</p>
          </div>
          {!claimed && rewardAmount > 0 ? (
            <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase">
              Free {formatPKR(rewardAmount)}
            </span>
          ) : null}
        </div>

        {claimed ? (
          <div className="mt-auto flex items-center justify-center gap-1.5 rounded-xl bg-white/15 px-3 py-2.5 text-xs font-semibold text-white/90">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            Reward Claimed
          </div>
        ) : claimAvailable ? (
          <>
            <div className="mt-auto grid grid-cols-2 gap-2">
              <Button
                className={`h-10 whitespace-normal bg-white px-2 text-xs font-semibold sm:text-sm focus-visible:ring-white ${
                  isWhatsapp ? "text-green-700 hover:bg-white/90" : "text-blue-700 hover:bg-white/90"
                }`}
                onClick={onClaim}
                disabled={claimPending}
                aria-label={`Claim your ${isWhatsapp ? "WhatsApp" : "Telegram"} reward`}
              >
                {claimPending ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <Gift className="size-4 shrink-0" aria-hidden="true" />
                )}
                Claim {isWhatsapp ? "WhatsApp" : "Telegram"} Reward
              </Button>
              <Button
                className="h-10 border border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white focus-visible:ring-white"
                onClick={onJoin}
                disabled={!linkConfigured}
                aria-label={`Revisit the ${isWhatsapp ? "WhatsApp" : "Telegram"} channel (opens in a new tab)`}
              >
                <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                Join Channel
              </Button>
            </div>
            <p className="text-center text-[11px] text-white/70">
              Back on Task Earn Hub? Claim your reward now.
            </p>
          </>
        ) : linkConfigured ? (
          <div className="mt-auto grid grid-cols-2 gap-2">
            <Button
              className={`h-10 border border-white/40 bg-white text-xs font-semibold sm:text-sm focus-visible:ring-white ${
                isWhatsapp
                  ? "text-green-700 hover:bg-white/90"
                  : "text-blue-700 hover:bg-white/90"
              } ${showCopyLink ? "" : "col-span-2"}`}
              onClick={onJoin}
              aria-label={`Join the ${isWhatsapp ? "WhatsApp" : "Telegram"} channel (opens in a new tab)`}
            >
              <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
              Join Channel
            </Button>
            {showCopyLink ? (
              <CopyButton
                value={url}
                toastLabel={`${isWhatsapp ? "WhatsApp" : "Telegram"} link copied!`}
                variant="outline"
                className="h-10 border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy Link
              </CopyButton>
            ) : null}
          </div>
        ) : (
          <div className="mt-auto rounded-xl bg-white/10 px-3 py-2.5 text-center text-xs font-medium text-white/75">
            Channel link coming soon — please check back later.
          </div>
        )}
      </div>
    </div>
  );
}

function SocialWidgets({ home }: { home: HomeResponseDTO }) {
  const queryClient = useQueryClient();
  const { returned, markVisit, clearVisit } = useChannelVisit();

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["home"] });
    void queryClient.invalidateQueries({ queryKey: ["session"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const useChannelClaim = (channel: ChannelKey) =>
    useMutation({
      mutationFn: () =>
        apiFetch<PromoClaimResponseDTO>(`/api/home/${channel}`, { method: "POST" }),
      onSuccess: (data) => {
        toast.success(
          `${formatPKR(data.reward)} reward claimed — added to your withdrawable balance!`,
        );
        clearVisit(channel);
        invalidateAll();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Claim failed. Try again.");
      },
    });

  const whatsappClaim = useChannelClaim("whatsapp");
  const telegramClaim = useChannelClaim("telegram");

  const whatsapp = home.whatsapp;
  const telegram = home.telegram;
  const whatsappUrl = home.social.whatsappUrl;
  const telegramUrl = home.social.telegramUrl;

  // Cards hidden entirely when the admin disables the task.
  if (!whatsapp.enabled && !telegram.enabled) return null;

  const joinChannel = (channel: ChannelKey, url: string) => {
    if (!url) return;
    markVisit(channel);
    // Open the EXACT admin-configured URL — unmodified, unproxied. The
    // browser/OS handles the WhatsApp/Telegram app or the web fallback.
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.section variants={item} aria-label="Social channels and rewards" className="grid gap-4 sm:grid-cols-2">
      {whatsapp.enabled ? (
        <ChannelRewardCard
          channel="whatsapp"
          title="Join WhatsApp Channel"
          subtitle="Visit our WhatsApp Channel and claim your reward."
          url={whatsappUrl}
          rewardAmount={whatsapp.rewardAmount}
          claimed={whatsapp.claimed}
          icon={<MessageCircle className="size-5.5" />}
          returned={returned.whatsapp}
          onJoin={() => joinChannel("whatsapp", whatsappUrl)}
          onClaim={() => whatsappClaim.mutate()}
          claimPending={whatsappClaim.isPending}
          showCopyLink
        />
      ) : null}
      {telegram.enabled ? (
        <ChannelRewardCard
          channel="telegram"
          title="Join Telegram Channel"
          subtitle="Visit our Telegram Channel and claim your reward."
          url={telegramUrl}
          rewardAmount={telegram.rewardAmount}
          claimed={telegram.claimed}
          icon={<Send className="size-5.5" />}
          returned={returned.telegram}
          onJoin={() => joinChannel("telegram", telegramUrl)}
          onClaim={() => telegramClaim.mutate()}
          claimPending={telegramClaim.isPending}
        />
      ) : null}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Home dashboard view                                                 */
/* ------------------------------------------------------------------ */

export function OverviewView() {
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoSession, setPromoSession] = useState(0);
  const creditPresentation = useReferralCreditPresentation();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardDTO>("/api/dashboard"),
    refetchInterval: 8_000,
  });

  const home = useQuery({
    queryKey: ["home"],
    queryFn: () => apiFetch<HomeResponseDTO>("/api/home"),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load your dashboard</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          <span>Something went wrong while fetching your data.</span>
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
      <div className="space-y-6">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  const { wallet } = data;
  const homeData = home.data;

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {/* 1. Hero — total balance (simple: label / PKR / Withdraw) */}
      <TotalBalanceCard
        taskBalance={wallet.taskBalance}
        withdrawableBalance={wallet.withdrawableBalance}
        celebration={
          creditPresentation.presentation
            ? {
                id: creditPresentation.presentation.key,
                gain: creditPresentation.presentation.gain,
                total:
                  creditPresentation.presentation.wallet.taskBalance +
                  creditPresentation.presentation.wallet.withdrawableBalance,
              }
            : undefined
        }
      />

      {/* 1b. One-time referral-credit earning card — the real credited
             amounts, presented once per commission transaction */}
      <ReferralCreditCelebration
        presentation={creditPresentation.presentation}
        onDismiss={creditPresentation.dismiss}
      />

      {/* 2-6. Dynamic widgets (announcement, team leader, team salary,
               stats + promo, social rewards) — reference section order */}
      {homeData ? (
        <>
          <AnnouncementCard home={homeData} />
          <TeamLeaderCard home={homeData} />
          <OfferLockedCard home={homeData} />
          <TeamSalaryBanner home={homeData} />
          <QuickStatsGrid
            home={homeData}
            onOpenPromo={() => {
              setPromoSession((s) => s + 1);
              setPromoOpen(true);
            }}
          />
          <SocialWidgets home={homeData} />
        </>
      ) : home.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the home widgets</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>Announcements, offers and rewards failed to load.</span>
            <Button variant="outline" size="sm" onClick={() => void home.refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-6" aria-hidden="true">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-44 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      )}

      <WelcomePopup />
      <PromoBannerOverlay />
      <PromoClaimDialog
        open={promoOpen}
        onOpenChange={setPromoOpen}
        session={promoSession}
      />
    </motion.div>
  );
}
