import { NextResponse } from "next/server";

import { ApiError } from "@/lib/api-helpers";
import type { PayoutDTO, PublicStatsDTO } from "@/lib/types";
import {
  getSupabaseSettings,
  mapPlanRow,
  requireSupabaseAdmin,
  rpcCall,
  type PlanRow,
} from "@/server/supabase/core";

/**
 * Supabase-mode implementations for the /api/public/* routes (Task 8).
 * Aggregates go through RPCs; the plans list is plain PostgREST.
 */

export async function supabasePublicStats(): Promise<NextResponse> {
  const stats = await rpcCall<PublicStatsDTO>("api_public_stats");
  return NextResponse.json(stats);
}

export async function supabasePublicPlans(): Promise<NextResponse> {
  const client = requireSupabaseAdmin();
  const { data, error } = await client
    .from("plans")
    .select(
      "id,name,description,price,reward_per_task,daily_task_limit,duration_days,is_active,sort_order"
    )
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) {
    throw new ApiError(`Supabase data backend error: ${error.message} (plans list)`, 500);
  }
  const plans = ((data ?? []) as PlanRow[]).map(mapPlanRow);
  return NextResponse.json({ plans });
}

export async function supabasePublicPayouts(): Promise<NextResponse> {
  const payouts = await rpcCall<PayoutDTO[]>("api_public_payouts");
  return NextResponse.json({ payouts });
}

export async function supabasePublicGateways(): Promise<NextResponse> {
  const s = await getSupabaseSettings();
  return NextResponse.json({
    site_title: s.site_title,
    easypaisa_account: s.easypaisa_account,
    jazzcash_account: s.jazzcash_account,
    usdt_address: s.usdt_address,
    easypaisa_title: s.easypaisa_title,
    jazzcash_title: s.jazzcash_title,
    usdt_qr_url: s.usdt_qr_url,
    payment_instructions: s.payment_instructions,
    min_withdrawal: s.min_withdrawal,
    max_withdrawal: s.max_withdrawal,
  });
}

/**
 * GET /api/public/branding — centralized site branding (logo / favicon).
 * Mirrors the local Prisma route: values come from system_settings rows
 * seeded from SETTING_DEFAULTS, so admin uploads carry over identically.
 */
export async function supabasePublicBranding(): Promise<NextResponse> {
  const s = await getSupabaseSettings();
  return NextResponse.json({
    siteTitle: s.site_title,
    logoUrl: s.site_logo_url || null,
    faviconUrl: s.site_favicon_url || null,
  });
}

/**
 * GET /api/public/payment-methods (Task 17) — the admin-managed payment
 * channels rendered on every member checkout. The seed RPC
 * (ensure_payment_methods_seeded, called inside api_payment_methods_list)
 * backfills the table from the legacy system_settings gateway keys the first
 * time it is empty, so the owner's live merchant accounts carry over.
 * walletImageUrl (admin-uploaded Wallet Balance image) is merged from the
 * branding settings — the RPC itself only returns payment_methods rows.
 */
export async function supabasePublicPaymentMethods(): Promise<NextResponse> {
  const [dto, s] = await Promise.all([
    rpcCall<{ methods: unknown[]; requireProof: boolean }>("api_payment_methods_list"),
    getSupabaseSettings(),
  ]);
  return NextResponse.json({
    ...dto,
    walletImageUrl: s.wallet_method_image_url || null,
  });
}

/**
 * GET /api/public/withdrawal-methods (Task 22) — the admin-managed payout
 * channels rendered in the Withdraw page dropdown (active rows only, in the
 * admin's display order). Rows are seeded by db/supabase-schema.sql §12.
 */
export async function supabasePublicWithdrawalMethods(): Promise<NextResponse> {
  const dto = await rpcCall<{ methods: unknown[] }>("api_withdrawal_methods_list");
  return NextResponse.json(dto);
}
