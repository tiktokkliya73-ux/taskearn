"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { motion, useInView } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Crown,
  LayoutDashboard,
  ListChecks,
  Shield,
  ShieldCheck,
  Split,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/components/providers";
import { BrandLogo } from "@/components/branding";
import { PayoutsTicker } from "@/components/landing/payouts-ticker";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { useCountUp } from "@/components/landing/count-up";
import { apiFetch } from "@/lib/client-api";
import { navigateTo } from "@/lib/hash-router";
import { formatCompact, formatPKR } from "@/lib/money";
import type { PlanDTO, PublicStatsDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function FadeIn({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SectionHeading({
  title,
  description,
  eyebrow,
}: {
  title: string;
  description: string;
  eyebrow?: string;
}) {
  return (
    <FadeIn className="mx-auto mb-10 max-w-2xl text-center">
      {eyebrow ? (
        <p className="mb-2 text-sm font-semibold tracking-wider text-primary uppercase">{eyebrow}</p>
      ) : null}
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-3 text-muted-foreground">{description}</p>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/* Navbar                                                              */
/* ------------------------------------------------------------------ */

function Navbar() {
  const { status, user } = useSession();
  const authed = status === "authenticated";
  const isAdmin = authed && user?.role === "admin";

  const navLinks = [
    { label: "How it works", target: "how" },
    { label: "VIP Plans", target: "plans" },
    { label: "Features", target: "features" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => scrollToId("top")}
          className="flex shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="TaskEarn home"
        >
          <BrandLogo boxClassName="size-9 rounded-xl bg-primary text-primary-foreground shadow-sm" iconClassName="size-5" />
          <span className="text-lg font-bold tracking-tight">TaskEarn</span>
        </button>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Landing sections">
          {navLinks.map((link) => (
            <a
              key={link.target}
              href={`#${link.target}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToId(link.target);
              }}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          {authed ? (
            <Button size="sm" onClick={() => navigateTo(isAdmin ? "/admin" : "/dashboard")}>
              {isAdmin ? (
                <Shield className="size-4" aria-hidden="true" />
              ) : (
                <LayoutDashboard className="size-4" aria-hidden="true" />
              )}
              {isAdmin ? "Admin" : "Dashboard"}
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => navigateTo("/login")}>
                Login
              </Button>
              <Button size="sm" onClick={() => navigateTo("/signup")}>
                Get Started
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  const { status } = useSession();
  const authed = status === "authenticated";

  return (
    <section className="relative" aria-labelledby="hero-heading">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-primary/5 [mask-image:radial-gradient(60%_60%_at_50%_0%,black,transparent)]"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
            <Users className="size-3.5 text-primary" aria-hidden="true" />
            Trusted by 12,000+ earners
          </Badge>
          <h1 id="hero-heading" className="mt-5 text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
            Turn spare minutes into <span className="text-primary">daily rewards.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Complete quick daily tasks, unlock your earnings through referrals, and cash out via EasyPaisa, JazzCash,
            or USDT.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => navigateTo(authed ? "/dashboard" : "/signup")}>
              {authed ? "Open Dashboard" : "Get Started"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => scrollToId("plans")}>
              See VIP Plans
            </Button>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" /> Secure payouts
            </li>
            <li className="flex items-center gap-2">
              <Zap className="size-4 text-primary" aria-hidden="true" /> Daily rewards
            </li>
            <li className="flex items-center gap-2">
              <Users className="size-4 text-primary" aria-hidden="true" /> Referral bonuses
            </li>
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
          className="relative"
        >
          <div className="relative overflow-hidden rounded-2xl border shadow-2xl ring-1 ring-primary/20">
            <Image
              src="/hero-illustration.png"
              alt="Person earning rewards with the TaskEarn app"
              width={576}
              height={432}
              priority
              sizes="(min-width: 1024px) 576px, 100vw"
              className="h-auto w-full"
            />
          </div>

          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-4 left-2 sm:top-10 sm:-left-7"
            aria-hidden="true"
          >
            <div className="flex items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <BadgeCheck className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-primary tabular-nums">+Rs 220</p>
                <p className="text-xs text-muted-foreground">task reward</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            className="absolute right-2 bottom-4 sm:-right-6 sm:bottom-12"
            aria-hidden="true"
          >
            <div className="flex items-center gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Users className="size-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-primary tabular-nums">+Rs 300</p>
                <p className="text-xs text-muted-foreground">referral unlocked</p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Live stats                                                          */
/* ------------------------------------------------------------------ */

interface StatConfig {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: ReactNode;
}

function StatCard({ stat, active, delay }: { stat: StatConfig; active: boolean; delay: number }) {
  const value = useCountUp(stat.value, active);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      whileHover={{ y: -3 }}
    >
      <Card className="h-full py-5">
        <CardContent className="flex flex-col gap-2 px-5">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {stat.icon}
          </span>
          <span className="text-xl font-bold tracking-tight tabular-nums sm:text-2xl lg:text-3xl">
            {stat.format(value)}
          </span>
          <span className="text-sm text-muted-foreground">{stat.label}</span>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StatsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const { data, isError } = useQuery({
    queryKey: ["public", "stats"],
    queryFn: () => apiFetch<PublicStatsDTO>("/api/public/stats"),
    refetchInterval: 15_000,
  });

  const stats: StatConfig[] = [
    { label: "Registered earners", value: data?.users ?? 0, format: formatCompact, icon: <Users className="size-5" /> },
    { label: "Total paid out", value: data?.paidOut ?? 0, format: (n) => formatPKR(n), icon: <Banknote className="size-5" /> },
    {
      label: "Tasks completed",
      value: data?.tasksCompleted ?? 0,
      format: formatCompact,
      icon: <ListChecks className="size-5" />,
    },
    { label: "Active plans", value: data?.activePlans ?? 0, format: formatCompact, icon: <Crown className="size-5" /> },
  ];

  return (
    <section ref={ref} className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6" aria-label="Platform statistics">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isError
          ? stats.map((s) => (
              <Card key={s.label} className="h-full py-5">
                <CardContent className="flex flex-col gap-2 px-5">
                  <span className="text-2xl font-bold">—</span>
                  <span className="text-sm text-muted-foreground">{s.label}</span>
                </CardContent>
              </Card>
            ))
          : stats.map((stat, i) => <StatCard key={stat.label} stat={stat} active={inView} delay={i * 0.07} />)}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* VIP plans                                                           */
/* ------------------------------------------------------------------ */

function PlansSection({ onActivate }: { onActivate: (plan: PlanDTO) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["public", "plans"],
    queryFn: () => apiFetch<{ plans: PlanDTO[] }>("/api/public/plans"),
  });

  const plans = data?.plans ?? [];
  const popularId =
    plans.find((p) => p.name.toLowerCase().includes("vip 2"))?.id ?? (plans.length > 1 ? plans[1].id : null);

  return (
    <section id="plans" className="scroll-mt-20 bg-muted/40 py-14 sm:py-20" aria-labelledby="plans-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="VIP Plans"
          title="Pick a plan, earn every day"
          description="Each plan sets how much you make per task and how many tasks you can complete daily. One-time activation, no hidden fees."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isLoading
            ? [0, 1, 2, 3].map((i) => (
                <Card key={i} className="h-full">
                  <CardHeader>
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-9 w-28" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </CardContent>
                </Card>
              ))
            : plans.map((plan, i) => (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.4, delay: i * 0.06, ease: "easeOut" }}
                  whileHover={{ y: -3 }}
                  className="h-full"
                >
                  <Card
                    className={cn(
                      "relative h-full",
                      plan.id === popularId && "border-primary shadow-md ring-1 ring-primary"
                    )}
                  >
                    {plan.id === popularId ? (
                      <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">Most Popular</Badge>
                    ) : null}
                    <CardHeader>
                      <CardTitle className="text-base">{plan.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {plan.description ?? "Daily task earning plan"}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <p className="text-3xl font-extrabold tracking-tight tabular-nums">
                          {formatPKR(plan.price)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">one-time activation</p>
                      </div>
                      <ul className="space-y-1.5 text-sm">
                        <li className="flex items-center justify-between">
                          <span className="text-muted-foreground">Per task</span>
                          <span className="font-medium tabular-nums">{formatPKR(plan.rewardPerTask)}</span>
                        </li>
                        <li className="flex items-center justify-between">
                          <span className="text-muted-foreground">Tasks per day</span>
                          <span className="font-medium tabular-nums">{plan.dailyTaskLimit}</span>
                        </li>
                        <li className="flex items-center justify-between">
                          <span className="text-muted-foreground">Duration</span>
                          <span className="font-medium">{plan.durationDays} days</span>
                        </li>
                      </ul>
                      <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2 text-sm">
                        <span className="font-medium text-primary">Daily earning</span>
                        <span className="font-bold text-primary tabular-nums">
                          {formatPKR(plan.rewardPerTask * plan.dailyTaskLimit)}
                        </span>
                      </div>
                      <Button
                        className="w-full"
                        variant={plan.id === popularId ? "default" : "outline"}
                        onClick={() => onActivate(plan)}
                      >
                        Activate Plan
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: <UserPlus className="size-5" />,
    title: "Create your free account",
    description: "Sign up in under a minute — no fees, no documents. Your referral link is ready instantly.",
  },
  {
    icon: <ListChecks className="size-5" />,
    title: "Complete daily tasks",
    description: "Activate a VIP plan, then finish short tasks each day to grow your Task Balance.",
  },
  {
    icon: <Wallet className="size-5" />,
    title: "Cash out your rewards",
    description: "Unlock earnings via referrals and withdraw to EasyPaisa, JazzCash, or USDT.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 py-14 sm:py-20" aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="Earning in three simple steps"
          description="From sign-up to cash-out, the whole flow takes minutes a day."
        />
        <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((step, i) => (
            <FadeIn key={step.title} delay={i * 0.08} className="relative">
              {i > 0 ? (
                <span
                  className="absolute top-1/2 -left-[26px] hidden -translate-y-1/2 text-muted-foreground/60 md:block"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              ) : null}
              <motion.div whileHover={{ y: -3 }} className="h-full">
                <Card className="h-full">
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                        {step.icon}
                      </span>
                      <span className="text-sm font-bold text-muted-foreground tabular-nums">0{i + 1}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold">{step.title}</h3>
                      <p className="mt-1.5 text-sm text-muted-foreground">{step.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </FadeIn>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: <Split className="size-5" />,
    title: "Dual-wallet security",
    description: "Task rewards sit in a locked balance and only move to your withdrawable balance as referrals activate — protecting payouts from abuse.",
  },
  {
    icon: <Users className="size-5" />,
    title: "Referral unlocks",
    description: "Each friend who activates a plan unlocks a fixed bonus from your Task Balance into withdrawable cash.",
  },
  {
    icon: <Zap className="size-5" />,
    title: "Instant payouts",
    description: "Withdraw to EasyPaisa, JazzCash, or USDT with fast processing and clear status tracking.",
  },
  {
    icon: <ShieldCheck className="size-5" />,
    title: "Anti-fraud protection",
    description: "IP and device fingerprint checks stop self-referrals and keep the reward pool fair for real earners.",
  },
  {
    icon: <CalendarCheck className="size-5" />,
    title: "Daily tasks",
    description: "Fresh micro-tasks every day — watch a clip, explore a page, share a link. Reset daily.",
  },
  {
    icon: <Clock className="size-5" />,
    title: "24/7 dashboard",
    description: "Track balances, task progress, referrals, and payouts live from any device.",
  },
];

function FeaturesGrid() {
  return (
    <section id="features" className="scroll-mt-20 bg-muted/40 py-14 sm:py-20" aria-labelledby="features-heading">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Features"
          title="Built for reliable earning"
          description="Everything you need to turn daily effort into withdrawable cash."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <FadeIn key={feature.title} delay={i * 0.05}>
              <motion.div whileHover={{ y: -3 }} className="h-full">
                <Card className="h-full">
                  <CardContent className="flex flex-col gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {feature.icon}
                    </span>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function Footer() {
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 md:grid-cols-3 lg:py-12">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <BrandLogo boxClassName="size-9 rounded-xl bg-primary text-primary-foreground" iconClassName="size-5" />
            <span className="text-lg font-bold tracking-tight">TaskEarn</span>
          </div>
          <p className="max-w-xs text-sm text-muted-foreground">
            Turn spare minutes into daily rewards — complete tasks, unlock earnings, cash out.
          </p>
        </div>

        <nav className="space-y-3 text-sm" aria-label="Footer">
          <h3 className="font-semibold">Quick links</h3>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <a
                href="#/"
                onClick={(e) => {
                  e.preventDefault();
                  navigateTo("/");
                }}
                className="transition-colors hover:text-foreground"
              >
                Home
              </a>
            </li>
            <li>
              <a
                href="#plans"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId("plans");
                }}
                className="transition-colors hover:text-foreground"
              >
                VIP Plans
              </a>
            </li>
            <li>
              <a
                href="#how"
                onClick={(e) => {
                  e.preventDefault();
                  scrollToId("how");
                }}
                className="transition-colors hover:text-foreground"
              >
                How it works
              </a>
            </li>
            <li>
              <a
                href="#login"
                onClick={(e) => {
                  e.preventDefault();
                  navigateTo("/login");
                }}
                className="transition-colors hover:text-foreground"
              >
                Login
              </a>
            </li>
            <li>
              <a
                href="#signup"
                onClick={(e) => {
                  e.preventDefault();
                  navigateTo("/signup");
                }}
                className="transition-colors hover:text-foreground"
              >
                Sign up
              </a>
            </li>
          </ul>
        </nav>

        <div className="space-y-3 text-sm">
          <h3 className="font-semibold">Payout methods</h3>
          <ul className="flex flex-wrap gap-2" aria-label="Supported payout methods">
            {["EasyPaisa", "JazzCash", "USDT"].map((m) => (
              <li
                key={m}
                className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"
              >
                <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>© 2025 TaskEarn. All rights reserved.</p>
          <p>Demo platform — no real payments.</p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function LandingPage() {
  const { status } = useSession();
  const authed = status === "authenticated";

  function handleActivate(plan: PlanDTO) {
    if (authed) {
      // Multi-step checkout: send signed-in visitors straight into Step 1.
      navigateTo(`/dashboard/checkout/plan/${plan.id}`);
    } else {
      navigateTo("/signup");
    }
  }

  return (
    <div id="top" className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <StatsSection />
        <PayoutsTicker />
        <PlansSection onActivate={handleActivate} />
        <HowItWorks />
        <FeaturesGrid />
      </main>
      <Footer />
    </div>
  );
}
