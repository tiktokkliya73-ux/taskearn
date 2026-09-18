"use client";

import { useState } from "react";
import { Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth/auth-layout";
import { PasswordField } from "@/components/auth/password-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/components/providers";
import { apiFetch } from "@/lib/client-api";
import { getFingerprint } from "@/lib/fingerprint";
import { navigateTo } from "@/lib/hash-router";
import { markWelcomeLogin } from "@/lib/welcome-popup";
import type { SessionUser } from "@/lib/types";

interface LoginResponse {
  user: SessionUser;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!email.trim() || !EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address to continue.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<LoginResponse>("/api/auth/login", {
        method: "POST",
        json: { email: email.trim(), password, fingerprint: await getFingerprint() },
      });
      await refresh();
      markWelcomeLogin();
      toast.success("Welcome back!");
      navigateTo(res.user.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your TaskEarn account to keep earning."
      footer={
        <p>
          New here?{" "}
          <button
            type="button"
            onClick={() => navigateTo("/signup")}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </button>
        </p>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error)}
          />
        </div>

        <div className="space-y-2">
          <PasswordField
            id="login-password"
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="Your password"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => navigateTo("/forgot-password")}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting} size="lg">
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <LogIn className="size-4" aria-hidden="true" />
          )}
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
