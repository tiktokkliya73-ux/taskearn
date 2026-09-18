"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useHashRoute, navigateTo } from "@/lib/hash-router";
import { useSession } from "@/components/providers";
import { useBranding, useFavicon } from "@/components/branding";

import { LandingPage } from "@/components/landing/landing-page";
import { LoginPage } from "@/components/auth/login-page";
import { SignupPage } from "@/components/auth/signup-page";
import { ForgotPasswordPage } from "@/components/auth/forgot-password-page";
import { ResetPasswordPage } from "@/components/auth/reset-password-page";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { AdminShell } from "@/components/admin/admin-shell";

export function AppShell() {
  const { path } = useHashRoute();
  const { status, user } = useSession();
  const { faviconUrl } = useBranding();

  // Admin's custom favicon (from /admin/branding) — applied app-wide once.
  useFavicon(faviconUrl);

  const isAuthView = ["/login", "/signup", "/forgot-password", "/reset-password"].includes(path);
  const isDashboard = path === "/dashboard" || path.startsWith("/dashboard/");
  const isAdmin = path === "/admin" || path.startsWith("/admin/");

  // Supabase Auth recovery links redirect back with the recovery session (or
  // a provider error) in the URL fragment, e.g. `#access_token=…&type=recovery`.
  // Route any such landing to the reset-password view regardless of the parsed
  // path — the page reads the fragment itself. Deliberately NOT part of
  // isAuthView: a visitor who is currently signed in may still be completing a
  // recovery link for their own account, so the authenticated-redirect guard
  // must not hijack the flow.
  const rawHash = typeof window !== "undefined" ? window.location.hash : "";
  const recoveryLanding =
    (rawHash.includes("type=recovery") && rawHash.includes("access_token=")) ||
    rawHash.includes("error_description=");

  // Guards
  useEffect(() => {
    if (status === "loading") return;
    if (isAuthView && status === "authenticated") {
      navigateTo(user?.role === "admin" ? "/admin" : "/dashboard");
    }
    if ((isDashboard || isAdmin) && status === "unauthenticated") {
      navigateTo("/login");
    }
    if (isAdmin && status === "authenticated" && user?.role !== "admin") {
      navigateTo("/dashboard");
    }
  }, [status, isAuthView, isDashboard, isAdmin, user?.role]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading TaskEarn…</p>
      </div>
    );
  }

  if (status === "banned") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-destructive" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
            <line x1="12" y1="2" x2="12" y2="12" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">Account suspended</h1>
        <p className="text-muted-foreground max-w-md">
          Your account has been suspended for violating platform rules. Contact support if you believe this is a
          mistake.
        </p>
      </div>
    );
  }

  if (recoveryLanding) {
    return <ResetPasswordPage />;
  }

  if (isAuthView) {
    switch (path) {
      case "/login":
        return <LoginPage />;
      case "/signup":
        return <SignupPage />;
      case "/forgot-password":
        return <ForgotPasswordPage />;
      case "/reset-password":
        return <ResetPasswordPage />;
    }
  }

  if (isDashboard && status === "authenticated") {
    return <DashboardShell />;
  }

  if (isAdmin && status === "authenticated" && user?.role === "admin") {
    return <AdminShell />;
  }

  return <LandingPage />;
}
