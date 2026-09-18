"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  History,
  ImagePlus,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/dashboard/copy-button";
import { SuccessCelebration, type SuccessCelebrationData } from "@/components/dashboard/success-celebration";
import {
  MethodVisual,
  PaymentMethodCard,
  PROOF_ACCEPT,
  downscaleToDataUrl,
  isCryptoMethod,
  methodIcon,
  validateProofFile,
} from "@/components/dashboard/payment-methods";
import { useSession } from "@/components/providers";
import { animationEnabled } from "@/lib/animations";
import { apiFetch } from "@/lib/client-api";
import { navigateTo, useHashRoute } from "@/lib/hash-router";
import { formatDate, formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  ActivatePlanResponseDTO,
  PackageCheckoutResponseDTO,
  PackageDTO,
  PackagesResponseDTO,
  PaymentMethodDTO,
  PaymentMethodsResponseDTO,
  PlanDTO,
  PurchasePackageResponseDTO,
  TransactionDTO,
  UserPackageDTO,
} from "@/lib/types";

/* ================================================================== */
/* Multi-step checkout (packages + VIP plans)                          */
/*                                                                    */
/* Hash-routed steps — each is a real screen with its own URL, so      */
/* browser Back/Forward and refresh keep working:                      */
/*   #/dashboard/checkout/{package|plan}/{id}           → Step 1       */
/*   #/dashboard/checkout/{package|plan}/{id}/method    → Step 2       */
/*   #/dashboard/checkout/{package|plan}/{id}/pay?method=… → Step 3    */
/*                                                                    */
/* The plan/package and payment method are resolved from the URL and   */
/* re-fetched from the existing APIs on every mount — never from       */
/* transient client state. Submissions hit the SAME existing           */
/* endpoints (/api/packages/checkout, /api/packages/purchase,          */
/* /api/plans/activate) with unchanged business logic.                 */
/* ================================================================== */

/** /dashboard/checkout/(package|plan)/(id)(/(method|pay))? */
const CHECKOUT_ROUTE_RE = /^\/dashboard\/checkout\/(package|plan)\/([^/]+?)(?:\/(method|pay))?$/;

/** Transaction/reference IDs (packages: alnum e.g. TXN12345678; plans: 11-12 digits). */
const PACKAGE_TXID_PATTERN = /^[A-Za-z0-9-]{6,40}$/;
const PLAN_TID_PATTERN = /^\d{11,12}$/;

const stepVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

type CheckoutKind = "package" | "plan";
type CheckoutStep = "confirm" | "method" | "pay";

/** The selected plan/package normalized for the shared checkout UI. */
interface CheckoutItem {
  kind: CheckoutKind;
  id: string;
  title: string;
  description: string | null;
  price: number;
  dailyEarning: number;
  durationDays: number;
  /** Packages only. */
  totalReturn: number | null;
  netProfit: number | null;
  /** Plans only. */
  rewardPerTask: number | null;
  dailyTaskLimit: number | null;
}

function stepUrl(kind: CheckoutKind, id: string, step: CheckoutStep, methodId?: string): string {
  const base = `/dashboard/checkout/${kind}/${id}`;
  if (step === "confirm") return base;
  if (step === "method") return `${base}/method`;
  return `${base}/pay?method=${encodeURIComponent(methodId ?? "")}`;
}

function catalogUrl(kind: CheckoutKind): string {
  return kind === "package" ? "/dashboard/packages" : "/dashboard/plans";
}

/** "Ends" label for a package instance — long horizons read as Lifetime. */
function endsLabel(up: UserPackageDTO): string {
  const days = Math.round(
    (new Date(up.endsAt).getTime() - new Date(up.startedAt).getTime()) / 86_400_000,
  );
  if (days > 3650) return "Lifetime";
  return formatDate(up.endsAt);
}

/* ------------------------------------------------------------------ */
/* Progress indicator — ● Plan ─── ○ Payment ─── ○ Submit              */
/* ------------------------------------------------------------------ */

const PROGRESS_STEPS: { n: 1 | 2 | 3; label: string }[] = [
  { n: 1, label: "Plan" },
  { n: 2, label: "Payment" },
  { n: 3, label: "Submit" },
];

function CheckoutProgress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label="Checkout progress"
      className="mx-auto flex w-full max-w-xs items-center px-2"
    >
      {PROGRESS_STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <Fragment key={s.n}>
            {i > 0 ? (
              <span
                aria-hidden="true"
                className={cn("h-0.5 flex-1 rounded-full", s.n <= current ? "bg-primary" : "bg-border")}
              />
            ) : null}
            <li className="flex w-12 flex-col items-center gap-1">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-primary/10 text-primary ring-2 ring-primary/25",
                  !done && !active && "border-border bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden="true" /> : s.n}
              </span>
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* "YOU'RE BUYING" summary card (values from the DB row)               */
/* ------------------------------------------------------------------ */

function PlanSummaryCard({ item }: { item: CheckoutItem }) {
  const metrics = [
    { label: "Invest", value: formatPKR(item.price), accent: false },
    { label: "Daily", value: formatPKR(item.dailyEarning), accent: true },
    { label: "Days", value: item.durationDays.toLocaleString("en-US"), accent: false },
  ];
  return (
    <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 to-primary/5 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
        You&apos;re buying
      </p>
      <h2 className="mt-1 text-xl font-bold leading-tight">{item.title}</h2>
      <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border bg-background/80">
        {metrics.map((m, i) => (
          <div
            key={m.label}
            className={cn(
              "flex flex-col items-center justify-center px-1 py-2.5",
              i > 0 && "border-l",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {m.label}
            </p>
            <p
              className={cn(
                "mt-0.5 text-xs font-bold tabular-nums sm:text-sm",
                m.accent && "text-primary",
              )}
            >
              {m.value}
            </p>
          </div>
        ))}
      </div>

      {item.kind === "plan" && item.rewardPerTask != null && item.dailyTaskLimit != null ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Badge variant="secondary">{formatPKR(item.rewardPerTask)} per task</Badge>
          <Badge variant="secondary">{item.dailyTaskLimit} tasks/day</Badge>
        </div>
      ) : null}
      {item.kind === "package" && item.totalReturn != null && item.netProfit != null ? (
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
          Total return {formatPKR(item.totalReturn)} <span aria-hidden="true">·</span> Net profit{" "}
          {formatPKR(item.netProfit)}
        </p>
      ) : null}
      {item.description ? (
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* STEP 1 · Plan confirmation                                          */
/* ------------------------------------------------------------------ */

function StepConfirm({
  item,
  onContinue,
  onBack,
}: {
  item: CheckoutItem;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <motion.section
      variants={stepVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-label="Plan confirmation"
      className="space-y-4"
    >
      <PlanSummaryCard item={item} />

      <p className="text-center text-xs text-muted-foreground">
        Review your selection, then choose how you want to pay.
      </p>

      <Button type="button" className="h-12 w-full text-base" onClick={onContinue}>
        Continue
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>

      <Button
        type="button"
        variant="ghost"
        className="h-10 w-full gap-1.5 text-muted-foreground"
        onClick={onBack}
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {item.kind === "package" ? "Back to Plans" : "Back to VIP Plans"}
      </Button>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* STEP 2 · Select payment method                                      */
/* ------------------------------------------------------------------ */

/** Wallet Balance secondary line (live balance vs price). */
function walletSecondary(loading: boolean, available: number, price: number): string {
  if (loading) return "Checking your balance…";
  if (available < price) return `Insufficient — you need ${formatPKR(price - available)} more`;
  return `Available ${formatPKR(available)} · activates instantly`;
}

function StepMethod({
  item,
  methodsQuery,
  walletImageUrl,
  onChange,
  onBack,
  onSelectMethod,
  onSelectWallet,
}: {
  item: CheckoutItem;
  methodsQuery: ReturnType<typeof useQuery<PaymentMethodsResponseDTO>>;
  walletImageUrl: string | null;
  onChange: () => void;
  onBack: () => void;
  onSelectMethod: (method: PaymentMethodDTO) => void;
  onSelectWallet: () => void;
}) {
  const methods = methodsQuery.data?.methods ?? [];
  const { wallet, status } = useSession();
  const walletLoading = status === "loading" || wallet === null;
  const walletAvailable = (wallet?.taskBalance ?? 0) + (wallet?.withdrawableBalance ?? 0);

  return (
    <motion.section
      variants={stepVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-label="Select payment method"
      className="space-y-4"
    >
      {/* Header — clear hierarchy: action → plan → dynamic amount */}
      <div className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight">Select Payment Method</h2>
        <p className="text-sm font-medium text-muted-foreground">{item.title}</p>
        <p className="text-2xl font-bold tabular-nums text-primary">{formatPKR(item.price)}</p>
      </div>

      {methodsQuery.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : methodsQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load payment methods</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>Check your connection and try again.</span>
            <Button variant="outline" size="sm" onClick={() => void methodsQuery.refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : methods.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No payment methods are configured yet — please check back soon.
        </p>
      ) : (
        <ul className="space-y-3">
          {methods.map((m) => (
            <PaymentMethodCard
              key={m.id}
              imageUrl={m.logoUrl}
              fallbackIcon={methodIcon(m.name)}
              name={m.name}
              secondary={m.accountNumber}
              onSelect={() => onSelectMethod(m)}
              ariaLabel={`Pay with ${m.name}`}
            />
          ))}
          {item.kind === "package" ? (
            <PaymentMethodCard
              imageUrl={walletImageUrl}
              fallbackIcon={Wallet}
              name="Wallet Balance"
              secondary={walletSecondary(walletLoading, walletAvailable, item.price)}
              onSelect={onSelectWallet}
              ariaLabel="Pay with wallet balance"
              tone="emerald"
            />
          ) : null}
        </ul>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          className="h-10 flex-1 gap-1.5 text-muted-foreground"
          onClick={onChange}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
      </div>
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Shared merchant card (Step 3 — external methods)                    */
/* ------------------------------------------------------------------ */

function MerchantCard({ method, price }: { method: PaymentMethodDTO; price: number }) {
  return (
    <div className="space-y-2">
      <Label>Send payment to</Label>
      <div className="space-y-3 rounded-xl border bg-muted/40 p-3">
        {method.accountTitle ? (
          <p className="min-w-0 truncate text-sm font-medium" title={method.accountTitle}>
            {method.accountTitle}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 break-all font-mono text-sm" title={method.accountNumber}>
            {method.accountNumber}
          </span>
          <CopyButton
            value={method.accountNumber}
            toastLabel="Account number copied"
            size="sm"
            variant="ghost"
            className="shrink-0"
            label="Copy account number"
          />
        </div>
        {method.logoUrl ? (
          <div className="flex items-center gap-3 border-t pt-3">
            <img
              src={method.logoUrl}
              alt={`${method.name} QR code`}
              className="size-16 shrink-0 rounded-md border bg-background object-contain p-1"
            />
            <p className="text-xs text-muted-foreground">
              {isCryptoMethod(method.name)
                ? `Scan the QR with your wallet app, or copy the address above. Send exactly ${formatPKR(price)} worth.`
                : "Scan the code with your payment app, or copy the account above."}
            </p>
          </div>
        ) : null}
      </div>
      <p className="text-xs font-medium text-foreground">
        Send {formatPKR(price)} to the account above, then submit the transaction details below.
      </p>
    </div>
  );
}

/** Payment screenshot upload (existing secure pipeline: validate → downscale). */
function ProofUpload({
  proof,
  setProof,
  requireProof,
  disabled,
  idPrefix,
}: {
  proof: string | null;
  setProof: (v: string | null) => void;
  requireProof: boolean;
  disabled: boolean;
  idPrefix: string;
}) {
  const [proofBusy, setProofBusy] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleProofFile(file: File | undefined) {
    if (!file) return;
    setProofError(null);
    const err = validateProofFile(file);
    if (err) {
      setProofError(err);
      return;
    }
    setProofBusy(true);
    try {
      const dataUrl = await downscaleToDataUrl(file);
      setProof(dataUrl);
    } catch {
      setProofError("Could not read that image. Try a different file.");
    } finally {
      setProofBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`${idPrefix}-proof`}>Payment screenshot</Label>
        {requireProof ? (
          <Badge variant="secondary" className="gap-1 text-[10px] font-semibold">
            Required
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">Optional</span>
        )}
      </div>
      {proof ? (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-3">
          <div className="flex items-center gap-3">
            <img
              src={proof}
              alt="Payment screenshot preview"
              className="size-16 shrink-0 rounded-md border object-cover"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">Screenshot attached</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Admins can view it with your submission.
              </p>
              <div className="mt-1.5 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={proofBusy || disabled}
                  onClick={() => fileRef.current?.click()}
                >
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={proofBusy || disabled}
                  aria-label="Remove payment screenshot"
                  onClick={() => setProof(null)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <input
            ref={fileRef}
            id={`${idPrefix}-proof`}
            type="file"
            accept={PROOF_ACCEPT}
            className="sr-only"
            onChange={(e) => void handleProofFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={proofBusy}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed p-4 text-left text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-foreground disabled:opacity-60"
          >
            {proofBusy ? (
              <Loader2 className="size-5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <ImagePlus className="size-5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              {proofBusy ? "Processing image…" : "Tap to upload screenshot"}
              <span className="block text-xs text-muted-foreground">
                JPG, PNG or WEBP — up to 5 MB
              </span>
            </span>
          </button>
        </>
      )}
      {proofError ? (
        <p className="text-sm text-destructive" role="alert">
          {proofError}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* STEP 3 · Payment details — external method                          */
/* ------------------------------------------------------------------ */

interface ExternalResult {
  type: "package-payment";
  transaction: TransactionDTO;
  methodName: string;
  txId: string;
}

function StepPayExternal({
  item,
  method,
  requireProof,
  onChange,
  onResult,
}: {
  item: CheckoutItem;
  method: PaymentMethodDTO;
  requireProof: boolean;
  onChange: () => void;
  onResult: (result: CheckoutResult) => void;
}) {
  const queryClient = useQueryClient();
  const [txId, setTxId] = useState("");
  const [txIdError, setTxIdError] = useState<string | null>(null);
  const [proof, setProof] = useState<string | null>(null);

  const isPlan = item.kind === "plan";
  const pattern = isPlan ? PLAN_TID_PATTERN : PACKAGE_TXID_PATTERN;

  const submit = useMutation({
    mutationFn: (vars: { txId: string; proof?: string }) =>
      isPlan
        ? apiFetch<ActivatePlanResponseDTO>("/api/plans/activate", {
            method: "POST",
            json: { planId: item.id, paymentMethodId: method.id, ...vars },
          })
        : apiFetch<PackageCheckoutResponseDTO>("/api/packages/checkout", {
            method: "POST",
            json: { packageId: item.id, paymentMethodId: method.id, ...vars },
          }),
    onSuccess: (res) => {
      if (isPlan) {
        const planRes = res as ActivatePlanResponseDTO;
        onResult({
          type: "plan",
          res: planRes,
        });
        // Premium presentation layer: the CONFIRMED instant activation is
        // celebrated by the Plan Activated overlay (driven from the real
        // response via `result` state in CheckoutView). Only the pending
        // path still needs its plain toast — no duplicate notifications.
        if (!planRes.activated) {
          toast.success("Payment submitted successfully! Plan will activate after Admin approval.");
        }
        void queryClient.invalidateQueries({ queryKey: ["session"] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        void queryClient.invalidateQueries({ queryKey: ["public", "plans"] });
        void queryClient.invalidateQueries({ queryKey: ["public", "stats"] });
        void queryClient.invalidateQueries({ queryKey: ["public", "payouts"] });
      } else {
        const pkgRes = res as PackageCheckoutResponseDTO;
        onResult({
          type: "package-payment",
          transaction: pkgRes.transaction,
          methodName: method.name,
          txId: txId.trim(),
        });
        toast.success("Payment submitted successfully. Your payment is under review.");
        void queryClient.invalidateQueries({ queryKey: ["packages"] });
        void queryClient.invalidateQueries({ queryKey: ["session"] });
        void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        void queryClient.invalidateQueries({ queryKey: ["wallet"] });
        void queryClient.invalidateQueries({ queryKey: ["payments"] });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Submission failed. Please try again.");
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submit.isPending) return;
    const trimmed = txId.trim();
    if (isPlan ? !PLAN_TID_PATTERN.test(trimmed) : !PACKAGE_TXID_PATTERN.test(trimmed)) {
      setTxIdError(
        isPlan
          ? "Enter the 11 or 12-digit Transaction ID (TID) from your payment app."
          : "Enter the Transaction ID from your payment app (e.g. TXN12345678).",
      );
      return;
    }
    setTxIdError(null);
    if (requireProof && !proof) {
      toast.error("A payment screenshot is required — attach your receipt image.");
      return;
    }
    submit.mutate({ txId: trimmed, proof: proof ?? undefined });
  }

  const tidValid = pattern.test(txId.trim());

  return (
    <motion.form
      variants={stepVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.25, ease: "easeOut" }}
      onSubmit={handleSubmit}
      noValidate
      aria-label="Payment details"
      className="space-y-4"
    >
      {/* Header — selected method + change */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MethodVisual method={method} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{method.name}</p>
            <p className="text-[11px] text-muted-foreground">{item.title}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submit.isPending}
          onClick={onChange}
          className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Change Method
        </Button>
      </div>

      {/* Dynamic merchant account + copy */}
      <MerchantCard method={method} price={item.price} />

      {/* Per-method instructions (admin-managed) */}
      {method.instructions ? (
        <Alert className="border-primary/30 bg-primary/5 py-3">
          <Info className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <AlertDescription className="text-xs leading-relaxed">
            {method.instructions}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Transaction ID */}
      <div className="space-y-2">
        <Label htmlFor="checkout-txid">Transaction ID</Label>
        <Input
          id="checkout-txid"
          value={txId}
          onChange={(e) =>
            setTxId(
              isPlan
                ? e.target.value.replace(/[^\d]/g, "").slice(0, 12)
                : e.target.value.slice(0, 40),
            )
          }
          inputMode={isPlan ? "numeric" : undefined}
          autoComplete="off"
          placeholder={isPlan ? "e.g. 03012345678" : "e.g. TXN12345678"}
          aria-invalid={Boolean(txIdError)}
          aria-describedby={txIdError ? "checkout-txid-error" : "checkout-txid-hint"}
          className="font-mono"
        />
        {txIdError ? (
          <p id="checkout-txid-error" className="text-sm text-destructive" role="alert">
            {txIdError}
          </p>
        ) : (
          <p id="checkout-txid-hint" className="text-xs text-muted-foreground">
            {isPlan
              ? "The 11 or 12-digit TID shown on your payment receipt."
              : "The transaction / reference ID from your payment receipt."}
          </p>
        )}
      </div>

      {/* Payment screenshot */}
      <ProofUpload
        proof={proof}
        setProof={setProof}
        requireProof={requireProof}
        disabled={submit.isPending}
        idPrefix="checkout"
      />

      <Button type="submit" className="h-12 w-full text-base" disabled={submit.isPending || !tidValid}>
        {submit.isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Submitting…
          </>
        ) : (
          "Submit Payment"
        )}
      </Button>
    </motion.form>
  );
}

/* ------------------------------------------------------------------ */
/* STEP 3 · Wallet balance (packages only)                             */
/* ------------------------------------------------------------------ */

function StepPayWallet({
  item,
  onChange,
  onResult,
}: {
  item: CheckoutItem;
  onChange: () => void;
  onResult: (result: { type: "package-wallet"; res: PurchasePackageResponseDTO }) => void;
}) {
  const queryClient = useQueryClient();
  const { wallet, status } = useSession();
  const loading = status === "loading" || wallet === null;

  const taskBalance = wallet?.taskBalance ?? 0;
  const withdrawableBalance = wallet?.withdrawableBalance ?? 0;
  const available = taskBalance + withdrawableBalance;
  const insufficient = !loading && available < item.price;

  const purchase = useMutation({
    mutationFn: (packageId: string) =>
      apiFetch<PurchasePackageResponseDTO>("/api/packages/purchase", {
        method: "POST",
        json: { packageId },
      }),
    onSuccess: (res) => {
      // Premium presentation layer: the CONFIRMED instant activation is
      // celebrated by the Plan Activated overlay (driven from this real
      // response via `result` state in CheckoutView) — the plain success
      // toast is superseded, so it is not fired as a duplicate.
      onResult({ type: "package-wallet", res });
      void queryClient.invalidateQueries({ queryKey: ["packages"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet"] });
      void queryClient.invalidateQueries({ queryKey: ["public", "stats"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Purchase failed. Please try again.");
    },
  });

  return (
    <motion.section
      variants={stepVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-label="Wallet balance payment"
      className="space-y-4"
    >
      {/* Header — selected method + change */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Wallet className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Wallet Balance</p>
            <p className="text-[11px] text-muted-foreground">{item.title}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={purchase.isPending}
          onClick={onChange}
          className="h-8 shrink-0 gap-1 px-2 text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Change Method
        </Button>
      </div>

      {/* Balance card */}
      <div className="space-y-2 rounded-xl border bg-primary/5 p-4">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <Wallet className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Available balance
          </span>
          {loading ? (
            <Skeleton className="h-5 w-20" />
          ) : (
            <span className="font-bold tabular-nums">{formatPKR(available)}</span>
          )}
        </div>
        {!loading ? (
          <>
            <p className="text-xs text-muted-foreground">
              Task {formatPKR(taskBalance)} <span aria-hidden="true">·</span> Withdrawable{" "}
              {formatPKR(withdrawableBalance)}
            </p>
            <p className="text-xs text-muted-foreground">
              The amount is deducted from your Task Balance first, then your Withdrawable Balance.
            </p>
          </>
        ) : null}
      </div>

      {insufficient ? (
        <>
          <p className="text-sm font-medium text-destructive" role="alert">
            Insufficient Balance — you need {formatPKR(item.price - available)} more.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-12 w-full gap-1.5 text-base"
            onClick={onChange}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Choose another payment method
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Confirm to invest {formatPKR(item.price)} from your wallet — {item.title} activates
            instantly and starts earning {formatPKR(item.dailyEarning)} daily.
          </p>
          <Button
            type="button"
            className="h-12 w-full text-base"
            disabled={loading || purchase.isPending}
            onClick={() => purchase.mutate(item.id)}
          >
            {purchase.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Investing…
              </>
            ) : (
              `Confirm & Invest ${formatPKR(item.price)}`
            )}
          </Button>
        </>
      )}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Result screen (payment request created → pending / activated)       */
/* ------------------------------------------------------------------ */

type CheckoutResult =
  | ExternalResult
  | { type: "package-wallet"; res: PurchasePackageResponseDTO }
  | { type: "plan"; res: ActivatePlanResponseDTO };

function StepResult({ item, result, onDone }: { item: CheckoutItem; result: CheckoutResult; onDone: () => void }) {
  return (
    <motion.section
      variants={stepVariants}
      initial="initial"
      animate="animate"
      transition={{ duration: 0.25, ease: "easeOut" }}
      aria-label="Payment result"
      className="space-y-5"
    >
      {result.type === "package-wallet" ? (
        <>
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="size-7" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-lg font-semibold">Investment active!</p>
              <p className="text-sm text-muted-foreground">
                {item.title} is now working for you — earnings land in your Withdrawable Balance.
              </p>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Daily earning</span>
              <span className="font-bold text-primary tabular-nums">
                {formatPKR(result.res.userPackage.dailyEarning)} / day
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Earning period ends</span>
              <span className="font-semibold tabular-nums">{endsLabel(result.res.userPackage)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Available balance now</span>
              <span className="font-semibold tabular-nums">
                {formatPKR(
                  result.res.wallet.taskBalance + result.res.wallet.withdrawableBalance,
                )}
              </span>
            </div>
          </div>
          <Button type="button" className="h-12 w-full text-base" onClick={onDone}>
            Done
          </Button>
        </>
      ) : result.type === "plan" ? (
        <>
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              {result.res.activated ? (
                <CheckCircle2 className="size-7" aria-hidden="true" />
              ) : (
                <Loader2 className="size-7 animate-spin" aria-hidden="true" />
              )}
            </span>
            <div className="space-y-1">
              <p className="text-lg font-semibold">
                {result.res.activated ? "Plan activated!" : "Payment submitted"}
              </p>
              <p className="text-sm text-muted-foreground">
                {result.res.activated
                  ? `${item.title} is now live — complete your daily tasks to start earning.`
                  : "Payment submitted successfully! Your plan will activate after Admin approval."}
              </p>
            </div>
          </div>

          {!result.res.activated ? (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Amount paid</span>
                <span className="font-semibold tabular-nums">{formatPKR(item.price)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="secondary" className="gap-1.5">
                  <span
                    className="size-1.5 animate-pulse rounded-full bg-amber-500"
                    aria-hidden="true"
                  />
                  Awaiting admin approval
                </Badge>
              </div>
            </div>
          ) : null}

          {result.res.unlock ? (
            result.res.unlock.blocked ? (
              <Alert className="border-amber-500/40 bg-amber-500/5 text-foreground">
                <ShieldAlert className="size-4 text-amber-600" aria-hidden="true" />
                <AlertTitle>Referral unlock blocked</AlertTitle>
                <AlertDescription>
                  Anti-fraud checks blocked the referral bonus for this activation (shared IP or
                  device between inviter and invitee).
                </AlertDescription>
              </Alert>
            ) : result.res.unlock.amount > 0 ? (
              <Alert className="border-primary/40 bg-primary/5">
                <Info className="size-4 text-primary" aria-hidden="true" />
                <AlertTitle>Referral bonus unlocked</AlertTitle>
                <AlertDescription>
                  {formatPKR(result.res.unlock.amount)} moved from your inviter{" "}
                  {result.res.unlock.inviterName}&apos;s Task Balance to their Withdrawable Balance.
                </AlertDescription>
              </Alert>
            ) : null
          ) : null}

          <Button type="button" className="h-12 w-full text-base" onClick={onDone}>
            Done
          </Button>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 pt-2 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="size-7" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-lg font-semibold">Payment submitted</p>
              <p className="text-sm text-muted-foreground">
                Payment submitted successfully. Your payment is under review.
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Amount paid</span>
              <span className="font-semibold tabular-nums">{formatPKR(item.price)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Payment method</span>
              <span className="font-semibold">{result.methodName}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Transaction ID</span>
              <span className="truncate font-mono text-xs" title={result.txId}>
                {result.txId}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Status</span>
              <Badge variant="secondary" className="gap-1.5">
                <span
                  className="size-1.5 animate-pulse rounded-full bg-amber-500"
                  aria-hidden="true"
                />
                Pending
              </Badge>
            </div>
          </div>

          <Alert className="border-amber-500/40 bg-amber-500/5">
            <ShieldAlert className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <AlertDescription className="text-xs leading-relaxed">
              {item.title} activates as soon as an admin approves your payment — watch the status
              under Wallet → Payments.
            </AlertDescription>
          </Alert>

          <div className="flex flex-col-reverse gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full gap-1.5"
              onClick={() => {
                onDone();
                navigateTo("/dashboard/history/deposits");
              }}
            >
              <History className="size-4" aria-hidden="true" />
              View payment history
            </Button>
            <Button type="button" className="h-12 w-full text-base" onClick={onDone}>
              Done
            </Button>
          </div>
        </>
      )}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */
/* Checkout view (route parser + data resolution)                      */
/* ------------------------------------------------------------------ */

function CheckoutSkeleton() {
  return (
    <div className="mx-auto w-full max-w-md space-y-5">
      <div className="mx-auto flex w-full max-w-xs items-center justify-between px-2">
        {[0, 1, 2].map((i) => (
          <Fragment key={i}>
            {i > 0 ? <span className="h-0.5 flex-1 bg-border" aria-hidden="true" /> : null}
            <Skeleton className="size-7 rounded-full" />
          </Fragment>
        ))}
      </div>
      <Skeleton className="h-44 w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-10 w-40 rounded-xl" />
    </div>
  );
}

export function CheckoutView() {
  const { path, query } = useHashRoute();
  const { animations } = useSession();
  const [result, setResult] = useState<CheckoutResult | null>(null);
  // One premium celebration per confirmed activation — derived ONLY from the
  // existing successful `result` (real response data + real item data).
  // `celebrationDone` makes it strictly one-shot within this checkout visit;
  // a fresh checkout (new route mount) naturally starts clean again.
  const [celebrationDone, setCelebrationDone] = useState(false);

  const match = CHECKOUT_ROUTE_RE.exec(path);
  const kind = (match?.[1] ?? "package") as CheckoutKind;
  const id = match?.[2] ?? "";
  const step = (match?.[3] ?? "confirm") as CheckoutStep;
  const methodParam = query.get("method") ?? "";

  // Scroll to top on every step change (each step is its own screen).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [path]);

  // Note: the dashboard shell keys its AnimatePresence by the route path, so
  // every step navigation remounts this view — transient state (form inputs,
  // result) resets naturally while the URL carries the plan + method.

  // Item data — re-fetched by id from the existing APIs (cached by react-query).
  const packagesQuery = useQuery({
    queryKey: ["packages"],
    queryFn: () => apiFetch<PackagesResponseDTO>("/api/packages"),
    enabled: kind === "package",
    refetchInterval: 30_000,
  });
  const plansQuery = useQuery({
    queryKey: ["public", "plans"],
    queryFn: () => apiFetch<{ plans: PlanDTO[] }>("/api/public/plans"),
    enabled: kind === "plan",
  });
  const methodsQuery = useQuery({
    queryKey: ["public", "payment-methods"],
    queryFn: () => apiFetch<PaymentMethodsResponseDTO>("/api/public/payment-methods"),
    staleTime: 60_000,
  });

  const item: CheckoutItem | null = useMemo(() => {
    if (kind === "package") {
      const pkg: PackageDTO | undefined = packagesQuery.data?.packages.find((p) => p.id === id);
      if (!pkg) return null;
      return {
        kind,
        id,
        title: pkg.title,
        description: pkg.description,
        price: pkg.price,
        dailyEarning: pkg.dailyEarning,
        durationDays: pkg.durationDays,
        totalReturn: pkg.totalReturn,
        netProfit: pkg.netProfit,
        rewardPerTask: null,
        dailyTaskLimit: null,
      };
    }
    const plan: PlanDTO | undefined = plansQuery.data?.plans.find((p) => p.id === id);
    if (!plan) return null;
    return {
      kind,
      id,
      title: plan.name,
      description: plan.description,
      price: plan.price,
      dailyEarning: plan.rewardPerTask * plan.dailyTaskLimit,
      durationDays: plan.durationDays,
      totalReturn: null,
      netProfit: null,
      rewardPerTask: plan.rewardPerTask,
      dailyTaskLimit: plan.dailyTaskLimit,
    };
  }, [kind, id, packagesQuery.data, plansQuery.data]);

  /* Premium success presentation — fires ONLY for CONFIRMED instant
   * activations (the existing mutations' genuine SUCCESS responses):
   *   • package-wallet  → /api/packages/purchase succeeded (activates
   *                       instantly — the response carries the real
   *                       userPackage)
   *   • plan + activated → /api/plans/activate returned activated: true
   * Pending submissions and failures never reach here. Every displayed
   * value is the REAL plan name / REAL daily earning from the existing
   * data — nothing is invented or recalculated. Honors the admin's
   * Animation & User Experience switches (visual layer only — the
   * activation itself always works). */
  const celebration = useMemo<SuccessCelebrationData | null>(() => {
    if (!result || !item) return null;
    if (!animationEnabled(animations, "planActivation")) return null;
    if (result.type === "package-wallet") {
      return {
        key: `pkg-${result.res.userPackage.id}`,
        heading: "Plan Activated",
        title: item.title,
        metric: {
          label: "Daily earning",
          value: result.res.userPackage.dailyEarning,
          suffix: " / day",
        },
        note: "Earnings land in your Withdrawable Balance.",
      };
    }
    if (result.type === "plan" && result.res.activated) {
      return {
        key: `plan-${result.res.transaction.id}`,
        heading: "Plan Activated",
        title: item.title,
        metric: {
          label: "Daily earning",
          value: item.dailyEarning,
          suffix: " / day",
        },
        note: "Complete your daily tasks to start earning.",
      };
    }
    return null;
  }, [result, item, animations]);

  const itemLoading =
    kind === "package" ? packagesQuery.isLoading : plansQuery.isLoading;
  const itemFailed =
    kind === "package" ? packagesQuery.isError : plansQuery.isError;

  // Unknown checkout route → back to the packages catalog.
  useEffect(() => {
    if (!match) navigateTo("/dashboard/packages");
  }, [match]);

  // Item resolved but not found (bad id / deactivated) → back to the catalog.
  useEffect(() => {
    if (match && !itemLoading && !itemFailed && !item) {
      toast.error(kind === "package" ? "That plan is no longer available." : "That plan is no longer available.");
      navigateTo(catalogUrl(kind));
    }
  }, [match, itemLoading, itemFailed, item, kind]);

  const methods = methodsQuery.data?.methods ?? [];
  const requireProof = methodsQuery.data?.requireProof ?? false;
  const walletSelected = methodParam === "wallet" && kind === "package";
  const selectedMethod = methods.find((m) => m.id === methodParam) ?? null;

  // Step 3 without a valid selection → back to method selection.
  useEffect(() => {
    if (step === "pay" && !methodsQuery.isLoading && !methodsQuery.isError) {
      if (!walletSelected && !selectedMethod) {
        navigateTo(stepUrl(kind, id, "method"));
      }
    }
  }, [step, methodsQuery.isLoading, methodsQuery.isError, walletSelected, selectedMethod, kind, id]);

  if (!match || itemLoading || itemFailed) {
    if (itemFailed) {
      return (
        <Alert variant="destructive" className="mx-auto max-w-md">
          <AlertTitle>Couldn&apos;t load this plan</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>Something went wrong while loading the checkout.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void (kind === "package" ? packagesQuery.refetch() : plansQuery.refetch())}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
    return <CheckoutSkeleton />;
  }

  if (!item) return <CheckoutSkeleton />;

  const progressStep: 1 | 2 | 3 = step === "confirm" ? 1 : step === "method" ? 2 : 3;

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      {/* Premium activation celebration — rendered from the CONFIRMED success
          response only; auto-completes and never blocks the checkout flow. */}
      <SuccessCelebration
        data={celebration && !celebrationDone ? celebration : null}
        onComplete={() => setCelebrationDone(true)}
      />

      {!result ? <CheckoutProgress current={progressStep} /> : null}

      {result ? (
        <StepResult
          item={item}
          result={result}
          onDone={() => navigateTo(catalogUrl(item.kind))}
        />
      ) : step === "confirm" ? (
        <StepConfirm
          item={item}
          onContinue={() => navigateTo(stepUrl(kind, id, "method"))}
          onBack={() => navigateTo(catalogUrl(kind))}
        />
      ) : step === "method" ? (
        <StepMethod
          item={item}
          methodsQuery={methodsQuery as ReturnType<typeof useQuery<PaymentMethodsResponseDTO>>}
          walletImageUrl={methodsQuery.data?.walletImageUrl ?? null}
          onChange={() => navigateTo(stepUrl(kind, id, "confirm"))}
          onBack={() => navigateTo(catalogUrl(kind))}
          onSelectMethod={(m) => navigateTo(stepUrl(kind, id, "pay", m.id))}
          onSelectWallet={() => navigateTo(stepUrl(kind, id, "pay", "wallet"))}
        />
      ) : walletSelected ? (
        <StepPayWallet
          item={item}
          onChange={() => navigateTo(stepUrl(kind, id, "method"))}
          onResult={setResult}
        />
      ) : selectedMethod ? (
        <StepPayExternal
          item={item}
          method={selectedMethod}
          requireProof={requireProof}
          onChange={() => navigateTo(stepUrl(kind, id, "method"))}
          onResult={setResult}
        />
      ) : (
        <CheckoutSkeleton />
      )}
    </div>
  );
}
