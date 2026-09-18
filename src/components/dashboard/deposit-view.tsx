"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, Info, Loader2, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/dashboard/copy-button";
import { useSession } from "@/components/providers";
import { SuccessCelebration, type SuccessCelebrationData } from "@/components/dashboard/success-celebration";
import { animationEnabled } from "@/lib/animations";
import {
  FormField,
  InfoCard,
  MethodSelectCard,
  PageHeader,
  PrimaryButton,
  SectionEnter,
  parseAmount,
  usePaymentMethods,
} from "@/components/dashboard/profile-ui";
import { apiFetch } from "@/lib/client-api";
import { formatPKR } from "@/lib/money";
import type { TransactionDTO } from "@/lib/types";

/* ================================================================== */
/* Deposit page (spec §3) — the old wallet-tab form as its own clean,  */
/* vertical, mobile-first page. SAME /api/wallet/deposit call, SAME    */
/* validation, SAME admin-managed methods & merchant accounts.         */
/* ================================================================== */

export function DepositView() {
  const queryClient = useQueryClient();
  const { animations } = useSession();
  const { query: methodsQuery, methods, selected, setSelected } = usePaymentMethods();
  const [amountRaw, setAmountRaw] = useState("");
  const [txId, setTxId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; txId?: string }>({});
  // Premium presentation for a CONFIRMED instant credit — filled ONLY from
  // the existing deposit response when the transaction comes back
  // completed/approved (real amount, real transaction id). The pending path
  // keeps its existing plain toast.
  const [celebration, setCelebration] = useState<SuccessCelebrationData | null>(null);

  const deposit = useMutation({
    mutationFn: (vars: { paymentMethodId: string; txId: string; amount: number }) =>
      apiFetch<{ transaction: TransactionDTO }>("/api/wallet/deposit", { method: "POST", json: vars }),
    onSuccess: (res) => {
      if (res.transaction.status === "completed" || res.transaction.status === "approved") {
        // Genuine instant credit. Premium presentation when the admin's
        // animation switch is ON; a plain confirmation toast when OFF —
        // the deposit itself already succeeded either way.
        if (animationEnabled(animations, "deposit")) {
          setCelebration({
            key: `deposit-${res.transaction.id}`,
            heading: "Deposit Credited",
            title: "",
            titleCountUpTo: Math.abs(res.transaction.amount),
            note: "Successfully credited to your wallet.",
          });
        } else {
          toast.success(`Deposit of ${formatPKR(Math.abs(res.transaction.amount))} credited to your wallet`);
        }
      } else {
        toast.success("Deposit submitted — awaiting approval");
      }
      setAmountRaw("");
      setTxId("");
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Deposit failed. Please try again.");
    },
  });

  const amount = parseAmount(amountRaw);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (deposit.isPending || !selected) return;

    const errors: { amount?: string; txId?: string } = {};
    if (amount == null || amount < 1) errors.amount = "Enter the amount you sent.";
    if (txId.trim().length < 4) errors.txId = "Paste the transaction ID from your payment app.";
    setFieldErrors(errors);
    if (errors.amount || errors.txId) return;
    if (amount == null) return;

    deposit.mutate({ paymentMethodId: selected.id, txId: txId.trim(), amount });
  }

  return (
    <div className="space-y-6">
      {/* Premium credited-deposit presentation — CONFIRMED success only,
          auto-completes so it can never block the deposit flow. */}
      <SuccessCelebration data={celebration} onComplete={() => setCelebration(null)} />

      <SectionEnter>
        <PageHeader
          title="Deposit"
          subtitle="Top up your wallet balance"
          right={
            methodsQuery.isLoading ? null : (
              <span className="rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
                {methods.length} method{methods.length === 1 ? "" : "s"}
              </span>
            )
          }
        />
      </SectionEnter>

      {methodsQuery.isError ? (
        <SectionEnter>
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load payment methods</AlertTitle>
            <AlertDescription className="flex items-center gap-3">
              <span>Check your connection and try again.</span>
              <Button variant="outline" size="sm" onClick={() => void methodsQuery.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </SectionEnter>
      ) : (
        <SectionEnter delay={0.05}>
          {/* Instruction card — the existing deposit process, explained */}
          <InfoCard icon={Info} title="How deposits work">
            <p>
              Send money to the account shown for your selected method, then submit the amount with
              the Transaction ID (TID) from your payment app receipt.
            </p>
            <p>
              Deposits are reviewed by an admin — your wallet is credited once the payment is
              approved.
            </p>
          </InfoCard>
        </SectionEnter>
      )}

      <SectionEnter delay={0.1}>
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {/* Amount (PKR) */}
          <FormField
            label="Amount (PKR)"
            htmlFor="deposit-amount"
            error={fieldErrors.amount}
            hint="The exact amount you sent."
          >
            <Input
              id="deposit-amount"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              placeholder="e.g. 2500"
              className="h-12 rounded-xl text-base"
              aria-invalid={Boolean(fieldErrors.amount)}
            />
          </FormField>

          {/* Payment Method */}
          <FormField label="Payment Method">
            {methodsQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[72px] w-full rounded-2xl" />
                ))}
              </div>
            ) : methods.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                No payment methods are configured yet.
              </p>
            ) : (
              <div role="radiogroup" aria-label="Payment method" className="space-y-2">
                {methods.map((m) => (
                  <MethodSelectCard
                    key={m.id}
                    method={m}
                    selected={selected?.id === m.id}
                    onSelect={() => setSelected(m)}
                  />
                ))}
              </div>
            )}
          </FormField>

          {/* Merchant account for the selected method (admin-managed, dynamic) */}
          {selected ? (
            <div className="space-y-2.5 rounded-2xl border bg-muted/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Send payment to
              </p>
              {selected.accountTitle ? (
                <p className="truncate text-sm font-medium" title={selected.accountTitle}>
                  {selected.accountTitle}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-mono text-sm" title={selected.accountNumber}>
                  {selected.accountNumber}
                </span>
                <CopyButton
                  value={selected.accountNumber}
                  toastLabel="Account number copied"
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  label="Copy account number"
                />
              </div>
              {selected.instructions ? (
                <p className="border-t pt-2.5 text-xs leading-relaxed text-muted-foreground">
                  {selected.instructions}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Transaction ID */}
          <FormField
            label="Transaction ID"
            htmlFor="deposit-txid"
            error={fieldErrors.txId}
            hint="From your payment app receipt — admin uses it to verify your payment."
          >
            <Input
              id="deposit-txid"
              value={txId}
              onChange={(e) => setTxId(e.target.value)}
              placeholder="Paste the transaction ID"
              autoComplete="off"
              className="h-12 rounded-xl text-base"
              aria-invalid={Boolean(fieldErrors.txId)}
            />
          </FormField>

          {/* Summary + Submit */}
          {amount != null && amount > 0 ? (
            <div className="flex items-center justify-between rounded-xl border bg-primary/[0.04] px-4 py-3 text-sm">
              <span className="text-muted-foreground">Deposit amount</span>
              <span className="font-bold text-primary tabular-nums">{formatPKR(amount)}</span>
            </div>
          ) : null}

          <PrimaryButton type="submit" icon={ArrowDownToLine} disabled={deposit.isPending || !selected}>
            {deposit.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              "Submit Deposit"
            )}
          </PrimaryButton>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ReceiptText className="size-3.5" aria-hidden="true" />
            Reviewed by an admin before your balance is credited
          </p>
        </form>
      </SectionEnter>
    </div>
  );
}

