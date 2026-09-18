"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import {
  BadgeCheck,
  ChevronsUpDown,
  Crown,
  Headset,
  Home,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Menu,
  MonitorPlay,
  Package,
  Shield,
  User,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { BrandLogo } from "@/components/branding";
import { OverviewView } from "@/components/dashboard/overview-view";
import { CheckoutView } from "@/components/dashboard/checkout-view";
import { PackagesView } from "@/components/dashboard/packages-view";
import { PlansView } from "@/components/dashboard/plans-view";
import { ProfileView } from "@/components/dashboard/profile-view";
import { DepositView } from "@/components/dashboard/deposit-view";
import { WithdrawView } from "@/components/dashboard/withdraw-view";
import { SupportView } from "@/components/dashboard/support-view";
import {
  BalanceHistoryView,
  DepositHistoryView,
  WithdrawalHistoryView,
} from "@/components/dashboard/history-views";
import { ReferralsView } from "@/components/dashboard/referrals-view";
import { TasksView } from "@/components/dashboard/tasks-view";
import { useSession } from "@/components/providers";
import { apiFetch } from "@/lib/client-api";
import { navigateTo, useHashRoute } from "@/lib/hash-router";
import { formatPKR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { HomeResponseDTO } from "@/lib/types";

interface PageMeta {
  path: string;
  label: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
}

/* ------------------------------------------------------------------ */
/* Home brand header — admin-managed title + tagline (Home Settings)   */
/* ------------------------------------------------------------------ */

const HOME_HEADER_FALLBACK = {
  title: "Task Earn Hub",
  tagline: "Earn daily, withdraw anytime",
};

/**
 * The brand block shown in the mobile topbar / desktop Home header.
 * Shares the ["home"] cache with the Overview view (one request, every
 * consumer); while it loads the safe defaults render instantly.
 */
function useHomeHeader() {
  const { data } = useQuery({
    queryKey: ["home"],
    queryFn: () => apiFetch<HomeResponseDTO>("/api/home"),
    staleTime: 60_000,
  });
  return data?.header ?? HOME_HEADER_FALLBACK;
}

const PAGES: PageMeta[] = [
  {
    path: "/dashboard",
    label: "Home",
    subtitle: "Earn daily, withdraw anytime.",
    icon: LayoutDashboard,
  },
  {
    path: "/dashboard/tasks",
    label: "Daily Tasks",
    subtitle: "One daily task — watch, wait, claim.",
    icon: ListChecks,
  },
  {
    path: "/dashboard/plans",
    label: "VIP Plans",
    subtitle: "Activate a plan — pay via EasyPaisa, JazzCash or USDT.",
    icon: Crown,
  },
  {
    path: "/dashboard/packages",
    label: "Packages",
    subtitle: "Investment plans — daily income, daily withdrawal.",
    icon: Package,
  },
  {
    path: "/dashboard/referrals",
    label: "Invite",
    subtitle: "Invite friends — earn commission and unlock cash rewards.",
    icon: Users,
  },
  {
    path: "/dashboard/profile",
    label: "Profile",
    subtitle: "Your account, deposits and withdrawals.",
    icon: User,
  },
  {
    path: "/dashboard/support",
    label: "Support",
    subtitle: "Get help — send us a message.",
    icon: Headset,
  },
];

function pageMeta(path: string): PageMeta {
  if (path.startsWith("/dashboard/checkout")) {
    return {
      path,
      label: "Checkout",
      subtitle: "Plan → Payment method → Payment details.",
      icon: Package,
    };
  }
  // Profile subtree — the dedicated pages carry their own PageHeader
  // (Back + title); the desktop section header stays "Profile".
  if (
    path.startsWith("/dashboard/profile") ||
    path === "/dashboard/deposit" ||
    path === "/dashboard/withdraw" ||
    path.startsWith("/dashboard/history/")
  ) {
    return {
      path,
      label: "Profile",
      subtitle: "Your account, deposits and withdrawals.",
      icon: User,
    };
  }
  return (
    PAGES.find((p) => p.path === path) ??
    (path.startsWith("/dashboard") ? PAGES[0] : { path, label: "Home", subtitle: PAGES[0].subtitle, icon: LayoutDashboard })
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Sidebar internals (shared by desktop aside + mobile sheet)          */
/* ------------------------------------------------------------------ */

function BalanceMiniCards() {
  const { wallet } = useSession();
  return (
    <div className="mt-5 space-y-2 px-1">
      <div className="rounded-lg border bg-card p-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Wallet className="size-3.5" aria-hidden="true" />
          Task Balance
        </p>
        <p className="mt-1 text-sm font-semibold tabular-nums">
          {wallet ? formatPKR(wallet.taskBalance) : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </p>
      </div>
      <div className="rounded-lg border bg-primary/5 p-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 text-primary" aria-hidden="true" />
          Withdrawable
        </p>
        <p className="mt-1 text-sm font-semibold text-primary tabular-nums">
          {wallet ? (
            formatPKR(wallet.withdrawableBalance)
          ) : (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </p>
      </div>
    </div>
  );
}

function UserCard({ onNavigate }: { onNavigate: () => void }) {
  const { user, logout } = useSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
              {initials(user?.name ?? "U")}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user?.name ?? "…"}</span>
            <span className="block truncate text-xs text-muted-foreground">{user?.email ?? ""}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {user?.role === "admin" ? (
          <DropdownMenuItem
            onClick={() => {
              onNavigate();
              navigateTo("/admin");
            }}
          >
            <Shield aria-hidden="true" />
            Admin panel
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            onNavigate();
            navigateTo("/");
          }}
        >
          <Home aria-hidden="true" />
          View site
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            onNavigate();
            void logout();
          }}
        >
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContent({
  path,
  onNavigate,
  brandTitle,
}: {
  path: string;
  onNavigate: () => void;
  brandTitle: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b px-5">
        <button
          type="button"
          onClick={() => {
            onNavigate();
            navigateTo("/");
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="TaskEarn home"
        >
          <BrandLogo boxClassName="size-9 rounded-xl bg-primary text-primary-foreground shadow-sm" iconClassName="size-5" />
          <span className="truncate text-lg font-bold tracking-tight">{brandTitle}</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3" aria-label="Dashboard navigation">
        <ul className="space-y-1">
          {PAGES.map((page) => {
            const Icon = page.icon;
            const active = page.path === path;
            return (
              <li key={page.path}>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate();
                    navigateTo(page.path);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {active ? (
                    <span
                      className="absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {page.label}
                </button>
              </li>
            );
          })}
        </ul>
        <BalanceMiniCards />
      </nav>

      <div className="border-t p-3">
        <UserCard onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile bottom navigation (user-mandated: 5 primary tabs)           */
/* ------------------------------------------------------------------ */

const BOTTOM_NAV: { path: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { path: "/dashboard", label: "Home", icon: Home },
  { path: "/dashboard/tasks", label: "Ads", icon: MonitorPlay },
  { path: "/dashboard/packages", label: "Packages", icon: Package },
  { path: "/dashboard/referrals", label: "Invite", icon: UserPlus },
  { path: "/dashboard/profile", label: "Profile", icon: User },
];

function BottomNav() {
  const { path } = useHashRoute();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {BOTTOM_NAV.map((tab) => {
        const Icon = tab.icon;
        const active =
          tab.path === path ||
          (tab.path === "/dashboard/packages" && path.startsWith("/dashboard/checkout/package/")) ||
          (tab.path === "/dashboard/profile" &&
            (path.startsWith("/dashboard/profile") ||
              path === "/dashboard/deposit" ||
              path === "/dashboard/withdraw" ||
              path.startsWith("/dashboard/history/")));
        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => navigateTo(tab.path)}
            aria-label={tab.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <span
                className="absolute top-0 h-0.5 w-8 rounded-full bg-primary"
                aria-hidden="true"
              />
            ) : null}
            <Icon className="size-5" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export function DashboardShell() {
  const { path, query } = useHashRoute();
  const [sheetOpen, setSheetOpen] = useState(false);
  const meta = pageMeta(path);
  const header = useHomeHeader();
  const isHome = path === "/dashboard";

  // Legacy /dashboard/wallet deep links (old bookmarks, overview CTAs,
  // checkout success screen) map onto the new dedicated pages.
  useEffect(() => {
    if (path !== "/dashboard/wallet") return;
    const tab = query.get("tab");
    const target =
      tab === "withdraw"
        ? "/dashboard/withdraw"
        : tab === "deposit"
          ? "/dashboard/deposit"
          : tab === "payments"
            ? "/dashboard/history/deposits"
            : tab === "history"
              ? "/dashboard/history/balance"
              : "/dashboard/profile";
    navigateTo(target);
  }, [path, query]);

  // The current view element, memoized on the route path ONLY. Without
  // this, every shell-level state change (mobile sheet open/close, the
  // home-brand header's own polling refresh, session-context updates)
  // rebuilt the element tree and forced a full re-render of the entire
  // current view subtree — pure wasted reconciliation work that made the
  // dashboard feel sluggish on low-end mobile devices. Views keep updating
  // on their own data through their own react-query subscriptions, exactly
  // as before; nothing about which view renders changes.
  const view = useMemo(() => {
    if (path.startsWith("/dashboard/checkout/")) {
      return <CheckoutView />;
    } else if (path === "/dashboard/tasks") {
      return <TasksView />;
    } else if (path === "/dashboard/plans") {
      return <PlansView />;
    } else if (path === "/dashboard/packages") {
      return <PackagesView />;
    } else if (path === "/dashboard/referrals") {
      return <ReferralsView />;
    } else if (path === "/dashboard/profile" || path === "/dashboard/wallet") {
      return <ProfileView />;
    } else if (path === "/dashboard/deposit") {
      return <DepositView />;
    } else if (path === "/dashboard/withdraw") {
      return <WithdrawView />;
    } else if (path === "/dashboard/history/withdrawals") {
      return <WithdrawalHistoryView />;
    } else if (path === "/dashboard/history/deposits") {
      return <DepositHistoryView />;
    } else if (path === "/dashboard/history/balance") {
      return <BalanceHistoryView />;
    } else if (path === "/dashboard/support") {
      return <SupportView />;
    } else {
      return <OverviewView />;
    }
  }, [path]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r bg-sidebar lg:flex">
        <SidebarContent path={path} onNavigate={() => undefined} brandTitle={header.title} />
      </aside>

      {/* Mobile topbar — premium app brand bar (menu + circular logo /
          admin-managed title + tagline + notification bell) */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md lg:hidden">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-1.5 px-4 sm:px-6">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation menu">
                <Menu className="size-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 border-r bg-sidebar p-0">
              {/* sr-only labels — satisfy Radix's a11y contract for the Sheet
                  (screen-reader users get a named dialog; nothing renders
                  visually). Fixes the pre-existing console error + the dev
                  issue badge it produced. */}
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <SheetDescription className="sr-only">
                TaskEarn dashboard sections and wallet balances
              </SheetDescription>
              <SidebarContent path={path} onNavigate={() => setSheetOpen(false)} brandTitle={header.title} />
            </SheetContent>
          </Sheet>
          <div className="flex min-w-0 flex-1 items-center gap-3 pl-1">
            <BrandLogo
              premium
              boxClassName="size-10 rounded-full bg-primary text-primary-foreground shadow-sm"
              iconClassName="size-5"
            />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[17px] font-extrabold tracking-tight">
                {header.title}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">
                {header.tagline}
              </span>
            </span>
          </div>
          <div className="ml-auto flex items-center gap-0.5 pr-1">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main column */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        {/* Desktop page header — the Home tab renders the premium brand
            block (circular logo + admin-managed title + tagline) instead of
            the generic page label */}
        <div className="hidden items-center justify-between gap-4 border-b bg-background/60 px-8 py-6 lg:flex">
          {isHome ? (
            <div className="flex min-w-0 items-center gap-4">
              <BrandLogo
                premium
                boxClassName="size-11 rounded-full bg-primary text-primary-foreground shadow-sm"
                iconClassName="size-6"
              />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-extrabold tracking-tight">{header.title}</h1>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{header.tagline}</p>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{meta.label}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{meta.subtitle}</p>
            </div>
          )}
          <div className="flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:pb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={path}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {view}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />
    </div>
    </MotionConfig>
  );
}
