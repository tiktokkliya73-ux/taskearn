"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Minimal hash-based client router. The only real route is `/`.
 * Paths look like: #/dashboard/tasks  #/signup?ref=AB12CD
 */

export interface HashRoute {
  path: string; // e.g. "/dashboard/tasks"
  query: URLSearchParams;
  navigate: (to: string) => void;
}

function parseHash(): { path: string; query: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  return { path: path.replace(/\/+$/, "") || "/", query: new URLSearchParams(queryPart ?? "") };
}

export function navigateTo(to: string) {
  const target = to.startsWith("#") ? to : `#${to.startsWith("/") ? to : `/${to}`}`;
  if (window.location.hash === target) return;
  window.location.hash = target;
}

export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<{ path: string; query: URLSearchParams }>(() =>
    typeof window === "undefined"
      ? { path: "/", query: new URLSearchParams() }
      : parseHash()
  );

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    if (!window.location.hash) {
      window.location.replace("#/");
    }
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((to: string) => navigateTo(to), []);

  return { ...route, navigate };
}

/** Stash ?ref=CODE from the real URL for the signup form. */
export function stashReferralCode(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("te_pending_ref", ref.trim().toUpperCase());
      // clean the query string so refresh keeps the SPA state
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  } catch {
    /* ignore */
  }
}

export function getStashedReferral(): string {
  try {
    return localStorage.getItem("te_pending_ref") ?? "";
  } catch {
    return "";
  }
}

export function clearStashedReferral(): void {
  try {
    localStorage.removeItem("te_pending_ref");
  } catch {
    /* ignore */
  }
}
