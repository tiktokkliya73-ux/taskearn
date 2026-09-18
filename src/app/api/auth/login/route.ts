import { NextResponse } from "next/server";
import { ApiError, getClientIp, handleRoute, parseJsonBody, setSessionCookie } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/password";
import { createSessionToken } from "@/lib/jwt";
import { generateReferralCode } from "@/lib/business";
import { ensureSupabaseAuthUser, supabaseConfigured, supabasePasswordSignIn } from "@/lib/supabase";
import { isSupabaseData } from "@/lib/data-backend";
import { toSessionUser } from "../../_lib/helpers";
import { supabaseLogin } from "@/server/supabase/auth-routes";

export const dynamic = "force-dynamic";

interface LoginBody {
  email?: string;
  password?: string;
  fingerprint?: string;
}

export async function POST(req: Request) {
  return handleRoute(async () => {
    if (await isSupabaseData()) {
      return supabaseLogin(req);
    }

    const body = await parseJsonBody<LoginBody>(req);

    const email = (body.email ?? "").trim().toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const fingerprint =
      typeof body.fingerprint === "string" && body.fingerprint ? body.fingerprint : null;

    let user = email ? await db.user.findUnique({ where: { email } }) : null;
    let authenticated = false;

    // 1) Supabase Auth first — the user's Supabase project is authoritative
    //    for credentials (verified via password grant, session discarded).
    if (supabaseConfigured && email) {
      const r = await supabasePasswordSignIn(email, password);
      if (r.ok) {
        authenticated = true;
        if (!user) {
          // Auth user exists but no local profile yet — provision profile +
          // wallet locally. Role is NEVER taken from client-controlled
          // metadata; it always defaults to "user".
          user = await db.$transaction(async (tx) => {
            const referralCode = await generateReferralCode(tx);
            const created = await tx.user.create({
              data: {
                name: r.name && r.name.length >= 2 ? r.name : email.split("@")[0],
                email,
                passwordHash: hashPassword(password),
                role: "user",
                referralCode,
                ipAddress: getClientIp(req),
                fingerprint,
                supabaseAuthId: r.authId ?? null,
              },
            });
            await tx.wallet.create({ data: { userId: created.id } });
            return created;
          });
        } else {
          const sync: { supabaseAuthId?: string; passwordHash?: string } = {};
          if (!user.supabaseAuthId) sync.supabaseAuthId = r.authId ?? undefined;
          // keep the local scrypt hash consistent with the Supabase password
          if (!verifyPassword(password, user.passwordHash)) {
            sync.passwordHash = hashPassword(password);
          }
          if (Object.keys(sync).length > 0) {
            await db.user.update({ where: { id: user.id }, data: sync }).catch(() => undefined);
          }
        }
      }
    }

    // 2) Local scrypt verification — fallback for accounts whose Supabase auth
    //    record is missing or out of sync (the auth user is then backfilled).
    if (!authenticated) {
      if (!user || !verifyPassword(password, user.passwordHash)) {
        throw new ApiError("Invalid email or password.", 401);
      }
      authenticated = true;
      if (user.supabaseAuthId === null && supabaseConfigured) {
        ensureSupabaseAuthUser(email, password, { name: user.name }).catch(() => undefined);
      }
    }

    if (!user) throw new ApiError("Invalid email or password.", 401);
    if (user.isBanned) throw new ApiError("Your account has been suspended. Contact support.", 403);

    const now = new Date();
    await db.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: now,
        ...(user.ipAddress === null ? { ipAddress: getClientIp(req) } : {}),
        ...(user.fingerprint === null && fingerprint ? { fingerprint } : {}),
      },
    });

    await setSessionCookie(await createSessionToken(user.id));
    return NextResponse.json({ user: toSessionUser(user) });
  });
}
