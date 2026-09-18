"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Coins, CreditCard, Landmark, Phone, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GatewaysDTO, PaymentMethodDTO } from "@/lib/types";

export type PaymentMethod = "easypaisa" | "jazzcash" | "usdt";

export interface PaymentMethodMeta {
  value: PaymentMethod;
  label: string;
  icon: ReactNode;
  /** Gateway account field shown on the gateway details box. */
  accountLabel: string;
  accountPlaceholder: string;
}

export const PAYMENT_METHODS: PaymentMethodMeta[] = [
  {
    value: "easypaisa",
    label: "EasyPaisa",
    icon: <Smartphone className="size-4" aria-hidden="true" />,
    accountLabel: "EasyPaisa account",
    accountPlaceholder: "03XX-XXXXXXX",
  },
  {
    value: "jazzcash",
    label: "JazzCash",
    icon: <Phone className="size-4" aria-hidden="true" />,
    accountLabel: "JazzCash account",
    accountPlaceholder: "03XX-XXXXXXX",
  },
  {
    value: "usdt",
    label: "USDT",
    icon: <Coins className="size-4" aria-hidden="true" />,
    accountLabel: "USDT TRC20 address",
    accountPlaceholder: "TRC20 wallet address",
  },
];

export function paymentMethodMeta(method: PaymentMethod): PaymentMethodMeta {
  return PAYMENT_METHODS.find((m) => m.value === method) ?? PAYMENT_METHODS[0];
}

/** Resolve the gateway receiving account for a payment method. */
export function gatewayAccount(
  gateways: GatewaysDTO | undefined,
  method: PaymentMethod
): { label: string; value: string } {
  const meta = paymentMethodMeta(method);
  const value =
    method === "easypaisa"
      ? gateways?.easypaisa_account
      : method === "jazzcash"
        ? gateways?.jazzcash_account
        : gateways?.usdt_address;
  return { label: meta.accountLabel, value: value || "—" };
}

/**
 * Split a legacy account string like "0300-1234567 (TaskEarn Pvt Ltd)" into
 * its number + title parts. Plain values return { title: null, number: value }.
 */
export function splitAccountValue(raw: string | undefined): { title: string | null; number: string } {
  const value = (raw ?? "").trim();
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(value);
  if (m) {
    const number = m[1].trim();
    const title = m[2].trim();
    if (number) return { title: title || null, number };
  }
  return { title: null, number: value };
}

/** Resolve the merchant account TITLE for a payment method (admin-managed). */
export function gatewayTitle(
  gateways: GatewaysDTO | undefined,
  method: PaymentMethod
): string | null {
  const explicit =
    method === "easypaisa"
      ? gateways?.easypaisa_title
      : method === "jazzcash"
        ? gateways?.jazzcash_title
        : null;
  if (explicit && explicit.trim()) return explicit.trim();
  // Legacy fallback: title may still be embedded in the account string.
  const account = gatewayAccount(gateways, method).value;
  if (account !== "—") {
    const parsed = splitAccountValue(account);
    if (parsed.title) return parsed.title;
  }
  return null;
}

export function isPaymentMethod(v: string): v is PaymentMethod {
  return v === "easypaisa" || v === "jazzcash" || v === "usdt";
}

/* ------------------------------------------------------------------ */
/* Dynamic payment methods (admin-managed payment_methods rows)        */
/* ------------------------------------------------------------------ */

/** Does this admin-configured method look like a crypto wallet channel? */
export function isCryptoMethod(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("usdt") || n.includes("crypto") || n.includes("bitcoin") || n.includes("btc") || n.includes("trx");
}

/** Heuristic Lucide icon for a dynamic payment method (fallback visual). */
export function methodIcon(name: string) {
  const n = name.toLowerCase();
  return n.includes("easypaisa")
    ? Smartphone
    : n.includes("jazzcash")
      ? Phone
      : isCryptoMethod(n)
        ? Coins
        : n.includes("bank")
          ? Landmark
          : CreditCard;
}

/**
 * Tile visual for a dynamic payment method: the admin-uploaded image when
 * set (falling back to the heuristic icon if the image fails to load),
 * otherwise the heuristic Lucide icon derived from the method name.
 */
export function MethodVisual({ method, className }: { method: PaymentMethodDTO; className?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(method.logoUrl) && !failed;
  if (showImage && method.logoUrl) {
    return (
      <img
        src={method.logoUrl}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className={cn("object-contain", className ?? "size-10 shrink-0 rounded-lg")}
      />
    );
  }
  const n = method.name.toLowerCase();
  const cls = className ? cn("shrink-0", className) : "size-5 shrink-0";
  if (n.includes("easypaisa")) return <Smartphone className={cls} aria-hidden="true" />;
  if (n.includes("jazzcash")) return <Phone className={cls} aria-hidden="true" />;
  if (isCryptoMethod(n)) return <Coins className={cls} aria-hidden="true" />;
  if (n.includes("bank")) return <Landmark className={cls} aria-hidden="true" />;
  return <CreditCard className={cls} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ */
/* Premium payment method card (shared: checkout Step 2, reusable)     */
/* ------------------------------------------------------------------ */

/**
 * The reusable payment-method card (spec §7): professional image container
 * (admin-uploaded image with fallback icon), clear name + secondary detail
 * and a clean right-side arrow — mobile-first, consistent height, smooth
 * hover/tap feedback. All values stay dynamic (passed by the caller).
 */
export function PaymentMethodCard({
  imageUrl,
  fallbackIcon: FallbackIcon,
  name,
  secondary,
  onSelect,
  ariaLabel,
  tone = "primary",
  selected = false,
  disabled = false,
  className,
}: {
  /** Admin-uploaded custom image (payment_methods.logoUrl / branding setting). */
  imageUrl: string | null;
  /** Lucide icon rendered when no custom image is set (or it fails to load). */
  fallbackIcon: typeof Smartphone;
  name: string;
  secondary: string;
  onSelect: () => void;
  ariaLabel: string;
  /** Visual accent: primary (external methods) or emerald (wallet). */
  tone?: "primary" | "emerald";
  selected?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !imgFailed;
  const accent =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "bg-primary/10 text-primary";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={selected}
        className={cn(
          "group flex min-h-[76px] w-full items-center gap-3.5 rounded-2xl border bg-card p-4 text-left shadow-sm",
          "transition-all duration-200 ease-out",
          "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md hover:shadow-primary/5",
          "active:translate-y-0 active:scale-[0.99]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          selected &&
            "-translate-y-0.5 scale-[1.01] border-primary/70 bg-primary/[0.03] ring-2 ring-primary/25 shadow-lg shadow-primary/15",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        {/* Professional image container — consistent, rounded, object-contain */}
        <span
          aria-hidden="true"
          className={cn(
            "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-background p-1.5",
            !showImage && accent,
          )}
        >
          {showImage && imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              onError={() => setImgFailed(true)}
              className="size-full object-contain"
            />
          ) : (
            <FallbackIcon className="size-5 shrink-0" aria-hidden="true" />
          )}
        </span>

        {/* Name + dynamic secondary detail */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">{name}</span>
          <span className="mt-1 block truncate text-xs leading-tight text-muted-foreground">
            {secondary}
          </span>
        </span>

        {/* Clean right-side arrow */}
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
        >
          <ChevronRight className="size-4.5" />
        </span>
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Payment screenshot (proof) upload helpers                           */
/* ------------------------------------------------------------------ */

/** Accepted screenshot MIME types (spec: JPG / JPEG / PNG / WEBP). */
export const PROOF_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
export const PROOF_ACCEPT = ".jpg,.jpeg,.png,.webp";
export const PROOF_MAX_BYTES = 5 * 1024 * 1024; // 5 MB raw file cap

/** Client-side screenshot validation — the server re-validates everything. */
export function validateProofFile(file: File): string | null {
  if (!PROOF_MIME_TYPES.includes(file.type as (typeof PROOF_MIME_TYPES)[number])) {
    return "Upload a screenshot image (JPG, PNG or WEBP).";
  }
  if (file.size > PROOF_MAX_BYTES) {
    return "Image is too large — keep it under 5 MB.";
  }
  return null;
}

/**
 * Downscale an image File to a compact JPEG data URL (≤900px, q0.72).
 * Re-encoding through the canvas also guarantees the stored payload is a
 * real image — executables or polyglot files can never survive it.
 */
export async function downscaleToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported on this device.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    bitmap.close();
  }
}

/* ------------------------------------------------------------------ */
/* Branding / method image upload (admin)                              */
/* ------------------------------------------------------------------ */

/** Accepted image MIME types for uploaded logos / method images. */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
export const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB raw file cap

/** Client-side image validation — the server re-validates the data URL. */
export function validateImageFile(file: File): string | null {
  if (!IMAGE_MIME_TYPES.includes(file.type as (typeof IMAGE_MIME_TYPES)[number])) {
    return "Upload an image (JPG, PNG or WEBP).";
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return "Image is too large — keep it under 5 MB.";
  }
  return null;
}

/**
 * Optimize an uploaded logo / payment-method image: downscale to at most
 * `maxDim` px on the long edge and re-encode through the canvas (which also
 * sanitizes the payload). PNG sources keep PNG so logos with transparency
 * stay crisp; everything else becomes quality-0.85 JPEG. Square, landscape
 * and portrait uploads all fit — the UI renders them with object-contain.
 */
export async function imageFileToDataUrl(file: File, maxDim = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported on this device.");
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (file.type === "image/png") return canvas.toDataURL("image/png");
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
