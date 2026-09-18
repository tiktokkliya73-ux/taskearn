import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { toNotificationDTO } from "../../_lib/helpers";
import {
  supabaseAdminNotificationsGet,
  supabaseAdminNotificationsPost,
} from "@/server/supabase/admin-routes";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const MAX_PAGE = 10_000; // sanity clamp — prevents absurd skip values

const TITLE_MAX = 80;
const MESSAGE_MAX = 500;

interface NotificationPostBody {
  title?: string;
  message?: string;
}

/**
 * Admin broadcast notifications — delivered to every member through the
 * existing dashboard notification bell. GET = paginated send history,
 * POST = send one broadcast to all members. One row per broadcast: there is
 * NO per-user delivery state, so this scales to any member count.
 */
export async function GET(req: Request) {
  return handleRoute(async () => {
    const { searchParams } = new URL(req.url);
    const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
    const page = Math.min(
      MAX_PAGE,
      Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1),
    );

    if (await isSupabaseData()) {
      return supabaseAdminNotificationsGet({ page, pageSize: PAGE_SIZE });
    }

    await requireAdmin();

    const [total, rows] = await Promise.all([
      db.notification.count(),
      db.notification.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return NextResponse.json({
      notifications: rows.map((n) => ({ ...toNotificationDTO(n), createdBy: n.createdBy })),
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminNotificationsPost(req);
    }

    const admin = await requireAdmin();
    const body = await parseJsonBody<NotificationPostBody>(req);

    const title = (body.title ?? "").trim();
    const message = (body.message ?? "").trim();

    if (!title) throw new ApiError("Enter a notification title.", 400);
    if (title.length > TITLE_MAX) {
      throw new ApiError(`Title must be ${TITLE_MAX} characters or fewer.`, 400);
    }
    if (!message) throw new ApiError("Enter a notification message.", 400);
    if (message.length > MESSAGE_MAX) {
      throw new ApiError(`Message must be ${MESSAGE_MAX} characters or fewer.`, 400);
    }

    const created = await db.notification.create({
      data: { title, message, createdBy: admin.email },
    });

    return NextResponse.json({
      ok: true,
      notification: { ...toNotificationDTO(created), createdBy: created.createdBy },
    });
  });
}
