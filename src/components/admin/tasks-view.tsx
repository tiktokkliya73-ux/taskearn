"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, ExternalLink, ListChecks, Pencil, Plus, Power, Save, Target } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import type { PlanDTO, TaskDTO } from "@/lib/types";

interface TasksPayload {
  tasks: TaskDTO[];
}

interface PlansPayload {
  plans: PlanDTO[];
}

interface TaskForm {
  title: string;
  description: string;
  url: string;
  durationSeconds: string;
  rewardAmount: string; // "" = plan default
  planId: string; // "" = all plans
}

const EMPTY_FORM: TaskForm = {
  title: "",
  description: "",
  url: "",
  durationSeconds: "",
  rewardAmount: "",
  planId: "",
};

function formFromTask(task: TaskDTO): TaskForm {
  return {
    title: task.title,
    description: task.description ?? "",
    url: task.url,
    durationSeconds: String(task.durationSeconds),
    rewardAmount: task.rewardAmount == null ? "" : String(task.rewardAmount),
    planId: task.planId ?? "",
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
}

/* ------------------------------- task dialog ------------------------------- */

interface TaskDialogProps {
  open: boolean;
  editing: TaskDTO | null;
  plans: PlanDTO[]; // for the target-plan select
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: TaskForm, editingId: string | null) => void;
  submitting: boolean;
}

function TaskDialog({ open, editing, plans, onOpenChange, onSubmit, submitting }: TaskDialogProps) {
  // Remounted (via key) every time the dialog is opened, so this initializer
  // always starts from the current task — no reset effects needed.
  const [form, setForm] = useState<TaskForm>(() => (editing ? formFromTask(editing) : EMPTY_FORM));
  const [errors, setErrors] = useState<Partial<Record<keyof TaskForm, string>>>({});

  const setField = (key: keyof TaskForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const submit = () => {
    const next: Partial<Record<keyof TaskForm, string>> = {};
    if (form.title.trim().length < 2) next.title = "Title must be at least 2 characters.";
    if (!/^https?:\/\/.+\..+/.test(form.url.trim())) {
      next.url = "Enter a full URL starting with http:// or https://";
    }
    const duration = Number(form.durationSeconds);
    if (!Number.isInteger(duration) || duration < 5 || duration > 600) {
      next.durationSeconds = "Duration must be between 5 and 600 seconds.";
    }
    const rewardRaw = form.rewardAmount.trim();
    if (rewardRaw !== "") {
      const reward = Number(rewardRaw);
      if (!Number.isInteger(reward) || reward < 0 || reward > 100_000) {
        next.rewardAmount = "Reward must be a whole number between 0 and 100,000.";
      }
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
          <DialogTitle>{editing ? `Edit ${editing.title}` : "Create daily task"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the ad page, reward, timer and target plan for this task."
              : "New tasks appear in the Daily Tasks list for members with an active plan."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={form.title}
              placeholder="Follow TaskEarn on X"
              aria-invalid={errors.title ? true : undefined}
              onChange={(e) => setField("title", e.target.value)}
            />
            {errors.title ? <p className="text-xs text-destructive">{errors.title}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-description">Description (optional)</Label>
            <Textarea
              id="task-description"
              rows={2}
              value={form.description}
              placeholder="Short instruction shown under the task title."
              onChange={(e) => setField("description", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-url">CPM / Ad webpage link</Label>
            <Input
              id="task-url"
              type="url"
              inputMode="url"
              value={form.url}
              placeholder="https://ads.network/campaign/123"
              aria-invalid={errors.url ? true : undefined}
              onChange={(e) => setField("url", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Rendered inside the task modal while the countdown runs.</p>
            {errors.url ? <p className="text-xs text-destructive">{errors.url}</p> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="task-duration">Timer duration (seconds)</Label>
              <Input
                id="task-duration"
                type="number"
                min={5}
                max={600}
                inputMode="numeric"
                value={form.durationSeconds}
                placeholder="10"
                aria-invalid={errors.durationSeconds ? true : undefined}
                onChange={(e) => setField("durationSeconds", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Countdown before Claim unlocks (5–600s).</p>
              {errors.durationSeconds ? <p className="text-xs text-destructive">{errors.durationSeconds}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-reward">Reward amount (PKR)</Label>
              <Input
                id="task-reward"
                type="number"
                min={0}
                max={100000}
                inputMode="numeric"
                value={form.rewardAmount}
                placeholder="Plan default"
                aria-invalid={errors.rewardAmount ? true : undefined}
                onChange={(e) => setField("rewardAmount", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional override — empty pays the member&apos;s plan reward per task.
              </p>
              {errors.rewardAmount ? <p className="text-xs text-destructive">{errors.rewardAmount}</p> : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-plan">Target investment plan</Label>
            <Select
              value={form.planId || "all"}
              onValueChange={(v) => setField("planId", v === "all" ? "" : v)}
            >
              <SelectTrigger id="task-plan" className="w-full">
                <SelectValue placeholder="All plans" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {formatPKR(p.rewardPerTask)}/task
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Restrict this task to members on one plan — or show it to everyone.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            <Save aria-hidden="true" />
            {submitting ? "Saving…" : editing ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- view ----------------------------------- */

export function AdminTasksView() {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({
    queryKey: ["admin", "tasks"],
    queryFn: () => apiFetch<TasksPayload>("/api/admin/tasks"),
  });
  const plansQuery = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => apiFetch<PlansPayload>("/api/admin/plans"),
  });
  const planName = (id: string | null) => (id ? (plansQuery.data?.plans ?? []).find((p) => p.id === id)?.name ?? "—" : "All plans");

  // Dashboard quick action: #/admin/tasks?create=1 opens the create dialog on
  // arrival. The one-time flag is stripped below so a refresh doesn't reopen.
  const { query: navQuery, navigate } = useHashRoute();
  const createOnArrival = navQuery.get("create") === "1";
  const [dialogOpen, setDialogOpen] = useState(createOnArrival);
  const [editing, setEditing] = useState<TaskDTO | null>(null);
  const [dialogSession, setDialogSession] = useState(0);
  const [toggleTarget, setToggleTarget] = useState<TaskDTO | null>(null);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiFetch<TasksPayload>("/api/admin/tasks", { method: "POST", json: payload }),
    onSuccess: (_data, payload) => {
      toast.success(payload.action === "update" ? "Task updated" : "Task created");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["admin", "tasks"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (payload: { action: "toggle"; id: string }) =>
      apiFetch<TasksPayload>("/api/admin/tasks", { method: "POST", json: payload }),
    onSuccess: () => {
      toast.success("Task availability updated");
      setToggleTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "tasks"] });
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
      navigate("/admin/tasks");
    }
  }, [navQuery, navigate]);

  const openEdit = (task: TaskDTO) => {
    setEditing(task);
    setDialogSession((s) => s + 1);
    setDialogOpen(true);
  };

  const submitTask = (form: TaskForm, editingId: string | null) => {
    saveMutation.mutate({
      action: editingId ? "update" : "create",
      ...(editingId ? { id: editingId } : {}),
      title: form.title.trim(),
      description: form.description.trim() || null,
      url: form.url.trim(),
      durationSeconds: Number(form.durationSeconds),
      rewardAmount: form.rewardAmount.trim() === "" ? null : Number(form.rewardAmount),
      planId: form.planId || null,
    });
  };

  const tasks = tasksQuery.data?.tasks ?? [];
  const activeCount = tasks.filter((t) => t.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {tasks.length} task{tasks.length === 1 ? "" : "s"} · {activeCount} active
        </p>
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Create Task
        </Button>
      </div>

      <Card className="py-0 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daily tasks</CardTitle>
          <CardDescription>The task library served to members with an active plan.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {tasksQuery.isPending ? (
            <TableSkeleton rows={6} columns={5} />
          ) : tasksQuery.isError ? (
            <div className="p-6">
              <SectionError
                title="Could not load tasks"
                message={tasksQuery.error.message}
                onRetry={() => void tasksQuery.refetch()}
              />
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              description="Create your first daily task so members with active plans can earn rewards."
            />
          ) : (
            <TableWrap>
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Task</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead className="text-right">Timer</TableHead>
                    <TableHead className="text-right">Reward</TableHead>
                    <TableHead>Target plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="max-w-[280px] pl-6">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                            <ListChecks className="h-4 w-4" aria-hidden="true" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{task.title}</p>
                            {task.description ? (
                              <p className="truncate text-xs text-muted-foreground">{task.description}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <a
                          href={task.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{task.url}</span>
                        </a>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatDuration(task.durationSeconds)}</TableCell>
                      <TableCell className="text-right">
                        {task.rewardAmount != null ? (
                          <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-primary">
                            <Coins className="size-3.5" aria-hidden="true" />
                            {formatPKR(task.rewardAmount)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Plan default</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Target className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          {task.planId ? planName(task.planId) : "All plans"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={task.isActive} />
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${task.title}`}
                            onClick={() => openEdit(task)}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={task.isActive ? `Disable ${task.title}` : `Enable ${task.title}`}
                            className={task.isActive ? "text-destructive hover:text-destructive" : "text-primary hover:text-primary"}
                            onClick={() => setToggleTarget(task)}
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

      <TaskDialog
        key={`task-dialog-${dialogSession}`}
        open={dialogOpen}
        editing={editing}
        plans={plansQuery.data?.plans ?? []}
        onOpenChange={(open) => {
          if (!saveMutation.isPending) setDialogOpen(open);
        }}
        onSubmit={submitTask}
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
                : `Enable ${toggleTarget?.title ?? "task"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.isActive
                ? "Members will no longer see this task in their Daily Tasks list. Completed rewards are unaffected."
                : "The task returns to the Daily Tasks list for members with an active plan."}
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
                  ? "Disable task"
                  : "Enable task"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
