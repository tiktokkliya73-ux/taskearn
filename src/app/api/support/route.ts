import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAuth } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { supabaseSupportCreate, supabaseSupportList } from "@/server/supabase/user-routes";
import type { SupportListResponseDTO, SupportTicketDTO } from "@/lib/types";
import type { SupportTicket } from "@prisma/client";

export const dynamic = "force-dynamic";

/* ================================================================== */
/* Member Support — the simple in-app help channel.                    */
/*                                                                    */
/* GET  → the member's OWN tickets, newest first (server-side scoped  */
/*        by the session userId — a member can never list or read     */
/*        another member's tickets).                                  */
/* POST → submit a new request { subject, message }. Subject and      */
/*        message are validated server-side; no sensitive data is     */
/*        asked for or stored.                                        */
/* ================================================================== */

function toSupportTicketDTO(t: SupportTicket): SupportTicketDTO {
  return {
    id: t.id,
    userId: t.userId,
    subject: t.subject,
    message: t.message,
    status: t.status as SupportTicketDTO["status"],
    reply: t.reply,
    repliedAt: t.repliedAt ? t.repliedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

interface SupportCreateBody {
  subject?: string;
  message?: string;
}

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseSupportList();
    }

    const user = await requireAuth();
    const tickets = await db.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const payload: SupportListResponseDTO = { tickets: tickets.map(toSupportTicketDTO) };
    return NextResponse.json(payload);
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseSupportCreate(req);
    }

    const user = await requireAuth();
    const body = await parseJsonBody<SupportCreateBody>(req);

    const subject = (body.subject ?? "").trim();
    const message = (body.message ?? "").trim();
    if (subject.length < 3 || subject.length > 120) {
      throw new ApiError("Subject must be 3–120 characters.", 400);
    }
    if (message.length < 5 || message.length > 2000) {
      throw new ApiError("Message must be 5–2000 characters.", 400);
    }

    const ticket = await db.supportTicket.create({
      data: { userId: user.id, subject, message },
    });
    return NextResponse.json({ ticket: toSupportTicketDTO(ticket) });
  });
}
