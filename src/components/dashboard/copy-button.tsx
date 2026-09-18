"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  /** Text to copy to the clipboard. */
  value: string;
  /** Toast message on success. Defaults to "Copied". */
  toastLabel?: string;
  /** Accessible label for the button. */
  label?: string;
  /** Optional custom content (replaces the default icon + label). */
  children?: ReactNode;
  variant?: "ghost" | "outline" | "secondary" | "default";
  size?: "sm" | "default" | "icon";
  className?: string;
}

/** Clipboard copy button with copied-state feedback and a sonner toast. */
export function CopyButton({
  value,
  toastLabel = "Copied",
  label,
  children,
  variant = "outline",
  size = "sm",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(toastLabel);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — please copy manually.");
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleCopy}
      aria-label={label ?? `Copy ${value}`}
      className={className}
    >
      {children ?? (
        <>
          {copied ? (
            <Check className="size-4 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {size !== "icon" ? <span>{copied ? "Copied" : "Copy"}</span> : null}
        </>
      )}
    </Button>
  );
}

/** Small spinner button used inline while async work runs. */
export function InlineSpinner() {
  return <Loader2 className="size-4 animate-spin" aria-hidden="true" />;
}
