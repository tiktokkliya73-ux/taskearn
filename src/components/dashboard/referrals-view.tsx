"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Info,
  Link2,
  Lock,
  RefreshCw,
  Share2,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/dashboard/copy-button";
import { apiFetch } from "@/lib/client-api";
import { formatDate } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { InviteRewardLevelDTO, ReferralsResponseDTO } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** "12,500 PKR" — the Invite page's PKR-suffix money format (per reference). */
function pkr(n: number): string {
  return `${Math.abs(n).toLocaleString("en-US")} PKR`;
}

/* ------------------------------------------------------------------ */
/* Referral code card (green hero)                                     */
/* ------------------------------------------------------------------ */

function ReferralCodeCard({ code, commissionText }: { code: string; commissionText: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Referral code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — please copy manually.");
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div className="rounded-2xl bg-primary p-5 text-primary-foreground shadow-lg sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/70">
          Your Referral Code
        </p>
        <p className="mt-2 break-all font-mono text-3xl font-bold tracking-[0.18em] sm:text-4xl" aria-label={`Referral code ${code}`}>
          {code}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-primary-foreground/85">{commissionText}</p>
        <Button
          type="button"
          onClick={copyCode}
          className="mt-4 h-11 w-full gap-2 bg-primary-foreground text-base font-semibold text-primary hover:bg-primary-foreground/90 active:scale-[0.99] sm:w-auto sm:min-w-48"
          aria-label={`Copy referral code ${code}`}
        >
          {copied ? (
            <>
              <Check className="size-4.5" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-4.5" aria-hidden="true" />
              Copy Referral Code
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Referral link card (+ share)                                        */
/* ------------------------------------------------------------------ */

function ReferralLinkCard({ referralLink }: { referralLink: string }) {
  async function handleShare() {
    if (!referralLink) return;
    // Native Web Share API where supported…
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "Task Earn Hub",
          text: "Join me on Task Earn Hub and start earning daily!",
          url: referralLink,
        });
        return;
      } catch (err) {
        // The user closing the share sheet is not an error — do nothing.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // other failures → fall through to the copy fallback
      }
    }
    // …fallback: copy the link.
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success("Referral link copied");
    } catch {
      toast.error("Couldn't share — please copy the link instead.");
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
      <Card className="py-5">
        <CardContent className="space-y-3 px-5">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold">Referral Link</p>
          </div>
          <div className="flex items-stretch gap-2">
            <Input
              readOnly
              value={referralLink}
              aria-label="Your referral link"
              className="min-w-0 flex-1 truncate font-mono text-xs sm:text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <CopyButton value={referralLink} toastLabel="Referral link copied" size="icon" label="Copy referral link" className="h-10 w-10 shrink-0" />
          </div>
          <Button
            type="button"
            onClick={handleShare}
            className="h-11 w-full gap-2 text-base font-semibold active:scale-[0.99]"
            aria-label="Share your referral link"
          >
            <Share2 className="size-4.5" aria-hidden="true" />
            Share Link
          </Button>
          <p className="text-xs text-muted-foreground">
            Anyone signing up through this link is permanently linked to you as your referral.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Team statistics                                                     */
/* ------------------------------------------------------------------ */

function TeamStatRow({ icon, label, value, delay }: { icon: ReactNode; label: string; value: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }}>
      <Card className="py-4">
        <CardContent className="flex items-center gap-3 px-5 py-0">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{label}</p>
          <p className="shrink-0 text-lg font-bold tabular-nums sm:text-xl">{value}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Cash Rewards Levels (purple offer card)                             */
/* ------------------------------------------------------------------ */

function LevelRow({ level, teamDeposits }: { level: InviteRewardLevelDTO; teamDeposits: number }) {
  const unlocked = teamDeposits >= level.required;
  const pct = Math.min(100, Math.round((teamDeposits / level.required) * 100));

  return (
    <div className="rounded-xl bg-white/10 p-3.5 sm:p-4">
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-base font-bold text-purple-950"
          aria-hidden="true"
        >
          {level.level}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold tracking-wide text-white">LEVEL {level.level}</p>
          <p className="text-xs text-white/70">{pkr(level.required)} Joining</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Reward</p>
          <p className="text-lg font-bold tabular-nums leading-tight text-amber-300">{level.reward.toLocaleString("en-US")}</p>
        </div>
      </div>

      <div className="mt-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Level ${level.level} progress`}>
        <div className="h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", unlocked ? "bg-emerald-400" : "bg-emerald-400/90")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[11px] tabular-nums text-white/70">
            {teamDeposits.toLocaleString("en-US")} / {level.required.toLocaleString("en-US")} PKR
          </p>
          {unlocked ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Unlocked
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/75">
              <Lock className="size-3.5" aria-hidden="true" />
              Locked
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CashRewardsCard({ teamDeposits, levels }: { teamDeposits: number; levels: InviteRewardLevelDTO[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-purple-700 to-purple-950 p-5 text-white shadow-lg sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15">
            <Trophy className="size-5.5 text-amber-300" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">Exclusive Offer</p>
            <h2 className="text-xl font-bold leading-tight sm:text-2xl">Cash Rewards Levels</h2>
          </div>
          <Sparkles className="size-5 shrink-0 text-amber-300" aria-hidden="true" />
        </div>

        <div className="mt-4 rounded-xl bg-white/10 p-4">
          <p className="text-sm text-white/75">Your Team Investment</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums text-amber-300">PKR {teamDeposits.toLocaleString("en-US")}</p>
        </div>

        <div className="mt-4 space-y-3">
          {levels.map((level) => (
            <LevelRow key={level.level} level={level} teamDeposits={teamDeposits} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* How it works + Referral policy                                      */
/* ------------------------------------------------------------------ */

function HowItWorksCard({ steps }: { steps: string[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.25 }}>
      <Card className="py-5">
        <CardContent className="space-y-4 px-5">
          <p className="text-base font-semibold">How it works</p>
          <ol className="space-y-3">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <p className="text-sm leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ReferralPolicyCard({ bullets }: { bullets: string[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.3 }}>
      <Card className="py-5">
        <CardContent className="space-y-4 px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Info className="size-4.5" aria-hidden="true" />
            </span>
            <p className="text-base font-semibold">Referral Policy</p>
          </div>
          <ul className="space-y-2.5">
            {bullets.map((bullet, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
          <p className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
            Anti-fraud: referrals sharing your IP address or device are blocked from triggering unlock bonuses.
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Your team (existing members list — collapsible)                     */
/* ------------------------------------------------------------------ */

function YourTeamCard({ list }: { list: ReferralsResponseDTO["list"] }) {
  const [open, setOpen] = useState(false);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.35 }}>
      <Card className="py-0">
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={open}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Users className="size-4.5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Your Team</span>
                <span className="block text-xs text-muted-foreground">
                  {list.length === 0 ? "No referrals yet" : `${list.length} member${list.length === 1 ? "" : "s"} joined with your code`}
                </span>
              </span>
              <ChevronDown
                className={cn("size-4.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t px-5 py-4">
              {list.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <Users className="size-7 text-muted-foreground/60" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">No referrals yet — share your link!</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {list.map((ref) => (
                    <li key={ref.id} className="flex items-center gap-3">
                      <Avatar className="size-8 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                          {initials(ref.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{ref.name}</p>
                        <p className="text-xs text-muted-foreground">Joined {formatDate(ref.joinedAt)}</p>
                      </div>
                      {ref.planActivated ? (
                        <Badge className="shrink-0">{ref.planName ?? "Plan active"}</Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0">
                          Not activated
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Card>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

function InviteSkeleton() {
  return (
    <div className="space-y-6 sm:max-w-xl">
      <div className="space-y-1.5">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-52 w-full rounded-xl" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
      <Skeleton className="h-96 w-full rounded-2xl" />
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function ReferralsView() {
  // Only rendered post-auth on the client, so reading window at first render is safe.
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["referrals"],
    queryFn: () => apiFetch<ReferralsResponseDTO>("/api/referrals"),
  });

  if (isError) {
    return (
      <div className="sm:max-w-xl">
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load your invite page</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>Something went wrong while fetching your referral data.</span>
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
    return <InviteSkeleton />;
  }

  const referralLink = data.code ? `${origin || "https://taskearn.app"}/?ref=${data.code}` : "";
  const invite = data.invite;

  return (
    <div className="space-y-6 sm:max-w-xl">
      {/* 1. Invite Friends header */}
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <UserPlus className="size-6 text-primary sm:size-7" aria-hidden="true" />
          Invite Friends
        </h1>
        <p className="text-sm text-muted-foreground">
          Share your code, grow your team and unlock cash rewards.
        </p>
      </div>

      {/* 2. Referral code card */}
      <ReferralCodeCard code={data.code} commissionText={invite.commissionText} />

      {/* 3. Referral link + share */}
      <ReferralLinkCard referralLink={referralLink} />

      {/* 4. Team statistics — real data from the existing referral system */}
      <div className="space-y-3">
        <TeamStatRow
          icon={<Users className="size-5" aria-hidden="true" />}
          label="Total Team Members"
          value={invite.teamMembers.toLocaleString("en-US")}
          delay={0.1}
        />
        <TeamStatRow
          icon={<Wallet className="size-5" aria-hidden="true" />}
          label="Total Team Deposits"
          value={pkr(invite.teamDeposits)}
          delay={0.13}
        />
        <TeamStatRow
          icon={<TrendingUp className="size-5" aria-hidden="true" />}
          label="Total Referral Commission"
          value={pkr(invite.referralCommission)}
          delay={0.16}
        />
      </div>

      {/* 5 + 6. Cash Rewards Levels with live progress */}
      <CashRewardsCard teamDeposits={invite.teamDeposits} levels={invite.levels} />

      {/* 7. How it works */}
      <HowItWorksCard steps={invite.howItWorks} />

      {/* 8. Referral policy */}
      <ReferralPolicyCard bullets={invite.policy} />

      {/* Existing members list — kept, collapsed by default */}
      <YourTeamCard list={data.list} />
    </div>
  );
}
