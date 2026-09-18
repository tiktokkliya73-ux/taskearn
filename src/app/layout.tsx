import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TaskEarn — Earn Daily Rewards for Simple Tasks",
  description:
    "TaskEarn is a daily task rewards platform. Complete tasks, earn VIP rewards, invite friends and cash out via EasyPaisa, JazzCash or USDT.",
  keywords: ["TaskEarn", "tasks", "rewards", "earn online", "referral", "EasyPaisa", "JazzCash"],
  authors: [{ name: "TaskEarn" }],
  // Default browser-tab icon (shipped in /public). Once an admin uploads a
  // custom favicon at /admin/branding, the dynamic favicon in
  // src/components/branding.tsx takes over at runtime.
  icons: { icon: [{ url: "/logo.svg", type: "image/svg+xml" }] },
  openGraph: {
    title: "TaskEarn — Earn Daily Rewards",
    description: "Complete daily tasks, unlock rewards and cash out.",
    siteName: "TaskEarn",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
