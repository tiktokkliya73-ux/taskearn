"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  IMAGE_ACCEPT,
  imageFileToDataUrl,
  validateImageFile,
} from "@/components/dashboard/payment-methods";

/* ================================================================== */
/* Reusable admin image upload field                                   */
/*                                                                    */
/* Controlled component: the parent draft holds the value (data URL,  */
/* http URL or "" for none), so the admin previews the image BEFORE   */
/* saving and one Save button persists everything.                    */
/* - Upload / Replace: pick from device → validate → canvas-optimize  */
/* - Remove: clears the custom image (falls back to the default)      */
/* - Optional URL input for QR / externally hosted images             */
/* ================================================================== */

export function ImageUploadField({
  id,
  value,
  onChange,
  disabled,
  maxDim = 256,
  allowUrl = false,
  uploadLabel = "Upload image",
  urlLabel = "Image URL (optional)",
  urlPlaceholder = "https://example.com/logo.png",
  previewClassName = "size-16 rounded-xl",
  compact = false,
  convert,
  className,
}: {
  id: string;
  /** Current image source: data URL, http(s) URL or "" (none). */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Long-edge pixel cap applied to uploads (256 icons / 512 logo). */
  maxDim?: number;
  /** Also offer a text input for http(s) image URLs (QR codes etc.). */
  allowUrl?: boolean;
  uploadLabel?: string;
  urlLabel?: string;
  urlPlaceholder?: string;
  previewClassName?: string;
  /** Row layout for inline usage inside lists. */
  compact?: boolean;
  /** Optional custom upload converter (e.g. larger promo images with adaptive quality). */
  convert?: (file: File) => Promise<string>;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const err = validateImageFile(file);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = convert
        ? await convert(file)
        : await imageFileToDataUrl(file, maxDim);
      onChange(dataUrl);
    } catch {
      setError("Could not read that image. Try a different file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const hasImage = Boolean(value.trim());

  const preview = hasImage ? (
    <img
      src={value.trim()}
      alt="Image preview"
      className={cn("shrink-0 border bg-background object-contain p-1", previewClassName)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center border border-dashed bg-muted/40 text-muted-foreground",
        previewClassName,
      )}
    >
      <ImagePlus className="size-5" />
    </span>
  );

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={fileRef}
        id={`${id}-file`}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      <div className={cn("flex items-center gap-3", compact ? "flex-wrap" : "flex-wrap sm:flex-nowrap")}>
        {preview}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={busy || disabled}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-3.5" aria-hidden="true" />
            )}
            {hasImage ? "Replace" : uploadLabel}
          </Button>
          {hasImage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy || disabled}
              onClick={() => onChange("")}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Remove
            </Button>
          ) : null}
          <p className="w-full text-[11px] leading-tight text-muted-foreground">
            JPG, PNG or WEBP — square, landscape or portrait all fit cleanly.
          </p>
        </div>
      </div>
      {allowUrl ? (
        <Input
          id={`${id}-url`}
          value={value.startsWith("data:") ? "" : value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder={urlPlaceholder}
          aria-label={urlLabel}
          disabled={disabled || busy}
          className="h-8 text-xs"
        />
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
