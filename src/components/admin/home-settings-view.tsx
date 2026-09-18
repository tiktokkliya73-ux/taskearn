"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Crown,
  Eye,
  Gift,
  ImagePlay,
  Loader2,
  Megaphone,
  MessageCircle,
  PanelTop,
  Pencil,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ActiveBadge, EmptyState, SectionError, TableSkeleton } from "@/components/admin/shared";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { WelcomePopupDialog } from "@/components/dashboard/welcome-popup";
import { apiFetch } from "@/lib/client-api";
import { formatPKR } from "@/lib/money";
import { popupImageToDataUrl } from "@/lib/welcome-popup";
import { cn } from "@/lib/utils";
import { WELCOME_POPUP_FREQUENCIES } from "@/lib/types";
import type {
  AdminHomeResponseDTO,
  AdminPromoCodeDTO,
  WelcomePopupFrequency,
} from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface HomeDraft {
  home_header_title: string;
  home_header_tagline: string;
  home_announcement_ur: string;
  home_announcement_en: string;
  home_lucky_draw_date: string;
  home_team_leader_target: string;
  home_team_leader_apply_enabled: boolean;
  home_team_salary_text: string;
  home_team_salary_link: string;
  home_team_salary_image: string;
  home_whatsapp_url: string;
  home_telegram_url: string;
  home_whatsapp_reward: string;
  home_whatsapp_enabled: boolean;
  home_telegram_reward: string;
  home_telegram_enabled: boolean;
}

function fromServer(raw: Record<string, string>): HomeDraft {
  return {
    home_header_title: raw.home_header_title ?? "",
    home_header_tagline: raw.home_header_tagline ?? "",
    home_announcement_ur: raw.home_announcement_ur ?? "",
    home_announcement_en: raw.home_announcement_en ?? "",
    home_lucky_draw_date: raw.home_lucky_draw_date ?? "",
    home_team_leader_target: raw.home_team_leader_target ?? "",
    home_team_leader_apply_enabled: raw.home_team_leader_apply_enabled === "true",
    home_team_salary_text: raw.home_team_salary_text ?? "",
    home_team_salary_link: raw.home_team_salary_link ?? "",
    home_team_salary_image: raw.home_team_salary_image ?? "",
    home_whatsapp_url: raw.home_whatsapp_url ?? "",
    home_telegram_url: raw.home_telegram_url ?? "",
    home_whatsapp_reward: raw.home_whatsapp_reward ?? "",
    home_whatsapp_enabled: raw.home_whatsapp_enabled !== "false",
    home_telegram_reward: raw.home_telegram_reward ?? "",
    home_telegram_enabled: raw.home_telegram_enabled !== "false",
  };
}

function toPayload(d: HomeDraft): Record<string, string> {
  return {
    home_header_title: d.home_header_title.trim(),
    home_header_tagline: d.home_header_tagline.trim(),
    home_announcement_ur: d.home_announcement_ur.trim(),
    home_announcement_en: d.home_announcement_en.trim(),
    home_lucky_draw_date: d.home_lucky_draw_date.trim(),
    home_team_leader_target: d.home_team_leader_target.trim(),
    home_team_leader_apply_enabled: d.home_team_leader_apply_enabled ? "true" : "false",
    home_team_salary_text: d.home_team_salary_text.trim(),
    home_team_salary_link: d.home_team_salary_link.trim(),
    home_team_salary_image: d.home_team_salary_image.trim(),
    home_whatsapp_url: d.home_whatsapp_url.trim(),
    home_telegram_url: d.home_telegram_url.trim(),
    home_whatsapp_reward: d.home_whatsapp_reward.trim(),
    home_whatsapp_enabled: d.home_whatsapp_enabled ? "true" : "false",
    home_telegram_reward: d.home_telegram_reward.trim(),
    home_telegram_enabled: d.home_telegram_enabled ? "true" : "false",
  };
}

function draftEquals(a: HomeDraft, b: HomeDraft): boolean {
  return JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));
}

function contentKey(raw: Record<string, string>): string {
  return JSON.stringify(Object.keys(raw).sort().map((k) => [k, raw[k] ?? ""]));
}

/* Client-side mirrors of the server-side channel-link validator: empty
   (not configured) or an http(s) URL on an official WhatsApp/Telegram host.
   Executable schemes (javascript:, data:, …) and foreign hosts are rejected. */
const WHATSAPP_LINK_HOSTS = new Set([
  "whatsapp.com",
  "www.whatsapp.com",
  "chat.whatsapp.com",
  "www.chat.whatsapp.com",
  "wa.me",
  "www.wa.me",
]);
const TELEGRAM_LINK_HOSTS = new Set([
  "t.me",
  "www.t.me",
  "telegram.me",
  "www.telegram.me",
]);

function isChannelLinkOnHosts(v: string, hosts: Set<string>): boolean {
  try {
    const url = new URL(v);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return hosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isValidWhatsappLink(v: string): boolean {
  return isChannelLinkOnHosts(v, WHATSAPP_LINK_HOSTS);
}

function isValidTelegramLink(v: string): boolean {
  return isChannelLinkOnHosts(v, TELEGRAM_LINK_HOSTS);
}

/* ------------------------------------------------------------------ */
/* Settings form                                                       */
/* ------------------------------------------------------------------ */

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
  span,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  span?: boolean;
}) {
  return (
    <div className={cn("space-y-2", span && "sm:col-span-2")}>
      <Label htmlFor={id}>{label}</Label>
      {children}
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

function HomeSettingsForm({ initial }: { initial: HomeDraft }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<HomeDraft>(initial);
  const [baseline, setBaseline] = useState<HomeDraft>(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof HomeDraft, string>>>({});
  const dirty = useMemo(() => !draftEquals(draft, baseline), [draft, baseline]);

  const setField = (key: keyof HomeDraft, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Partial<Record<keyof HomeDraft, string>> = {};
    if (draft.home_header_title.trim().length > 60) {
      errors.home_header_title = "Keep the header title at 60 characters or fewer.";
    }
    if (draft.home_header_tagline.trim().length > 120) {
      errors.home_header_tagline = "Keep the tagline at 120 characters or fewer.";
    }
    if (draft.home_lucky_draw_date && !/^\d{4}-\d{2}-\d{2}$/.test(draft.home_lucky_draw_date)) {
      errors.home_lucky_draw_date = "Pick a valid date.";
    }
    const target = Number(draft.home_team_leader_target);
    if (!Number.isInteger(target) || target < 1) {
      errors.home_team_leader_target = "Target must be Rs 1 or more.";
    }
    const reward = Number(draft.home_telegram_reward);
    if (!Number.isInteger(reward) || reward < 0) {
      errors.home_telegram_reward = "Reward must be Rs 0 or more.";
    }
    const whatsappReward = Number(draft.home_whatsapp_reward);
    if (!Number.isInteger(whatsappReward) || whatsappReward < 0) {
      errors.home_whatsapp_reward = "Reward must be Rs 0 or more.";
    }
    // Channel links: empty (not configured) or an official WhatsApp/Telegram
    // http(s) URL — mirrors the server-side validateChannelLinkSettingValue.
    const whatsappUrl = draft.home_whatsapp_url.trim();
    if (whatsappUrl && !isValidWhatsappLink(whatsappUrl)) {
      errors.home_whatsapp_url =
        "Use a WhatsApp channel link: https://whatsapp.com/channel/… , https://chat.whatsapp.com/… or https://wa.me/…";
    }
    const telegramUrl = draft.home_telegram_url.trim();
    if (telegramUrl && !isValidTelegramLink(telegramUrl)) {
      errors.home_telegram_url = "Use a Telegram channel link: https://t.me/… or https://telegram.me/…";
    }
    const salaryLink = draft.home_team_salary_link.trim();
    if (salaryLink && !/^https?:\/\/.+/.test(salaryLink) && !salaryLink.startsWith("/dashboard")) {
      errors.home_team_salary_link = "Enter a full URL (https://…) or an internal /dashboard link.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = useMutation({
    mutationFn: (settings: Record<string, string>) =>
      apiFetch<{ settings: Record<string, string> }>("/api/admin/home", {
        method: "POST",
        json: { settings },
      }),
    onSuccess: (data) => {
      toast.success("Home page settings saved");
      const parsed = fromServer(data.settings ?? {});
      setDraft(parsed);
      setBaseline(parsed);
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["admin", "home"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="py-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Home Page Widgets</CardTitle>
            <CardDescription>
              The Home header brand block plus every widget below renders live on the member Home screen — no redeploy needed.
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
            save.mutate(toPayload(draft));
          }}
        >
          {/* Home header brand block */}
          <fieldset className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" disabled={save.isPending}>
            <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <PanelTop className="size-4 text-primary" aria-hidden="true" />
              Home Header
            </legend>
            <FieldShell
              id="hs-header-title"
              label="Header Title"
              hint="The bold brand name beside the logo at the top of the Home screen. Empty falls back to “Task Earn Hub”."
              error={fieldErrors.home_header_title}
            >
              <Input
                id="hs-header-title"
                value={draft.home_header_title}
                maxLength={60}
                placeholder="Task Earn Hub"
                onChange={(e) => setField("home_header_title", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="hs-header-tagline"
              label="Header Tagline"
              hint="The small muted line under the title. Empty falls back to “Earn daily, withdraw anytime”."
              error={fieldErrors.home_header_tagline}
            >
              <Input
                id="hs-header-tagline"
                value={draft.home_header_tagline}
                maxLength={120}
                placeholder="Earn daily, withdraw anytime"
                onChange={(e) => setField("home_header_tagline", e.target.value)}
              />
            </FieldShell>
          </fieldset>

          {/* Announcement & lucky draw */}
          <fieldset className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2" disabled={save.isPending}>
            <legend className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Megaphone className="size-4 text-primary" aria-hidden="true" />
              Announcement &amp; Lucky Draw
            </legend>
            <FieldShell
              id="hs-announcement-ur"
              label="Announcement (Urdu)"
              hint="Shown on the dark navy/gold card. Leave empty to hide the card."
              error={fieldErrors.home_announcement_ur}
              span
            >
              <Textarea
                id="hs-announcement-ur"
                dir="rtl"
                rows={4}
                value={draft.home_announcement_ur}
                onChange={(e) => setField("home_announcement_ur", e.target.value)}
                className="font-urdu text-right"
              />
            </FieldShell>
            <FieldShell
              id="hs-announcement-en"
              label="English Summary"
              hint="Small translation line under the Urdu text."
              error={fieldErrors.home_announcement_en}
              span
            >
              <Textarea
                id="hs-announcement-en"
                rows={2}
                value={draft.home_announcement_en}
                onChange={(e) => setField("home_announcement_en", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="hs-lucky-draw"
              label="Lucky Draw Date"
              hint="Displayed as a badge with a live days-left countdown."
              error={fieldErrors.home_lucky_draw_date}
            >
              <div className="relative">
                <CalendarClock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="hs-lucky-draw"
                  type="date"
                  value={draft.home_lucky_draw_date}
                  onChange={(e) => setField("home_lucky_draw_date", e.target.value)}
                  className="pl-9"
                />
              </div>
            </FieldShell>

            {/* Team leader offer */}
            <div className="sm:col-span-2 mt-2 mb-2 flex items-center gap-2 text-sm font-semibold">
              <Crown className="size-4 text-amber-500" aria-hidden="true" />
              Team Leader Offer
            </div>
            <FieldShell
              id="hs-team-target"
              label="Target — New Team Investment (PKR)"
              hint="Progress bar on Home tracks referrals' plan + package purchases against this."
              error={fieldErrors.home_team_leader_target}
            >
              <Input
                id="hs-team-target"
                type="number"
                min={1}
                value={draft.home_team_leader_target}
                onChange={(e) => setField("home_team_leader_target", e.target.value)}
              />
            </FieldShell>
            <div className="space-y-2">
              <Label htmlFor="hs-team-apply">“Apply for the Offer” button</Label>
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  id="hs-team-apply"
                  checked={draft.home_team_leader_apply_enabled}
                  onCheckedChange={(v) => setField("home_team_leader_apply_enabled", v)}
                />
                <div className="text-xs text-muted-foreground">
                  {draft.home_team_leader_apply_enabled
                    ? "Enabled — members see the Apply button once they hit the target."
                    : "Disabled — members see “applications closed”."}
                </div>
              </div>
            </div>

            {/* Team salary banner */}
            <div className="sm:col-span-2 mt-2 mb-2 flex items-center gap-2 text-sm font-semibold">
              <Wallet className="size-4 text-violet-500" aria-hidden="true" />
              Team Salary Banner
            </div>
            <FieldShell
              id="hs-salary-text"
              label="Banner Text"
              hint="The purple gradient banner headline."
              error={fieldErrors.home_team_salary_text}
            >
              <Input
                id="hs-salary-text"
                value={draft.home_team_salary_text}
                placeholder="Team Salary System — Earn up to PKR 13,000 every week"
                onChange={(e) => setField("home_team_salary_text", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="hs-salary-link"
              label="Target Link"
              hint="Where the banner sends members."
              error={fieldErrors.home_team_salary_link}
            >
              <Input
                id="hs-salary-link"
                value={draft.home_team_salary_link}
                placeholder="/dashboard/referrals or https://…"
                onChange={(e) => setField("home_team_salary_link", e.target.value)}
              />
            </FieldShell>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="hs-salary-image-file">Banner Image (optional)</Label>
              <ImageUploadField
                id="hs-salary-image"
                value={draft.home_team_salary_image}
                onChange={(next) => setField("home_team_salary_image", next)}
                maxDim={512}
                allowUrl
                uploadLabel="Upload image"
                urlLabel="Banner image URL (optional)"
                urlPlaceholder="https://example.com/banner.png"
                previewClassName="size-16 rounded-xl"
              />
              <p className="text-xs text-muted-foreground">
                Replaces the trophy icon on the member Home banner. No image set → the default icon
                is shown.
              </p>
            </div>

            {/* Social channels & visit rewards */}
            <div className="sm:col-span-2 mt-2 mb-2 flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="size-4 text-green-600" aria-hidden="true" />
              Social Channels &amp; Visit Rewards
            </div>
            <FieldShell
              id="hs-whatsapp"
              label="WhatsApp Channel Link"
              hint="The “Join Channel” button opens exactly this URL (visit → return → claim reward)."
              error={fieldErrors.home_whatsapp_url}
            >
              <Input
                id="hs-whatsapp"
                type="url"
                value={draft.home_whatsapp_url}
                placeholder="https://whatsapp.com/channel/…"
                onChange={(e) => setField("home_whatsapp_url", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="hs-whatsapp-reward"
              label="WhatsApp Visit Reward (PKR)"
              hint="One-time reward credited when a member returns and claims. Empty or 0 disables the payout."
              error={fieldErrors.home_whatsapp_reward}
            >
              <Input
                id="hs-whatsapp-reward"
                type="number"
                min={0}
                value={draft.home_whatsapp_reward}
                onChange={(e) => setField("home_whatsapp_reward", e.target.value)}
              />
            </FieldShell>
            <div className="space-y-2">
              <Label htmlFor="hs-whatsapp-enabled">WhatsApp reward task</Label>
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  id="hs-whatsapp-enabled"
                  checked={draft.home_whatsapp_enabled}
                  onCheckedChange={(v) => setField("home_whatsapp_enabled", v)}
                />
                <div className="text-xs text-muted-foreground">
                  {draft.home_whatsapp_enabled
                    ? "Enabled — members see the WhatsApp card with the Join → Claim flow."
                    : "Disabled — the WhatsApp card is hidden from the Home screen."}
                </div>
              </div>
            </div>
            <FieldShell
              id="hs-telegram"
              label="Telegram Channel Link"
              hint="The “Join Channel” button opens exactly this URL (visit → return → claim reward)."
              error={fieldErrors.home_telegram_url}
            >
              <Input
                id="hs-telegram"
                type="url"
                value={draft.home_telegram_url}
                placeholder="https://t.me/…"
                onChange={(e) => setField("home_telegram_url", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="hs-telegram-reward"
              label="Telegram Visit Reward (PKR)"
              hint="One-time reward credited when a member returns and claims. Empty or 0 disables the payout."
              error={fieldErrors.home_telegram_reward}
            >
              <Input
                id="hs-telegram-reward"
                type="number"
                min={0}
                value={draft.home_telegram_reward}
                onChange={(e) => setField("home_telegram_reward", e.target.value)}
              />
            </FieldShell>
            <div className="space-y-2">
              <Label htmlFor="hs-telegram-enabled">Telegram reward task</Label>
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  id="hs-telegram-enabled"
                  checked={draft.home_telegram_enabled}
                  onCheckedChange={(v) => setField("home_telegram_enabled", v)}
                />
                <div className="text-xs text-muted-foreground">
                  {draft.home_telegram_enabled
                    ? "Enabled — members see the Telegram card with the Join → Claim flow."
                    : "Disabled — the Telegram card is hidden from the Home screen."}
                </div>
              </div>
            </div>
          </fieldset>

          <div className="flex justify-end gap-2">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(baseline);
                  setFieldErrors({});
                }}
              >
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" disabled={save.isPending || !dirty}>
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Save Home Settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Promo codes CRUD                                                    */
/* ------------------------------------------------------------------ */

interface PromoDialogState {
  open: boolean;
  mode: "create" | "edit";
  target?: AdminPromoCodeDTO;
  session: number;
}

function PromoCodeDialog({
  state,
  onOpenChange,
  onSaved,
}: {
  state: PromoDialogState;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const editing = state.mode === "edit" ? state.target : undefined;
  const [code, setCode] = useState(editing?.code ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [reward, setReward] = useState(editing ? String(editing.rewardAmount) : "");
  const [maxUsesRaw, setMaxUsesRaw] = useState(
    editing ? (editing.maxUses == null ? "" : String(editing.maxUses)) : "",
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () => {
      const maxUses = maxUsesRaw.trim() === "" ? null : Number(maxUsesRaw);
      return apiFetch("/api/admin/home/promo", {
        method: "POST",
        json: {
          action: state.mode,
          id: editing?.id,
          code: code.trim().toUpperCase(),
          title: title.trim(),
          rewardAmount: reward.trim(),
          maxUses,
        },
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Promo code updated" : "Promo code created");
      onSaved();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^[A-Z0-9_-]{3,32}$/.test(code.trim().toUpperCase())) {
      errs.code = "3-32 letters, numbers, dash or underscore.";
    }
    const r = Number(reward);
    if (!Number.isInteger(r) || r < 1) errs.reward = "Reward must be Rs 1 or more.";
    if (maxUsesRaw.trim() !== "") {
      const m = Number(maxUsesRaw);
      if (!Number.isInteger(m) || m < 1) errs.maxUses = "Usage limit must be 1 or more (empty = unlimited).";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    mutation.mutate();
  }

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent key={state.session} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-5 text-primary" aria-hidden="true" />
            {editing ? `Edit ${editing.code}` : "Create Promo Code"}
          </DialogTitle>
          <DialogDescription>
            Members redeem codes on the Home screen — the reward lands in their withdrawable balance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="promo-code">Code</Label>
            <Input
              id="promo-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WELCOME50"
              autoComplete="off"
              spellCheck={false}
              className="font-mono font-semibold tracking-wider uppercase"
              aria-invalid={Boolean(errors.code)}
              disabled={editing?.isSystem}
            />
            {errors.code ? (
              <p className="text-xs text-destructive" role="alert">{errors.code}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="promo-title">Title (internal note)</Label>
            <Input
              id="promo-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Welcome campaign"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="promo-reward">Reward (PKR)</Label>
              <Input
                id="promo-reward"
                type="number"
                min={1}
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                aria-invalid={Boolean(errors.reward)}
              />
              {errors.reward ? (
                <p className="text-xs text-destructive" role="alert">{errors.reward}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo-max">Usage limit</Label>
              <Input
                id="promo-max"
                type="number"
                min={1}
                value={maxUsesRaw}
                onChange={(e) => setMaxUsesRaw(e.target.value)}
                placeholder="Unlimited"
                aria-invalid={Boolean(errors.maxUses)}
              />
              {errors.maxUses ? (
                <p className="text-xs text-destructive" role="alert">{errors.maxUses}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Empty = unlimited members.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" aria-hidden="true" />
              )}
              {editing ? "Save Changes" : "Create Code"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PromoCodesCard({
  codes,
  telegramReward,
  whatsappReward,
}: {
  codes: AdminPromoCodeDTO[];
  telegramReward: number;
  whatsappReward: number;
}) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<PromoDialogState>({ open: false, mode: "create", session: 0 });
  const [deleteTarget, setDeleteTarget] = useState<AdminPromoCodeDTO | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "home"] });
    void queryClient.invalidateQueries({ queryKey: ["home"] });
  };

  const toggle = useMutation({
    mutationFn: (id: string) =>
      apiFetch("/api/admin/home/promo", { method: "POST", json: { action: "toggle", id } }),
    onSuccess: () => {
      toast.success("Promo code updated");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch("/api/admin/home/promo", { method: "POST", json: { action: "delete", id } }),
    onSuccess: () => {
      toast.success("Promo code deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="py-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Promo Codes</CardTitle>
            <CardDescription>
              Reward codes members redeem on the Home screen — one claim per account.
            </CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => setDialog((d) => ({ ...d, open: true, mode: "create", target: undefined, session: d.session + 1 }))}
          >
            <Plus className="size-4" aria-hidden="true" />
            Create Code
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {codes.length === 0 ? (
          <EmptyState
            icon={Gift}
            title="No promo codes yet"
            description="Create a code — members can redeem it from the Home screen promo box."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Reward</TableHead>
                  <TableHead className="text-right">Claims</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c) => {
                  const remaining = c.maxUses == null ? null : Math.max(0, c.maxUses - c.usedCount);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-semibold tracking-wide">{c.code}</TableCell>
                      <TableCell className="max-w-44 truncate text-muted-foreground">
                        {c.isSystem ? (
                          <Badge variant="outline" className="gap-1 border-teal-500/40 text-teal-600 dark:text-teal-400">
                            <Send className="size-3" aria-hidden="true" />
                            {c.code === "TELEGRAM" ? "Telegram reward" : "WhatsApp reward"}
                          </Badge>
                        ) : (
                          c.title || "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-primary">
                        {formatPKR(
                          c.isSystem
                            ? c.code === "TELEGRAM"
                              ? telegramReward
                              : whatsappReward
                            : c.rewardAmount,
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {c.claimsCount}
                        {c.maxUses != null ? ` / ${c.maxUses}` : " / ∞"}
                        {remaining === 0 ? (
                          <Badge variant="secondary" className="ml-2 text-[10px]">Exhausted</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={c.isActive} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {!c.isSystem ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${c.code}`}
                              onClick={() =>
                                setDialog((d) => ({
                                  ...d,
                                  open: true,
                                  mode: "edit",
                                  target: c,
                                  session: d.session + 1,
                                }))
                              }
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                            </Button>
                          ) : null}
                          <Switch
                            checked={c.isActive}
                            onCheckedChange={() => toggle.mutate(c.id)}
                            disabled={toggle.isPending}
                            aria-label={`${c.isActive ? "Disable" : "Enable"} ${c.code}`}
                          />
                          {!c.isSystem ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:bg-destructive/10"
                              aria-label={`Delete ${c.code}`}
                              disabled={remove.isPending}
                              onClick={() => setDeleteTarget(c)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          The system <span className="font-mono font-semibold">TELEGRAM</span> and{" "}
          <span className="font-mono font-semibold">WHATSAPP</span> rows back the Home visit-reward
          cards — their amounts are managed by the “Telegram Visit Reward” (currently{" "}
          {formatPKR(telegramReward)}) and “WhatsApp Visit Reward” (currently{" "}
          {formatPKR(whatsappReward)}) settings above.
        </p>
      </CardContent>

      <PromoCodeDialog
        state={dialog}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={invalidate}
      />

      <AlertDialog open={deleteTarget != null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.claimsCount ?? 0} member claim{deleteTarget?.claimsCount === 1 ? "" : "s"} already
              exist and will be removed with it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Login Welcome Popup                                                */
/* ------------------------------------------------------------------ */

interface WelcomePopupDraft {
  image: string;
  enabled: boolean;
  frequency: WelcomePopupFrequency;
  title: string;
  description: string;
  buttonText: string;
  buttonLink: string;
}

const FREQUENCY_HINTS: Record<WelcomePopupFrequency, string> = {
  every_login: "Shows right after every login or signup.",
  once_per_session: "Shows once per browser session — never again after the member closes it.",
  once_per_day: "Shows on the first Home visit of each day.",
};

function popupFromServer(raw: Record<string, string>): WelcomePopupDraft {
  const freq = raw.home_welcome_popup_frequency ?? "";
  const frequency = (WELCOME_POPUP_FREQUENCIES as readonly string[]).includes(freq)
    ? (freq as WelcomePopupFrequency)
    : "once_per_session";
  return {
    image: raw.home_welcome_popup_image ?? "",
    enabled: raw.home_welcome_popup_enabled === "true",
    frequency,
    title: raw.home_welcome_popup_title ?? "",
    description: raw.home_welcome_popup_description ?? "",
    buttonText: raw.home_welcome_popup_button_text ?? "",
    buttonLink: raw.home_welcome_popup_button_link ?? "",
  };
}

function popupToPayload(d: WelcomePopupDraft): Record<string, string> {
  return {
    home_welcome_popup_enabled: d.enabled ? "true" : "false",
    home_welcome_popup_image: d.image.trim(),
    home_welcome_popup_frequency: d.frequency,
    home_welcome_popup_title: d.title.trim().slice(0, 120),
    home_welcome_popup_description: d.description.trim().slice(0, 600),
    home_welcome_popup_button_text: d.buttonText.trim().slice(0, 60),
    home_welcome_popup_button_link: d.buttonLink.trim(),
  };
}

function popupEquals(a: WelcomePopupDraft, b: WelcomePopupDraft): boolean {
  return JSON.stringify(popupToPayload(a)) === JSON.stringify(popupToPayload(b));
}

function WelcomePopupCard({ initial }: { initial: WelcomePopupDraft }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WelcomePopupDraft>(initial);
  const [baseline, setBaseline] = useState<WelcomePopupDraft>(initial);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof WelcomePopupDraft, string>>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const dirty = useMemo(() => !popupEquals(draft, baseline), [draft, baseline]);
  const hasImage = Boolean(draft.image.trim());

  const setField = (key: keyof WelcomePopupDraft, value: string | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const errors: Partial<Record<keyof WelcomePopupDraft, string>> = {};
    const link = draft.buttonLink.trim();
    if (link && !/^https?:\/\/.+/i.test(link) && !(link.startsWith("/") && !link.startsWith("//"))) {
      errors.buttonLink = "Enter an internal /dashboard… route or a full https:// URL.";
    }
    if (draft.title.trim().length > 120) errors.title = "Keep the title at 120 characters or fewer.";
    if (draft.description.trim().length > 600) {
      errors.description = "Keep the description at 600 characters or fewer.";
    }
    if (draft.buttonText.trim().length > 60) errors.buttonText = "Keep the button text at 60 characters or fewer.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ settings: Record<string, string> }>("/api/admin/home", {
        method: "POST",
        json: { settings: popupToPayload(draft) },
      }),
    onSuccess: (data) => {
      toast.success("Login welcome popup saved");
      const parsed = popupFromServer(data.settings ?? {});
      setDraft(parsed);
      setBaseline(parsed);
      setFieldErrors({});
      void queryClient.invalidateQueries({ queryKey: ["admin", "home"] });
      void queryClient.invalidateQueries({ queryKey: ["welcome-popup"] });
      void queryClient.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="py-0">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ImagePlay className="size-4 text-primary" aria-hidden="true" />
              Login Welcome Popup
            </CardTitle>
            <CardDescription>
              Promotional image popup members see automatically right after login on the Home screen.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {hasImage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="size-3.5" aria-hidden="true" />
                Preview popup
              </Button>
            ) : null}
            <ActiveBadge active={baseline.enabled && Boolean(baseline.image.trim())} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validate()) {
              toast.error("Please fix the highlighted popup fields.");
              return;
            }
            save.mutate();
          }}
        >
          {/* Image upload / replace / remove */}
          <div className="space-y-2">
            <Label htmlFor="wp-image-file">Popup image</Label>
            <ImageUploadField
              id="wp-image"
              value={draft.image}
              onChange={(next) => setField("image", next)}
              disabled={save.isPending}
              convert={popupImageToDataUrl}
              allowUrl
              urlLabel="Popup image URL (optional)"
              urlPlaceholder="https://example.com/promo.jpg"
              previewClassName="h-24 w-36 rounded-xl"
              uploadLabel="Upload popup image"
            />
            <p className="text-xs text-muted-foreground">
              Portrait or landscape both work — members always see the whole image, never cropped.
              Uploads are optimized automatically (JPG, PNG or WEBP, up to 5 MB).
            </p>
          </div>

          {/* Enable + frequency */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wp-enabled">Show popup to members</Label>
              <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Switch
                  id="wp-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(v) => setField("enabled", v)}
                  disabled={save.isPending}
                />
                <div className="text-xs text-muted-foreground">
                  {draft.enabled
                    ? hasImage
                      ? "Enabled — shows right after login on the Home screen."
                      : "On, but no image yet — members see nothing until an image is uploaded."
                    : "Disabled — hidden from members."}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wp-frequency">Display frequency</Label>
              <Select
                value={draft.frequency}
                onValueChange={(v) => setField("frequency", v as WelcomePopupFrequency)}
                disabled={save.isPending}
              >
                <SelectTrigger id="wp-frequency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="every_login">Every login</SelectItem>
                  <SelectItem value="once_per_session">Once per session</SelectItem>
                  <SelectItem value="once_per_day">Once per day</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{FREQUENCY_HINTS[draft.frequency]}</p>
            </div>
          </div>

          {/* Optional title / description / button */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            <FieldShell
              id="wp-title"
              label="Title (optional)"
              hint="Bold headline shown under the image."
              error={fieldErrors.title}
            >
              <Input
                id="wp-title"
                value={draft.title}
                maxLength={120}
                placeholder="Welcome offer!"
                onChange={(e) => setField("title", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="wp-button-text"
              label="Button text (optional)"
              hint="Full-width button under the popup. Empty = no button."
              error={fieldErrors.buttonText}
            >
              <Input
                id="wp-button-text"
                value={draft.buttonText}
                maxLength={60}
                placeholder="Claim Now"
                onChange={(e) => setField("buttonText", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="wp-button-link"
              label="Button link / action (optional)"
              hint="Internal /dashboard… route or full https:// URL. Empty = button simply closes the popup."
              error={fieldErrors.buttonLink}
            >
              <Input
                id="wp-button-link"
                value={draft.buttonLink}
                placeholder="/dashboard/packages or https://…"
                onChange={(e) => setField("buttonLink", e.target.value)}
              />
            </FieldShell>
            <FieldShell
              id="wp-description"
              label="Description (optional)"
              hint="Short supporting text under the title."
              error={fieldErrors.description}
            >
              <Textarea
                id="wp-description"
                rows={3}
                maxLength={600}
                value={draft.description}
                placeholder="A few words about this announcement…"
                onChange={(e) => setField("description", e.target.value)}
              />
            </FieldShell>
          </div>

          <div className="flex justify-end gap-2">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending}
                onClick={() => {
                  setDraft(baseline);
                  setFieldErrors({});
                }}
              >
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" disabled={save.isPending || !dirty}>
              {save.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              Save Popup Settings
            </Button>
          </div>
        </form>
      </CardContent>

      {/* Live preview — exactly what members see after login */}
      {hasImage ? (
        <WelcomePopupDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          popup={{
            imageUrl: draft.image.trim(),
            title: draft.title,
            description: draft.description,
            buttonText: draft.buttonText,
            buttonLink: draft.buttonLink,
          }}
          preview
        />
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export function HomeSettingsView() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "home"],
    queryFn: () => apiFetch<AdminHomeResponseDTO>("/api/admin/home"),
    refetchInterval: 15_000,
  });

  if (isError) {
    return (
      <SectionError
        message={error instanceof Error ? error.message : "Unknown error."}
        onRetry={() => void refetch()}
        title="Could not load home settings"
      />
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <TableSkeleton rows={4} columns={6} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Scoped keys: saving one card must never remount (and wipe) unsaved
          edits in the other card — each form only tracks ITS OWN settings. */}
      <HomeSettingsForm
        key={contentKey(toPayload(fromServer(data.settings)))}
        initial={fromServer(data.settings)}
      />
      <WelcomePopupCard
        key={`popup-${contentKey(popupToPayload(popupFromServer(data.settings)))}`}
        initial={popupFromServer(data.settings)}
      />
      <PromoCodesCard
        codes={data.promoCodes}
        telegramReward={data.telegramReward}
        whatsappReward={data.whatsappReward}
      />
    </div>
  );
}
