"use client";

import { useMemo, useState } from "react";
import { Gift, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth/auth-layout";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/components/providers";
import { apiFetch } from "@/lib/client-api";
import { getFingerprint } from "@/lib/fingerprint";
import { clearStashedReferral, getStashedReferral, navigateTo } from "@/lib/hash-router";
import { markWelcomeLogin } from "@/lib/welcome-popup";
import type { SessionUser } from "@/lib/types";

interface SignupResponse {
  user: SessionUser;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupPage() {
  const { refresh } = useSession();
  const stashedReferral = useMemo(() => getStashedReferral(), []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(stashedReferral);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = "Enter your full name (at least 2 characters).";
    if (!EMAIL_RE.test(email.trim())) errors.email = "Enter a valid email address.";
    if (password.length < 8) errors.password = "Password must be at least 8 characters.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await apiFetch<SignupResponse>("/api/auth/signup", {
        method: "POST",
        json: {
          name: name.trim(),
          email: email.trim(),
          password,
          ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
          fingerprint: await getFingerprint(),
        },
      });
      clearStashedReferral();
      await refresh();
      markWelcomeLogin();
      toast.success("Account created — welcome to TaskEarn!");
      navigateTo("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Signup failed. Please try again.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start completing tasks and earning daily rewards."
      footer={
        <p>
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => navigateTo("/login")}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </button>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="signup-name">Full Name</Label>
          <Input
            id="signup-name"
            type="text"
            autoComplete="name"
            placeholder="Ali Raza"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
          />
          {fieldErrors.name ? (
            <p className="text-sm text-destructive" role="alert">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
          />
          {fieldErrors.email ? (
            <p className="text-sm text-destructive" role="alert">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <PasswordField
            id="signup-password"
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            error={fieldErrors.password}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-referral">Referral Code (optional)</Label>
          <div className="relative">
            <Gift className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="signup-referral"
              type="text"
              placeholder="e.g. 7K2QXZ"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              className="pl-9 uppercase"
              aria-describedby="signup-referral-hint"
            />
          </div>
          <p id="signup-referral-hint" className="text-xs text-muted-foreground">
            Invited by a friend? Their link pre-fills this code.
          </p>
        </div>

        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" size="lg" disabled={submitting}>
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus className="size-4" aria-hidden="true" />
          )}
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
