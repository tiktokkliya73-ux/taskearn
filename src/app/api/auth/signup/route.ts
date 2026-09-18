import { NextResponse } from "next/server";
import {
  ApiError,
  getClientIp,
  handleRoute,
  parseJsonBody,
  setSessionCookie,
} from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSessionToken } from "@/lib/jwt";
import { generateReferralCode } from "@/lib/business";
import { ensureSupabaseAuthUser, supabaseConfigured } from "@/lib/supabase";
import { isSupabaseData } from "@/lib/data-backend";
import { toSessionUser } from "../../_lib/helpers";
import { supabaseSignup } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface SignupBody {
  name?: string;
  email?: string;
  password?: string;
  referralCode?: string;
  fingerprint?: string;
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseSignup(req);
    }

    const body = await parseJsonBody<SignupBody>(req);

    const name = (body.name ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const fingerprint = typeof body.fingerprint === "string" && body.fingerprint ? body.fingerprint : null;

    if (name.length < 2) throw new ApiError("Please enter your full name.", 400);
    if (!EMAIL_RE.test(email)) throw new ApiError("Please enter a valid email address.", 400);
    if (password.length < 8) throw new ApiError("Password must be at least 8 characters.", 400);

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw new ApiError("An account with this email already exists.", 409);

    // Optional referral code (trimmed + uppercased)
    const refCode = (body.referralCode ?? "").trim().toUpperCase();
    let referredById: string | null = null;
    if (refCode) {
      const inviter = await db.user.findUnique({ where: { referralCode: refCode } });
      if (!inviter) throw new ApiError("Invalid referral code.", 400);
      referredById = inviter.id;
    }

    // Create the account in the project's Supabase Auth (visible under
    // Authentication → Users in the Supabase dashboard). Failures other than
    // "already registered" are non-blocking — login will re-sync later.
    let supabaseAuthId: string | null = null;
    if (supabaseConfigured) {
      const r = await ensureSupabaseAuthUser(email, password, { name });
      if (r.ok) {
        supabaseAuthId = r.authId ?? null;
      } else if (/already|registered|exists/i.test(r.error ?? "")) {
        throw new ApiError("An account with this email already exists.", 409);
      }
    }

    // handle_new_user() RPC equivalent — user + wallet created atomically.
    const user = await db.$transaction(async (tx) => {
      const referralCode = await generateReferralCode(tx);
      const created = await tx.user.create({
        data: {
          name,
          email,
          passwordHash: hashPassword(password),
          role: "user",
          referralCode,
          referredById,
          ipAddress: getClientIp(req),
          fingerprint,
          supabaseAuthId,
        },
      });
      await tx.wallet.create({ data: { userId: created.id } });
      return created;
    });

    await setSessionCookie(await createSessionToken(user.id));
    return NextResponse.json({ user: toSessionUser(user) }, { status: 201 });
  });
}
