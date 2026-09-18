"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  Clock,
  Flame,
  Layers,
  Package,
  Pencil,
  Play,
  Plus,
  Power,
  RotateCcw,
  Save,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  ActiveBadge,
  EmptyState,
  SectionError,
  TableSkeleton,
  TableWrap,
} from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { useHashRoute } from "@/lib/hash-router";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DailyEarningsSummaryDTO, PackageDTO } from "@/lib/types";

/* ---------------------------------- types ---------------------------------- */

interface PackagesStats {
  totalInstances: number;
  activeInstances: number;
  totalInvested: number;
  dailyLiability: number;
  totalEarnedPaid: number;
}

interface PackagesPayload {
  packages: PackageDTO[];
  stats: PackagesStats;
}

interface PackageForm {
  title: string;
  description: string;
  price: string;
  dailyEarning: string;
  durationDays: string;
  totalReturn: string; // "" → auto (daily × duration)
  sortOrder: string; // "" → auto (next free slot)
  isActive: boolean;
}

type TextFieldKey = Exclude<keyof PackageForm, "isActive">;

const EMPTY_FORM: PackageForm = {
  title: "",
  description: "",
  price: "",
  dailyEarning: "",
  durationDays: "",
  totalReturn: "",
  sortOrder: "",
  isActive: true,
};

const CRON_HINT = "5 0 * * * cd /app && bun scripts/daily-earnings.ts";

function formFromPackage(pkg: PackageDTO): PackageForm {
  return {
    title: pkg.title,
    description: pkg.description ?? "",
    price: String(pkg.price),
    dailyEarning: String(pkg.dailyEarning),
    durationDays: String(pkg.durationDays),
    // Prefill only when the stored total is a custom override.
    totalReturn: pkg.totalReturn === pkg.dailyEarning * pkg.durationDays ? "" : String(pkg.totalReturn),
    sortOrder: String(pkg.sortOrder),
    isActive: pkg.isActive,
  };
}

function isPositiveInt(value: string): boolean {
  if (value.trim() === "") return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1;
}

function isInt(value: string): boolean {
  if (value.trim() === "") return false;
  return Number.isInteger(Number(value));
}

/** "36,500 days" + a humanized "≈ 100 yrs" caption for very long durations. */
function DurationCell({ days }: { days: number }) {
  return (
    <span className="whitespace-nowrap">
      <span className="tabular-nums">{days.toLocaleString("en-US")} days</span>
      {days > 3650 ? (
        <span className="block text-[11px] text-muted-foreground">≈ {Math.round(days / 365)} yrs</span>
      ) : null}
    </span>
  );
}

/* ------------------------------ motion helper ------------------------------ */

function FadeIn({ delay = 0, children, className }: { delay?: number; children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------- stat cards -------------------------------- */

function StatCard({
  title,
  value,
  caption,
  icon: Icon,
  iconClass,
}: {
  title: string;
  value: string;
  caption?: ReactNode;
  icon: LucideIcon;
  iconClass: string;
}) {
  return (
    <Card className="py-0 transition-shadow hover:shadow-md">
      <CardContent className="flex items-start gap-4 p-4 sm:p-5">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", iconClass)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
          {caption ? <p className="mt-1 text-xs text-muted-foreground">{caption}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- package dialog ---------------------------- */

interface PackageDialogProps {
  open: boolean;
  editing: PackageDTO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: PackageForm, editingId: string | null) => void;
  submitting: boolean;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  prefix,
  placeholder,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  prefix?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex">
        {prefix ? (
          <span
            aria-hidden="true"
            className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground"
          >
            {prefix}
          </span>
        ) : null}
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          {...(min !== undefined ? { min } : {})}
          placeholder={placeholder}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={prefix ? "rounded-l-none" : undefined}
        />
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function PackageDialog({ open, editing, onOpenChange, onSubmit, submitting }: PackageDialogProps) {
  // Remounted (via key) every time the dialog is opened, so this initializer
  // always starts from the current package — no reset effects needed.
  const [form, setForm] = useState<PackageForm>(() => (editing ? formFromPackage(editing) : EMPTY_FORM));
  const [errors, setErrors] = useState<Partial<Record<keyof PackageForm, string>>>({});

  const setTextField = (key: TextFieldKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Live auto-calc: daily × duration → total; total − price → net.
  const dailyNum = Number(form.dailyEarning);
  const durationNum = Number(form.durationDays);
  const priceNum = Number(form.price);
  const autoTotal = isPositiveInt(form.dailyEarning) && isPositiveInt(form.durationDays)
    ? dailyNum * durationNum
    : null;
  const fieldTotal = form.totalReturn.trim() !== "" ? Number(form.totalReturn) : null;
  const effectiveTotal = fieldTotal !== null && Number.isFinite(fieldTotal) ? fieldTotal : autoTotal;
  const netPreview = effectiveTotal !== null && isPositiveInt(form.price) ? effectiveTotal - priceNum : null;
  const hasCustomTotal =
    form.totalReturn.trim() !== "" && (autoTotal === null || Number(form.totalReturn) !== autoTotal);

  const submit = () => {
    const next: Partial<Record<keyof PackageForm, string>> = {};
    if (form.title.trim().length < 2) next.title = "Package title must be at least 2 characters.";
    if (!isPositiveInt(form.price)) next.price = "Price must be a positive integer.";
    if (!isPositiveInt(form.dailyEarning)) next.dailyEarning = "Daily earnings must be a positive integer.";
    if (!isPositiveInt(form.durationDays)) next.durationDays = "Duration must be a positive integer.";
    if (form.totalReturn.trim() !== "" && !isPositiveInt(form.totalReturn)) {
      next.totalReturn = "Total return must be a positive integer.";
    }
    if (form.sortOrder.trim() !== "" && !isInt(form.sortOrder)) next.sortOrder = "Priority must be an integer.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    onSubmit(form, editing?.id ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.title}` : "Create package"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the terms once — every member holding this package automatically follows the new daily earnings. No per-user editing needed."
              : "New packages appear in the members' Packages tab as soon as they are active."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="pkg-title">Title</Label>
            <Input
              id="pkg-title"
              value={form.title}
              placeholder="Mini Plan"
              aria-invalid={errors.title ? true : undefined}
              onChange={(e) => setTextField("title", e.target.value)}
            />
            {errors.title ? <p className="text-xs text-destructive">{errors.title}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pkg-description">Description (optional)</Label>
            <Textarea
              id="pkg-description"
              value={form.description}
              rows={3}
              maxLength={500}
              placeholder="e.g. Perfect starter plan — withdraw your earnings every day."
              onChange={(e) => setTextField("description", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Shown on the member checkout summary card when they buy this package.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="pkg-price"
              label="Investment Amount"
              prefix="Rs"
              min={1}
              value={form.price}
              error={errors.price}
              onChange={(v) => setTextField("price", v)}
            />
            <NumberField
              id="pkg-daily"
              label="Daily Earnings"
              prefix="Rs"
              min={1}
              value={form.dailyEarning}
              error={errors.dailyEarning}
              onChange={(v) => setTextField("dailyEarning", v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="pkg-duration"
              label="Duration (days)"
              min={1}
              value={form.durationDays}
              error={errors.durationDays}
              onChange={(v) => setTextField("durationDays", v)}
            />
            <NumberField
              id="pkg-priority"
              label="Priority"
              placeholder="auto"
              value={form.sortOrder}
              error={errors.sortOrder}
              hint="Display order — lower shows first. Blank uses the next free slot."
              onChange={(v) => setTextField("sortOrder", v)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="pkg-total">Total Return</Label>
              {hasCustomTotal ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                  onClick={() => setTextField("totalReturn", "")}
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Reset to auto
                </Button>
              ) : null}
            </div>
            <div className="flex">
              <span
                aria-hidden="true"
                className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground"
              >
                Rs
              </span>
              <Input
                id="pkg-total"
                type="number"
                min={1}
                inputMode="numeric"
                value={form.totalReturn}
                placeholder={autoTotal !== null ? `= ${formatPKR(autoTotal)} (auto)` : "= daily × duration (auto)"}
                aria-invalid={errors.totalReturn ? true : undefined}
                onChange={(e) => setTextField("totalReturn", e.target.value)}
                className="rounded-l-none"
              />
            </div>
            {errors.totalReturn ? (
              <p className="text-xs text-destructive">{errors.totalReturn}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {autoTotal !== null
                  ? `Auto value: ${formatPKR(autoTotal)} = ${formatPKR(dailyNum)} daily × ${durationNum.toLocaleString("en-US")} days.`
                  : "Leave blank to auto-calculate daily earnings × duration."}
              </p>
            )}
          </div>

          {/* live preview — updates as the admin types */}
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Total return</span>
              <span className="font-medium tabular-nums">
                {effectiveTotal !== null ? formatPKR(effectiveTotal) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Net profit <span className="text-xs">(auto-calculated)</span>
              </span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  netPreview === null
                    ? "text-muted-foreground"
                    : netPreview >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive",
                )}
              >
                {netPreview !== null ? formatPKR(netPreview) : "—"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="pkg-active" className="text-sm">
                Active
              </Label>
              <p className="text-xs text-muted-foreground">
                Disabled packages are hidden from the members' Packages tab.
              </p>
            </div>
            <Switch
              id="pkg-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((prev) => ({ ...prev, isActive: v }))}
              disabled={submitting}
              aria-label="Package active"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            <Save aria-hidden="true" />
            {submitting ? "Saving…" : editing ? "Save changes" : "Create package"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------- daily earnings card --------------------------- */

function DailyEarningsCard() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<DailyEarningsSummaryDTO | null>(null);

  const runMutation = useMutation({
    mutationFn: () => apiFetch<DailyEarningsSummaryDTO>("/api/admin/cron/daily-earnings", { method: "POST" }),
    onSuccess: (summary) => {
      setResult(summary);
      if (summary.alreadyRan) {
        toast("Today's distribution has already run.");
      } else {
        toast.success(
          `Daily earnings distributed — ${formatPKR(summary.totalCredited)} to ${summary.usersCredited} ${
            summary.usersCredited === 1 ? "member" : "members"
          }`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="py-0">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Daily Earnings</CardTitle>
            <CardDescription>
              Every night at 00:05, each active package credits its current daily earnings — live
              from this catalog — to the member&apos;s main balance. Edits above apply on the next
              credit.
            </CardDescription>
          </div>
          <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            <Play aria-hidden="true" />
            {runMutation.isPending ? "Running…" : "Run distribution now"}
          </Button>
          <p className="text-xs text-muted-foreground">Idempotent — safe to run repeatedly, once per day.</p>
        </div>

        {result ? (
          result.alreadyRan ? (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
            >
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Today's distribution has already run — nothing left to credit.</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Members credited</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{result.usersCredited}</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Packages credited</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">{result.packagesCredited}</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Total credited</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-primary">
                    {formatPKR(result.totalCredited)}
                  </p>
                </div>
              </div>
              {result.packagesCompleted > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {result.packagesCompleted} package {result.packagesCompleted === 1 ? "instance" : "instances"}{" "}
                  reached the end date and {result.packagesCompleted === 1 ? "was" : "were"} marked completed.
                </p>
              ) : null}
              {result.details.length > 0 ? (
                <ul className="divide-y rounded-lg border">
                  {result.details.map((detail) => (
                    <li key={detail.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{detail.userName}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {detail.packages} package{detail.packages === 1 ? "" : "s"}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                        {formatPKR(detail.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        ) : null}

        <div className="rounded-lg bg-muted/60 p-3">
          <p className="text-xs text-muted-foreground">Schedule the nightly run in production with crontab:</p>
          <code className="mt-1 block overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground">
            {CRON_HINT}
          </code>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function AdminPackagesView() {
  const queryClient = useQueryClient();
  const packagesQuery = useQuery({
    queryKey: ["admin", "packages"],
    queryFn: () => apiFetch<PackagesPayload>("/api/admin/packages"),
    refetchInterval: 15_000,
  });

  // Dashboard quick action: #/admin/packages?create=1 opens the create dialog
  // on arrival. The one-time flag is stripped below so a refresh doesn't reopen.
  const { query: navQuery, navigate } = useHashRoute();
  const createOnArrival = navQuery.get("create") === "1";
  const [dialogOpen, setDialogOpen] = useState(createOnArrival);
  const [editing, setEditing] = useState<PackageDTO | null>(null);
  const [dialogSession, setDialogSession] = useState(0);
  const [toggleTarget, setToggleTarget] = useState<PackageDTO | null>(null);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<Pick<PackagesPayload, "packages">>("/api/admin/packages", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      toast.success(payload.action === "update" ? "Package updated" : "Package created");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
      void queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (payload: { action: "toggle"; id: string }) =>
      apiFetch<Pick<PackagesPayload, "packages">>("/api/admin/packages", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success("Package availability updated");
      setToggleTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "packages"] });
      void queryClient.invalidateQueries({ queryKey: ["packages"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setDialogSession((s) => s + 1);
    setDialogOpen(true);
  };

  // Sync-only effect: clears the one-time ?create=1 flag from the URL (an
  // external-system update — allowed inside an effect).
  useEffect(() => {
    if (navQuery.get("create") === "1") {
      navigate("/admin/packages");
    }
  }, [navQuery, navigate]);

  const openEdit = (pkg: PackageDTO) => {
    setEditing(pkg);
    setDialogSession((s) => s + 1);
    setDialogOpen(true);
  };

  const submitPackage = (form: PackageForm, editingId: string | null) => {
    const daily = Number(form.dailyEarning);
    const duration = Number(form.durationDays);
    const auto = isPositiveInt(form.dailyEarning) && isPositiveInt(form.durationDays) ? daily * duration : null;
    const customValue = form.totalReturn.trim() !== "" ? Number(form.totalReturn) : null;
    const isCustom = customValue !== null && customValue !== auto;

    saveMutation.mutate({
      action: editingId ? "update" : "create",
      ...(editingId ? { id: editingId } : {}),
      title: form.title.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      dailyEarning: Number(form.dailyEarning),
      durationDays: Number(form.durationDays),
      // Send the custom value ONLY when it differs from the auto total; on
      // update, null resets a previously custom total back to auto.
      ...(editingId
        ? { totalReturn: isCustom ? customValue : null }
        : isCustom
          ? { totalReturn: customValue }
          : {}),
      ...(form.sortOrder.trim() !== "" ? { sortOrder: Number(form.sortOrder) } : {}),
      isActive: form.isActive,
    });
  };

  const packages = packagesQuery.data?.packages ?? [];
  const stats = packagesQuery.data?.stats;
  const activeCount = packages.filter((p) => p.isActive).length;

  return (
    <div className="space-y-6">
      {/* summary header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Investment Packages</h2>
          <p className="mt-0.5 text-sm text-muted-foreground" aria-live="polite">
            {packagesQuery.isPending
              ? "Loading packages…"
              : `${packages.length} package${packages.length === 1 ? "" : "s"} · ${activeCount} active`}
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create Package
        </Button>
      </div>

      {/* stats strip */}
      {packagesQuery.isPending ? (
        <StatsSkeleton />
      ) : stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <FadeIn delay={0}>
            <StatCard
              title="Active Packages"
              value={String(activeCount)}
              caption={`${packages.length} total`}
              icon={Package}
              iconClass="bg-primary/10 text-primary"
            />
          </FadeIn>
          <FadeIn delay={0.05}>
            <StatCard
              title="Active Instances"
              value={String(stats.activeInstances)}
              caption="member holdings"
              icon={Layers}
              iconClass="bg-secondary text-secondary-foreground"
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <StatCard
              title="Daily Payout"
              value={formatPKR(stats.dailyLiability)}
              caption="credited nightly"
              icon={TrendingUp}
              iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <StatCard
              title="Total Invested"
              value={formatPKR(stats.totalInvested)}
              caption={`Daily earnings paid: ${formatPKR(stats.totalEarnedPaid)}`}
              icon={Banknote}
              iconClass="bg-primary/10 text-primary"
            />
          </FadeIn>
        </div>
      ) : null}

      {/* packages table */}
      <Card className="py-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Package catalog</CardTitle>
          <CardDescription>
            Price, daily earnings and duration for every investment package — edits go live for members instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {packagesQuery.isPending ? (
            <TableSkeleton rows={4} columns={8} />
          ) : packagesQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load packages"
                message={packagesQuery.error.message}
                onRetry={() => void packagesQuery.refetch()}
              />
            </div>
          ) : packages.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No packages yet"
              description="Create your first investment package to start offering daily earnings to members."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[680px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Package</TableHead>
                    <TableHead className="text-right">Invest</TableHead>
                    <TableHead className="text-right">Daily</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Duration</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">Total Return</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Net Profit</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packages.map((pkg) => (
                    <TableRow key={pkg.id}>
                      <TableCell className="max-w-[240px] pl-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 via-red-500 to-rose-600 shadow-sm">
                            <Flame className="h-4 w-4 text-white" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{pkg.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {formatPKR(pkg.price)} · {pkg.durationDays.toLocaleString("en-US")} days
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formatPKR(pkg.price)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-primary">
                        {formatPKR(pkg.dailyEarning)}
                      </TableCell>
                      <TableCell className="hidden text-right md:table-cell">
                        <DurationCell days={pkg.durationDays} />
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right tabular-nums xl:table-cell">
                        {formatPKR(pkg.totalReturn)}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right font-medium tabular-nums text-emerald-600 lg:table-cell dark:text-emerald-400">
                        {formatPKR(pkg.netProfit)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums xl:table-cell">{pkg.sortOrder}</TableCell>
                      <TableCell>
                        <ActiveBadge active={pkg.isActive} />
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${pkg.title}`}
                            onClick={() => openEdit(pkg)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={pkg.isActive ? `Disable ${pkg.title}` : `Enable ${pkg.title}`}
                            className={
                              pkg.isActive
                                ? "text-destructive hover:text-destructive"
                                : "text-primary hover:text-primary"
                            }
                            onClick={() => setToggleTarget(pkg)}
                          >
                            <Power className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          )}
        </CardContent>
      </Card>

      {/* nightly earnings engine */}
      <DailyEarningsCard />

      <PackageDialog
        key={`package-dialog-${dialogSession}`}
        open={dialogOpen}
        editing={editing}
        onOpenChange={(open) => {
          if (!saveMutation.isPending) setDialogOpen(open);
        }}
        onSubmit={submitPackage}
        submitting={saveMutation.isPending}
      />

      <AlertDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => {
          if (!open && !toggleMutation.isPending) setToggleTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.isActive
                ? `Disable ${toggleTarget.title}?`
                : `Enable ${toggleTarget?.title ?? "package"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.isActive
                ? "Members will no longer see it in the Packages tab. Existing holdings keep earning until they expire."
                : "The package becomes visible in the members' Packages tab and available for investment immediately."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggleMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={toggleMutation.isPending}
              onClick={(e) => {
                e.preventDefault(); // keep the dialog open until the mutation settles
                if (toggleTarget) {
                  toggleMutation.mutate({ action: "toggle", id: toggleTarget.id });
                }
              }}
            >
              {toggleMutation.isPending
                ? "Working…"
                : toggleTarget?.isActive
                  ? "Disable package"
                  : "Enable package"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
