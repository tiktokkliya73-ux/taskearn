"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { BrandingResponseDTO } from "@/lib/types";

/* ================================================================== */
/* Centralized branding — ONE configuration rendered everywhere        */
/*                                                                    */
/* The admin uploads the website logo / favicon once at               */
/* /admin/branding (stored in system_settings); every location that   */
/* shows the brand — landing header + footer, auth pages, member      */
/* sidebar + mobile topbar, admin sidebar — renders it through        */
/* <BrandLogo /> so there is never a duplicated hard-coded logo.      */
/* ================================================================== */

/** Shared branding query (cached 60s — same freshness as payment methods). */
export function useBranding() {
  const query = useQuery({
    queryKey: ["public", "branding"],
    queryFn: () => apiFetch<BrandingResponseDTO>("/api/public/branding"),
    staleTime: 60_000,
  });
  return {
    siteTitle: query.data?.siteTitle ?? "TaskEarn",
    logoUrl: query.data?.logoUrl ?? null,
    faviconUrl: query.data?.faviconUrl ?? null,
    isLoading: query.isLoading,
  };
}

/* ------------------------- dynamic favicon ------------------------- */

let appliedFavicon: string | null = null;

function applyFavicon(url: string | null) {
  if (typeof document === "undefined") return;
  if (appliedFavicon === url) return;
  appliedFavicon = url;

  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  if (url) {
    link.href = url;
    link.type = url.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  } else {
    // Reset to the app default shipped in /public.
    link.href = "/logo.svg";
    link.type = "image/svg+xml";
  }
}

/** Apply the admin's custom favicon to the browser tab (call once per shell). */
export function useFavicon(url: string | null) {
  useEffect(() => {
    applyFavicon(url);
  }, [url]);
}

/* ---------------------------- brand logo --------------------------- */

/**
 * The website brand mark: the admin-uploaded logo when configured, otherwise
 * the built-in default mark. Renders inside a rounded container with
 * object-contain — square, landscape and portrait logos all fit cleanly,
 * and a broken image URL falls back to the default mark automatically.
 *
 * `boxClassName` sizes the container (defaults match the old icon tiles);
 * the text beside the mark stays at each call site as before.
 *
 * `premium` adds the animated brand effect used ONLY on the member Home
 * header: a soft green glow, a slowly rotating green arc ring and a gentle
 * moving shine around a circular container. The logo artwork itself stays
 * completely static — only the surrounding effect animates. All animation
 * is CSS transform/opacity (GPU-composited) and is disabled automatically
 * for prefers-reduced-motion users.
 */
export function BrandLogo({
  className,
  boxClassName = "size-9 rounded-xl bg-primary text-primary-foreground shadow-sm",
  iconClassName = "size-5",
  alt = "Site logo",
  premium = false,
}: {
  className?: string;
  /** Container classes — keep the size/shape, e.g. "size-8 rounded-lg". */
  boxClassName?: string;
  /** Fallback icon classes inside the default mark. */
  iconClassName?: string;
  alt?: string;
  /** Animated premium presentation (circular; Home header only). */
  premium?: boolean;
}) {
  const { logoUrl } = useBranding();
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(logoUrl) && !failed;

  const mark = (
    <>
      {showImage && logoUrl ? (
        <img
          src={logoUrl}
          alt={alt}
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      ) : (
        <Coins className={iconClassName} aria-hidden="true" />
      )}
    </>
  );

  if (!premium) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden",
          boxClassName,
          // Image mode: neutral clean tile (tw-merge drops the tinted bg).
          showImage && "border bg-background p-0.5",
          className,
        )}
        aria-hidden="true"
      >
        {mark}
      </span>
    );
  }

  /* Premium animated presentation (Home header). The artwork stays static;
     only the glow, the rotating arc ring and the shine sweep animate. */
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      aria-hidden="true"
    >
      {/* Soft static green glow behind the mark */}
      <span className="pointer-events-none absolute -inset-1.5 rounded-full bg-primary/20 blur-md" />

      {/* Slowly rotating green arc on a faint base ring */}
      <span className="pointer-events-none absolute -inset-[3px] animate-premium-ring rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,transparent_290deg,var(--primary)_350deg,transparent_360deg)] ring-1 ring-primary/25" />

      {/* Static logo container — separated from the ring by a bg-colored gap */}
      <span
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full ring-2 ring-background",
          boxClassName,
          showImage && "border bg-background p-0.5",
        )}
      >
        {mark}

        {/* Gentle moving shine, clipped to the circle */}
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
          <span className="absolute inset-y-0 left-0 w-1/2 animate-premium-shine bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        </span>
      </span>
    </span>
  );
}
