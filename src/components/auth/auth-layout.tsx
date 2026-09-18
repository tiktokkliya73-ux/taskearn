"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandLogo } from "@/components/branding";
import { navigateTo } from "@/lib/hash-router";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Shared shell for all auth views: centered card on a soft emerald glow,
 * TaskEarn logo on top, back-to-home link, optional footer link row.
 */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* subtle emerald radial tint */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-48 -right-24 h-96 w-96 rounded-full bg-primary/5 blur-3xl"
      />

      <a
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          navigateTo("/");
        }}
        className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:top-6 sm:left-6"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to home
      </a>

      <div className="relative grid min-h-screen place-items-center px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="w-11/12 max-w-md"
        >
          <div className="mb-6 flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => navigateTo("/")}
              aria-label="TaskEarn home"
              className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Same existing logo asset with the existing premium glow /
                  ring / shine treatment used on the member Home header —
                  nothing about the artwork itself changes. */}
              <BrandLogo
                premium
                boxClassName="size-12 rounded-full bg-primary text-primary-foreground shadow-sm"
                iconClassName="size-6"
              />
              <span className="text-xl font-bold tracking-tight">TaskEarn</span>
            </button>
          </div>

          <Card className="border-border/80 shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{title}</CardTitle>
              <CardDescription>{subtitle}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
            {footer ? (
              <div className="border-t px-6 py-4 text-center text-sm text-muted-foreground">{footer}</div>
            ) : null}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
