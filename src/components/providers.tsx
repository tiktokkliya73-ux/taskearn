"use client";

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_ANIMATION_SETTINGS } from "@/lib/animations";
import { apiFetch } from "@/lib/client-api";
import { startBodyPointerEventsGuard } from "@/lib/interaction-guard";
import { navigateTo, stashReferralCode } from "@/lib/hash-router";
import type { AnimationSettingsDTO, SessionUser, WalletData } from "@/lib/types";

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      })
  );

  // Frontend responsiveness safeguard: if a Radix modal layer (Sheet /
  // Dialog / menu) ever tears down abnormally and leaves its inline
  // `pointer-events: none` lock on <body>, taps on the whole page would
  // stay dead until a manual refresh. The guard removes ONLY a stale
  // lock — legitimate open layers are never touched. See
  // src/lib/interaction-guard.ts for the full rationale.
  useEffect(() => startBodyPointerEventsGuard(), []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

interface SessionResponse {
  user: SessionUser | null;
  wallet: WalletData | null;
  /** Admin-controlled success-animation switches (absent → defaults ON). */
  animations?: AnimationSettingsDTO | null;
}

interface AuthContextValue {
  status: "loading" | "authenticated" | "unauthenticated" | "banned";
  user: SessionUser | null;
  wallet: WalletData | null;
  /** Admin success-animation switches — visual layer only, defaults ON. */
  animations: AnimationSettingsDTO;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["session"],
    queryFn: () => apiFetch<SessionResponse>("/api/auth/session"),
    refetchInterval: 10_000, // near real-time balance sync
  });

  // Stash ?ref= from landing links once on mount
  useEffect(() => {
    stashReferralCode();
  }, []);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
  };

  const logout = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    await queryClient.invalidateQueries();
    navigateTo("/");
  };

  const user = data?.user ?? null;
  const status: AuthContextValue["status"] = isLoading
    ? "loading"
    : !user
      ? "unauthenticated"
      : user.isBanned
        ? "banned"
        : "authenticated";

  const value = useMemo(
    () => ({
      status,
      user,
      wallet: data?.wallet ?? null,
      animations: data?.animations ?? DEFAULT_ANIMATION_SETTINGS,
      refresh,
      logout,
    }),
    [status, user, data?.wallet, data?.animations, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSession(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useSession must be used inside <AuthProvider>");
  return ctx;
}
