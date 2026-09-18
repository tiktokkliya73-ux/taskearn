"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Pencil, Plus, Power, Save } from "lucide-react";
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
import type { PlanDTO } from "@/lib/types";

interface PlansPayload {
  plans: PlanDTO[];
}

interface PlanForm {
  name: string;
  description: string;
  price: string;
  rewardPerTask: string;
  dailyTaskLimit: string;
  durationDays: string;
}

const EMPTY_FORM: PlanForm = {
  name: "",
  description: "",
  price: "",
  rewardPerTask: "",
  dailyTaskLimit: "",
  durationDays: "",
};

function formFromPlan(plan: PlanDTO): PlanForm {
  return {
    name: plan.name,
    description: plan.description ?? "",
    price: String(plan.price),
    rewardPerTask: String(plan.rewardPerTask),
    dailyTaskLimit: String(plan.dailyTaskLimit),
    durationDays: String(plan.durationDays),
  };
}

/* ------------------------------- plan dialog ------------------------------- */

interface PlanDialogProps {
  open: boolean;
  editing: PlanDTO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: PlanForm, editingId: string | null) => void;
  submitting: boolean;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min = 1,
  prefix,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  prefix?: string;
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
          min={min}
          inputMode="numeric"
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={prefix ? "rounded-l-none" : undefined}
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function PlanDialog({ open, editing, onOpenChange, onSubmit, submitting }: PlanDialogProps) {
  // Remounted (via key) every time the dialog is opened, so this initializer
  // always starts from the current plan — no reset effects needed.
  const [form, setForm] = useState<PlanForm>(() => (editing ? formFromPlan(editing) : EMPTY_FORM));
  const [errors, setErrors] = useState<Partial<Record<keyof PlanForm, string>>>({});

  const setField = (key: keyof PlanForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = () => {
    const next: Partial<Record<keyof PlanForm, string>> = {};
    if (form.name.trim().length < 2) next.name = "Name must be at least 2 characters.";
    for (const key of ["price", "rewardPerTask", "dailyTaskLimit", "durationDays"] as const) {
      const n = Number(form[key]);
      if (!Number.isInteger(n) || n < 1) next[key] = "Enter a whole number of 1 or more.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error("Please fix the highlighted fields.");
      return;
    }
    onSubmit(form, editing?.id ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.name}` : "Create VIP plan"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the pricing and rewards for this plan."
              : "New plans appear on the landing page as soon as they are active."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="plan-name">Name</Label>
            <Input
              id="plan-name"
              value={form.name}
              placeholder="VIP 3 · Gold"
              aria-invalid={errors.name ? true : undefined}
              onChange={(e) => setField("name", e.target.value)}
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="plan-description">Description (optional)</Label>
            <Textarea
              id="plan-description"
              rows={2}
              value={form.description}
              placeholder="Short pitch shown next to the plan on the landing page."
              onChange={(e) => setField("description", e.target.value)}
            />
          </div>
          <NumberField
            id="plan-price"
            label="Price"
            prefix="Rs"
            value={form.price}
            error={errors.price}
            onChange={(v) => setField("price", v)}
          />
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="plan-reward"
              label="Reward / task"
              prefix="Rs"
              value={form.rewardPerTask}
              error={errors.rewardPerTask}
              onChange={(v) => setField("rewardPerTask", v)}
            />
            <NumberField
              id="plan-limit"
              label="Daily task limit"
              value={form.dailyTaskLimit}
              error={errors.dailyTaskLimit}
              onChange={(v) => setField("dailyTaskLimit", v)}
            />
          </div>
          <NumberField
            id="plan-duration"
            label="Duration (days)"
            value={form.durationDays}
            error={errors.durationDays}
            onChange={(v) => setField("durationDays", v)}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            <Save aria-hidden="true" />
            {submitting ? "Saving…" : editing ? "Save changes" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function PlansView() {
  const queryClient = useQueryClient();
  const plansQuery = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => apiFetch<PlansPayload>("/api/admin/plans"),
  });

  // Dashboard quick action: #/admin/plans?create=1 opens the create dialog on
  // arrival. The one-time flag is stripped below so a refresh doesn't reopen.
  const { query: navQuery, navigate } = useHashRoute();
  const createOnArrival = navQuery.get("create") === "1";
  const [dialogOpen, setDialogOpen] = useState(createOnArrival);
  const [editing, setEditing] = useState<PlanDTO | null>(null);
  const [dialogSession, setDialogSession] = useState(0);
  const [toggleTarget, setToggleTarget] = useState<PlanDTO | null>(null);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<PlansPayload>("/api/admin/plans", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      toast.success(payload.action === "update" ? "Plan updated" : "Plan created");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "plans"] });
      void queryClient.invalidateQueries({ queryKey: ["public"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (payload: { action: "toggle"; id: string }) =>
      apiFetch<PlansPayload>("/api/admin/plans", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success("Plan availability updated");
      setToggleTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "plans"] });
      void queryClient.invalidateQueries({ queryKey: ["public"] });
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
      navigate("/admin/plans");
    }
  }, [navQuery, navigate]);

  const openEdit = (plan: PlanDTO) => {
    setEditing(plan);
    setDialogSession((s) => s + 1);
    setDialogOpen(true);
  };

  const submitPlan = (form: PlanForm, editingId: string | null) => {
    saveMutation.mutate({
      action: editingId ? "update" : "create",
      ...(editingId ? { id: editingId } : {}),
      name: form.name.trim(),
      description: form.description.trim() || null,
      price: Number(form.price),
      rewardPerTask: Number(form.rewardPerTask),
      dailyTaskLimit: Number(form.dailyTaskLimit),
      durationDays: Number(form.durationDays),
    });
  };

  const plans = plansQuery.data?.plans ?? [];
  const activeCount = plans.filter((p) => p.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {plans.length} plan{plans.length === 1 ? "" : "s"} · {activeCount} active
        </p>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create Plan
        </Button>
      </div>

      <Card className="py-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">VIP plans</CardTitle>
          <CardDescription>Pricing, rewards and availability for every membership tier.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {plansQuery.isPending ? (
            <TableSkeleton rows={4} columns={7} />
          ) : plansQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load plans"
                message={plansQuery.error.message}
                onRetry={() => void plansQuery.refetch()}
              />
            </div>
          ) : plans.length === 0 ? (
            <EmptyState
              icon={Crown}
              title="No plans yet"
              description="Create your first VIP plan to start selling memberships."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Plan</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Reward / Task</TableHead>
                    <TableHead className="text-right">Daily Limit</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Daily Payout</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="max-w-[260px] pl-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <Crown className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{plan.name}</p>
                            {plan.description ? (
                              <p className="truncate text-xs text-muted-foreground">{plan.description}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatPKR(plan.price)}</TableCell>
                      <TableCell className="text-right tabular-nums text-primary">
                        {formatPKR(plan.rewardPerTask)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{plan.dailyTaskLimit}</TableCell>
                      <TableCell className="text-right tabular-nums">{plan.durationDays} days</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPKR(plan.rewardPerTask * plan.dailyTaskLimit)}
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={plan.isActive} />
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${plan.name}`}
                            onClick={() => openEdit(plan)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={plan.isActive ? `Disable ${plan.name}` : `Enable ${plan.name}`}
                            className={plan.isActive ? "text-destructive hover:text-destructive" : "text-primary hover:text-primary"}
                            onClick={() => setToggleTarget(plan)}
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

      <PlanDialog
        key={`plan-dialog-${dialogSession}`}
        open={dialogOpen}
        editing={editing}
        onOpenChange={(open) => {
          if (!saveMutation.isPending) setDialogOpen(open);
        }}
        onSubmit={submitPlan}
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
                ? `Disable ${toggleTarget.name}?`
                : `Enable ${toggleTarget?.name ?? "plan"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.isActive
                ? "New users won't see it. Existing members keep their active plan until it expires."
                : "The plan becomes visible on the landing page and available for purchase immediately."}
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
                  ? "Disable plan"
                  : "Enable plan"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
