import { isHttpUrl, isPopupImageSourceUrl } from "@/app/api/_lib/helpers";
import { SETTING_DEFAULTS } from "@/lib/settings";
import type {
  AdminPromoBannerDTO,
  PromoBannerAction,
  PromoBannerDTO,
  PromoBannerInput,
} from "@/lib/types";

// Re-exported so the server routes can keep one import source for both the
// logic and the action types (type-only — safe for any client import too).
export type { PromoBannerAction, PromoBannerInput } from "@/lib/types";

/* ================================================================== */
/* PROMOTIONAL BANNERS — shared engine (both data backends)             */
/*                                                                    */
/* Admin-managed promotional banner list stored as ONE JSON array in   */
/* the existing `system_settings` key-value store (key: promo_banners) */
/* — the exact storage pattern the Login Welcome Popup and Branding    */
/* features already use. Images are canvas-re-encoded data URLs or     */
/* http(s) URLs, validated server-side. No new tables, columns, RPCs   */
/* or buckets are ever required on either backend.                     */
/*                                                                    */
/* Kept free of any next/server imports so it is trivially shareable   */
/* by the local Prisma routes and the Supabase PostgREST routes.       */
/* ================================================================== */

/** The single system_settings key holding the banner list JSON. */
export const PROMO_BANNERS_KEY = "promo_banners";

/* Text caps — identical spirit to the welcome-popup setting caps. */
export const PROMO_BANNER_TITLE_MAX = 120;
export const PROMO_BANNER_CTA_TEXT_MAX = 60;

/** Raw stored record shape (the JSON inside the settings row). */
export interface StoredPromoBanner {
  id: string;
  image: string;
  title: string;
  ctaText: string;
  ctaLink: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Internal-route or http(s) link only — javascript:/data: never survive. */
function sanitizeLink(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  // Computed before the isHttpUrl predicate so `v` keeps its string type
  // (the predicate's false branch would otherwise narrow it to never).
  const isInternal = v.startsWith("/") && !v.startsWith("//");
  return isHttpUrl(v) || isInternal ? v : "";
}

/**
 * Tolerant parse of the stored JSON list: malformed rows are dropped (never
 * crash the route), every field is re-sanitized, and the list comes back in
 * display order (sortOrder, then creation time).
 */
export function parseStoredPromoBanners(rawValue: string | undefined): StoredPromoBanner[] {
  const raw = (rawValue ?? "").trim() || SETTING_DEFAULTS.promo_banners;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: StoredPromoBanner[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const b = item as Record<string, unknown>;
    if (typeof b.id !== "string" || !b.id) continue;
    if (typeof b.image !== "string" || !isPopupImageSourceUrl(b.image)) continue;
    const createdAt = typeof b.createdAt === "string" && b.createdAt ? b.createdAt : new Date().toISOString();
    out.push({
      id: b.id,
      image: b.image.trim(),
      title: typeof b.title === "string" ? b.title.trim().slice(0, PROMO_BANNER_TITLE_MAX) : "",
      ctaText: typeof b.ctaText === "string" ? b.ctaText.trim().slice(0, PROMO_BANNER_CTA_TEXT_MAX) : "",
      ctaLink: sanitizeLink(b.ctaLink),
      isActive: b.isActive === true,
      sortOrder: Number.isInteger(b.sortOrder) ? (b.sortOrder as number) : 0,
      createdAt,
      updatedAt: typeof b.updatedAt === "string" && b.updatedAt ? b.updatedAt : createdAt,
    });
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
  return out;
}

/** Serialize the list back into the settings row value. */
export function serializePromoBanners(list: StoredPromoBanner[]): string {
  return JSON.stringify(list);
}

/** Full admin-facing list (includes inactive banners). */
export function toAdminPromoBannerDTOs(list: StoredPromoBanner[]): AdminPromoBannerDTO[] {
  return list.map((b) => ({ ...b }));
}

/**
 * Member-facing DTO built from raw settings: ONLY active banners, every
 * value re-sanitized server-side (image source + link scheme + caps), in
 * the admin's configured display order. An inactive / deleted / invalid
 * banner can never reach a member.
 */
export function buildPromoBannersDTO(settings: Record<string, string>): PromoBannerDTO[] {
  return parseStoredPromoBanners(settings[PROMO_BANNERS_KEY])
    .filter((b) => b.isActive)
    .map((b) => ({
      id: b.id,
      imageUrl: b.image,
      title: b.title,
      ctaText: b.ctaText,
      ctaLink: b.ctaLink,
    }));
}

/**
 * Validate one admin mutation input BEFORE anything is persisted (identical
 * rules on both backends). Returns a human-readable error, or null when the
 * input is acceptable. `requireImage` is true for create (an image is the
 * banner), false for partial updates (fields may be omitted).
 */
export function validatePromoBannerInput(input: PromoBannerInput, requireImage: boolean): string | null {
  const image = (input.image ?? "").trim();
  if (requireImage && !image) return "Upload a banner image first (or paste an image URL).";
  if (image && !isPopupImageSourceUrl(image)) {
    return (
      "Banner image must be an uploaded image file (JPG, PNG or WEBP — optimized " +
      "to under ~375 KB) or an http(s) image URL."
    );
  }
  if ((input.title ?? "").trim().length > PROMO_BANNER_TITLE_MAX) {
    return `Banner title must be ${PROMO_BANNER_TITLE_MAX} characters or fewer.`;
  }
  if ((input.ctaText ?? "").trim().length > PROMO_BANNER_CTA_TEXT_MAX) {
    return `Button text must be ${PROMO_BANNER_CTA_TEXT_MAX} characters or fewer.`;
  }
  const ctaLink = (input.ctaLink ?? "").trim();
  if (ctaLink) {
    // Same guard order as sanitizeLink — compute the internal-route check
    // before the isHttpUrl predicate narrows the string type.
    const isInternal = ctaLink.startsWith("/") && !ctaLink.startsWith("//");
    if (!isHttpUrl(ctaLink) && !isInternal) {
      return "Button link must be an internal /dashboard… route or a full http(s) URL.";
    }
  }
  return null;
}

/** Generate a fresh banner id (server-side — clients never choose ids). */
function newBannerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Apply one admin action to the stored list → the NEW list (pure function,
 * shared by the local and Supabase routes so behavior is byte-identical).
 * Callers validate inputs first (validatePromoBannerInput) and check ids.
 */
export function applyPromoBannerAction(
  list: StoredPromoBanner[],
  action: PromoBannerAction,
): StoredPromoBanner[] {
  const now = new Date().toISOString();

  switch (action.action) {
    case "create": {
      const input = action.banner ?? {};
      const maxSort = list.reduce((m, b) => Math.max(m, b.sortOrder), 0);
      return [
        ...list,
        {
          id: newBannerId(),
          image: (input.image ?? "").trim(),
          title: (input.title ?? "").trim().slice(0, PROMO_BANNER_TITLE_MAX),
          ctaText: (input.ctaText ?? "").trim().slice(0, PROMO_BANNER_CTA_TEXT_MAX),
          ctaLink: sanitizeLink(input.ctaLink ?? ""),
          // New banners are active immediately — the admin can disable any time.
          isActive: input.isActive !== false,
          sortOrder: maxSort + 1,
          createdAt: now,
          updatedAt: now,
        },
      ];
    }

    case "update": {
      const id = (action.id ?? "").trim();
      const input = action.banner ?? {};
      return list.map((b) => {
        if (b.id !== id) return b;
        return {
          ...b,
          ...(input.image !== undefined ? { image: input.image.trim() } : {}),
          ...(input.title !== undefined ? { title: input.title.trim().slice(0, PROMO_BANNER_TITLE_MAX) } : {}),
          ...(input.ctaText !== undefined
            ? { ctaText: input.ctaText.trim().slice(0, PROMO_BANNER_CTA_TEXT_MAX) }
            : {}),
          ...(input.ctaLink !== undefined ? { ctaLink: sanitizeLink(input.ctaLink) } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive === true } : {}),
          updatedAt: now,
        };
      });
    }

    case "delete": {
      const id = (action.id ?? "").trim();
      return list.filter((b) => b.id !== id);
    }

    case "reorder": {
      const ids = Array.isArray(action.ids) ? action.ids.filter((v) => typeof v === "string") : [];
      const position = new Map(ids.map((id, i) => [id, i]));
      // Known ids get consecutive positions in the submitted order; unknown
      // ids keep their relative order after the known ones.
      const rest = list.filter((b) => !position.has(b.id));
      const known = list.filter((b) => position.has(b.id));
      known.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
      const reordered = [...known, ...rest].map((b, i) =>
        b.sortOrder === i + 1 ? b : { ...b, sortOrder: i + 1, updatedAt: now },
      );
      return reordered;
    }
  }
}
