import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { fetchAdminUsersPage, toIntOrNull } from "../../_lib/helpers";
import { supabaseAdminUsersGet, supabaseAdminUsersPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface UserPostBody {
  userId?: string;
  action?: string;
  balanceType?: string;
  amount?: number | string;
  reason?: string;
}

export async function GET(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminUsersGet(req);
    }

    await requireAdmin();
    const params = new URL(req.url).searchParams;
    const payload = await fetchAdminUsersPage({
      q: params.get("q") ?? "",
      status: params.get("status") ?? "all",
      page: toIntOrNull(params.get("page")) ?? 1,
      pageSize: toIntOrNull(params.get("pageSize")) ?? undefined,
    });
    return NextResponse.json(payload);
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminUsersPost(req);
    }

    const admin = await requireAdmin();
    const body = await parseJsonBody<UserPostBody>(req);

    const userId = (body.userId ?? "").trim();
    const action = (body.action ?? "").trim();

    const target = userId ? await db.user.findUnique({ where: { id: userId } }) : null;
    if (!target) throw new ApiError("User not found.", 400);

    if (action === "ban") {
      if (target.role === "admin" || target.id === admin.id) {
        throw new ApiError("Cannot ban an admin.", 400);
      }
      await db.user.update({ where: { id: target.id }, data: { isBanned: true } });
    } else if (action === "unban") {
      await db.user.update({ where: { id: target.id }, data: { isBanned: false } });
    } else if (action === "adjust") {
      const balanceType = (body.balanceType ?? "").trim();
      if (balanceType !== "task" && balanceType !== "withdrawable") {
        throw new ApiError("Balance type must be task or withdrawable.", 400);
      }
      const amount = toIntOrNull(body.amount);
      if (amount === null || amount === 0) {
        throw new ApiError("Enter a non-zero integer amount.", 400);
      }
      const reason =
        body.reason === undefined || body.reason === null ? null : String(body.reason).trim();
      const field = balanceType === "task" ? "taskBalance" : "withdrawableBalance";

      await db.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId: target.id } });
        if (!wallet) throw new ApiError("Wallet not found for this user.", 404);
        if (amount < 0 && wallet[field] + amount < 0) {
          throw new ApiError("Insufficient balance for this adjustment.", 400);
        }
        await tx.wallet.update({
          where: { userId: target.id },
          data: { [field]: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            userId: target.id,
            type: "adjustment",
            amount: Math.abs(amount),
            status: "completed",
            description: `Manual ${balanceType === "task" ? "task balance" : "withdrawable balance"} adjustment (${amount > 0 ? "+" : "−"}Rs ${Math.abs(amount)})${reason ? " — " + reason : ""}`,
            meta: JSON.stringify({
              balanceType,
              signedAmount: amount,
              reason,
              byAdmin: admin.email,
            }),
            processedAt: new Date(),
          },
        });
      });
    } else {
      throw new ApiError("Unknown action. Use ban, unban or adjust.", 400);
    }

    // The list itself is refreshed by the client via query invalidation — no
    // need to re-serialize the whole page here.
    return NextResponse.json({ ok: true });
  });
}
