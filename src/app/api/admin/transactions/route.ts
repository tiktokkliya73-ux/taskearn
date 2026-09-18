import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { handleRoute, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toTransactionDTO } from "@/lib/business";
import { supabaseAdminTransactionsGet } from "@/server/supabase/admin-routes";
import type { TransactionDTO, TransactionStatus, TransactionType } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_PAGE = 10_000; // sanity clamp — prevents absurd skip values

const TX_TYPES = new Set<string>([
  "task_reward",
  "referral_unlock",
  "referral_commission",
  "deposit",
  "withdrawal",
  "adjustment",
  "plan_purchase",
  "package_purchase",
  "daily_earning",
  "promo_reward",
]);

const TX_STATUSES = new Set<string>(["pending", "completed", "approved", "rejected", "blocked"]);

interface TransactionsPayload {
  transactions: TransactionDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * READ-ONLY paginated view over the existing transaction ledger for the Admin
 * Control Center. No writes, no new ledger — this only surfaces what the
 * platform already records, with member search + type/status filters.
 */
export async function GET(req: Request) {
  return handleRoute(async () => {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
    const type = (searchParams.get("type") ?? "").trim();
    const status = (searchParams.get("status") ?? "").trim();
    const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
    const page = Math.min(
      MAX_PAGE,
      Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1),
    );

    if (await isSupabaseData()) {
      return supabaseAdminTransactionsGet({ q, type, status, page, pageSize: PAGE_SIZE });
    }

    await requireAdmin();

    const where: Prisma.TransactionWhereInput = {};
    if (TX_TYPES.has(type)) where.type = type as TransactionType;
    if (TX_STATUSES.has(status)) where.status = status as TransactionStatus;
    if (q) {
      // Same member-search semantics as the admin Users list (plain contains —
      // SQLite LIKE is case-insensitive for ASCII).
      where.user = {
        is: {
          OR: [{ name: { contains: q } }, { email: { contains: q } }],
        },
      };
    }

    const [total, rows] = await Promise.all([
      db.transaction.count({ where }),
      db.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);

    const payload: TransactionsPayload = {
      transactions: rows.map(toTransactionDTO),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    };
    return NextResponse.json(payload);
  });
}
