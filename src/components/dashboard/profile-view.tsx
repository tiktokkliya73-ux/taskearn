"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  CalendarDays,
  Headset,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MailPlus,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CopyButton } from "@/components/dashboard/copy-button";
import {
  ChangePasswordDialog,
  RecoveryEmailDialog,
} from "@/components/dashboard/account-dialogs";
import {
  ProfileOption,
  ProfileSection,
  SectionEnter,
} from "@/components/dashboard/profile-ui";
import { useSession } from "@/components/providers";
import {
  CountUp,
  ReferralCreditCelebration,
  useReferralCreditPresentation,
} from "@/components/dashboard/referral-credit-celebration";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { formatDate, formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { RecoveryEmailResponseDTO } from "@/lib/types";

/* ================================================================== */
/* Profile hub (spec §1) — clean sections, one option per row, every   */
/* tap opens a dedicated page/modal instead of the old cramped tabs.  */
/* All data stays dynamic (session + existing APIs).                  */
/* ================================================================== */

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* User profile card — avatar · name · email · referral code · balance */
/* While a NEW referral commission is being presented, the Withdrawable */
/* digits count up to the fresh real value — presentation only.         */
/* ------------------------------------------------------------------ */

function ProfileHeader({
  celebration,
}: {
  /** Active referral-credit presentation (visual only). */
  celebration?: { id: string; gain: number; withdrawable: number };
}) {
  const { user, wallet } = useSession();
  const active = celebration && celebration.gain > 0 ? celebration : null;

  return (
    <section
      aria-label="Your profile"
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      {/* Identity */}
      <div className="flex items-center gap-4 p-4 sm:p-5">
        <Avatar className="size-16 shrink-0 border shadow-sm">
          <AvatarFallback className="bg-primary/10 text-lg font-bold text-primary">
            {user ? initials(user.name) : "…"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold leading-tight tracking-tight">
            {user?.name ?? <span className="text-muted-foreground">Loading…</span>}
          </h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground" title={user?.email ?? ""}>
            {user?.email ?? ""}
          </p>
          {user ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border bg-primary/[0.05] px-2.5 py-1 text-xs font-medium text-primary">
                <BadgeCheck className="size-3.5" aria-hidden="true" />
                <span className="font-mono tracking-wide">{user.referralCode}</span>
              </span>
              <CopyButton
                value={user.referralCode}
                toastLabel="Referral code copied"
                label="Copy referral code"
                variant="ghost"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
              />
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-muted-foreground"
                title={user.createdAt ? formatDate(user.createdAt) : undefined}
              >
                <CalendarDays className="size-3.5" aria-hidden="true" />
                Member
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Balances — the existing dual-wallet data, presented compactly */}
      <div className="grid grid-cols-2 divide-x border-t bg-primary/[0.03]">
        <div className={cn("px-4 py-3.5 sm:px-5", active && "bg-emerald-500/[0.06]")}>
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <BadgeCheck className="size-3.5 text-primary" aria-hidden="true" />
            Withdrawable
          </p>
          <p className="relative mt-1 text-base font-bold text-primary tabular-nums sm:text-lg">
            {active ? (
              <CountUp
                key={`w-${active.id}`}
                from={Math.max(0, active.withdrawable - active.gain)}
                to={active.withdrawable}
                format={(n) => formatPKR(n)}
              />
            ) : wallet ? (
              formatPKR(wallet.withdrawableBalance)
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            {active ? (
              <motion.span
                className="absolute -top-1 right-0 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-md shadow-emerald-500/30"
                initial={{ opacity: 0, y: 10, scale: 0.85 }}
                animate={{ opacity: [0, 1, 1, 0], y: -22, scale: [0.85, 1, 1, 1] }}
                transition={{ duration: 2.4, times: [0, 0.12, 0.72, 1], ease: "easeOut" }}
                aria-hidden="true"
              >
                {formatPKR(active.gain, { sign: true })}
              </motion.span>
            ) : null}
          </p>
        </div>
        <div className="px-4 py-3.5 sm:px-5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Wallet className="size-3.5" aria-hidden="true" />
            Task Balance
          </p>
          <p className="mt-1 text-base font-bold tabular-nums sm:text-lg">
            {wallet ? formatPKR(wallet.taskBalance) : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Profile view                                                        */
/* ------------------------------------------------------------------ */

export function ProfileView() {
  const { logout } = useSession();
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [recoveryEmailOpen, setRecoveryEmailOpen] = useState(false);
  const creditPresentation = useReferralCreditPresentation();

  // Saved recovery email — shows the current value on the ACCOUNT row.
  const recovery = useQuery({
    queryKey: ["recovery-email"],
    queryFn: () => apiFetch<RecoveryEmailResponseDTO>("/api/auth/recovery-email"),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-8">
      <SectionEnter>
        <ProfileHeader
          celebration={
            creditPresentation.presentation
              ? {
                  id: creditPresentation.presentation.key,
                  gain: creditPresentation.presentation.gain,
                  withdrawable: creditPresentation.presentation.wallet.withdrawableBalance,
                }
              : undefined
          }
        />
      </SectionEnter>

      {/* One-time referral-credit earning card — the real credited
          amounts, presented once per commission transaction */}
      <ReferralCreditCelebration
        presentation={creditPresentation.presentation}
        onDismiss={creditPresentation.dismiss}
      />

      {/* QUICK ACTIONS */}
      <SectionEnter delay={0.05}>
        <ProfileSection title="Quick Actions">
          <ProfileOption
            icon={ArrowDownToLine}
            title="Deposit"
            description="Add funds to your wallet"
            onClick={() => navigateTo("/dashboard/deposit")}
          />
          <ProfileOption
            icon={ArrowUpFromLine}
            iconTone="primary"
            title="Withdraw"
            description="Cash out your withdrawable balance"
            onClick={() => navigateTo("/dashboard/withdraw")}
          />
          <ProfileOption
            icon={Headset}
            title="Support"
            description="Get help — send us a message"
            onClick={() => navigateTo("/dashboard/support")}
          />
        </ProfileSection>
      </SectionEnter>

      {/* HISTORY */}
      <SectionEnter delay={0.1}>
        <ProfileSection title="History">
          <ProfileOption
            icon={ArrowUpFromLine}
            iconTone="neutral"
            title="Withdrawal History"
            description="Your payout requests and their status"
            onClick={() => navigateTo("/dashboard/history/withdrawals")}
          />
          <ProfileOption
            icon={ReceiptText}
            iconTone="neutral"
            title="Deposit History"
            description="Payments you submitted for review"
            onClick={() => navigateTo("/dashboard/history/deposits")}
          />
          <ProfileOption
            icon={Wallet}
            iconTone="neutral"
            title="Balance History"
            description="Credits and deductions on your account"
            onClick={() => navigateTo("/dashboard/history/balance")}
          />
        </ProfileSection>
      </SectionEnter>

      {/* ACCOUNT */}
      <SectionEnter delay={0.15}>
        <ProfileSection title="Account">
          <ProfileOption
            icon={KeyRound}
            title="Change Password"
            description="Update your sign-in password"
            onClick={() => setChangePasswordOpen(true)}
          />
          <ProfileOption
            icon={recovery.isLoading || !recovery.data?.recoveryEmail ? MailPlus : Mail}
            title="Recovery Email"
            description={
              recovery.data?.recoveryEmail
                ? `Saved: ${recovery.data.recoveryEmail}`
                : "Add a secondary contact for account recovery"
            }
            onClick={() => setRecoveryEmailOpen(true)}
          />
          <ProfileOption
            icon={LogOut}
            title="Logout"
            description="Sign out of your account"
            onClick={() => void logout()}
            destructive
            showArrow={false}
            trailing={
              <span
                aria-hidden="true"
                className="flex h-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 px-4 text-sm font-semibold text-destructive"
              >
                Logout
              </span>
            }
          />
        </ProfileSection>
      </SectionEnter>

      {/* Dedicated account modals */}
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
      <RecoveryEmailDialog open={recoveryEmailOpen} onOpenChange={setRecoveryEmailOpen} />
    </div>
  );
}
