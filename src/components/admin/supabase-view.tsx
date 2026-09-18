"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FileTerminal,
  ListOrdered,
  Loader2,
  LogIn,
  RefreshCw,
  Rocket,
  Server,
  ShieldAlert,
  Users,
  X,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardSkeleton, SectionError } from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { SupabaseStatusDTO } from "@/lib/types";

/**
 * Admin → Supabase (Task 8): status + provisioning + migration control for the
 * dual data backend. Mirrors the patterns of the other admin views (TanStack
 * Query + apiFetch + sonner + framer-motion + shared helpers).
 */

/* ------------------------------ motion helper ------------------------------ */

function FadeIn({ delay = 0, children, className }: { delay?: number; children: React.ReactNode; className?: string }) {
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

/* --------------------------------- status bits ------------------------------ */

function BooleanPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {ok ? (
        <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
      ) : (
        <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-semibold", ok ? "text-foreground" : "text-muted-foreground")}>
        {ok ? "Yes" : "No"}
      </span>
    </span>
  );
}

function CountStat({ label, value, icon: Icon }: { label: string; value: number | null | undefined; icon: typeof Users }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums">
          {value === null || value === undefined ? "—" : value.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/* --------------------------------- setup card ------------------------------- */

const SETUP_STEPS: { title: string; body: string; icon: typeof LogIn; iconClass: string }[] = [
  {
    title: "Open your Supabase dashboard",
    body: "Sign in at supabase.com and open the project this site is connected to.",
    icon: LogIn,
    iconClass: "bg-primary/10 text-primary",
  },
  {
    title: "Open the SQL Editor",
    body: "Create a new query in SQL Editor → New query.",
    icon: FileTerminal,
    iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    title: "Paste the script below and Run",
    body: "It creates all tables, RPC functions and seed data — idempotent, ~10 seconds. Then come back and press Recheck.",
    icon: ListOrdered,
    iconClass: "bg-primary/10 text-primary",
  },
];

function SetupCard({
  status,
  rechecking,
  onRecheck,
}: {
  status: SupabaseStatusDTO;
  rechecking: boolean;
  onRecheck: () => void;
}) {
  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(status.sql);
      toast.success("SQL copied to clipboard");
    } catch {
      toast.error("Could not copy — select the text manually.");
    }
  };

  return (
    <Card className="py-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">One-time setup — create the tables</CardTitle>
            <CardDescription>
              The tables don&apos;t exist in your Supabase project yet. Run this script once, then
              press Recheck.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" disabled={rechecking} onClick={onRecheck}>
            {rechecking ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {rechecking ? "Checking…" : "Recheck"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-2">
        <ol className="grid gap-3 sm:grid-cols-3">
          {SETUP_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex items-start gap-3 rounded-lg border bg-card p-4">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", step.iconClass)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    <span className="mr-1.5 text-primary">{i + 1}.</span>
                    {step.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              db/supabase-schema.sql — the complete provisioning script
            </p>
            <Button variant="outline" size="sm" onClick={copySql} disabled={!status.sql}>
              <Copy aria-hidden="true" />
              Copy SQL
            </Button>
          </div>
          <pre
            tabIndex={0}
            aria-label="Supabase provisioning SQL script"
            className={cn(
              "max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-[11px] leading-relaxed text-foreground/90",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "[scrollbar-width:thin]",
              "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            )}
          >
            {status.sql || "-- SQL script could not be read on the server."}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------- migrate card ------------------------------- */

function ReadyCard({
  status,
  migrating,
  onMigrate,
}: {
  status: SupabaseStatusDTO;
  migrating: boolean;
  onMigrate: () => void;
}) {
  return (
    <Card className="py-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Tables detected — ready to go live</CardTitle>
            <CardDescription>
              Your Supabase project is provisioned with
              {" "}
              {(status.supabaseUserCount ?? 0).toLocaleString()} user
              {(status.supabaseUserCount ?? 0) === 1 ? "" : "s"}.
            </CardDescription>
          </div>
          <Button onClick={onMigrate} disabled={migrating}>
            {migrating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Rocket aria-hidden="true" />}
            {migrating ? "Migrating…" : "Migrate & Activate"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ul className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <li className="flex items-start gap-2 rounded-lg border bg-card p-3">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Copies every local user, wallet, plan, task and transaction to Supabase (existing remote
            rows are kept).
          </li>
          <li className="flex items-start gap-2 rounded-lg border bg-card p-3">
            <Server className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Makes Supabase the LIVE data backend — signups, tasks, deposits and payouts all run on
            Postgres RPCs from then on.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/* -------------------------------- live banner ------------------------------- */

function LiveCard({
  status,
  deactivating,
  onDeactivate,
}: {
  status: SupabaseStatusDTO;
  deactivating: boolean;
  onDeactivate: () => void;
}) {
  return (
    <Alert className="items-start border-primary/40 bg-primary/5">
      <span className="relative flex h-4 w-4 shrink-0 pt-1">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" aria-hidden="true" />
        <span className="relative inline-flex h-4 w-4 rounded-full bg-primary/70" aria-hidden="true" />
      </span>
      <div className="flex-1">
        <AlertTitle className="text-primary">LIVE — Supabase is the data backend</AlertTitle>
        <AlertDescription className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>
            All reads and financial mutations now run against your Supabase project
            {(status.supabaseUserCount ?? 0) > 0
              ? ` (${(status.supabaseUserCount ?? 0).toLocaleString()} users)`
              : ""}
            . The local SQLite store stays as a fallback you can switch back to at any time.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={deactivating}
            onClick={onDeactivate}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {deactivating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
            {deactivating ? "Switching…" : "Deactivate"}
          </Button>
        </AlertDescription>
      </div>
    </Alert>
  );
}

/* ---------------------------------- view ------------------------------------ */

export function SupabaseView() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<"migrate" | "deactivate" | null>(null);

  const statusQuery = useQuery({
    queryKey: ["admin", "supabase"],
    queryFn: () => apiFetch<SupabaseStatusDTO>("/api/admin/supabase"),
    refetchInterval: 10_000,
  });

  const invalidateEverything = () => {
    // The data source changed — every cached list/aggregate is stale.
    void queryClient.invalidateQueries();
  };

  const recheckMutation = useMutation({
    mutationFn: () =>
      apiFetch<SupabaseStatusDTO>("/api/admin/supabase", { method: "POST", json: { action: "recheck" } }),
    onSuccess: (data) => {
      if (data.provisioned) toast.success("Supabase tables detected — ready to migrate.");
      else toast("Tables not found yet — run the SQL script first.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "supabase"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const migrateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; migrated: Record<string, number> }>("/api/admin/supabase", {
        method: "POST",
        json: { action: "migrate" },
      }),
    onSuccess: (data) => {
      const m = data.migrated ?? {};
      toast.success(
        `Migration complete — Supabase is now LIVE (${m.users ?? 0} users, ${m.transactions ?? 0} transactions)`
      );
      setConfirm(null);
      invalidateEverything();
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setConfirm(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean }>("/api/admin/supabase", { method: "POST", json: { action: "deactivate" } }),
    onSuccess: () => {
      toast("Switched back to the local backend");
      setConfirm(null);
      invalidateEverything();
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setConfirm(null);
    },
  });

  if (statusQuery.isPending) {
    return (
      <div className="space-y-6">
        <CardSkeleton className="h-[280px]" />
        <CardSkeleton className="h-[420px]" />
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <SectionError
        title="Could not load Supabase status"
        message={statusQuery.error.message}
        onRetry={() => void statusQuery.refetch()}
      />
    );
  }

  const status = statusQuery.data;
  const live = status.backend === "supabase";
  const submitting = migrateMutation.isPending || deactivateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* status card */}
      <FadeIn>
        <Card className="py-0">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Supabase Data Backend</CardTitle>
                <CardDescription>
                  Dual-backend control — run on the local SQLite store or switch to your Supabase
                  project.
                </CardDescription>
              </div>
              {live ? (
                <Badge className="gap-1.5 bg-emerald-600 hover:bg-emerald-600">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-70" aria-hidden="true" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-white" aria-hidden="true" />
                  </span>
                  LIVE · Supabase
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1.5">
                  <Database className="h-3.5 w-3.5" aria-hidden="true" />
                  Local · SQLite
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                  <Database className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-1">
                  <BooleanPill ok={status.configured} label="Configured" />
                  <BooleanPill ok={status.provisioned} label="Provisioned" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <CountStat label="Supabase users" value={status.supabaseUserCount} icon={Users} />
                <CountStat label="Auth users" value={status.authUserCount} icon={ShieldAlert} />
              </div>
            </div>

            {status.siteUrl ? (
              <a
                href={status.siteUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate font-mono text-xs">{status.siteUrl}</span>
              </a>
            ) : null}

            {status.connectError ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>Connection problem</AlertTitle>
                <AlertDescription>{status.connectError}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </FadeIn>

      {/* state-driven cards */}
      {live ? (
        <FadeIn delay={0.08}>
          <LiveCard
            status={status}
            deactivating={deactivateMutation.isPending}
            onDeactivate={() => setConfirm("deactivate")}
          />
        </FadeIn>
      ) : status.provisioned ? (
        <FadeIn delay={0.08}>
          <ReadyCard
            status={status}
            migrating={migrateMutation.isPending}
            onMigrate={() => setConfirm("migrate")}
          />
        </FadeIn>
      ) : (
        <FadeIn delay={0.08}>
          <SetupCard
            status={status}
            rechecking={recheckMutation.isPending}
            onRecheck={() => recheckMutation.mutate()}
          />
        </FadeIn>
      )}

      {/* confirm dialogs */}
      {confirm === "migrate" ? (
        <AlertDialog open onOpenChange={(open) => !open && !submitting && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Migrate &amp; activate Supabase?</AlertDialogTitle>
              <AlertDialogDescription>
                Copies all local data to your Supabase project and makes it the live data backend.
              </AlertDialogDescription>
              <AlertDialogDescription>
                Existing remote rows are kept, local settings win, and the site keeps working during
                the switch. You can deactivate at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={submitting}
                onClick={(e) => {
                  e.preventDefault(); // keep the dialog open until the mutation settles
                  migrateMutation.mutate();
                }}
              >
                {migrateMutation.isPending ? "Working…" : "Migrate & Activate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {confirm === "deactivate" ? (
        <AlertDialog open onOpenChange={(open) => !open && !submitting && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Switch back to the local backend?</AlertDialogTitle>
              <AlertDialogDescription>
                Data written to Supabase AFTER the switch will not be copied back automatically —
                the local SQLite store still has the state from the moment you migrated.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={submitting}
                onClick={(e) => {
                  e.preventDefault();
                  deactivateMutation.mutate();
                }}
              >
                {deactivateMutation.isPending ? "Working…" : "Deactivate"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {/* status footer note */}
      {!live && status.provisioned ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Provisioning detected — the switch happens only when you confirm.
        </p>
      ) : null}
    </div>
  );
}
