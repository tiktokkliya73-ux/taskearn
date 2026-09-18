"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Gift,
  Info,
  ListOrdered,
  Percent,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CardSkeleton, SectionError } from "@/components/admin/shared";
import { apiFetch } from "@/lib/client-api";
import { INVITE_LEVELS_MAX, INVITE_TEXT_LIST_MAX, INVITE_TEXT_MAX_CHARS } from "@/lib/invite";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface InviteDraft {
  commissionPercent: string;
  commissionText: string;
  /** Raw level rows — string inputs for a controlled form experience. */
  levels: { required: string; reward: string }[];
  /** One step per line (raw template text — {percent} placeholders intact). */
  howItWorks: string;
  /** One bullet per line (raw template text — {percent} placeholders intact). */
  policy: string;
}

interface InvitePayload {
  settings: Record<string, string>;
}

function parseLevelsFromSetting(raw: string | undefined): { required: string; reward: string }[] {
  try {
    const parsed = JSON.parse((raw ?? "").trim());
    if (Array.isArray(parsed)) {
      return parsed
        .map((v): { required: string; reward: string } | null => {
          if (typeof v !== "object" || v === null) return null;
          const required = Number((v as { required?: unknown }).required);
          const reward = Number((v as { reward?: unknown }).reward);
          if (!Number.isFinite(required) || !Number.isFinite(reward)) return null;
          return { required: String(required), reward: String(reward) };
        })
        .filter((v): v is { required: string; reward: string } => v !== null);
    }
  } catch {
    /* fall through */
  }
  return [];
}

function fromServer(raw: Record<string, string>): InviteDraft {
  return {
    commissionPercent: raw.invite_commission_percent ?? "10",
    commissionText: raw.invite_commission_text ?? "",
    levels: parseLevelsFromSetting(raw.invite_reward_levels),
    howItWorks: (JSON.parse(raw.invite_how_it_works ?? "[]") as unknown[])
      .filter((v): v is string => typeof v === "string")
      .join("\n"),
    policy: (JSON.parse(raw.invite_referral_policy ?? "[]") as unknown[])
      .filter((v): v is string => typeof v === "string")
      .join("\n"),
  };
}

function toPayload(draft: InviteDraft): Record<string, string> {
  const levels = draft.levels
    .map((l) => ({ required: Number(l.required), reward: Number(l.reward) }))
    .filter((l) => Number.isInteger(l.required) && l.required > 0 && Number.isInteger(l.reward) && l.reward > 0)
    .sort((a, b) => a.required - b.required);
  const lines = (s: string) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  return {
    invite_commission_percent: draft.commissionPercent.trim(),
    invite_commission_text: draft.commissionText.trim(),
    invite_reward_levels: JSON.stringify(levels),
    invite_how_it_works: JSON.stringify(lines(draft.howItWorks)),
    invite_referral_policy: JSON.stringify(lines(draft.policy)),
  };
}

function draftEquals(a: InviteDraft, b: InviteDraft): boolean {
  return JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));
}

function contentKey(raw: Record<string, string>): string {
  return JSON.stringify(Object.keys(raw).sort().map((k) => [k, raw[k] ?? ""]));
}

/* ------------------------------------------------------------------ */
/* form                                                                */
/* ------------------------------------------------------------------ */

function InviteSettingsForm({ initial }: { initial: InviteDraft }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<InviteDraft>(initial);
  const [baseline, setBaseline] = useState<InviteDraft>(initial);
  const [errors, setErrors] = useState<Partial<Record<"percent" | "commissionText" | "levels" | "howItWorks" | "policy", string>>>({});

  const dirty = useMemo(() => !draftEquals(draft, baseline), [draft, baseline]);

  const validate = (): boolean => {
    const next: typeof errors = {};
    const percent = Number(draft.commissionPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      next.percent = "Percentage must be a whole number between 0 and 100.";
    }
    const commissionText = draft.commissionText.trim();
    if (commissionText.length < 3 || commissionText.length > 200) {
      next.commissionText = "Card text must be between 3 and 200 characters.";
    }
    const levels = draft.levels.map((l) => ({ required: Number(l.required), reward: Number(l.reward) }));
    if (levels.length < 1 || levels.length > INVITE_LEVELS_MAX) {
      next.levels = `Keep between 1 and ${INVITE_LEVELS_MAX} levels.`;
    } else if (levels.some((l) => !Number.isInteger(l.required) || l.required < 1 || !Number.isInteger(l.reward) || l.reward < 1)) {
      next.levels = "Every level needs whole numbers of PKR 1 or more.";
    }
    const howLines = draft.howItWorks.split("\n").map((l) => l.trim()).filter(Boolean);
    if (howLines.length < 1 || howLines.length > INVITE_TEXT_LIST_MAX) {
      next.howItWorks = `Keep between 1 and ${INVITE_TEXT_LIST_MAX} steps.`;
    } else if (howLines.some((l) => l.length > INVITE_TEXT_MAX_CHARS)) {
      next.howItWorks = `Each step must be ${INVITE_TEXT_MAX_CHARS} characters or fewer.`;
    }
    const policyLines = draft.policy.split("\n").map((l) => l.trim()).filter(Boolean);
    if (policyLines.length < 1 || policyLines.length > INVITE_TEXT_LIST_MAX) {
      next.policy = `Keep between 1 and ${INVITE_TEXT_LIST_MAX} bullets.`;
    } else if (policyLines.some((l) => l.length > INVITE_TEXT_MAX_CHARS)) {
      next.policy = `Each bullet must be ${INVITE_TEXT_MAX_CHARS} characters or fewer.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: (settings: Record<string, string>) =>
      apiFetch<InvitePayload>("/api/admin/invite", { method: "POST", json: { settings } }),
    onSuccess: (data) => {
      toast.success("Invite page settings saved");
      const parsed = fromServer(data.settings ?? {});
      setDraft(parsed);
      setBaseline(parsed);
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ["admin", "invite"] });
      // the member Invite page reads these values live
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const setLevel = (index: number, field: "required" | "reward", value: string) => {
    setDraft((prev) => {
      const levels = [...prev.levels];
      levels[index] = { ...levels[index], [field]: value.replace(/[^0-9]/g, "") };
      return { ...prev, levels };
    });
    setErrors((prev) => (prev.levels ? { ...prev, levels: undefined } : prev));
  };

  return (
    <Card className="py-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Invite Page Configuration</CardTitle>
            <CardDescription>
              Everything the member Invite tab shows: commission display, Cash Rewards Levels and the
              informational texts. Changes go live immediately.
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
          {/* commission */}
          <fieldset className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" disabled={saveMutation.isPending}>
            <legend className="sr-only">Referral commission</legend>
            <div className="space-y-2">
              <Label htmlFor="invite-percent">Referral Commission (%)</Label>
              <div className="relative flex">
                <span
                  aria-hidden="true"
                  className="flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground"
                >
                  <Percent className="size-3.5" />
                </span>
                <Input
                  id="invite-percent"
                  type="number"
                  min={0}
                  max={100}
                  inputMode="numeric"
                  value={draft.commissionPercent}
                  aria-invalid={errors.percent ? true : undefined}
                  onChange={(e) => {
                    setDraft((prev) => ({ ...prev, commissionPercent: e.target.value }));
                    setErrors((prev) => (prev.percent ? { ...prev, percent: undefined } : prev));
                  }}
                  className={cn("rounded-l-none flex-1", errors.percent && "border-destructive focus-visible:ring-destructive/30")}
                />
              </div>
              {errors.percent ? (
                <p className="text-xs text-destructive">{errors.percent}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Displayed on the referral code card, in How it works and in the policy text.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-commission-text">Referral Code Card Text</Label>
              <Input
                id="invite-commission-text"
                value={draft.commissionText}
                placeholder="Earn {percent}% commission on every referral's package purchase"
                aria-invalid={errors.commissionText ? true : undefined}
                onChange={(e) => {
                  setDraft((prev) => ({ ...prev, commissionText: e.target.value }));
                  setErrors((prev) => (prev.commissionText ? { ...prev, commissionText: undefined } : prev));
                }}
                className={cn(errors.commissionText && "border-destructive focus-visible:ring-destructive/30")}
              />
              {errors.commissionText ? (
                <p className="text-xs text-destructive">{errors.commissionText}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Use <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{"{percent}"}</code> where the
                  percentage should appear — it updates automatically.
                </p>
              )}
            </div>
          </fieldset>

          {/* reward levels */}
          <fieldset className="space-y-3" disabled={saveMutation.isPending}>
            <legend className="sr-only">Cash Reward Levels</legend>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Gift className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium">Cash Rewards Levels</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Unlocked when a member&apos;s team investment (qualifying team deposits) reaches the joining
                  amount. Levels are sorted ascending on save.
                </p>
              </div>
            </div>
            <div className="space-y-2.5">
              {draft.levels.map((level, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[2.5rem_1fr_1fr_2.75rem] items-center gap-2 rounded-lg border bg-card p-2.5 sm:grid-cols-[3rem_1fr_1fr_3rem]"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-amber-400/90 text-sm font-bold text-purple-950" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <Label htmlFor={`level-${i}-required`} className="sr-only">
                      Level {i + 1} joining amount in PKR
                    </Label>
                    <Input
                      id={`level-${i}-required`}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={level.required}
                      placeholder="5000"
                      onChange={(e) => setLevel(i, "required", e.target.value)}
                      className="tabular-nums"
                    />
                    <p className="mt-1 hidden text-[10px] text-muted-foreground sm:block">Joining (PKR)</p>
                  </div>
                  <div className="min-w-0">
                    <Label htmlFor={`level-${i}-reward`} className="sr-only">
                      Level {i + 1} cash reward in PKR
                    </Label>
                    <Input
                      id={`level-${i}-reward`}
                      type="number"
                      min={1}
                      inputMode="numeric"
                      value={level.reward}
                      placeholder="1500"
                      onChange={(e) => setLevel(i, "reward", e.target.value)}
                      className="tabular-nums"
                    />
                    <p className="mt-1 hidden text-[10px] text-muted-foreground sm:block">Reward (PKR)</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={draft.levels.length <= 1}
                    onClick={() => setDraft((prev) => ({ ...prev, levels: prev.levels.filter((_, j) => j !== i) }))}
                    aria-label={`Remove level ${i + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            {errors.levels ? <p className="text-xs text-destructive">{errors.levels}</p> : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={draft.levels.length >= INVITE_LEVELS_MAX}
              onClick={() => setDraft((prev) => ({ ...prev, levels: [...prev.levels, { required: "", reward: "" }] }))}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add Level
            </Button>
          </fieldset>

          {/* how it works */}
          <fieldset className="space-y-2" disabled={saveMutation.isPending}>
            <legend className="sr-only">How it works</legend>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ListOrdered className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <Label htmlFor="invite-how" className="text-sm font-medium">
                  How It Works
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">One step per line — numbered automatically.</p>
              </div>
            </div>
            <Textarea
              id="invite-how"
              rows={5}
              value={draft.howItWorks}
              placeholder={"Share your referral link with friends\nThey sign up and buy a package\nYou earn {percent}% commission on their package purchase\nUnlock Cash Rewards as your team grows!"}
              aria-invalid={errors.howItWorks ? true : undefined}
              onChange={(e) => {
                setDraft((prev) => ({ ...prev, howItWorks: e.target.value }));
                setErrors((prev) => (prev.howItWorks ? { ...prev, howItWorks: undefined } : prev));
              }}
              className={cn(errors.howItWorks && "border-destructive focus-visible:ring-destructive/30")}
            />
            {errors.howItWorks ? (
              <p className="text-xs text-destructive">{errors.howItWorks}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{"{percent}"}</code> is replaced with the
                live commission percentage.
              </p>
            )}
          </fieldset>

          {/* referral policy */}
          <fieldset className="space-y-2" disabled={saveMutation.isPending}>
            <legend className="sr-only">Referral policy</legend>
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Info className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <Label htmlFor="invite-policy" className="text-sm font-medium">
                  Referral Policy
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">One bullet per line.</p>
              </div>
            </div>
            <Textarea
              id="invite-policy"
              rows={5}
              value={draft.policy}
              placeholder={"You earn only when your referred user purchases a package.\nOn every paid package purchase, you receive {percent}% commission of the package amount."}
              aria-invalid={errors.policy ? true : undefined}
              onChange={(e) => {
                setDraft((prev) => ({ ...prev, policy: e.target.value }));
                setErrors((prev) => (prev.policy ? { ...prev, policy: undefined } : prev));
              }}
              className={cn(errors.policy && "border-destructive focus-visible:ring-destructive/30")}
            />
            {errors.policy ? (
              <p className="text-xs text-destructive">{errors.policy}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Keep the rules aligned with the platform&apos;s actual referral logic.
              </p>
            )}
          </fieldset>

          {/* actions */}
          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setDraft(baseline);
                  setErrors({});
                }}
              >
                <RotateCcw aria-hidden="true" />
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" disabled={!dirty || saveMutation.isPending}>
              <Save aria-hidden="true" />
              {saveMutation.isPending ? "Saving…" : "Save invite settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* view                                                                */
/* ------------------------------------------------------------------ */

export function InviteSettingsView() {
  const settingsQuery = useQuery({
    queryKey: ["admin", "invite"],
    queryFn: () => apiFetch<InvitePayload>("/api/admin/invite"),
  });

  if (settingsQuery.isPending) {
    return (
      <div className="space-y-6">
        <CardSkeleton className="h-[720px]" />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <SectionError
        title="Could not load invite settings"
        message={settingsQuery.error.message}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const raw = settingsQuery.data.settings ?? {};

  return (
    <div className="space-y-6">
      <InviteSettingsForm key={contentKey(raw)} initial={fromServer(raw)} />
    </div>
  );
}
