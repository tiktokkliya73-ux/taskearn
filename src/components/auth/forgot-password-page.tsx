"use client";

import { useState } from "react";
import { Loader2, MailCheck, Send } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import type { ForgotPasswordResponse } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      // The server sends the recovery link to the account owner's mailbox
      // (or responds identically when the account doesn't exist) — it never
      // returns a reset credential, so knowing an email alone can never
      // lead to a password change.
      await apiFetch<ForgotPasswordResponse>("/api/auth/forgot-password", {
        method: "POST",
        json: { email: email.trim() },
      });
      setSent(true);
      toast.success("If that email is registered, a recovery link is on its way.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a secure recovery link."
      footer={
        <p>
          Remembered it?{" "}
          <button
            type="button"
            onClick={() => navigateTo("/login")}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to sign in
          </button>
        </p>
      }
    >
      {sent ? (
        <div className="space-y-4">
          <Alert className="border-primary/40 bg-primary/5">
            <MailCheck className="size-4 text-primary" aria-hidden="true" />
            <AlertTitle>Check your email</AlertTitle>
            <AlertDescription>
              If an account exists for <span className="font-medium text-foreground">{email}</span>, a
              password recovery link has been sent. The link only works for the owner of that
              mailbox — check your spam folder if it hasn&apos;t arrived after a few minutes.
            </AlertDescription>
          </Alert>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {submitting ? "Sending…" : "Send recovery link"}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
