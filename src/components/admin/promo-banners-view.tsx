"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  Images,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { ActiveBadge, CardSkeleton, EmptyState, SectionError } from "@/components/admin/shared";
import { PromoBannerOverlayDialog } from "@/components/dashboard/promo-banner-overlay";
import { apiFetch } from "@/lib/client-api";
import { popupImageToDataUrl } from "@/lib/welcome-popup";
import { cn } from "@/lib/utils";
import type {
  AdminPromoBannerDTO,
  AdminPromoBannersResponseDTO,
  PromoBannerAction,
  PromoBannerDTO,
  PromoBannerInput,
} from "@/lib/types";

/* ================================================================== */
/* Admin Promotional Banners — management for the member-side premium   */
/* overlay carousel.                                                   */
/*                                                                    */
/* One banner list (add any number), each with an image, optional      */
/* title / CTA button, enable state and display order. Only ACTIVE    */
/* banners ever reach members; disabling or deleting one removes it   */
/* from the member side immediately.                                  */
/* ================================================================== */

interface BannerDraft {
  image: string;
  title: string;
  ctaText: string;
  ctaLink: string;
  isActive: boolean;
}

const EMPTY_DRAFT: BannerDraft = {
  image: "",
  title: "",
  ctaText: "",
  ctaLink: "",
  isActive: true,
};

function draftFromBanner(b: AdminPromoBannerDTO): BannerDraft {
  return {
    image: b.image,
    title: b.title,
    ctaText: b.ctaText,
    ctaLink: b.ctaLink,
    isActive: b.isActive,
  };
}

/* ------------------------------ edit dialog ------------------------------ */

function BannerDialog({
  open,
  onOpenChange,
  editing,
  submitting,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The banner being edited, or null when creating a new one. */
  editing: AdminPromoBannerDTO | null;
  submitting: boolean;
  onSave: (banner: PromoBannerInput) => void;
}) {
  const [draft, setDraft] = useState<BannerDraft>(EMPTY_DRAFT);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sync the draft whenever a DIFFERENT banner is opened for editing (or a
  // fresh create starts) — never while the admin is typing.
  const syncKey = open ? (editing?.id ?? "new") : null;
  if (syncKey !== loadedFor) {
    setLoadedFor(syncKey);
    setDraft(editing ? draftFromBanner(editing) : EMPTY_DRAFT);
    setError(null);
  }

  const hasImage = Boolean(draft.image.trim());

  function submit() {
    const image = draft.image.trim();
    const link = draft.ctaLink.trim();
    if (!image) {
      setError("Upload a banner image first (or paste an image URL).");
      return;
    }
    if (link && !/^https?:\/\//i.test(link) && !(link.startsWith("/") && !link.startsWith("//"))) {
      setError("Button link must be an internal /dashboard… route or a full https:// URL.");
      return;
    }
    setError(null);
    onSave({
      image,
      title: draft.title.trim(),
      ctaText: draft.ctaText.trim(),
      ctaLink: link,
      isActive: draft.isActive,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit banner" : "Add promotional banner"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update the artwork, texts or enable state — members see the change immediately."
              : "Upload the promotional artwork members will see in the premium overlay carousel."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="pb-image-file">Banner image</Label>
            <ImageUploadField
              id="pb-image"
              value={draft.image}
              onChange={(next) => setDraft((d) => ({ ...d, image: next }))}
              disabled={submitting}
              convert={popupImageToDataUrl}
              allowUrl
              urlLabel="Banner image URL (optional)"
              urlPlaceholder="https://example.com/promo.jpg"
              previewClassName="h-24 w-36 rounded-xl"
              uploadLabel="Upload banner image"
            />
            <p className="text-xs text-muted-foreground">
              Portrait or landscape both work — members always see the whole image, never cropped.
              Uploads are optimized automatically (JPG, PNG or WEBP).
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pb-title">Title (optional)</Label>
              <Input
                id="pb-title"
                value={draft.title}
                maxLength={120}
                placeholder="Eid Mega Bonus!"
                disabled={submitting}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-cta-text">Button text (optional)</Label>
              <Input
                id="pb-cta-text"
                value={draft.ctaText}
                maxLength={60}
                placeholder="Invest Now"
                disabled={submitting}
                onChange={(e) => setDraft((d) => ({ ...d, ctaText: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pb-cta-link">Button link / action (optional)</Label>
            <Input
              id="pb-cta-link"
              value={draft.ctaLink}
              placeholder="/dashboard/packages or https://…"
              disabled={submitting}
              onChange={(e) => setDraft((d) => ({ ...d, ctaLink: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Internal /dashboard… route or full https:// URL. Empty = the button is hidden (image-only banner).
            </p>
          </div>

          <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
            <Switch
              id="pb-active"
              checked={draft.isActive}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, isActive: v }))}
              disabled={submitting}
            />
            <div className="text-xs text-muted-foreground">
              {draft.isActive
                ? "Active — visible to members in the promotional overlay."
                : "Inactive — hidden from members until you enable it."}
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className="gap-1.5" disabled={submitting || !hasImage} onClick={submit}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {editing ? "Save banner" : "Add banner"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- view ---------------------------------- */

export function PromoBannersView() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPromoBannerDTO | null>(null);
  const [deleting, setDeleting] = useState<AdminPromoBannerDTO | null>(null);
  const [previewBanner, setPreviewBanner] = useState<AdminPromoBannerDTO | null>(null);

  const bannersQuery = useQuery({
    queryKey: ["admin", "promo-banners"],
    queryFn: () => apiFetch<AdminPromoBannersResponseDTO>("/api/admin/promo-banners"),
    refetchInterval: 15_000,
  });

  const act = useMutation({
    mutationFn: (payload: PromoBannerAction) =>
      apiFetch<AdminPromoBannersResponseDTO>("/api/admin/promo-banners", { method: "POST", json: payload }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "promo-banners"] });
      void queryClient.invalidateQueries({ queryKey: ["promo-banners"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const banners = useMemo(() => bannersQuery.data?.banners ?? [], [bannersQuery.data]);
  const activeCount = banners.filter((b) => b.isActive).length;

  function runAction(payload: PromoBannerAction, successMessage?: string) {
    act.mutate(payload, {
      onSuccess: () => {
        if (successMessage) toast.success(successMessage);
      },
    });
  }

  function saveBanner(banner: PromoBannerInput) {
    if (editing) {
      runAction({ action: "update", id: editing.id, banner }, "Banner saved");
    } else {
      runAction({ action: "create", banner }, "Banner added");
    }
    setDialogOpen(false);
  }

  function moveBanner(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= banners.length) return;
    const ids = banners.map((b) => b.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    runAction({ action: "reorder", ids });
  }

  const previewDto: PromoBannerDTO[] | null = previewBanner
    ? [
        {
          id: previewBanner.id,
          imageUrl: previewBanner.image,
          title: previewBanner.title,
          ctaText: previewBanner.ctaText,
          ctaLink: previewBanner.ctaLink,
        },
      ]
    : null;

  return (
    <div className="space-y-6">
      <Card className="py-0">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Images className="size-4 text-primary" aria-hidden="true" />
                Promotional banners
                <Badge variant="secondary" className="tabular-nums">
                  {activeCount} active / {banners.length} total
                </Badge>
              </CardTitle>
              <CardDescription>
                Premium promotional images members see in the overlay carousel — add any number of
                banners; only active ones are shown.
              </CardDescription>
            </div>
            <Button
              type="button"
              className="gap-1.5"
              disabled={act.isPending}
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add Banner
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {bannersQuery.isPending ? (
            <div className="space-y-3">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : bannersQuery.isError ? (
            <SectionError
              title="Could not load promotional banners"
              message={bannersQuery.error.message}
              onRetry={() => void bannersQuery.refetch()}
            />
          ) : banners.length === 0 ? (
            <EmptyState
              icon={Images}
              title="No promotional banners yet"
              description="Add your first banner — members will see it as a premium promotional card after login."
            />
          ) : (
            <ul className="divide-y rounded-xl border">
              {banners.map((banner, i) => (
                <li
                  key={banner.id}
                  className="flex flex-col gap-3 p-3 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4"
                >
                  {/* Image preview */}
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <img
                      src={banner.image}
                      alt={banner.title || "Banner preview"}
                      className="h-16 w-24 shrink-0 rounded-lg border object-contain p-1"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {banner.title || "Untitled banner"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {banner.ctaText ? `CTA: ${banner.ctaText}` : "No CTA button"}
                        {banner.ctaLink ? ` → ${banner.ctaLink}` : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Position {banner.sortOrder} · added {new Date(banner.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {/* Status + controls */}
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <ActiveBadge active={banner.isActive} />
                    <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5">
                      <Switch
                        id={`pb-toggle-${banner.id}`}
                        aria-label={banner.isActive ? "Disable banner" : "Enable banner"}
                        checked={banner.isActive}
                        disabled={act.isPending}
                        onCheckedChange={(v) =>
                          runAction(
                            { action: "update", id: banner.id, banner: { isActive: v } },
                            v ? "Banner enabled — visible to members" : "Banner disabled — hidden from members",
                          )
                        }
                      />
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {banner.isActive ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        aria-label="Move banner up"
                        disabled={act.isPending || i === 0}
                        onClick={() => moveBanner(i, -1)}
                      >
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        aria-label="Move banner down"
                        disabled={act.isPending || i === banners.length - 1}
                        onClick={() => moveBanner(i, 1)}
                      >
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5"
                        disabled={act.isPending}
                        onClick={() => setPreviewBanner(banner)}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                        Preview
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5"
                        disabled={act.isPending}
                        onClick={() => {
                          setEditing(banner);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-9 gap-1.5 px-2",
                          "text-destructive hover:bg-destructive/10 hover:text-destructive",
                        )}
                        disabled={act.isPending}
                        onClick={() => setDeleting(banner)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {banners.length > 0 ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <RotateCw
                className={cn("size-3.5", bannersQuery.isFetching && "animate-spin")}
                aria-hidden="true"
              />
              {activeCount > 0
                ? `${activeCount} banner${activeCount === 1 ? "" : "s"} currently shown to members in the promotional overlay.`
                : "All banners are disabled — members see no promotional overlay."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <BannerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        submitting={act.isPending}
        onSave={saveBanner}
      />

      {/* Delete confirmation */}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this banner?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.title || "This banner"} will be removed from the promotional overlay
              immediately — members will stop seeing it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={act.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={act.isPending}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (deleting) runAction({ action: "delete", id: deleting.id }, "Banner deleted");
                setDeleting(null);
              }}
            >
              {act.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Delete banner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Live preview — exactly the premium overlay members see */}
      {previewDto ? (
        <PromoBannerOverlayDialog
          open={Boolean(previewBanner)}
          onOpenChange={(v) => !v && setPreviewBanner(null)}
          banners={previewDto}
          preview
        />
      ) : null}
    </div>
  );
}
