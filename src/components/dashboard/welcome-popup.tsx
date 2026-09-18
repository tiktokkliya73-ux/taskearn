"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { cn } from "@/lib/utils";
import { markWelcomePopupShown, shouldShowWelcomePopup } from "@/lib/welcome-popup";
import type { WelcomePopupDTO } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Presentational popup (member Home screen + admin preview)           */
/* ------------------------------------------------------------------ */

export interface WelcomePopupContent {
  imageUrl: string;
  title: string;
  description: string;
  buttonText: string;
  buttonLink: string;
}

/**
 * The Login Welcome Popup itself — one admin-uploaded promotional image in a
 * centered rounded card over a dimmed backdrop, exactly like the reference:
 * the artwork dominates, an optional title / description / CTA sit beneath
 * it and a clear Close/X floats over the image's top-right corner.
 *
 * Responsive by construction: the card is capped at min(94vw, 28rem) and the
 * image keeps its natural aspect ratio (object-contain, max 64dvh) so it is
 * NEVER cropped on Android, iPhone, tablet or desktop.
 */
export function WelcomePopupDialog({
  open,
  onOpenChange,
  popup,
  preview = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  popup: WelcomePopupContent;
  /** Admin preview mode: the CTA never navigates — it explains itself. */
  preview?: boolean;
}) {
  const title = popup.title.trim();
  const description = popup.description.trim();
  const buttonText = popup.buttonText.trim();
  const link = popup.buttonLink.trim();
  const hasFooter = Boolean(title || description || buttonText);

  function handleCta() {
    onOpenChange(false);
    if (preview) {
      toast.info(
        link
          ? "Preview — members will follow the configured link from this button."
          : "Preview — this is exactly how members see the popup.",
      );
      return;
    }
    if (!link) return;
    if (/^https?:\/\//i.test(link)) {
      window.open(link, "_blank", "noopener,noreferrer");
    } else if (link.startsWith("/") && !link.startsWith("//")) {
      navigateTo(link);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "left-1/2 top-1/2 z-50 w-full translate-x-[-50%] translate-y-[-50%] gap-0 rounded-none border-none bg-transparent p-0 shadow-none",
          "max-w-[calc(100%-1.5rem)] sm:max-w-[min(94vw,28rem)]",
        )}
      >
        <div className="relative mx-auto flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-2xl bg-card shadow-2xl ring-1 ring-black/10 dark:ring-white/10">
          {/* Promotional image — object-contain: fits every screen, never cropped */}
          <div className="flex min-h-0 items-center justify-center overflow-hidden bg-muted/50">
            <img
              src={popup.imageUrl}
              alt={title || "Welcome offer"}
              className="max-h-[64dvh] w-auto max-w-full select-none object-contain"
              draggable={false}
            />
          </div>

          {/* Optional texts + CTA */}
          {hasFooter ? (
            <div className="flex flex-col items-center gap-3 border-t px-5 py-4 text-center sm:px-6 sm:py-5">
              {title ? (
                <p className="text-lg font-bold leading-tight tracking-tight">{title}</p>
              ) : null}
              {description ? (
                <p className="max-w-[26rem] text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
                  {description}
                </p>
              ) : null}
              {buttonText ? (
                <Button
                  type="button"
                  className="h-11 w-full rounded-xl text-sm font-semibold sm:text-base"
                  onClick={handleCta}
                >
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                  {buttonText}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Clear Close/X — always visible over any artwork (44px touch target) */}
          <DialogClose
            className="absolute top-3 right-3 z-10 flex size-11 items-center justify-center rounded-full bg-black/60 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label="Close welcome popup"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
        </div>

        {/* Screen-reader labels (visual counterparts render above when set) */}
        <DialogTitle className="sr-only">{title || "Welcome offer"}</DialogTitle>
        <DialogDescription className="sr-only">
          {description || "A promotional message from the platform."}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Auto-open wrapper (member Home screen)                              */
/* ------------------------------------------------------------------ */

/** Small delay so the Home content settles before the popup zooms in. */
const SHOW_DELAY_MS = 400;

/**
 * Mounted on the member Home screen. Fetches the admin-configured popup and
 * auto-opens it right after login — strictly respecting the display
 * frequency — then never interferes with the page behind it. Renders nothing
 * at all when the popup is disabled or has no image.
 */
export function WelcomePopup() {
  const [open, setOpen] = useState(false);
  const decidedRef = useRef(false);

  const { data } = useQuery({
    queryKey: ["welcome-popup"],
    queryFn: () => apiFetch<WelcomePopupDTO>("/api/home/welcome-popup"),
    staleTime: 30_000,
    retry: 1,
  });

  useEffect(() => {
    if (decidedRef.current || !data?.enabled || !data.imageUrl) return;
    decidedRef.current = true;
    if (!shouldShowWelcomePopup(data.frequency)) return;
    const timer = setTimeout(() => {
      markWelcomePopupShown(data.frequency);
      setOpen(true);
    }, SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [data]);

  if (!data?.enabled || !data.imageUrl) return null;

  return (
    <WelcomePopupDialog
      open={open}
      onOpenChange={setOpen}
      popup={{
        imageUrl: data.imageUrl,
        title: data.title,
        description: data.description,
        buttonText: data.buttonText,
        buttonLink: data.buttonLink,
      }}
    />
  );
}
