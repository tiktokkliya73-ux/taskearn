import { NextResponse } from "next/server";
import { ApiError, handleRoute, parseJsonBody, requireAdmin } from "@/lib/api-helpers";
import { isSupabaseData } from "@/lib/data-backend";
import { db } from "@/lib/db";
import { supabaseAdminSupportGet, supabaseAdminSupportPost } from "@/server/supabase/admin-routes";
import type { SupportTicket, User } from "@prisma/client";
import type { SupportTicketDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/* ================================================================== */
/* Admin Support — the admin side of the member help channel.          */
/*                                                                    */
/* GET  → every ticket (newest first, with the member's name/email).  */
/* POST → update one ticket: mark the member's message SEEN and/or    */
/*        set a status and/or the admin reply.                        */
/*        { id, seen?, status?, reply? } — at least one of            */
/*        seen/status/reply is required; the reply is stored on the   */
/*        ticket itself and is visible to the member on their         */
/*        Support page.                                               */
/*                                                                    */
/* Per-message unread semantics: adminSeenAt is set the FIRST time    */
/* an admin opens the ticket detail (seen=true) — a reply or a status */
/* change implies the message was seen too, so those paths set it as  */
/* well. Once seen, a message never returns to unread.                */
/* ================================================================== */

const SUPPORT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type SupportStatus = (typeof SUPPORT_STATUSES)[number];

function toAdminSupportTicketDTO(t: SupportTicket & { user: Pick<User, "name" | "email"> }): SupportTicketDTO {
  return {
    id: t.id,
    userId: t.userId,
    userName: t.user.name,
    userEmail: t.user.email,
    subject: t.subject,
    message: t.message,
    status: t.status as SupportTicketDTO["status"],
    reply: t.reply,
    repliedAt: t.repliedAt ? t.repliedAt.toISOString() : null,
    adminSeenAt: t.adminSeenAt ? t.adminSeenAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

async function fetchTickets(): Promise<SupportTicketDTO[]> {
  const tickets = await db.supportTicket.findMany({
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return tickets.map(toAdminSupportTicketDTO);
}

interface SupportUpdateBody {
  id?: string;
  seen?: boolean;
  status?: string;
  reply?: string;
}

export async function GET() {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminSupportGet();
    }

    await requireAdmin();
    return NextResponse.json({ tickets: await fetchTickets() });
  });
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseAdminSupportPost(req);
    }

    await requireAdmin();
    const body = await parseJsonBody<SupportUpdateBody>(req);

    const id = (body.id ?? "").trim();
    const seen = body.seen === true;
    const status = (body.status ?? "").trim() as SupportStatus | "";
    const reply = typeof body.reply === "string" ? body.reply.trim() : undefined;

    if (!id) throw new ApiError("Missing ticket id.", 400);
    if (!seen && !status && reply === undefined) {
      throw new ApiError("Provide a seen flag, a status or a reply to update.", 400);
    }
    if (status && !SUPPORT_STATUSES.includes(status as SupportStatus)) {
      throw new ApiError("Unknown status.", 400);
    }
    if (reply !== undefined && (reply.length < 1 || reply.length > 2000)) {
      throw new ApiError("Reply must be 1–2000 characters.", 400);
    }

    const ticket = await db.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new ApiError("Support request not found.", 404);

    const updated = await db.supportTicket.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(reply !== undefined ? { reply: reply || null, repliedAt: reply ? new Date() : null } : {}),
        // Seeing = the admin opened this individual message: record the FIRST
        // seen time only (never re-stamps an already-seen message). A reply
        // or status change also implies the admin saw the message.
        ...(seen || status || reply !== undefined
          ? { adminSeenAt: ticket.adminSeenAt ?? new Date() }
          : {}),
      },
      include: { user: { select: { name: true, email: true } } },
    });

    return NextResponse.json({ ticket: toAdminSupportTicketDTO(updated), tickets: await fetchTickets() });
  });
}
