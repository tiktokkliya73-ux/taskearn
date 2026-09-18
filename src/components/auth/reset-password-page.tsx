"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth/auth-layout";
import { PasswordField } from "@/components/auth/password-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHashRoute, navigateTo } from "@/lib/hash-router";
import { apiFetch } from "@/lib/client-api";

/**
 * Parse the raw location hash into key/value pairs. Supabase Auth recovery
 * links redirect back with the recovery session in the URL fragment, e.g.
 * `#access_token=…&type=recovery` (GoTrue implicit flow) — sometimes appended
 * after the route, e.g. `#/reset-password#access_token=…`. A plain split on
 * `&`/`#` handles both shapes.
 */
function parseHashParams(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const segment of raw.split(/[&#]/)) {
    const eq = segment.indexOf("=");
    if (eq <= 0) continue;
    const key = segment.slice(0, eq);
    const value = segment.slice(eq + 1);
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

interface RecoveryLanding {
  /** The provider-issued recovery session — proof the visitor opened the
   * emailed link from the account owner's mailbox. */
  accessToken: string;
  /** Provider error when the link was expired/invalid (GoTrue error redirects). */
  error: string | null;
}

/**
 * Read the Supabase recovery session (or error) from the landing URL — read
 * once on mount; the token lives only in component state for this page and is
 * never persisted anywhere.
 */
function readRecoveryLanding(): RecoveryLanding | null {
  if (typeof window === "undefined") return null;
  const params = parseHashParams(window.location.hash.replace(/^#/, ""));
  const hasRelevantKeys =
    "access_token" in params || "error" in params || "error_description" in params || "error_code" in params;
  if (!hasRelevantKeys) return null;
  if (params.access_token && params.type === "recovery") {
    return { accessToken: params.access_token, error: null };
  }
  const providerError = params.error_description || params.error || null;
  if (providerError) return { accessToken: "", error: providerError };
  return null;
}

export function ResetPasswordPage() {
  const { query } = useHashRoute();
  const legacyToken = query.get("token") ?? "";

  // The recovery session from the emailed link (or a provider error state).
  const [recovery, setRecovery] = useState(readRecoveryLanding);

  // If the recovery fragment arrives AFTER this page has already mounted
  // (in-page hash change rather than a fresh email-link load), pick it up.
  useEffect(() => {
    const onChange = () => {
      const next = readRecoveryLanding();
      if (next) setRecovery(next);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !recovery?.accessToken) return;
    setFormError(null);

    const errors: { password?: string; confirm?: string } = {};
    if (password.length < 8) errors.password = "Password must be at least 8 characters.";
    if (confirm !== password) errors.confirm = "Passwords do not match.";
    setFieldErrors(errors);
    if (errors.password || errors.confirm) return;

    setSubmitting(true);
    try {
      // Only the provider-issued recovery session can authorize the change —
      // an email address alone is never accepted by the server.
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        json: { supabaseAccessToken: recovery.accessToken, password },
      });
      toast.success("Password updated");
      navigateTo("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reset failed. Please try again.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const invalidLinkScreen = (subtitle: string, description: string) => (
    <AuthLayout
      title="Invalid reset link"
      subtitle={subtitle}
      footer={
        <button
          type="button"
          onClick={() => navigateTo("/forgot-password")}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Request a new recovery link
        </button>
      }
    >
      <Alert variant="destructive">
        <ShieldAlert className="size-4" aria-hidden="true" />
        <AlertTitle>Reset link not valid</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </AuthLayout>
  );

  // Provider rejected the link (expired / already used / tampered).
  if (recovery?.error) {
    return invalidLinkScreen(
      "This password recovery link is no longer valid.",
      recovery.error || "The recovery link has expired or was already used. Request a fresh link to continue."
    );
  }

  // Legacy token links (from the retired demo flow) can no longer authorize a
  // reset — only a provider recovery session can.
  if (!recovery) {
    if (legacyToken) {
      return invalidLinkScreen(
        "This reset link is no longer valid.",
        "Reset links now require a verified recovery session from your email. Request a fresh recovery link to continue."
      );
    }
    return invalidLinkScreen(
      "This password reset link is missing its recovery session.",
      "The link you followed doesn't include a valid recovery session. Request a fresh link to continue."
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a strong password you don't use elsewhere."
      footer={
        <p>
          Link not working?{" "}
          <button
            type="button"
            onClick={() => navigateTo("/forgot-password")}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Request a new one
          </button>
        </p>
      }
    >
      <div className="space-y-4">
        <Alert className="border-primary/40 bg-primary/5">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          <AlertTitle>Email verified</AlertTitle>
          <AlertDescription>
            Your identity was confirmed through your email recovery link. Choose your new password
            below.
          </AlertDescription>
        </Alert>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <PasswordField
            id="reset-password"
            label="New Password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            error={fieldErrors.password}
          />

          <PasswordField
            id="reset-confirm"
            label="Confirm Password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Repeat your new password"
            autoComplete="new-password"
            error={fieldErrors.confirm}
          />

          {formError ? (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
            {submitting ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
