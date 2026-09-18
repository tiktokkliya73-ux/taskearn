"use client";

import type { WelcomePopupFrequency } from "@/lib/types";

/* ================================================================== */
/* LOGIN WELCOME POPUP — client-side presentation helpers              */
/*                                                                    */
/* All popup CONFIG comes from GET /api/home/welcome-popup (server is  */
/* the source of truth); this module only handles WHEN the popup may   */
/* auto-open and how admin uploads are optimized before saving.        */
/*                                                                    */
/* Display frequency semantics:                                       */
/* - every_login      → only right after an explicit login/signup      */
/*                      (a one-shot flag the auth pages set)           */
/* - once_per_session → at most once per browser session               */
/*                      (sessionStorage guard)                         */
/* - once_per_day     → at most once per local calendar day            */
/*                      (localStorage guard)                           */
/* ================================================================== */

const LOGIN_FLAG_KEY = "taskearn.welcome-popup.login";
const SHOWN_SESSION_KEY = "taskearn.welcome-popup.shown-session";
const SHOWN_DAY_KEY = "taskearn.welcome-popup.shown-day";

/** Client-side budget — must stay under the server-side cap (500k chars). */
export const POPUP_IMAGE_MAX_CHARS = 470_000;

/**
 * Set right after a SUCCESSFUL login or signup so the "Every Login"
 * frequency can show the popup exactly once per authentication event.
 * Survives the hash-route navigation to /dashboard; consumed the moment
 * the popup is shown (page reloads alone never re-trigger it).
 */
export function markWelcomeLogin(): void {
  try {
    sessionStorage.setItem(LOGIN_FLAG_KEY, "1");
  } catch {
    /* storage blocked — "every login" simply degrades to no auto-open */
  }
}

function loginFlagSet(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function consumeLoginFlag(): void {
  try {
    sessionStorage.removeItem(LOGIN_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/** Local calendar day as YYYY-MM-DD (user's timezone, not UTC). */
function localDay(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** May the popup auto-open right now under this frequency? */
export function shouldShowWelcomePopup(frequency: WelcomePopupFrequency): boolean {
  try {
    if (frequency === "every_login") return loginFlagSet();
    if (frequency === "once_per_day") return localStorage.getItem(SHOWN_DAY_KEY) !== localDay();
    return sessionStorage.getItem(SHOWN_SESSION_KEY) !== "1";
  } catch {
    // Storage blocked (private mode): fail safe — never auto-open.
    return false;
  }
}

/**
 * Record that the popup was SHOWN so the frequency guards hold for the
 * rest of the session/day. Also consumes the login flag so returning to
 * the Home tab within the same login never repeats it.
 */
export function markWelcomePopupShown(frequency: WelcomePopupFrequency): void {
  consumeLoginFlag();
  try {
    if (frequency === "once_per_day") localStorage.setItem(SHOWN_DAY_KEY, localDay());
    else if (frequency === "once_per_session") sessionStorage.setItem(SHOWN_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Admin upload optimization (used by the Home Settings image field)   */
/* ------------------------------------------------------------------ */

/** Encode a bitmap to JPEG with a white base so transparent art stays printable. */
function encodeJpeg(bitmap: ImageBitmap, maxDim: number, quality: number): string {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported on this device.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Optimize an uploaded promo image for the welcome popup. Full-screen promo
 * art needs more pixels than logos: ≤1080px on the long edge, re-encoded
 * through the canvas (which also sanitizes the payload — anything that is
 * not a real image cannot survive the round-trip). Adaptive quality keeps
 * the stored data URL within the client budget above.
 */
export async function popupImageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const attempts: Array<[number, number]> = [
      [1080, 0.78],
      [1080, 0.66],
      [960, 0.58],
      [840, 0.5],
    ];
    for (const [maxDim, quality] of attempts) {
      const url = encodeJpeg(bitmap, maxDim, quality);
      if (url.length <= POPUP_IMAGE_MAX_CHARS) return url;
    }
    return encodeJpeg(bitmap, 720, 0.45);
  } finally {
    bitmap.close();
  }
}
