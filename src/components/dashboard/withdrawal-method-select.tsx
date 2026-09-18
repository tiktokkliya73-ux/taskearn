"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Landmark, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WithdrawalMethodDTO } from "@/lib/types";

/* ================================================================== */
/* Withdrawal Method dropdown (Withdraw page)                          */
/*                                                                    */
/* A professional select component for the admin-managed payout        */
/* channels: white/light surface, rounded corners, thin border, soft   */
/* shadow, one channel per row with comfortable vertical padding, a    */
/* subtle selected background + right-side checkmark and a smooth      */
/* open/close animation. Shows ONLY the channel identity (logo +       */
/* name) — never the admin's receiving accounts. The member's own      */
/* payout account is a separate field rendered below the dropdown.     */
/* ================================================================== */

/**
 * The channel visual: the admin-uploaded logo when set (falling back to
 * the kind default icon if the image fails to load), otherwise the clean
 * default icon (Smartphone for wallets, Landmark for banks). Shared by the
 * member dropdown and the admin manager rows.
 */
export function WithdrawalMethodLogo({
  method,
  className,
  iconClassName,
}: {
  method: WithdrawalMethodDTO;
  /** Classes for the wrapping tile. */
  className?: string;
  /** Classes for the icon/image itself. */
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const FallbackIcon = method.kind === "bank" ? Landmark : Smartphone;
  const showImage = Boolean(method.logoUrl) && !failed;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background p-1",
        !showImage && "bg-primary/10 text-primary",
        className,
      )}
    >
      {showImage && method.logoUrl ? (
        <img
          src={method.logoUrl}
          alt=""
          onError={() => setFailed(true)}
          className={cn("size-full object-contain", iconClassName)}
        />
      ) : (
        <FallbackIcon className={cn("size-4.5 shrink-0", iconClassName)} />
      )}
    </span>
  );
}

export function WithdrawalMethodSelect({
  id,
  methods,
  value,
  onChange,
  disabled,
  ariaLabel = "Withdrawal method",
}: {
  id?: string;
  methods: WithdrawalMethodDTO[];
  value: WithdrawalMethodDTO | null;
  onChange: (method: WithdrawalMethodDTO) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Tap/click outside closes the dropdown; Escape closes it too.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function select(method: WithdrawalMethodDTO) {
    onChange(method);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Closed trigger — looks exactly like the form inputs */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}${value ? `: ${value.name}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-xl border border-input bg-card px-3.5 text-left text-base shadow-sm",
          "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          "hover:border-primary/40",
          open && "border-primary/60 ring-1 ring-primary/30",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {value ? (
          <>
            <WithdrawalMethodLogo method={value} />
            <span className="min-w-0 flex-1 truncate font-medium">{value.name}</span>
          </>
        ) : (
          <span className="flex-1 truncate text-muted-foreground">Select withdrawal method</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180 text-primary",
          )}
        />
      </button>

      {/* Dropdown list — one channel per row, comfortable padding, */}
      {/* selected row highlighted with a checkmark on the right.     */}
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute inset-x-0 top-full z-50 mt-2 origin-top"
          >
            <div
              role="listbox"
              aria-label={ariaLabel}
              className="overflow-hidden rounded-xl border bg-card shadow-lg shadow-black/5"
            >
              <ul className="max-h-80 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
                {methods.map((m) => {
                  const isSelected = value?.id === m.id;
                  return (
                    <li key={m.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onClick={() => select(m)}
                        aria-label={`Select ${m.name}`}
                        className={cn(
                          "flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left",
                          "transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                          isSelected ? "bg-primary/[0.08]" : "hover:bg-muted/70 active:bg-muted",
                        )}
                      >
                        <WithdrawalMethodLogo method={m} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                        {isSelected ? (
                          <span
                            aria-hidden="true"
                            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          >
                            <Check className="size-3" />
                          </span>
                        ) : (
                          // Invisible spacer keeps every row's name aligned
                          <span aria-hidden="true" className="size-5 shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
