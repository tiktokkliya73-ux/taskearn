"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Banknote,
  ChevronDown,
  Coins,
  CreditCard,
  Crown,
  Database,
  ExternalLink,
  Headset,
  House,
  Image as ImageIcon,
  Images,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Package,
  ReceiptText,
  Settings,
  Sun,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSession } from "@/components/providers";
import { BrandLogo } from "@/components/branding";
import { apiFetch } from "@/lib/client-api";
import { navigateTo, useHashRoute } from "@/lib/hash-router";
import { cn } from "@/lib/utils";
import type { AdminStatsDTO } from "@/lib/types";

import { AdminOverviewView } from "@/components/admin/overview-view";
import { AdminTasksView } from "@/components/admin/tasks-view";
import { AdminPackagesView } from "@/components/admin/packages-view";
import { DepositsView } from "@/components/admin/deposits-view";
import { PaymentMethodsView } from "@/components/admin/payment-methods-view";
import { HomeSettingsView } from "@/components/admin/home-settings-view";
import { PromoBannersView } from "@/components/admin/promo-banners-view";
import { InviteSettingsView } from "@/components/admin/invite-settings-view";
import { BrandingView } from "@/components/admin/branding-view";
import { PlansView } from "@/components/admin/plans-view";
import { SettingsView } from "@/components/admin/settings-view";
import { SupabaseView } from "@/components/admin/supabase-view";
import { UsersView } from "@/components/admin/users-view";
import { WithdrawalsView } from "@/components/admin/withdrawals-view";
import { TransactionsView } from "@/components/admin/transactions-view";
import { NotificationsView } from "@/components/admin/notifications-view";
import { SupportView } from "@/components/admin/support-view";
import { initials } from "@/components/admin/shared";

/* --------------------------------- config --------------------------------- */

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  /** Small non-interactive group heading. */
  label: string;
  items: NavItem[];
}

/**
 * Control-center navigation: existing admin features grouped so the admin
 * understands where everything lives at a glance. Every path is an existing
 * route — only the presentation (labels + grouping) changed.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Main",
    items: [{ path: "/admin", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Management",
    items: [
      { path: "/admin/users", label: "Users", icon: Users },
      { path: "/admin/packages", label: "Packages", icon: Package },
      { path: "/admin/plans", label: "VIP Plans", icon: Crown },
      { path: "/admin/tasks", label: "Tasks & Ads", icon: ListChecks },
    ],
  },
  {
    label: "Financial",
    items: [
      { path: "/admin/deposits", label: "Deposits", icon: ArrowDownToLine },
      { path: "/admin/withdrawals", label: "Withdrawals", icon: Banknote },
      { path: "/admin/transactions", label: "Transactions", icon: ReceiptText },
      { path: "/admin/payment-methods", label: "Payment Methods", icon: CreditCard },
    ],
  },
  {
    label: "Content",
    items: [
      { path: "/admin/home-settings", label: "Home Page", icon: House },
      { path: "/admin/promo-banners", label: "Promo Banners", icon: Images },
      { path: "/admin/branding", label: "Branding", icon: ImageIcon },
    ],
  },
  {
    label: "Communication",
    items: [
      { path: "/admin/notifications", label: "Notifications", icon: Megaphone },
      { path: "/admin/support", label: "Support", icon: Headset },
      { path: "/admin/invite", label: "Referral Program", icon: UserPlus },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/admin/settings", label: "Settings", icon: Settings },
      { path: "/admin/supabase", label: "Supabase", icon: Database },
    ],
  },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/admin": {
    title: "Dashboard",
    subtitle: "Platform health, pending work and quick controls — your control center",
  },
  "/admin/home-settings": {
    title: "Home Page",
    subtitle: "Home header, login welcome popup, announcements, offers, promo codes and social widgets — live on the member Home screen",
  },
  "/admin/promo-banners": {
    title: "Promo Banners",
    subtitle: "Premium promotional images members see in the overlay carousel — add, enable, reorder or retire them any time",
  },
  "/admin/invite": {
    title: "Referral Program",
    subtitle: "Commission display, Cash Rewards Levels and texts — live on the member Invite screen",
  },
  "/admin/notifications": {
    title: "Notifications",
    subtitle: "Broadcast a message to every member's notification bell — send once, delivered to all",
  },
  "/admin/support": {
    title: "Support",
    subtitle: "Member help requests — read, reply and resolve them from one place",
  },
  "/admin/branding": {
    title: "Branding",
    subtitle: "Website logo, favicon and payment method images — one centralized visual identity",
  },
  "/admin/payment-methods": {
    title: "Payment Methods",
    subtitle: "Payment channels shown on every member checkout — accounts, titles, logos, instructions and order",
  },
  "/admin/settings": { title: "System Settings", subtitle: "Platform rules, referral and withdrawal limits" },
  "/admin/settings/gateways": {
    title: "Payment Methods",
    subtitle: "Redirecting to the dynamic Payment Methods manager…",
  },
  "/admin/deposits": {
    title: "Deposits",
    subtitle: "Payment requests from members — review the proof and approve to activate instantly",
  },
  "/admin/plans": { title: "VIP Plans", subtitle: "Membership tiers that gate Daily Tasks — pricing and rewards" },
  "/admin/packages": {
    title: "Packages",
    subtitle: "Investment packages — price, daily earnings, duration and description",
  },
  "/admin/tasks": { title: "Tasks & Ads", subtitle: "The ad-watch task library shown to active members" },
  "/admin/withdrawals": {
    title: "Withdrawals",
    subtitle: "Payout requests from members — approve once paid, reject to refund",
  },
  "/admin/transactions": {
    title: "Transactions",
    subtitle: "The complete platform ledger — every reward, commission, deposit and payout",
  },
  "/admin/users": { title: "Users", subtitle: "Accounts, balances and moderation" },
  "/admin/supabase": { title: "Supabase", subtitle: "Data backend status, provisioning and migration" },
};

function pageMeta(path: string): { title: string; subtitle: string } {
  return PAGE_META[path] ?? PAGE_META["/admin"];
}

/* ------------------------------ small pieces ------------------------------ */

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandLogo boxClassName="h-9 w-9 rounded-lg bg-primary text-primary-foreground shadow-sm" iconClassName="h-5 w-5" />
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">TaskEarn</span>
        <Badge variant="destructive" className="px-1.5 py-0 text-[10px] font-semibold tracking-wide">
          ADMIN
        </Badge>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="text-muted-foreground"
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" aria-hidden="true" /> : <Moon className="h-[18px] w-[18px]" aria-hidden="true" />}
    </Button>
  );
}

/** Light poll of admin stats for the pending badges (shared cache with Overview). */
function usePendingCounts(): { payouts?: number; deposits?: number; support?: number } {
  const { data } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => apiFetch<AdminStatsDTO>("/api/admin/stats"),
    refetchInterval: 15_000,
  });
  return {
    payouts: data?.pendingPayoutsCount,
    deposits: data?.pendingDepositsCount,
    // REAL per-message unread count: individual member messages an admin has
    // not opened yet (decrements per message seen, hides at 0).
    support: data?.unseenSupportCount,
  };
}

function NavList({
  path,
  onSelect,
}: {
  path: string;
  onSelect?: (to: string) => void;
}) {
  const pending = usePendingCounts();
  const badgeFor = (itemPath: string): number | undefined => {
    if (itemPath === "/admin/withdrawals") return pending.payouts;
    if (itemPath === "/admin/deposits") return pending.deposits;
    if (itemPath === "/admin/support") return pending.support;
    return undefined;
  };
  return (
    <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:thin]">
      {NAV_GROUPS.map((group, gi) => (
        <div key={group.label} className={gi > 0 ? "mt-4" : undefined}>
          <p
            aria-hidden="true"
            className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70"
          >
            {group.label}
          </p>
          <ul className="flex flex-col gap-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = path === item.path;
              const badge = badgeFor(item.path);
              const showPending = badge !== undefined && badge > 0;
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(item.path)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      active
                        ? "bg-sidebar-accent text-primary"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                    )}
                  >
                    {/* left active indicator */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-1/2 -left-3 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                    {showPending ? (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center gap-1 rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">
                        {badge}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserCard({ onSelect, compact = false }: { onSelect?: (to: string) => void; compact?: boolean }) {
  const { user, logout } = useSession();
  const name = user?.name ?? "Admin";
  const email = user?.email ?? "";

  return (
    <div className={cn("p-3", compact && "p-2")}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open account menu"
            className={cn(
              "flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-sidebar-accent/60",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback className="bg-primary/15 text-[13px] font-semibold text-primary">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-sidebar-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as admin</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSelect?.("/dashboard")}>
            <ExternalLink aria-hidden="true" />
            View user site
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelect?.("/")}>
            <Coins aria-hidden="true" />
            Back to landing
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              void logout();
            }}
          >
            <LogOut aria-hidden="true" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ------------------------------ logout row ------------------------------- */

/**
 * Dedicated visible Log out row at the very bottom of the admin sidebar.
 * Reuses the EXISTING auth system end-to-end: POST /api/auth/logout (the
 * shared httpOnly-cookie session route) → invalidate the session query cache
 * → land on the existing login page. Server-side requireAdmin() keeps every
 * protected admin route protected after the cookie is gone.
 */
function LogoutRow() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* the cookie may already be gone — clearing client state still logs out */
    }
    await queryClient.invalidateQueries();
    navigateTo("/login");
    setBusy(false);
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handleLogout()}
      className={cn(
        "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        busy && "cursor-wait opacity-70",
      )}
    >
      {busy ? (
        <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      )}
      <span>{busy ? "Signing out…" : "Log out"}</span>
    </button>
  );
}

/** Sidebar footer: the signed-in admin card + the visible Log out row. */
function SidebarFooter({ onSelect }: { onSelect?: (to: string) => void }) {
  return (
    <div className="border-t border-sidebar-border">
      <UserCard onSelect={onSelect} />
      <div className="px-3 pb-3">
        <div className="mb-1 h-px bg-sidebar-border" aria-hidden="true" />
        <LogoutRow />
      </div>
    </div>
  );
}

/* --------------------------------- sidebar -------------------------------- */

function DesktopSidebar({ path }: { path: string }) {
  const { navigate } = useHashRoute();
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
      <div className="flex h-16 items-center px-5">
        <BrandMark />
      </div>
      <div className="h-px bg-sidebar-border" aria-hidden="true" />
      <NavList path={path} onSelect={navigate} />
      <SidebarFooter onSelect={navigate} />
    </aside>
  );
}

/* --------------------------------- topbar --------------------------------- */

function MobileTopbar({ path, onOpenMenu }: { path: string; onOpenMenu: () => void }) {
  const meta = pageMeta(path);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden">
      <Button variant="ghost" size="icon" aria-label="Open navigation menu" onClick={onOpenMenu}>
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{meta.title}</p>
        <p className="truncate text-[11px] leading-tight text-muted-foreground">{meta.subtitle}</p>
      </div>
      <ThemeToggle />
    </header>
  );
}

function MobileNavSheet({ open, onOpenChange, path }: { open: boolean; onOpenChange: (v: boolean) => void; path: string }) {
  const { navigate } = useHashRoute();
  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-72 border-sidebar-border bg-sidebar p-0 [&>button]:text-sidebar-foreground"
      >
        <SheetHeader className="h-16 justify-center border-b border-sidebar-border px-5 py-0">
          <SheetTitle asChild>
            <div>
              <BrandMark />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">Admin navigation menu</SheetDescription>
        </SheetHeader>
        <div className="flex h-[calc(100vh-4rem)] flex-col">
          <NavList path={path} onSelect={go} />
          <SidebarFooter onSelect={go} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* --------------------------------- shell ---------------------------------- */

export function AdminShell() {
  const { path } = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  // Legacy alias: the Task 16 gateways settings page was superseded by the
  // dynamic Payment Methods manager — keep the old hash route working.
  const effectivePath = path === "/admin/settings/gateways" ? "/admin/payment-methods" : path;

  const view = (() => {
    switch (effectivePath) {
      case "/admin/home": // legacy alias for the spec path
      case "/admin/home-settings":
        return <HomeSettingsView />;
      case "/admin/promo-banners":
        return <PromoBannersView />;
      case "/admin/invite":
        return <InviteSettingsView />;
      case "/admin/notifications":
        return <NotificationsView />;
      case "/admin/support":
        return <SupportView />;
      case "/admin/branding":
        return <BrandingView />;
      case "/admin/payment-methods":
        return <PaymentMethodsView />;
      case "/admin/settings":
        return <SettingsView />;
      case "/admin/deposits":
        return <DepositsView />;
      case "/admin/plans":
        return <PlansView />;
      case "/admin/packages":
        return <AdminPackagesView />;
      case "/admin/tasks":
        return <AdminTasksView />;
      case "/admin/withdrawals":
        return <WithdrawalsView />;
      case "/admin/transactions":
        return <TransactionsView />;
      case "/admin/users":
        return <UsersView />;
      case "/admin/supabase":
        return <SupabaseView />;
      default:
        return <AdminOverviewView />;
    }
  })();

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <DesktopSidebar path={effectivePath} />
      <MobileTopbar path={effectivePath} onOpenMenu={() => setMenuOpen(true)} />
      <MobileNavSheet open={menuOpen} onOpenChange={setMenuOpen} path={effectivePath} />
      <div className="lg:pl-60">
        <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
          {/* desktop page header + theme toggle */}
          <div className="mb-6 hidden items-end justify-between lg:flex">
            {(() => {
              const meta = pageMeta(effectivePath);
              return (
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{meta.subtitle}</p>
                </div>
              );
            })()}
            <ThemeToggle />
          </div>
          <main id="main-content" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={effectivePath}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                {view}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
}
