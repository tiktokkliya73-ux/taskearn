import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { ensurePaymentMethodsSeeded, toPaymentMethodDTO } from "@/lib/business";
import { isImageSourceUrl } from "../../_lib/helpers";
import { supabaseAdminPaymentMethodsGet, supabaseAdminPaymentMethodsPost } from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

interface PaymentMethodPostBody {
  action?: string; // create | update | toggle | delete
  id?: string;
  name?: string;
  accountNumber?: string;
  accountTitle?: string;
  instructions?: string;
  logoUrl?: string;
  sortOrder?: number | string;
  isActive?: boolean;
}

/** All rows (admin list), sorted by display order. */
async function fetchAllMethods() {
  await ensurePaymentMethodsSeeded();
  const rows = await db.paymentMethod.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toPaymentMethodDTO);
}

function validateFields(input: {
  name?: string;
  accountNumber?: string;
  accountTitle?: string;
  instructions?: string;
  logoUrl?: string;
}): { name: string; accountNumber: string; accountTitle: string | null; instructions: string | null; logoUrl: string | null } {
  const name = (input.name ?? "").trim();
  if (name.length < 2 || name.length > 40) {
    throw new ApiError("Payment method name must be 2–40 characters.", 400);
  }
  const accountNumber = (input.accountNumber ?? "").trim();
  if (accountNumber.length < 4 || accountNumber.length > 100) {
    throw new ApiError("Account number must be 4–100 characters.", 400);
  }
  const accountTitle = (input.accountTitle ?? "").trim();
  if (accountTitle.length > 60) throw new ApiError("Account title must be at most 60 characters.", 400);
  const instructions = (input.instructions ?? "").trim();
  if (instructions.length > 400) throw new ApiError("Instructions must be at most 400 characters.", 400);
  const logoUrl = (input.logoUrl ?? "").trim();
  if (logoUrl && !isImageSourceUrl(logoUrl)) {
    throw new ApiError(
      "Logo / QR image must be an http(s) URL or an uploaded image (JPG, PNG or WEBP).",
      400,
    );
  }
  return {
    name,
    accountNumber,
    accountTitle: accountTitle || null,
    instructions: instructions || null,
    logoUrl: logoUrl || null,
  };
}

function coerceSortOrder(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * GET  /api/admin/payment-methods — every payment method (admin manager).
 * POST /api/admin/payment-methods — action: create | update | toggle | delete.
 *
 * The admin's display order (sortOrder, lowest first), enable/disable and
 * delete drive every member checkout live — the payment page renders exactly
 * these rows.
 */
export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPaymentMethodsGet();
    }
    await requireAdmin();
    return NextResponse.json({ methods: await fetchAllMethods() });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminPaymentMethodsPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<PaymentMethodPostBody>(req);
    const action = (body.action ?? "").trim();

    if (action === "create") {
      const fields = validateFields(body);
      const sortOrder = coerceSortOrder(body.sortOrder);
      let order: number;
      if (sortOrder === null) {
        const max = await db.paymentMethod.aggregate({ _max: { sortOrder: true } });
        order = (max._max.sortOrder ?? 0) + 1;
      } else {
        order = sortOrder;
      }

      const clash = await db.paymentMethod.findFirst({
        where: { name: { equals: fields.name } },
        select: { id: true },
      });
      if (clash) throw new ApiError("A payment method with that name already exists.", 400);

      await db.paymentMethod.create({
        data: { ...fields, sortOrder: order, isActive: true },
      });
    } else if (action === "update") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.paymentMethod.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Payment method not found.", 400);

      const fields = validateFields({
        name: body.name !== undefined ? body.name : existing.name,
        accountNumber: body.accountNumber !== undefined ? body.accountNumber : existing.accountNumber,
        accountTitle: body.accountTitle !== undefined ? body.accountTitle : (existing.accountTitle ?? ""),
        instructions: body.instructions !== undefined ? body.instructions : (existing.instructions ?? ""),
        logoUrl: body.logoUrl !== undefined ? body.logoUrl : (existing.logoUrl ?? ""),
      });
      if (fields.name !== existing.name) {
        const clash = await db.paymentMethod.findFirst({
          where: { name: { equals: fields.name }, id: { not: existing.id } },
          select: { id: true },
        });
        if (clash) throw new ApiError("A payment method with that name already exists.", 400);
      }

      const sortOrder = coerceSortOrder(body.sortOrder);
      await db.paymentMethod.update({
        where: { id },
        data: {
          ...fields,
          ...(sortOrder !== null ? { sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: Boolean(body.isActive) } : {}),
        },
      });
    } else if (action === "toggle") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.paymentMethod.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Payment method not found.", 400);
      const remaining = await db.paymentMethod.count({
        where: { isActive: true, id: { not: existing.id } },
      });
      if (existing.isActive && remaining === 0) {
        throw new ApiError("At least one payment method must stay enabled.", 400);
      }
      await db.paymentMethod.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });
    } else if (action === "delete") {
      const id = (body.id ?? "").trim();
      const existing = id ? await db.paymentMethod.findUnique({ where: { id } }) : null;
      if (!existing) throw new ApiError("Payment method not found.", 400);
      const remaining = await db.paymentMethod.count({
        where: { isActive: true, id: { not: existing.id } },
      });
      if (existing.isActive && remaining === 0) {
        throw new ApiError("Disable or add another method before deleting the last enabled one.", 400);
      }
      // Payment history keeps the stored method NAME (meta.paymentMethod) —
      // deleting the row never breaks old requests.
      await db.paymentMethod.delete({ where: { id } });
    } else {
      throw new ApiError("Unknown action. Use create, update, toggle or delete.", 400);
    }

    return NextResponse.json({ methods: await fetchAllMethods() });
  });
}
