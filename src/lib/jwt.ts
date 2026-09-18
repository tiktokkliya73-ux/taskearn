import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "taskearn-dev-secret-change-in-production";
const secret = new TextEncoder().encode(JWT_SECRET);
export const SESSION_COOKIE = "te_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: false, // sandbox runs behind a proxy over http
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
