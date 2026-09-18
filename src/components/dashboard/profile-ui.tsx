"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MethodVisual, methodIcon } from "@/components/dashboard/payment-methods";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { cn } from "@/lib/utils";
import type {
  PaymentMethodsResponseDTO,
  PaymentMethodDTO,
  TransactionStatus,
  WithdrawalMethodsResponseDTO,
  WithdrawalMethodDTO,
} from "@/lib/types";

/* ================================================================== */
/* Profile flow UI kit (spec §11) — one consistent, reusable set for   */
/* the Profile hub + every dedicated page (Deposit / Withdraw /        */
/* histories / account dialogs).                                      */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* PageHeader — the ONE reusable header for every dedicated page       */
/* (< Back · Page Title · optional right slot)                         */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  backTo = "/dashboard/profile",
  right,
}: {
  title: string;
  subtitle?: string;
  /** Hash route the back arrow returns to (default: the Profile hub). */
  backTo?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Go back"
        onClick={() => navigateTo(backTo)}
        className="size-11 shrink-0 rounded-xl shadow-sm"
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
        {subtitle ? <p className="truncate text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ProfileSection — a clearly separated group with its own heading     */
/* ------------------------------------------------------------------ */

export function ProfileSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {description ? (
          <p className="truncate text-xs text-muted-foreground/80">{description}</p>
        ) : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* ProfileOption — one full-width, touch-friendly option row/card      */
/* (icon tile · title + description · right chevron or custom trailing) */
/* ------------------------------------------------------------------ */

type IconTone = "primary" | "amber" | "destructive" | "neutral";

const ICON_TONES: Record<IconTone, string> = {
  primary: "bg-primary/10 text-primary",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  destructive: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

export function ProfileOption({
  icon: Icon,
  iconTone = "primary",
  title,
  description,
  onClick,
  trailing,
  showArrow = true,
  destructive = false,
  ariaLabel,
}: {
  icon: ComponentType<{ className?: string }>;
  iconTone?: IconTone;
  title: string;
  description?: string;
  onClick: () => void;
  /** Custom right-side content (replaces the chevron when provided). */
  trailing?: ReactNode;
  showArrow?: boolean;
  destructive?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? title}
      className={cn(
        "group flex min-h-[72px] w-full items-center gap-3.5 rounded-2xl border bg-card p-4 text-left",
        "transition-all duration-200 ease-out",
        destructive
          ? "border-destructive/25 hover:border-destructive/50 hover:bg-destructive/[0.03]"
          : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
        "active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl",
          ICON_TONES[destructive ? "destructive" : iconTone],
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-semibold leading-tight",
            destructive && "text-destructive",
          )}
        >
          {title}
        </span>
        {description ? (
          <span className="mt-1 block truncate text-xs leading-tight text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ? (
        trailing
      ) : showArrow ? (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors",
            destructive
              ? "group-hover:bg-destructive/10 group-hover:text-destructive"
              : "group-hover:bg-primary/10 group-hover:text-primary",
          )}
        >
          <ChevronRight className="size-4.5" />
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* StatusBadge — clear APPROVED / PENDING / REJECTED state badges      */
/* (reuses the transaction status palette from tx-helpers)            */
/* ------------------------------------------------------------------ */

const STATUS_STYLES: Record<TransactionStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  completed: "bg-primary/10 text-primary border-primary/20",
  approved: "bg-primary/10 text-primary border-primary/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  blocked: "bg-destructive/10 text-destructive border-destructive/20",
};

const STATUS_TEXT: Record<TransactionStatus, string> = {
  pending: "PENDING",
  completed: "COMPLETED",
  approved: "APPROVED",
  rejected: "REJECTED",
  blocked: "BLOCKED",
};

export function StatusBadge({ status, className }: { status: TransactionStatus; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border px-2 py-0.5 text-[10px] font-bold tracking-wide", STATUS_STYLES[status] ?? "", className)}
    >
      {STATUS_TEXT[status] ?? status.toUpperCase()}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* TransactionCard — one clean, padded card per transaction            */
/* ------------------------------------------------------------------ */

export function TransactionCard({
  icon,
  title,
  subtitle,
  rows,
  amount,
  status,
  footer,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** Label → value detail rows (method, account, TxID…). */
  rows?: { label: string; value: ReactNode }[];
  amount: ReactNode;
  status?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3.5">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="min-w-0 truncate text-sm font-semibold leading-tight">{title}</p>
            {status}
          </div>
          {subtitle ? (
            <p className="mt-1 truncate text-xs leading-tight text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-right">{amount}</span>
      </div>

      {rows && rows.length > 0 ? (
        <dl className="mt-3.5 grid gap-x-4 gap-y-2 border-t pt-3.5 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
              <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
                {row.label}
              </dt>
              <dd className="min-w-0 text-right text-sm font-medium sm:mt-0.5 sm:text-left sm:break-all">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {footer ? <div className="mt-3 border-t pt-3">{footer}</div> : null}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* FormField — label + control + hint/error, vertical, own spacing     */
/* ------------------------------------------------------------------ */

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PrimaryButton — the one consistent full-width primary action        */
/* ------------------------------------------------------------------ */

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "submit",
  icon: Icon,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "submit" | "button";
  icon?: ComponentType<{ className?: string }>;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("h-12 w-full rounded-xl text-base font-semibold shadow-sm", className)}
    >
      {Icon ? <Icon className="size-5" aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState + shared skeletons                                       */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function HistorySkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border bg-card p-4 sm:p-5">
          <div className="flex items-center gap-3.5">
            <div className="size-10 animate-pulse rounded-xl bg-muted" />
            <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-4 h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MethodSelectCard — selectable payment method row (radio semantics) */
/* ------------------------------------------------------------------ */

export function MethodSelectCard({
  method,
  selected,
  onSelect,
  disabled,
}: {
  method: PaymentMethodDTO;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const FallbackIcon = methodIcon(method.name);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`Payment method ${method.name}`}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-[72px] w-full items-center gap-3.5 rounded-2xl border bg-card p-4 text-left shadow-sm",
        "transition-all duration-200 ease-out",
        "hover:border-primary/40 hover:shadow-md hover:shadow-primary/5",
        "active:scale-[0.99]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected &&
          "scale-[1.01] border-primary/70 bg-primary/[0.03] ring-2 ring-primary/25 shadow-lg shadow-primary/15",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-12 shrink-0 items-center justify-center rounded-xl border bg-background p-1.5",
          !method.logoUrl && "bg-primary/10 text-primary",
        )}
      >
        <MethodVisual method={method} className="size-full object-contain" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight">{method.name}</span>
        <span className="mt-1 block truncate font-mono text-xs leading-tight text-muted-foreground">
          {method.accountNumber}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30",
        )}
      >
        {selected ? <Check className="size-3.5" /> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* InfoCard — instruction / information card (deposit process etc.)    */
/* ------------------------------------------------------------------ */

export function InfoCard({
  icon: Icon,
  title,
  children,
  tone = "primary",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
  tone?: "primary" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 sm:p-5",
        tone === "primary" ? "border-primary/20 bg-primary/[0.04]" : "border-amber-500/25 bg-amber-500/[0.05]",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            tone === "primary" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared amount parsing + payment-methods hook (existing behavior)   */
/* ------------------------------------------------------------------ */

/** Parses a positive PKR amount string → integer, else null (existing rule). */
export function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Admin-managed payment methods (60s cache — same source as checkout). */
export function usePaymentMethods() {
  const query = useQuery({
    queryKey: ["public", "payment-methods"],
    queryFn: () => apiFetch<PaymentMethodsResponseDTO>("/api/public/payment-methods"),
    staleTime: 60_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const methods = query.data?.methods ?? [];
  const selected: PaymentMethodDTO | null =
    methods.find((m) => m.id === selectedId) ?? methods[0] ?? null;
  const setSelected = (m: PaymentMethodDTO) => setSelectedId(m.id);
  return { query, methods, selected, setSelected };
}

/** Admin-managed withdrawal channels for the Withdraw page dropdown (60s cache). */
export function useWithdrawalMethods() {
  const query = useQuery({
    queryKey: ["public", "withdrawal-methods"],
    queryFn: () => apiFetch<WithdrawalMethodsResponseDTO>("/api/public/withdrawal-methods"),
    staleTime: 60_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const methods = query.data?.methods ?? [];
  const selected: WithdrawalMethodDTO | null =
    methods.find((m) => m.id === selectedId) ?? methods[0] ?? null;
  const setSelected = (m: WithdrawalMethodDTO) => setSelectedId(m.id);
  return { query, methods, selected, setSelected };
}

/* ------------------------------------------------------------------ */
/* SectionEnter — the one subtle entrance animation for page sections  */
/* ------------------------------------------------------------------ */

export function SectionEnter({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
