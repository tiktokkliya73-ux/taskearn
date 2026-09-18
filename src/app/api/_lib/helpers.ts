import type { InvestmentPackage, Notification, Plan, Task, User, UserPackage, Wallet } from "@prisma/client";
import { db } from "@/lib/db";
import { WELCOME_POPUP_FREQUENCIES } from "@/lib/types";
import type {
  AdminUserDTO,
  AdminUsersPayloadDTO,
  NotificationDTO,
  PackageDTO,
  PlanDTO,
  Role,
  SessionUser,
  TaskDTO,
  UserPackageDTO,
  WalletData,
} from "@/lib/types";

/**
 * Shared serialization + small coercion helpers for API routes.
 * Private folder (leading underscore) — excluded from Next.js routing.
 */

/**
 * Map a user row (Prisma `User` or the shared `AppUser`) to the SessionUser
 * DTO. `createdAt` accepts both Date objects (Prisma) and ISO strings
 * (Supabase PostgREST rows).
 */
export function toSessionUser(user: {
  id: string;
  name: string;
  email: string;
  role: string;
  isBanned: boolean;
  referralCode: string;
  createdAt: Date | string;
}): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    isBanned: user.isBanned,
    referralCode: user.referralCode,
    createdAt:
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : new Date(user.createdAt).toISOString(),
  };
}

export function toWalletData(wallet: Wallet): WalletData {
  return { taskBalance: wallet.taskBalance, withdrawableBalance: wallet.withdrawableBalance };
}

export function toPlanDTO(plan: Plan): PlanDTO {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    rewardPerTask: plan.rewardPerTask,
    dailyTaskLimit: plan.dailyTaskLimit,
    durationDays: plan.durationDays,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
  };
}

export function toTaskDTO(task: Task): TaskDTO {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    url: task.url,
    durationSeconds: task.durationSeconds,
    rewardAmount: task.rewardAmount,
    planId: task.planId,
    isActive: task.isActive,
    sortOrder: task.sortOrder,
  };
}

export function toPackageDTO(pkg: InvestmentPackage): PackageDTO {
  return {
    id: pkg.id,
    title: pkg.title,
    description: pkg.description,
    price: pkg.price,
    dailyEarning: pkg.dailyEarning,
    durationDays: pkg.durationDays,
    totalReturn: pkg.totalReturn,
    netProfit: pkg.netProfit,
    isActive: pkg.isActive,
    sortOrder: pkg.sortOrder,
  };
}

export function toUserPackageDTO(
  up: UserPackage & { pkg?: Pick<InvestmentPackage, "title" | "dailyEarning"> | null }
): UserPackageDTO {
  return {
    id: up.id,
    packageId: up.packageId,
    packageTitle: up.pkg?.title ?? "Package",
    investAmount: up.investAmount,
    // The package row is the source of truth: show its CURRENT admin-configured
    // dailyEarning (the instance's snapshot is only a fallback for deleted
    // packages), so an Admin edit is reflected here without touching the user.
    dailyEarning: up.pkg?.dailyEarning ?? up.dailyEarning,
    status: up.status === "completed" ? "completed" : "active",
    lastEarningDate: up.lastEarningDate,
    startedAt: up.startedAt.toISOString(),
    endsAt: up.endsAt.toISOString(),
  };
}

export function safeParseMeta(meta: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(meta ?? "{}");
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export const PAYMENT_METHODS = ["easypaisa", "jazzcash", "usdt"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function asPaymentMethod(v: unknown): PaymentMethod | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (PAYMENT_METHODS as readonly string[]).includes(s) ? (s as PaymentMethod) : null;
}

// Type predicate asserts the http(s) URL subtype (not plain `string`) so the
// false-branch keeps the original string type instead of narrowing to `never`.
export function isHttpUrl(v: unknown): v is `http://${string}` | `https://${string}` {
  return typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"));
}

/**
 * Admin-uploaded branding / payment-method images: either an http(s) URL or a
 * re-encoded data:image URL produced by the client canvas pipeline (JPG, PNG
 * or WEBP only — the canvas round-trip guarantees the payload is a real image,
 * never an executable or polyglot). Capped at ~350 KB so a row stays lean.
 */
export const IMAGE_DATA_URL_MAX_CHARS = 350_000;
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;

export function isImageSourceUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (s.startsWith("http://") || s.startsWith("https://")) return true;
  return s.length <= IMAGE_DATA_URL_MAX_CHARS && IMAGE_DATA_URL_RE.test(s);
}

/**
 * Login-welcome-popup promotional image: same source rules as branding
 * images but with a larger budget — full-screen promo art may legitimately
 * need more pixels than a 256px logo (~375 KB binary after the canvas
 * re-encode, still far below any row/payload limit).
 */
export const POPUP_IMAGE_DATA_URL_MAX_CHARS = 500_000;

export function isPopupImageSourceUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  if (s.startsWith("http://") || s.startsWith("https://")) return true;
  return s.length <= POPUP_IMAGE_DATA_URL_MAX_CHARS && IMAGE_DATA_URL_RE.test(s);
}

/**
 * Validate one home_welcome_popup_* setting value coming from an admin
 * settings update. Returns a human-readable error message, or null when the
 * value is acceptable. Used identically by the local and Supabase admin
 * routes BEFORE anything is persisted.
 */
export function validateWelcomePopupSettingValue(key: string, value: string): string | null {
  const v = value.trim();
  switch (key) {
    case "home_welcome_popup_enabled":
      if (v !== "true" && v !== "false") return "Popup enable flag must be true or false.";
      return null;
    case "home_welcome_popup_image":
      if (v && !isPopupImageSourceUrl(v)) {
        return (
          "Popup image must be an uploaded image file (JPG, PNG or WEBP — optimized " +
          "to under ~375 KB) or an http(s) image URL."
        );
      }
      return null;
    case "home_welcome_popup_frequency":
      if (!(WELCOME_POPUP_FREQUENCIES as readonly string[]).includes(v)) {
        return "Display frequency must be every_login, once_per_session or once_per_day.";
      }
      return null;
    case "home_welcome_popup_button_link":
      if (v && !isHttpUrl(v) && !(v.startsWith("/") && !v.startsWith("//"))) {
        return "Button link must be an internal /dashboard… route or a full http(s) URL.";
      }
      return null;
    case "home_welcome_popup_title":
      if (v.length > 120) return "Popup title must be 120 characters or fewer.";
      return null;
    case "home_welcome_popup_description":
      if (v.length > 600) return "Popup description must be 600 characters or fewer.";
      return null;
    case "home_welcome_popup_button_text":
      if (v.length > 60) return "Button text must be 60 characters or fewer.";
      return null;
    default:
      return null;
  }
}

/**
 * Validate one home_header_* setting value coming from an admin settings
 * update (the Home brand block: strong title + muted tagline). Returns a
 * human-readable error message, or null when the value is acceptable.
 * Used identically by the local and Supabase admin routes.
 */
export function validateHomeHeaderSettingValue(key: string, value: string): string | null {
  const v = value.trim();
  switch (key) {
    case "home_header_title":
      if (v.length > 60) return "Header title must be 60 characters or fewer.";
      return null;
    case "home_header_tagline":
      if (v.length > 120) return "Header tagline must be 120 characters or fewer.";
      return null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Channel visit-reward URLs (WhatsApp / Telegram)                     */
/* ------------------------------------------------------------------ */

/**
 * Admin-entered WhatsApp / Telegram channel links are the ONLY external URLs
 * the member "Join Channel" buttons may open, so they get format validation:
 * empty (task simply not configured) or an http(s) URL on an official
 * WhatsApp / Telegram host. Executable schemes (javascript:, data:, …) and
 * arbitrary hosts can never reach the member UI.
 */
const WHATSAPP_LINK_HOSTS = new Set([
  "whatsapp.com",
  "www.whatsapp.com",
  "chat.whatsapp.com",
  "www.chat.whatsapp.com",
  "wa.me",
  "www.wa.me",
]);
const TELEGRAM_LINK_HOSTS = new Set([
  "t.me",
  "www.t.me",
  "telegram.me",
  "www.telegram.me",
]);

export function validateChannelLinkSettingValue(
  key: "home_whatsapp_url" | "home_telegram_url",
  value: string,
): string | null {
  const v = value.trim();
  if (!v) return null; // not configured yet — allowed, member UI shows a calm unavailable state
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return "Enter a full channel URL (https://…).";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Only http(s) channel links are allowed — javascript:/data: style values are rejected.";
  }
  const host = url.hostname.toLowerCase();
  const isWhatsapp = key === "home_whatsapp_url";
  const allowed = isWhatsapp ? WHATSAPP_LINK_HOSTS : TELEGRAM_LINK_HOSTS;
  if (!allowed.has(host)) {
    return isWhatsapp
      ? "Use a WhatsApp channel link: https://whatsapp.com/channel/… , https://chat.whatsapp.com/… or https://wa.me/…"
      : "Use a Telegram channel link: https://t.me/… or https://telegram.me/…";
  }
  return null;
}

/** Coerce to integer; null when not an integer. */
export function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** Days remaining on a plan (>= 0), rounded up. */
export function daysLeft(expiresAt: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
}

export function toNotificationDTO(n: Notification): NotificationDTO {
  return {
    id: n.id,
    title: n.title,
    message: n.message,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Latest admin broadcasts for the member bell (bounded — newest first). */
export async function fetchRecentNotifications(take = 5): Promise<NotificationDTO[]> {
  const rows = await db.notification.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(toNotificationDTO);
}

export const ADMIN_USERS_PAGE_SIZE = 25;
export const ADMIN_USERS_MAX_PAGE_SIZE = 100;

/**
 * Paginated admin user list — server-side search (name/email), status filter
 * and paging so the panel stays fast at any member count. `bannedTotal` is
 * computed for the whole searched set (ignores the status filter) so the
 * header summary stays honest while filtering.
 */
export async function fetchAdminUsersPage(opts: {
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminUsersPayloadDTO> {
  const query = (opts.q ?? "").trim();
  const status = opts.status === "active" || opts.status === "banned" ? opts.status : "all";

  const pageSize = Math.min(
    Math.max(1, Math.trunc(opts.pageSize ?? ADMIN_USERS_PAGE_SIZE)),
    ADMIN_USERS_MAX_PAGE_SIZE,
  );
  const page = Math.max(1, Math.trunc(opts.page ?? 1));

  const qWhere = query
    ? { OR: [{ name: { contains: query } }, { email: { contains: query } }] }
    : {};
  const where =
    status === "all" ? qWhere : { ...qWhere, isBanned: status === "banned" };

  const [total, bannedTotal, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.count({ where: { ...qWhere, isBanned: true } }),
    db.user.findMany({
      where,
      include: {
        wallet: true,
        userPlans: {
          where: { status: "active", expiresAt: { gt: new Date() } },
          include: { plan: { select: { name: true } } },
          orderBy: { startedAt: "desc" },
        },
        userPackages: {
          where: { status: "active", endsAt: { gt: new Date() } },
          include: { pkg: { select: { title: true } } },
          orderBy: { startedAt: "desc" },
        },
        _count: { select: { referrals: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const users: AdminUserDTO[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    isBanned: u.isBanned,
    ipAddress: u.ipAddress,
    fingerprint: u.fingerprint,
    taskBalance: u.wallet?.taskBalance ?? 0,
    withdrawableBalance: u.wallet?.withdrawableBalance ?? 0,
    activePlanName: u.userPlans[0]?.plan.name ?? null,
    // Active package titles resolved from the LIVE package rows — the same
    // source of truth that drives each member's daily earning.
    activePackages: u.userPackages.map((up) => up.pkg?.title ?? "Package"),
    referralCount: u._count.referrals,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
  }));

  return {
    users,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    bannedTotal,
  };
}
