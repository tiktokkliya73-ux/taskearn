"use client";

/**
 * Device fingerprint (client-side) — hashed browser/device signals.
 * Used for anti self-referral checks (must match server-side comparison policy).
 */
export async function getFingerprint(): Promise<string> {
  try {
    if (typeof window === "undefined") return "unknown";
    const nav = window.navigator;
    const signals = [
      nav.userAgent,
      nav.language,
      (nav.languages || []).join(","),
      (nav as unknown as { platform?: string }).platform || "",
      `${screen.width}x${screen.height}`,
      `${screen.colorDepth}`,
      String(new Date().getTimezoneOffset()),
      String(nav.hardwareConcurrency || 0),
    ].join("|");
    const data = new TextEncoder().encode(signals);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "unknown";
  }
}
