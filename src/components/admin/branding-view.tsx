"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Coins,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  Palette,
  Save,
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { EmptyState, SectionError, TableSkeleton } from "@/components/admin/shared";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { MethodVisual } from "@/components/dashboard/payment-methods";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { PaymentMethodDTO } from "@/lib/types";

/* ================================================================== */
/* Admin → Branding                                                    */
/*                                                                    */
/* One place for the site's visual identity:                           */
/*  1. Website logo + favicon (stored in system_settings, rendered     */
/*     through the centralized <BrandLogo /> everywhere).              */
/*  2. Payment method images (payment_methods.logoUrl) incl. the       */
/*     Wallet Balance card image — shown live on every member          */
/*     checkout and the wallet deposit form.                           */
/* Every image is admin-uploaded (or removed) here — nothing is        */
/* hardcoded, and fallback icons render whenever no image is set.      */
/* ================================================================== */

interface MethodsPayload {
  methods: PaymentMethodDTO[];
}

/* ------------------------- website branding ------------------------- */

/** Form state lives in a child keyed by the saved content — it remounts
 *  (re-syncing the draft) only when the server content truly changes. */
function BrandingForm({ initial }: { initial: { logo: string; favicon: string } }) {
  const queryClient = useQueryClient();
  const [logoDraft, setLogoDraft] = useState<string>(initial.logo);
  const [faviconDraft, setFaviconDraft] = useState<string>(initial.favicon);

  const dirty =
    logoDraft.trim() !== initial.logo.trim() || faviconDraft.trim() !== initial.favicon.trim();

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ settings: Record<string, string> }>("/api/admin/settings", {
        method: "POST",
        json: {
          settings: {
            site_logo_url: logoDraft.trim(),
            site_favicon_url: faviconDraft.trim(),
          },
        },
      }),
    onSuccess: () => {
      toast.success("Branding saved — the logo is live everywhere.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      void queryClient.invalidateQueries({ queryKey: ["public", "branding"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <div className="space-y-2">
        <Label>Website logo</Label>
        <ImageUploadField
          id="brand-logo"
          value={logoDraft}
          onChange={setLogoDraft}
          disabled={save.isPending}
          maxDim={512}
          uploadLabel="Upload logo"
          previewClassName="size-16 rounded-xl"
        />
        <p className="text-xs text-muted-foreground">
          Square, landscape or portrait — it always fits without distortion.
        </p>
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>Browser tab icon (favicon)</Label>
        <ImageUploadField
          id="brand-favicon"
          value={faviconDraft}
          onChange={setFaviconDraft}
          disabled={save.isPending}
          maxDim={128}
          uploadLabel="Upload favicon"
          previewClassName="size-10 rounded-lg"
        />
        <p className="text-xs text-muted-foreground">
          Optional — shown as the browser tab / home-screen icon. Falls back to the default.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          className="gap-1.5"
          disabled={save.isPending || !dirty}
          onClick={() => save.mutate()}
        >
          {save.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          Save Changes
        </Button>
      </div>
    </>
  );
}

function WebsiteBrandingCard() {
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiFetch<{ settings: Record<string, string> }>("/api/admin/settings"),
  });

  const raw = settingsQuery.data?.settings;
  const contentKey = raw
    ? JSON.stringify([raw.site_logo_url ?? "", raw.site_favicon_url ?? ""])
    : "loading";

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Palette className="size-4 text-primary" aria-hidden="true" />
          Branding Settings
        </CardTitle>
        <CardDescription>
          The website logo appears in the landing header &amp; footer, the login/register pages, the
          member sidebar + mobile topbar and the admin sidebar. Empty fields keep the built-in
          default mark.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {settingsQuery.isError ? (
          <SectionError
            title="Could not load branding settings"
            message={settingsQuery.error.message}
            onRetry={() => void settingsQuery.refetch()}
          />
        ) : settingsQuery.isPending ? (
          <div className="space-y-3">
            <div className="h-20 w-full animate-pulse rounded-xl bg-muted" />
            <div className="h-20 w-full animate-pulse rounded-xl bg-muted" />
          </div>
        ) : (
          <BrandingForm
            key={contentKey}
            initial={{
              logo: settingsQuery.data?.settings.site_logo_url ?? "",
              favicon: settingsQuery.data?.settings.site_favicon_url ?? "",
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------- payment method images ----------------------- */

/** One payment-method row with its own upload / preview / save cycle. */
function MethodImageRow({
  name,
  accountNumber,
  logoUrl,
  disabled,
  onSave,
  saving,
}: {
  name: string;
  accountNumber: string;
  logoUrl: string | null;
  disabled?: boolean;
  onSave: (logoUrl: string) => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<string>(logoUrl ?? "");
  const dirty = draft.trim() !== (logoUrl ?? "").trim();

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background text-primary">
          {draft.trim() ? (
            <img src={draft.trim()} alt="" aria-hidden="true" className="size-full object-contain p-1" />
          ) : (
            <MethodVisual
              method={{ id: "", name, accountNumber, accountTitle: null, instructions: null, logoUrl: null, sortOrder: 0, isActive: true }}
              className="size-5 shrink-0"
            />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={accountNumber}>
            {accountNumber}
          </p>
        </div>
      </div>
      <div className="sm:w-[320px]">
        <ImageUploadField
          id={`method-image-${name.replace(/\s+/g, "-").toLowerCase()}`}
          value={draft}
          onChange={setDraft}
          disabled={disabled || saving}
          maxDim={256}
          compact
          previewClassName="size-12 rounded-lg"
        />
      </div>
      <Button
        type="button"
        size="sm"
        className="h-8 gap-1.5 sm:shrink-0"
        disabled={disabled || saving || !dirty}
        onClick={() => onSave(draft.trim())}
      >
        {saving ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-3.5" aria-hidden="true" />
        )}
        Save image
      </Button>
    </div>
  );
}

/** The Wallet Balance card row (branding setting, not a payment_methods row). */
function WalletImageForm({ initial }: { initial: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>(initial);
  const dirty = draft.trim() !== initial.trim();

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ settings: Record<string, string> }>("/api/admin/settings", {
        method: "POST",
        json: { settings: { wallet_method_image_url: draft.trim() } },
      }),
    onSuccess: () => {
      toast.success("Wallet Balance image saved.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] });
      void queryClient.invalidateQueries({ queryKey: ["public", "payment-methods"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background text-emerald-600 dark:text-emerald-400">
          {draft.trim() ? (
            <img src={draft.trim()} alt="" aria-hidden="true" className="size-full object-contain p-1" />
          ) : (
            <Wallet className="size-5 shrink-0" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">Wallet Balance</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Instant checkout with available balance
          </p>
        </div>
      </div>
      <div className="sm:w-[320px]">
        <ImageUploadField
          id="wallet-method-image"
          value={draft}
          onChange={setDraft}
          disabled={save.isPending}
          maxDim={256}
          compact
          previewClassName="size-12 rounded-lg"
        />
      </div>
      <Button
        type="button"
        size="sm"
        className="h-8 gap-1.5 sm:shrink-0"
        disabled={save.isPending || !dirty}
        onClick={() => save.mutate()}
      >
        {save.isPending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-3.5" aria-hidden="true" />
        )}
        Save image
      </Button>
    </div>
  );
}

function WalletImageRow() {
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiFetch<{ settings: Record<string, string> }>("/api/admin/settings"),
  });

  if (settingsQuery.isError || settingsQuery.isPending) {
    return (
      <div className="h-20 w-full animate-pulse rounded-xl bg-muted/40" aria-hidden="true" />
    );
  }

  const saved = settingsQuery.data.settings.wallet_method_image_url ?? "";
  return <WalletImageForm key={saved} initial={saved} />;
}

function PaymentMethodImagesCard() {
  const queryClient = useQueryClient();
  const methodsQuery = useQuery({
    queryKey: ["admin", "payment-methods"],
    queryFn: () => apiFetch<MethodsPayload>("/api/admin/payment-methods"),
  });

  const saveMethod = useMutation({
    mutationFn: (vars: { id: string; logoUrl: string }) =>
      apiFetch<MethodsPayload>("/api/admin/payment-methods", {
        method: "POST",
        json: { action: "update", id: vars.id, logoUrl: vars.logoUrl },
      }),
    onSuccess: () => {
      toast.success("Payment method image saved.");
      void queryClient.invalidateQueries({ queryKey: ["admin", "payment-methods"] });
      void queryClient.invalidateQueries({ queryKey: ["public", "payment-methods"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const methods = useMemo(
    () =>
      [...(methodsQuery.data?.methods ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [methodsQuery.data],
  );

  return (
    <Card className="overflow-hidden py-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4 text-primary" aria-hidden="true" />
          Payment Method Images
        </CardTitle>
        <CardDescription>
          Custom images shown on every member checkout and the wallet deposit form. Upload, replace
          or remove — members see the change within a minute. No image set → the default icon is
          shown.
        </CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary" className="tabular-nums">
            {methods.length} methods
          </Badge>
          <Badge className="gap-1.5">
            <ImageIcon className="size-3" aria-hidden="true" />
            + Wallet Balance
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {methodsQuery.isError ? (
          <SectionError
            title="Could not load payment methods"
            message={methodsQuery.error.message}
            onRetry={() => void methodsQuery.refetch()}
          />
        ) : methodsQuery.isPending ? (
          <TableSkeleton rows={3} columns={1} />
        ) : methods.length === 0 ? (
          <EmptyState
            icon={Coins}
            title="No payment methods yet"
            description="Add payment methods on the Payment Methods page first."
          />
        ) : (
          methods.map((m) => (
            <MethodImageRow
              key={`${m.id}:${m.logoUrl ?? ""}`}
              name={m.name}
              accountNumber={m.accountNumber}
              logoUrl={m.logoUrl}
              saving={saveMethod.isPending && saveMethod.variables?.id === m.id}
              disabled={saveMethod.isPending}
              onSave={(logoUrl) => saveMethod.mutate({ id: m.id, logoUrl })}
            />
          ))
        )}

        <WalletImageRow />
      </CardContent>
    </Card>
  );
}

/* --------------------------------- view ----------------------------------- */

export function BrandingView() {
  return (
    <div className="space-y-6">
      <WebsiteBrandingCard />
      <PaymentMethodImagesCard />
      <p className={cn("text-xs text-muted-foreground")}>
        Images are validated (JPG, PNG or WEBP), optimized client-side and re-checked on the server.
        Removing an image instantly restores the built-in default.
      </p>
    </div>
  );
}
