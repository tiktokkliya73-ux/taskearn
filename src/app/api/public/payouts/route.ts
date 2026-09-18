import { NextResponse } from "next/server";
import { handleRoute } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { maskName } from "@/lib/business";
import { safeParseMeta } from "../../_lib/helpers";
import { supabasePublicPayouts } from "@/server/supabase/public-routes";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabasePublicPayouts();
    }

    const txns = await db.transaction.findMany({
      where: { type: "withdrawal", status: "approved" },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 12,
    });

    const payouts = txns.map((t) => {
      const meta = safeParseMeta(t.meta);
      const method =
        typeof meta.paymentMethod === "string" && meta.paymentMethod ? meta.paymentMethod : "bank";
      return {
        id: t.id,
        name: maskName(t.user?.name ?? "User"),
        amount: t.amount,
        method,
        at: t.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ payouts });
  });
}
