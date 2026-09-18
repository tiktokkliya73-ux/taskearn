"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField, PrimaryButton } from "@/components/dashboard/profile-ui";
import { apiFetch } from "@/lib/client-api";
import type { AccountActionResponseDTO, RecoveryEmailResponseDTO } from "@/lib/types";

/* ================================================================== */
/* Account dialogs (spec §2) — dedicated Change Password / Recovery    */
/* Email modals driven by the additive /api/auth/* routes. Existing    */
/* auth mechanics (login, sessions, reset links) are untouched.        */
/* ================================================================== */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/* Change Password                                                     */
/* ------------------------------------------------------------------ */

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const changePassword = useMutation({
    mutationFn: (vars: { currentPassword: string; newPassword: string }) =>
      apiFetch<AccountActionResponseDTO>("/api/auth/change-password", { method: "POST", json: vars }),
    onSuccess: () => {
      toast.success("Password updated", {
        description: "Use your new password next time you sign in.",
      });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't update your password. Please try again.");
    },
  });

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setFieldErrors({});
    setShowCurrent(false);
    setShowNew(false);
    changePassword.reset();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (changePassword.isPending) return;

    const errors: typeof fieldErrors = {};
    if (!currentPassword) errors.current = "Enter your current password.";
    if (newPassword.length < 8) errors.next = "New password must be at least 8 characters.";
    else if (newPassword === currentPassword) errors.next = "New password must be different from your current password.";
    if (confirmPassword !== newPassword) errors.confirm = "Passwords don't match.";
    setFieldErrors(errors);
    if (errors.current || errors.next || errors.confirm) return;

    changePassword.mutate({ currentPassword, newPassword });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="size-4" aria-hidden="true" />
            </span>
            Change Password
          </DialogTitle>
          <DialogDescription>
            Confirm your current password, then choose a new one. You stay signed in on this device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormField label="Current password" htmlFor="cp-current" error={fieldErrors.current}>
            <div className="relative">
              <Input
                id="cp-current"
                type={showCurrent ? "text" : "password"}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="pr-11"
                aria-invalid={Boolean(fieldErrors.current)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={showCurrent ? "Hide current password" : "Show current password"}
                className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowCurrent((v) => !v)}
              >
                {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </FormField>

          <FormField label="New password" htmlFor="cp-next" error={fieldErrors.next} hint="At least 8 characters.">
            <div className="relative">
              <Input
                id="cp-next"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="pr-11"
                aria-invalid={Boolean(fieldErrors.next)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={showNew ? "Hide new password" : "Show new password"}
                className="absolute top-1/2 right-1 size-9 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowNew((v) => !v)}
              >
                {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </FormField>

          <FormField label="Confirm new password" htmlFor="cp-confirm" error={fieldErrors.confirm}>
            <Input
              id="cp-confirm"
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={Boolean(fieldErrors.confirm)}
            />
          </FormField>

          <PrimaryButton type="submit" icon={KeyRound} disabled={changePassword.isPending}>
            {changePassword.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Updating…
              </>
            ) : (
              "Update Password"
            )}
          </PrimaryButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Recovery Email                                                      */
/* ------------------------------------------------------------------ */

export function RecoveryEmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Mail className="size-4" aria-hidden="true" />
            </span>
            Recovery Email
          </DialogTitle>
          <DialogDescription>
            A secondary contact we can use to reach you about this account. Your sign-in email stays{" "}
            <span className="font-medium text-foreground">unchanged</span>.
          </DialogDescription>
        </DialogHeader>
        {/* Radix unmounts content on close — the form remounts fresh each open. */}
        <RecoveryEmailForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function RecoveryEmailForm({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  // Local override — null mirrors the fetched value until the member edits.
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Current recovery email — fetched fresh when the dialog (re)opens.
  const current = useQuery({
    queryKey: ["recovery-email"],
    queryFn: () => apiFetch<RecoveryEmailResponseDTO>("/api/auth/recovery-email"),
  });

  const save = useMutation({
    mutationFn: (recoveryEmail: string) =>
      apiFetch<AccountActionResponseDTO>("/api/auth/recovery-email", {
        method: "POST",
        json: { recoveryEmail },
      }),
    onSuccess: (_res, recoveryEmail) => {
      toast.success(
        recoveryEmail ? "Recovery email saved" : "Recovery email removed",
      );
      void queryClient.invalidateQueries({ queryKey: ["recovery-email"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn't save your recovery email. Please try again.");
    },
  });

  const shown = value ?? current.data?.recoveryEmail ?? "";
  const savedEmail = current.data?.recoveryEmail ?? null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (save.isPending) return;

    const trimmed = shown.trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    save.mutate(trimmed);
  }

  if (current.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading…
      </div>
    );
  }

  if (current.isError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive" role="alert">
          Couldn&apos;t load your recovery email.
        </p>
        <Button variant="outline" size="sm" onClick={() => void current.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {savedEmail ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="leading-relaxed text-muted-foreground">
            Current recovery email:{" "}
            <span className="font-medium break-all text-foreground">{savedEmail}</span>
          </p>
        </div>
      ) : null}

      <FormField label="Recovery email" htmlFor="re-email" error={error} hint="Optional — leave empty to remove it.">
        <Input
          id="re-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="recovery@example.com"
          value={shown}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={Boolean(error)}
        />
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        {savedEmail ? (
          <Button
            type="button"
            variant="outline"
            className="h-12 rounded-xl font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive sm:w-auto"
            disabled={save.isPending}
            onClick={() => {
              setValue("");
              setError(null);
              save.mutate("");
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </Button>
        ) : null}
        <PrimaryButton type="submit" icon={Mail} disabled={save.isPending} className="sm:flex-1">
          {save.isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            "Save Recovery Email"
          )}
        </PrimaryButton>
      </div>
    </form>
  );
}
