"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BadgeCheck,
  Coins,
  Gift,
  Image as ImageIcon,
  Rocket,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CardSkeleton, SectionError } from "@/components/admin/shared";
import { getAnimationSettings, type AnimationFlag } from "@/lib/animations";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

/* ---------------------------------- types ---------------------------------- */

interface SettingsDraft {
  site_title: string;
  support_email: string;
  unlock_amount_per_ref: string;
  auto_approve_deposits: boolean;
  require_payment_proof: boolean;
}

type SettingsKey = Exclude<keyof SettingsDraft, "auto_approve_deposits" | "require_payment_proof">;

interface SettingsPayload {
  settings: Record<string, string>;
}

const DEFAULT_DRAFT: SettingsDraft = {
  site_title: "",
  support_email: "",
  unlock_amount_per_ref: "",
  auto_approve_deposits: false,
  require_payment_proof: false,
};

function fromServer(raw: Record<string, string>): SettingsDraft {
  return {
    site_title: raw.site_title ?? "",
    support_email: raw.support_email ?? "",
    unlock_amount_per_ref: raw.unlock_amount_per_ref ?? "",
    auto_approve_deposits: raw.auto_approve_deposits === "true",
    require_payment_proof: raw.require_payment_proof === "true",
  };
}

function draftEquals(a: SettingsDraft, b: SettingsDraft): boolean {
  return (
    a.site_title === b.site_title &&
    a.support_email === b.support_email &&
    a.unlock_amount_per_ref === b.unlock_amount_per_ref &&
    a.auto_approve_deposits === b.auto_approve_deposits &&
    a.require_payment_proof === b.require_payment_proof
  );
}

function toPayload(draft: SettingsDraft): Record<string, string> {
  return {
    site_title: draft.site_title.trim(),
    support_email: draft.support_email.trim(),
    unlock_amount_per_ref: draft.unlock_amount_per_ref.trim(),
    auto_approve_deposits: draft.auto_approve_deposits ? "true" : "false",
    require_payment_proof: draft.require_payment_proof ? "true" : "false",
  };
}

/** Stable key derived from the actual settings content. The form component is
 * remounted only when the server content truly changes, so background refetches
 * never clobber in-progress edits and saved values always re-sync. */
function contentKey(raw: Record<string, string>): string {
  return JSON.stringify(Object.keys(raw).sort().map((k) => [k, raw[k] ?? ""]));
}

/* --------------------------------- fields ---------------------------------- */

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "email";
  min?: number;
  prefix?: string;
  span?: boolean;
}

function Field({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  placeholder,
  type = "text",
  min,
  prefix,
  span,
}: FieldProps) {
  return (
    <div className={cn("space-y-2", span && "sm:col-span-2")}>
      <Label htmlFor={id}>{label}</Label>
      <div className={cn("relative", prefix && "flex")}>
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
          type={type}
          value={value}
          min={min}
          inputMode={type === "number" ? "numeric" : undefined}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={cn(prefix && "rounded-l-none flex-1", error && "border-destructive focus-visible:ring-destructive/30")}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------- settings form ------------------------------ */

function SettingsForm({ initial }: { initial: SettingsDraft }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  // Baseline tracks the last saved snapshot, so `dirty` is accurate even
  // between save and the refetch-driven remount.
  const [baseline, setBaseline] = useState<SettingsDraft>(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<SettingsKey, string>>>({});

  const dirty = useMemo(() => !draftEquals(draft, baseline), [draft, baseline]);

  const setField = (key: keyof SettingsDraft, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key as SettingsKey];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Partial<Record<SettingsKey, string>> = {};
    if (!draft.site_title.trim()) errors.site_title = "Site title is required.";

    const email = draft.support_email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.support_email = "Enter a valid email address.";
    }

    const unlock = Number(draft.unlock_amount_per_ref);
    if (!Number.isInteger(unlock) || unlock < 0) {
      errors.unlock_amount_per_ref = "Enter a whole number of Rs 0 or more.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: (settings: Record<string, string>) =>
      apiFetch<SettingsPayload>("/api/admin/settings", { method: "POST", json: { settings } }),
    onSuccess: (data) => {
      toast.success("Settings saved");
      // re-sync the form to the server response; the content-keyed remount
      // (parent) will confirm the same values once the query refetches.
      const parsed = fromServer(data.settings ?? {});
      setDraft(parsed);
      setBaseline(parsed);
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      // gateways shown on the landing site / user wallet depend on these keys
      void queryClient.invalidateQueries({ queryKey: ["public"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Card className="py-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Platform Settings</CardTitle>
            <CardDescription>
              Referral rules and platform behavior. Payment accounts live in{" "}
              <a
                href="#/admin/payment-methods"
                className="font-medium text-primary hover:underline"
              >
                Payment Methods
              </a>
              .
            </CardDescription>
          </div>
          {dirty ? (
            <Badge variant="secondary" className="gap-1 text-amber-600 dark:text-amber-400">
              Unsaved changes
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <form
          className="space-y-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validate()) {
              toast.error("Please fix the highlighted fields.");
              return;
            }
            saveMutation.mutate(toPayload(draft));
          }}
        >
          {/* identity & platform rules (payment accounts now live in
              Payment Gateways: /admin/settings/gateways) */}
          <fieldset className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" disabled={saveMutation.isPending}>
            <legend className="sr-only">Site identity</legend>
            <Field
              id="setting-site-title"
              label="Site Title"
              value={draft.site_title}
              error={fieldErrors.site_title}
              placeholder="TaskEarn"
              hint="Shown in the top bar and browser tab."
              onChange={(v) => setField("site_title", v)}
            />
            <Field
              id="setting-support-email"
              label="Support Email"
              type="email"
              value={draft.support_email}
              error={fieldErrors.support_email}
              placeholder="support@taskearn.com"
              hint="Where members reach you with payment issues."
              onChange={(v) => setField("support_email", v)}
            />
          </fieldset>

          {/* money rules */}
          <fieldset className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" disabled={saveMutation.isPending}>
            <legend className="sr-only">Money rules</legend>
            <Field
              id="setting-unlock"
              label="Unlock Amount per Referral"
              type="number"
              min={0}
              prefix="Rs"
              value={draft.unlock_amount_per_ref}
              error={fieldErrors.unlock_amount_per_ref}
              hint="Moved from the inviter's Task Balance to Withdrawable when a referral activates a plan."
              onChange={(v) => setField("unlock_amount_per_ref", v)}
            />
            <div className="space-y-2 self-start rounded-lg border bg-muted/40 p-4 sm:col-span-2">
              <p className="text-sm font-medium">Withdrawal limits</p>
              <p className="text-xs text-muted-foreground">
                Fixed by platform policy: minimum Rs 20 per request, no fixed platform maximum —
                the per-request cap is each member&apos;s own lower of Task and Withdrawable
                balance (the Task Balance is only an eligibility cap and is never deducted).
              </p>
            </div>
          </fieldset>

          {/* auto approve */}
          <div
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
              draft.auto_approve_deposits && "border-primary/30 bg-primary/5",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Zap className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <Label htmlFor="setting-auto-approve" className="text-sm font-medium">
                  Auto-approve deposits
                </Label>
                <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
                  When ON, plan payments and top-ups are processed instantly. When OFF, each submission
                  lands in Deposit Approvals for manual review.
                </p>
              </div>
            </div>
            <Switch
              id="setting-auto-approve"
              checked={draft.auto_approve_deposits}
              onCheckedChange={(v) => setField("auto_approve_deposits", v)}
              disabled={saveMutation.isPending}
              aria-label="Auto-approve deposits"
            />
          </div>

          {/* require payment screenshot */}
          <div
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
              draft.require_payment_proof && "border-primary/30 bg-primary/5",
            )}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ImageIcon className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <Label htmlFor="setting-require-proof" className="text-sm font-medium">
                  Require payment screenshot
                </Label>
                <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
                  When ON, members must attach a screenshot of their payment receipt when submitting
                  a package or plan payment request. Package payments are always reviewed by an
                  admin before activation.
                </p>
              </div>
            </div>
            <Switch
              id="setting-require-proof"
              checked={draft.require_payment_proof}
              onCheckedChange={(v) => setField("require_payment_proof", v)}
              disabled={saveMutation.isPending}
              aria-label="Require payment screenshot"
            />
          </div>

          {/* actions */}
          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setDraft(baseline);
                  setFieldErrors({});
                }}
              >
                <RotateCcw aria-hidden="true" />
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" disabled={!dirty || saveMutation.isPending}>
              <Save aria-hidden="true" />
              {saveMutation.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* --------------------- animation & user experience ---------------------- */

/** Individual animations that actually exist today (only these are offered). */
const ANIMATION_ROWS: {
  flag: AnimationFlag;
  settingKey: string;
  icon: typeof Rocket;
  iconClass: string;
  label: string;
  hint: string;
}[] = [
  {
    flag: "planActivation",
    settingKey: "success_animation_plan_activation",
    icon: Rocket,
    iconClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "Plan Activation",
    hint: "The premium celebration after a package or plan is genuinely activated.",
  },
  {
    flag: "referralCommission",
    settingKey: "success_animation_referral_commission",
    icon: Coins,
    iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    label: "Referral Commission",
    hint: "The one-time earning presentation when a real referral commission is credited.",
  },
  {
    flag: "deposit",
    settingKey: "success_animation_deposit",
    icon: ArrowDownToLine,
    iconClass: "bg-primary/10 text-primary",
    label: "Deposit Credited",
    hint: "The success presentation when a deposit is instantly credited to the wallet.",
  },
  {
    flag: "withdrawal",
    settingKey: "success_animation_withdrawal",
    icon: Send,
    iconClass: "bg-primary/10 text-primary",
    label: "Withdrawal Request",
    hint: "The success presentation when a withdrawal request is successfully submitted.",
  },
  {
    flag: "taskClaim",
    settingKey: "success_animation_task_claim",
    icon: Gift,
    iconClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "Task Claim",
    hint: "The in-place success presentation when a daily task reward is claimed.",
  },
];

/** SystemSetting key of the master switch. */
const MASTER_KEY = "success_animations_enabled";

/**
 * Admin control for the member-facing premium success presentations.
 * Switches apply immediately through the EXISTING settings persistence
 * (POST /api/admin/settings — same endpoint, same whitelist). A separate
 * cache entry (["admin","animations"]) is used deliberately so toggling
 * here can never remount the platform-settings form above and clobber
 * its unsaved drafts.
 */
function AnimationSettingsCard() {
  const queryClient = useQueryClient();

  const animQuery = useQuery({
    queryKey: ["admin", "animations"],
    queryFn: () => apiFetch<SettingsPayload>("/api/admin/settings"),
    staleTime: 30_000,
  });

  const current = getAnimationSettings(animQuery.data?.settings ?? {});

  const saveFlag = useMutation({
    mutationFn: (vars: { key: string; value: boolean }) =>
      apiFetch<SettingsPayload>("/api/admin/settings", {
        method: "POST",
        json: { settings: { [vars.key]: vars.value ? "true" : "false" } },
      }),
    onMutate: async (vars) => {
      // Optimistic update on THIS card's cache entry only.
      const previous = queryClient.getQueryData<SettingsPayload>(["admin", "animations"]);
      queryClient.setQueryData<SettingsPayload>(["admin", "animations"], (old) =>
        old
          ? { settings: { ...old.settings, [vars.key]: vars.value ? "true" : "false" } }
          : old,
      );
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "animations"], data);
      // members' live sessions pick the change up within their next poll;
      // invalidating here makes it feel instant for a logged-in admin too.
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["admin", "animations"], ctx.previous);
      toast.error(err instanceof Error ? err.message : "Could not save the animation setting.");
    },
  });

  const toggle = (key: string, value: boolean) => saveFlag.mutate({ key, value });
  const busy = saveFlag.isPending || animQuery.isPending;

  return (
    <Card className="py-0">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Animation &amp; User Experience</CardTitle>
        <CardDescription>
          Premium success presentations shown after genuinely successful member
          actions. Visual layer only — turning any animation OFF never disables
          the action itself (activation, commission, deposit, withdrawal and
          task claims all keep working exactly as before). Applies to members
          within a few seconds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {/* Master switch */}
        <div
          className={cn(
            "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
            current.master && "border-emerald-500/30 bg-emerald-500/5",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <Label htmlFor="setting-animations-master" className="text-sm font-medium">
                Premium Success Animations
              </Label>
              <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">
                Master switch for every success animation. OFF disables all of them
                at once — members still see normal confirmations for their actions.
              </p>
            </div>
          </div>
          <Switch
            id="setting-animations-master"
            checked={current.master}
            onCheckedChange={(v) => toggle(MASTER_KEY, v)}
            disabled={busy}
            aria-label="Premium success animations master switch"
          />
        </div>

        {/* Individual animations — only the ones that actually exist */}
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Individual animations
          </legend>
          {ANIMATION_ROWS.map((row) => {
            const Icon = row.icon;
            const on = current[row.flag];
            return (
              <div
                key={row.flag}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-4 transition-opacity sm:flex-row sm:items-center sm:justify-between",
                  current.master ? "opacity-100" : "opacity-55",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", row.iconClass)}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div>
                    <Label htmlFor={`setting-animation-${row.flag}`} className="text-sm font-medium">
                      {row.label}
                    </Label>
                    <p className="mt-0.5 max-w-lg text-xs text-muted-foreground">{row.hint}</p>
                  </div>
                </div>
                <Switch
                  id={`setting-animation-${row.flag}`}
                  checked={on}
                  onCheckedChange={(v) => toggle(row.settingKey, v)}
                  disabled={busy || !current.master}
                  aria-label={`${row.label} success animation`}
                />
              </div>
            );
          })}
        </fieldset>

        <p className="text-xs text-muted-foreground">
          Individual switches only apply while the master switch is ON. Success
          animations never trigger for failed, pending or cancelled actions —
          only after the system confirms a genuine success.
        </p>
      </CardContent>
    </Card>
  );
}

/* ------------------------------- explainer --------------------------------- */

const EXPLAINER_ITEMS = [
  {
    icon: Sparkles,
    iconClass: "bg-primary/10 text-primary",
    title: "Instant referral unlock",
    body: "When a member you referred activates a VIP plan, your referral reward unlocks immediately — no waiting period.",
  },
  {
    icon: ArrowLeftRight,
    iconClass: "bg-primary/10 text-primary",
    title: "Atomic LEAST() move",
    body: "The system moves LEAST(inviter's Task Balance, unlock amount) from Task Balance to Withdrawable Balance inside one atomic database transaction. If the task balance is lower, only what exists is moved — never a negative balance.",
  },
  {
    icon: ShieldAlert,
    iconClass: "bg-destructive/10 text-destructive",
    title: "Anti-fraud blocking",
    body: "Unlocks are blocked when the inviter and invitee signed up from the same IP address or share the same device fingerprint. Blocked attempts are recorded in the ledger with amount 0.",
  },
  {
    icon: BadgeCheck,
    iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    title: "One unlock per referral",
    body: "Each referred member can trigger at most one unlock, tracked across the ledger so repeats are impossible.",
  },
];

/* ---------------------------------- view ----------------------------------- */

export function SettingsView() {
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiFetch<SettingsPayload>("/api/admin/settings"),
  });

  if (settingsQuery.isPending) {
    return (
      <div className="space-y-6">
        <CardSkeleton className="h-[560px]" />
        <CardSkeleton className="h-[240px]" />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <SectionError
        title="Could not load settings"
        message={settingsQuery.error.message}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const raw = settingsQuery.data.settings ?? {};

  return (
    <div className="space-y-6">
      <SettingsForm key={contentKey(raw)} initial={fromServer(raw)} />

      <AnimationSettingsCard />

      <Card className="py-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">How the unlock rule works</CardTitle>
          <CardDescription>
            The referral unlock is a single atomic operation — a quick reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-2 sm:grid-cols-2">
          {EXPLAINER_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="flex items-start gap-3 rounded-lg border bg-card p-4">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", item.iconClass)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
