/**
 * Shared DTO types — binding contract between API routes and frontend views.
 * All money amounts are integers in PKR.
 */

export type Role = "user" | "admin";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isBanned: boolean;
  referralCode: string;
  createdAt: string;
}

export interface WalletData {
  taskBalance: number;
  withdrawableBalance: number;
}

export interface PlanDTO {
  id: string;
  name: string;
  description: string | null;
  price: number;
  rewardPerTask: number;
  dailyTaskLimit: number;
  durationDays: number;
  isActive: boolean;
  sortOrder: number;
}

export interface TaskDTO {
  id: string;
  title: string;
  description: string | null;
  url: string;
  durationSeconds: number;
  /** Admin-set PKR reward override — null = use the member's plan rewardPerTask. */
  rewardAmount: number | null;
  /** Target investment plan — tasks with a planId are only listed to members whose active plan matches. null = all plans. */
  planId: string | null;
  isActive: boolean;
  sortOrder: number;
}

/* ─── Investment Packages (dynamic engine) ───────────────────────────── */

export interface PackageDTO {
  id: string;
  title: string;
  /** Admin-editable marketing blurb rendered in the checkout summary. */
  description: string | null;
  price: number;
  dailyEarning: number;
  durationDays: number;
  totalReturn: number;
  netProfit: number;
  isActive: boolean;
  sortOrder: number;
}

export interface UserPackageDTO {
  id: string;
  packageId: string;
  packageTitle: string;
  investAmount: number;
  dailyEarning: number;
  status: "active" | "completed";
  lastEarningDate: string | null;
  startedAt: string;
  endsAt: string;
}

export interface PackagesResponseDTO {
  packages: PackageDTO[];
  myPackages: UserPackageDTO[];
  totals: {
    activeCount: number;
    dailyIncome: number;
    investedTotal: number;
    earnedTotal: number;
  };
}

export interface PurchasePackageResponseDTO {
  transaction: TransactionDTO;
  wallet: WalletData;
  userPackage: UserPackageDTO;
}

/** Response of POST /api/packages/checkout — an external payment request. */
export interface PackageCheckoutResponseDTO {
  transaction: TransactionDTO;
}

/* ─── Payment Methods (admin-managed, 100% dynamic) ────────────── */

export interface PaymentMethodDTO {
  id: string;
  name: string;
  accountNumber: string;
  accountTitle: string | null;
  instructions: string | null;
  /** Optional logo / QR image URL (http/https) shown in checkout. */
  logoUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Response of GET /api/public/payment-methods (active rows only). */
export interface PaymentMethodsResponseDTO {
  methods: PaymentMethodDTO[];
  /** Mirror of the require_payment_proof setting — screenshots mandatory when true. */
  requireProof: boolean;
  /** Admin-uploaded Wallet Balance method image (branding setting; null = default icon). */
  walletImageUrl: string | null;
}

/** Response of GET /api/public/branding — centralized site branding. */
export interface BrandingResponseDTO {
  siteTitle: string;
  /** Admin-uploaded website logo (http/data URL); null = default mark. */
  logoUrl: string | null;
  /** Admin-uploaded favicon (http/data URL); null = default. */
  faviconUrl: string | null;
}

/** Response of GET /api/admin/payment-methods (all rows). */
export interface AdminPaymentMethodsResponseDTO {
  methods: PaymentMethodDTO[];
}

/* ─── Withdrawal Methods (admin-managed Withdraw page dropdown) ── */

/**
 * A payout channel shown in the Withdraw page dropdown. `kind` drives the
 * member payout field: 'wallet' → Account / Mobile Number, 'bank' → Bank
 * Account Number. The channel set is fixed (the seven payout channels);
 * the admin manages each channel's logo, order and enable state.
 */
export interface WithdrawalMethodDTO {
  id: string;
  name: string;
  kind: "wallet" | "bank";
  /** Optional admin-uploaded logo image (http/data URL); null = default icon. */
  logoUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}

/** Response of GET /api/public/withdrawal-methods (active channels only). */
export interface WithdrawalMethodsResponseDTO {
  methods: WithdrawalMethodDTO[];
}

/** Response of GET /api/admin/withdrawal-methods (all channels). */
export interface AdminWithdrawalMethodsResponseDTO {
  methods: WithdrawalMethodDTO[];
}

/** Response of GET /api/payments — the signed-in member's payment requests. */
export interface PaymentHistoryResponseDTO {
  payments: TransactionDTO[];
}

export interface DailyEarningsSummaryDTO {
  date: string;
  usersCredited: number;
  packagesCredited: number;
  packagesCompleted: number;
  totalCredited: number;
  alreadyRan: boolean;
  details: { userId: string; userName: string; packages: number; total: number }[];
}

export type TransactionType =
  | "task_reward"
  | "referral_unlock"
  | "referral_commission"
  | "deposit"
  | "withdrawal"
  | "adjustment"
  | "plan_purchase"
  | "package_purchase"
  | "daily_earning"
  | "promo_reward";

export type TransactionStatus =
  | "pending"
  | "completed"
  | "approved"
  | "rejected"
  | "blocked";

export interface TransactionDTO {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  relatedUserId?: string | null;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  description: string;
  meta: Record<string, unknown>;
  /** True when the raw meta carried a payment-proof screenshot (Task 16);
   * the image itself is only served through the admin proof endpoint. */
  hasProof?: boolean;
  createdAt: string;
  processedAt?: string | null;
}

export interface ActivePlanDTO {
  name: string;
  rewardPerTask: number;
  dailyLimit: number;
  completedToday: number;
  daysLeft: number;
  startedAt: string;
  expiresAt: string;
}

/** Admin-authored broadcast shown in the member dashboard bell. */
export interface NotificationDTO {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

/* ─── Member Support Tickets (simple member → admin help channel) ── */

export type SupportTicketStatus = "open" | "in_progress" | "resolved" | "closed";

/** One member-submitted support request with the admin's optional reply. */
export interface SupportTicketDTO {
  id: string;
  userId: string;
  /** Present on admin-listed tickets; never exposed for other members. */
  userName?: string;
  userEmail?: string;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  reply: string | null;
  repliedAt?: string | null;
  /** Admin-side (admin list only): null = the member's message is still UNSEEN. */
  adminSeenAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response of GET /api/support — the member's OWN tickets, newest first. */
export interface SupportListResponseDTO {
  tickets: SupportTicketDTO[];
}

export interface DashboardDTO {
  user: SessionUser;
  wallet: WalletData;
  activePlan: ActivePlanDTO | null;
  referrals: { total: number; activated: number; unlockedTotal: number };
  pendingWithdrawals: number;
  recentTransactions: TransactionDTO[];
  /** Latest admin broadcasts — delivered through the notification bell. */
  notifications: NotificationDTO[];
}

export interface TaskWithStatusDTO {
  task: TaskDTO;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TasksResponseDTO {
  plan: { name: string; rewardPerTask: number; dailyLimit: number; completedToday: number; daysLeft: number } | null;
  tasks: TaskWithStatusDTO[];
  canCompleteMore: boolean;
}

/* ─── Daily Package Tasks (Ads → Daily Tasks flow) ─────────────────── */

/**
 * The ONE daily task card on the Ads page, generated from the member's
 * applicable ACTIVE investment-package instance (highest admin-configured
 * dailyEarning). `reward` is the package's CURRENT admin-configured
 * dailyEarning — an Admin edit applies immediately.
 */
export interface PackageTaskCardDTO {
  /** The UserPackage instance id (the task's claim identity). */
  id: string;
  packageId: string;
  packageTitle: string;
  /** PKR paid on claim — the package's CURRENT admin-configured dailyEarning. */
  reward: number;
  /** True when today's task was already claimed (any package) or credited by the nightly run. */
  claimedToday: boolean;
  /** Server-registered countdown start for today's attempt, if any. */
  startedAt: string | null;
  endsAt: string;
}

/** Response of GET /api/package-tasks. */
export interface PackageTasksResponseDTO {
  tasks: PackageTaskCardDTO[];
  /** The admin-configured task content (first active Task row) — null when none is configured. */
  content: TaskDTO | null;
}

/** Response of POST /api/package-tasks/start. */
export interface PackageTaskStartResponseDTO {
  startedAt: string;
}

/** Response of POST /api/package-tasks/complete. */
export interface PackageTaskClaimResponseDTO {
  wallet: WalletData;
  reward: number;
}

export interface ReferralListDTO {
  id: string;
  name: string;
  joinedAt: string;
  planActivated: boolean;
  planName: string | null;
}

/** One admin-configured Cash Rewards Level on the Invite page. */
export interface InviteRewardLevelDTO {
  /** 1-based display order (ascending by required amount). */
  level: number;
  /** Team investment (PKR) required to unlock the level. */
  required: number;
  /** Cash reward amount (PKR) displayed for the level. */
  reward: number;
}

export interface ReferralsResponseDTO {
  code: string;
  stats: { total: number; activated: number; pending: number; unlockedTotal: number };
  list: ReferralListDTO[];
  /**
   * Invite page payload (Task 25): real team statistics + the admin-configured
   * commission / Cash Rewards Levels / informational texts (rendered with the
   * live commission percentage). Team statistics come from the EXISTING
   * referral + team-investment business logic — never client-calculated.
   */
  invite: {
    commissionPercent: number;
    commissionText: string;
    teamMembers: number;
    /** Qualifying team investment — the same business definition the Home Team Leader widget uses. */
    teamDeposits: number;
    /** Total referral commission earned through the existing referral system. */
    referralCommission: number;
    levels: InviteRewardLevelDTO[];
    howItWorks: string[];
    policy: string[];
  };
}

/** GET/POST /api/admin/invite — the raw admin-editable Invite page settings. */
export interface AdminInviteResponseDTO {
  settings: Record<string, string>;
}

export interface WalletResponseDTO {
  wallet: WalletData;
  transactions: TransactionDTO[];
}

/**
 * GET /api/wallet/referral-credits — READ-ONLY presentation feed for the
 * one-time earning celebration. `credits` are `referral_commission` rows
 * the EXISTING commission system already created (newest first, capped);
 * `wallet` is a fresh snapshot taken in the same read. Nothing is ever
 * written, recalculated or re-derived by this endpoint.
 */
export interface ReferralCreditsResponseDTO {
  wallet: WalletData;
  credits: TransactionDTO[];
}

/* ─── Profile: dedicated history + account pages ─────────────────── */

/** GET /api/wallet/withdrawals — the member's payout requests (type=withdrawal). */
export interface WithdrawalsResponseDTO {
  withdrawals: TransactionDTO[];
}

/** GET /api/auth/recovery-email — the member's saved recovery contact. */
export interface RecoveryEmailResponseDTO {
  recoveryEmail: string | null;
}

/** POST /api/auth/change-password | /api/auth/recovery-email acknowledgement. */
export interface AccountActionResponseDTO {
  ok: true;
  recoveryEmail?: string | null;
}

/* ─── Dynamic Home Page (admin-driven widgets + promo claims) ─────── */

export interface HomeResponseDTO {
  /** Brand block shown at the top of the Home screen (admin-managed). */
  header: {
    title: string;
    tagline: string;
  };
  announcementUr: string;
  announcementEn: string;
  luckyDrawDate: string | null; // YYYY-MM-DD
  teamLeader: {
    targetAmount: number;
    applyEnabled: boolean;
    teamInvestment: number;
  };
  teamSalary: { text: string; link: string; image: string };
  stats: {
    totalEarnings: number;
    todayTaskEarning: number;
    referralEarnings: number;
  };
  promo: { activePromoAvailable: boolean };
  social: { whatsappUrl: string; telegramUrl: string };
  /** Visit-channel reward tasks: open channel → return → claim once. */
  whatsapp: { rewardAmount: number; claimed: boolean; enabled: boolean };
  telegram: { rewardAmount: number; claimed: boolean; enabled: boolean };
}

/* ------------------------------------------------------------------ */
/* Login welcome popup (admin-managed promotional image popup)         */
/* ------------------------------------------------------------------ */

/** How often the Login Welcome Popup may re-appear for the same member. */
export const WELCOME_POPUP_FREQUENCIES = [
  "every_login",
  "once_per_session",
  "once_per_day",
] as const;
export type WelcomePopupFrequency = (typeof WELCOME_POPUP_FREQUENCIES)[number];

/** GET /api/home/welcome-popup — sanitized member-facing popup config. */
export interface WelcomePopupDTO {
  /** Server-forced false when the popup is disabled or no valid image is set. */
  enabled: boolean;
  /** Admin-uploaded promotional image (canvas-re-encoded data URL) or http(s) URL. */
  imageUrl: string;
  /** Optional headline shown under the image ("" = hidden). */
  title: string;
  /** Optional supporting text under the title ("" = hidden). */
  description: string;
  /** Optional CTA label ("" = no button). */
  buttonText: string;
  /** Internal /dashboard… route or a full http(s) URL ("" = none). */
  buttonLink: string;
  frequency: WelcomePopupFrequency;
}

export interface PromoClaimResponseDTO {
  reward: number;
  title: string;
  code: string;
}

/* ------------------------------------------------------------------ */
/* Promotional banners (admin-managed premium overlay carousel)         */
/* ------------------------------------------------------------------ */

/** GET /api/home/promo-banners — one ACTIVE admin-managed promotional banner
 *  (sanitized server-side; inactive banners never reach members). */
export interface PromoBannerDTO {
  id: string;
  /** Admin-uploaded promotional image (canvas-re-encoded data URL) or http(s) URL. */
  imageUrl: string;
  /** Optional headline ("" = image-only presentation). */
  title: string;
  /** Optional CTA label ("" = no button). */
  ctaText: string;
  /** Internal /dashboard… route or a full http(s) URL ("" = none). */
  ctaLink: string;
}

/** Full admin-side banner record (includes inactive banners). */
export interface AdminPromoBannerDTO {
  id: string;
  image: string;
  title: string;
  ctaText: string;
  ctaLink: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/admin/promo-banners — every banner in display order. */
export interface AdminPromoBannersResponseDTO {
  banners: AdminPromoBannerDTO[];
}

/** Admin mutation input for POST /api/admin/promo-banners (image required on create). */
export interface PromoBannerInput {
  image?: string;
  title?: string;
  ctaText?: string;
  ctaLink?: string;
  isActive?: boolean;
}

/** One admin action sent to POST /api/admin/promo-banners. */
export interface PromoBannerAction {
  action: "create" | "update" | "delete" | "reorder";
  id?: string;
  banner?: PromoBannerInput;
  /** Ordered id list for the "reorder" action. */
  ids?: string[];
}

export interface AdminPromoCodeDTO {
  id: string;
  code: string;
  title: string;
  rewardAmount: number;
  maxUses: number | null;
  usedCount: number;
  claimsCount: number;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
}

export interface AdminHomeResponseDTO {
  settings: Record<string, string>; // home_* keys only
  promoCodes: AdminPromoCodeDTO[];
  telegramReward: number; // live setting (authoritative for the system row)
  whatsappReward: number; // live setting (authoritative for the system row)
}

export interface UnlockResult {
  amount: number;
  blocked: boolean;
  inviterName: string;
}

export interface ActivatePlanResponseDTO {
  transaction: TransactionDTO;
  activated: boolean;
  unlock: UnlockResult | null;
}

export interface PayoutDTO {
  id: string;
  name: string; // masked e.g. "Al***"
  amount: number;
  method: string;
  at: string;
}

export interface PublicStatsDTO {
  users: number;
  paidOut: number;
  tasksCompleted: number;
  activePlans: number;
}

export interface GatewaysDTO {
  site_title: string;
  easypaisa_account: string;
  jazzcash_account: string;
  usdt_address: string;
  /** Merchant account titles + QR + instructions (admin-managed, Task 16). */
  easypaisa_title: string;
  jazzcash_title: string;
  usdt_qr_url: string;
  payment_instructions: string;
  min_withdrawal: string;
  max_withdrawal: string;
}

export interface AdminUserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  isBanned: boolean;
  ipAddress: string | null;
  fingerprint: string | null;
  taskBalance: number;
  withdrawableBalance: number;
  activePlanName: string | null;
  /** Titles of the member's ACTIVE investment packages (source of truth for
   * their daily earning) — newest first, resolved from the live package rows. */
  activePackages: string[];
  referralCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Paginated admin user-list response (server-side search + filter + paging). */
export interface AdminUsersPayloadDTO {
  users: AdminUserDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Banned count for the whole searched set (ignores the status filter). */
  bannedTotal: number;
}

/** Paginated admin notification-history response. */
export interface AdminNotificationsPayloadDTO {
  notifications: (NotificationDTO & { createdBy: string })[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminStatsDTO {
  totalDeposited: number;
  totalWithdrawn: number;
  pendingPayoutsCount: number;
  pendingPayoutsAmount: number;
  /** Payment submissions (deposit / plan / package purpose) awaiting review. */
  pendingDepositsCount: number;
  pendingDepositsAmount: number;
  activeUsers: number;
  bannedUsers: number;
  totalUsers: number;
  taskRewardsPaid: number;
  /** Catalog health: packages & tasks currently visible to members. */
  activePackages: number;
  activeTasks: number;
  /** Member support requests awaiting an admin reply (open / in progress). */
  openSupportCount: number;
  /** Individual member support messages not yet SEEN by an admin — drives the
   *  sidebar Support badge (decrements per message the admin opens, hides at 0). */
  unseenSupportCount: number;
  series: { date: string; deposits: number; withdrawals: number; rewards: number }[];
  recentTransactions: TransactionDTO[];
}

export interface ForgotPasswordResponse {
  ok: boolean;
}

/**
 * Server-side user shape shared by both data backends.
 * Supabase (PostgREST) rows return ISO date strings; Prisma rows return Date
 * objects — both are accepted. `passwordHash` is only needed by auth flows.
 */
export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  referralCode: string;
  referredById: string | null;
  isBanned: boolean;
  ipAddress: string | null;
  fingerprint: string | null;
  supabaseAuthId: string | null;
  /** Optional secondary contact for account recovery (member-managed). */
  recoveryEmail?: string | null;
  passwordHash?: string;
  lastLoginAt: string | Date | null;
  createdAt: string | Date;
}

/** Status payload of GET/POST /api/admin/supabase. */
export interface SupabaseStatusDTO {
  configured: boolean;
  provisioned: boolean;
  connectError?: string | null;
  supabaseUserCount?: number | null;
  authUserCount?: number | null;
  backend: "local" | "supabase";
  siteUrl: string;
  /** Full provisioning SQL (db/supabase-schema.sql) — empty when unreadable. */
  sql: string;
}

/**
 * Admin-controlled premium success-animation switches (visual layer ONLY).
 * Served inside the session response (`animations` field) so every member
 * view can honor them; absent/null (older payloads, logged-out) means the
 * professional defaults: everything ON. Turning any switch OFF never
 * disables the underlying feature — activations, deposits, withdrawals,
 * task claims and referral commissions all keep working exactly as before.
 */
export interface AnimationSettingsDTO {
  /** Master switch — OFF disables every success animation at once. */
  master: boolean;
  /** Celebration after a package/plan is genuinely activated. */
  planActivation: boolean;
  /** One-time earning presentation for a real referral commission credit. */
  referralCommission: boolean;
  /** Presentation when a deposit is instantly credited to the wallet. */
  deposit: boolean;
  /** Presentation when a withdrawal request is successfully submitted. */
  withdrawal: boolean;
  /** In-place presentation when a daily task reward is claimed. */
  taskClaim: boolean;
}
