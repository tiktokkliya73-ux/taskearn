"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Info, Loader2, Send, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FormField,
  InfoCard,
  PageHeader,
  PrimaryButton,
  SectionEnter,
  parseAmount,
  useWithdrawalMethods,
} from "@/components/dashboard/profile-ui";
import { WithdrawalMethodSelect } from "@/components/dashboard/withdrawal-method-select";
import { useSession } from "@/components/providers";
import { animationEnabled } from "@/lib/animations";
import { SuccessCelebration, type SuccessCelebrationData } from "@/components/dashboard/success-celebration";
import { apiFetch } from "@/lib/client-api";
import { formatPKR } from "@/lib/money";
import type { TransactionDTO, WalletResponseDTO } from "@/lib/types";

/* ================================================================== */
/* Withdraw page — the vertical form with the professional Withdrawal   */
/* Method dropdown. SAME /api/wallet/withdraw call, SAME validation.     */
/* The payout channels come from the admin-managed withdrawal_methods   */
/* rows (/api/public/withdrawal-methods) and the payout-account field   */
/* below the dropdown adapts to the selected channel's kind.            */
/*                                                                      */
/* Withdrawal policy (enforced server-side in /api/wallet/withdraw,     */
/* mirrored here only as a friendly pre-check): minimum Rs 20 per       */
/* request, maximum = MIN(Task Balance, Withdrawable Balance). The      */
/* Task Balance is ONLY an eligibility cap — it is never withdrawn or   */
/* deducted; just the Withdrawable Balance pays out.                    */
/* ================================================================== */

/** Fixed policy minimum — mirror of the server's MIN_WITHDRAWAL_AMOUNT. */
const MIN_WITHDRAWAL = 20;

export function WithdrawView() {
  const queryClient = useQueryClient();
  const { animations } = useSession();
  const { query: methodsQuery, methods, selected, setSelected } = useWithdrawalMethods();
  const [accountDetails, setAccountDetails] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ account?: string; amount?: string }>({});
  // Premium presentation for a CONFIRMED withdrawal-request submission —
  // filled ONLY from the existing successful response (real amount, real
  // transaction id). The request itself always lands exactly as before;
  // when the admin's animation switch is OFF the plain toast is kept.
  const [celebration, setCelebration] = useState<SuccessCelebrationData | null>(null);

  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponseDTO>("/api/wallet"),
    refetchInterval: 10_000,
  });

  const withdraw = useMutation({
    mutationFn: (vars: { paymentMethodId: string; accountDetails: string; amount: number }) =>
      apiFetch<{ transaction: TransactionDTO }>("/api/wallet/withdraw", { method: "POST", json: vars }),
    onSuccess: (res) => {
      // Genuine SUCCESS: the withdrawal request was accepted by the existing
      // system. Premium presentation when enabled; plain toast when the
      // admin disabled the animation — the request works either way.
      if (animationEnabled(animations, "withdrawal")) {
        setCelebration({
          key: `withdraw-${res.transaction.id}`,
          heading: "Withdrawal Requested",
          title: "",
          titleCountUpTo: Math.abs(res.transaction.amount),
          note: "Your request is being reviewed — funds are sent once it is approved.",
        });
      } else {
        toast.success("Withdrawal request submitted");
      }
      setAmountRaw("");
      setAccountDetails("");
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Withdrawal failed. Please try again.");
    },
  });

  // Two SEPARATE balances — never mirrored, never the same calculated value:
  //   Dashboard Balance = the MAIN balance (task earnings — locked from
  //   withdrawal until unlocked via referrals).
  //   Withdrawable     = the withdrawable pocket (referral commissions,
  //   unlocked funds, top-ups) — the only amount withdrawals are validated
  //   against (client hint + server-side source of truth).
  const withdrawable = wallet.data?.wallet.withdrawableBalance ?? 0;
  const taskBalance = wallet.data?.wallet.taskBalance ?? 0;
  const dashboardBalance = taskBalance;
  const amount = parseAmount(amountRaw);
  // Per-request maximum = MIN(Task Balance, Withdrawable Balance) — the Task
  // Balance only gates eligibility, so it caps the request without ever
  // being withdrawn or deducted itself.
  const maxEligible = Math.min(taskBalance, withdrawable);

  // The payout-account field adapts to the selected channel's kind:
  // wallets ask for the member's mobile/account number, banks for the
  // bank account number — exactly the fields the existing submission
  // logic stores in accountDetails.
  const isBankChannel = selected?.kind === "bank";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (withdraw.isPending || !selected) return;

    const errors: { account?: string; amount?: string } = {};
    if (accountDetails.trim().length < 5) errors.account = "Enter the account / wallet you want funds sent to.";
    if (amount == null) {
      errors.amount = "Enter a valid amount.";
    } else {
      if (amount < MIN_WITHDRAWAL) errors.amount = `Minimum withdrawal is ${formatPKR(MIN_WITHDRAWAL)}.`;
      else if (amount > taskBalance) errors.amount = `This exceeds your Task Balance of ${formatPKR(taskBalance)}.`;
      else if (amount > withdrawable) errors.amount = `You only have ${formatPKR(withdrawable)} available.`;
    }
    setFieldErrors(errors);
    if (errors.account || errors.amount) return;
    if (amount == null) return;

    withdraw.mutate({
      paymentMethodId: selected.id,
      accountDetails: accountDetails.trim(),
      amount,
    });
  }

  return (
    <div className="space-y-6">
      {/* Premium withdrawal-request presentation — CONFIRMED success only,
          auto-completes so it can never block the withdraw flow. */}
      <SuccessCelebration data={celebration} onComplete={() => setCelebration(null)} />

      <SectionEnter>
        <PageHeader title="Withdraw" subtitle="Cash out your withdrawable balance" />
      </SectionEnter>

      {/* Balance tiles — dynamic from /api/wallet */}
      <SectionEnter delay={0.05}>
        <section
          aria-label="Available balance"
          className="grid grid-cols-2 gap-3 sm:gap-4"
        >
          <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Wallet className="size-3.5" aria-hidden="true" />
              Dashboard Balance
            </p>
            {wallet.isLoading ? (
              <Skeleton className="mt-2 h-7 w-28" />
            ) : (
              <p className="mt-1.5 text-lg font-bold tracking-tight tabular-nums sm:text-xl">
                {formatPKR(dashboardBalance)}
              </p>
            )}
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
              Task earnings — unlock via referrals
            </p>
          </div>
          <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 shadow-sm sm:p-5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <BadgeCheck className="size-3.5 text-primary" aria-hidden="true" />
              Withdrawable
            </p>
            {wallet.isLoading ? (
              <Skeleton className="mt-2 h-7 w-28" />
            ) : (
              <p className="mt-1.5 text-lg font-bold tracking-tight text-primary tabular-nums sm:text-xl">
                {formatPKR(withdrawable)}
              </p>
            )}
            <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
              Available to withdraw
            </p>
          </div>
        </section>
      </SectionEnter>

      {wallet.isError ? (
        <SectionEnter>
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load your wallet</AlertTitle>
            <AlertDescription className="flex items-center gap-3">
              <span>Something went wrong while fetching your wallet.</span>
              <Button variant="outline" size="sm" onClick={() => void wallet.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </SectionEnter>
      ) : (
        <SectionEnter delay={0.1}>
          <InfoCard icon={Info} title="Before you request">
            <p>
              Minimum {formatPKR(MIN_WITHDRAWAL)} per request · the maximum you can request is
              the lower of your Task Balance ({formatPKR(taskBalance)}) and Withdrawable Balance
              ({formatPKR(withdrawable)}). Funds are sent to your account once an admin approves
              the request.
            </p>
            {maxEligible < MIN_WITHDRAWAL ? (
              <p className="font-medium text-amber-600 dark:text-amber-400">
                Your current eligible amount ({formatPKR(maxEligible)}) is below the{" "}
                {formatPKR(MIN_WITHDRAWAL)} minimum — keep earning to unlock withdrawals.
              </p>
            ) : null}
          </InfoCard>
        </SectionEnter>
      )}

      <SectionEnter delay={0.15}>
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {/* Amount */}
          <FormField
            label="Amount (PKR)"
            htmlFor="withdraw-amount"
            error={fieldErrors.amount}
            hint={
              <>
                Min {formatPKR(MIN_WITHDRAWAL)} — Max {formatPKR(maxEligible)} · Available{" "}
                {formatPKR(withdrawable)}
              </>
            }
          >
            <Input
              id="withdraw-amount"
              type="number"
              inputMode="numeric"
              min={MIN_WITHDRAWAL}
              max={maxEligible}
              step={1}
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              placeholder="Enter amount"
              className="h-12 rounded-xl text-base"
              aria-invalid={Boolean(fieldErrors.amount)}
            />
          </FormField>

          {/* Withdrawal Method — the dropdown lists the admin-managed payout
              channels (name + logo only); the member's own payout account is
              the separate field below it. */}
          <FormField label="Withdrawal Method" htmlFor="withdraw-method">
            {methodsQuery.isLoading ? (
              <Skeleton className="h-12 w-full rounded-xl" />
            ) : methods.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                No withdrawal methods are configured yet.
              </p>
            ) : (
              <WithdrawalMethodSelect
                id="withdraw-method"
                methods={methods}
                value={selected}
                onChange={setSelected}
                disabled={withdraw.isPending}
              />
            )}
          </FormField>

          {/* User payout account — adapts to the selected channel */}
          <FormField
            label={isBankChannel ? "Bank Account Number" : "Account / Mobile Number"}
            htmlFor="withdraw-account"
            error={fieldErrors.account}
            hint={
              isBankChannel
                ? "Your bank account number for this payout method."
                : "The account / mobile number funds should be sent to."
            }
          >
            <Input
              id="withdraw-account"
              value={accountDetails}
              onChange={(e) => setAccountDetails(e.target.value)}
              placeholder={
                isBankChannel ? "Enter account number" : "03XXXXXXXXX — your payout account"
              }
              autoComplete="off"
              className="h-12 rounded-xl text-base"
              aria-invalid={Boolean(fieldErrors.account)}
            />
          </FormField>

          {/* Summary */}
          {amount != null && amount > 0 ? (
            <div className="flex items-center justify-between rounded-xl border bg-primary/[0.04] px-4 py-3 text-sm">
              <span className="text-muted-foreground">You&apos;ll receive</span>
              <span className="font-bold text-primary tabular-nums">{formatPKR(amount)}</span>
            </div>
          ) : null}

          <PrimaryButton
            type="submit"
            icon={Send}
            disabled={withdraw.isPending || maxEligible < MIN_WITHDRAWAL || !selected}
          >
            {withdraw.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              "Request Withdrawal"
            )}
          </PrimaryButton>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Wallet className="size-3.5" aria-hidden="true" />
            Reviewed by an admin before funds are sent
          </p>
        </form>
      </SectionEnter>
    </div>
  );
}
