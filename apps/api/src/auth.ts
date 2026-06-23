import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { config } from "./config";
import { commonPool } from "./db";

export type AuthUser = {
  id: string;
  accountId: number;
  email: string;
  name: string;
};

export type AppVariables = {
  user: AuthUser;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const result = await commonPool.query<{
    id: string;
    account_id: string;
    email: string;
    name: string;
  }>(
    `SELECT id, account_id, email, name
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email]
  );

  const row = result.rows[0];
  if (!row || !equalString(password, "password")) {
    throw new Error("INVALID_CREDENTIALS");
  }

  const token = `${randomUUID()}.${randomBytes(24).toString("base64url")}`;
  await commonPool.query(
    `INSERT INTO sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
    [row.id, sha256(token), config.session.maxAgeSeconds]
  );

  return {
    token,
    user: {
      id: row.id,
      accountId: Number(row.account_id),
      email: row.email,
      name: row.name
    }
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await commonPool.query(
    `UPDATE sessions
        SET revoked_at = now()
      WHERE session_token_hash = $1
        AND revoked_at IS NULL`,
    [sha256(token)]
  );
}

export async function currentUserFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;

  const result = await commonPool.query<{
    id: string;
    account_id: string;
    email: string;
    name: string;
  }>(
    `SELECT u.id, u.account_id, u.email, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1`,
    [sha256(token)]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    accountId: Number(row.account_id),
    email: row.email,
    name: row.name
  };
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, config.session.cookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    path: "/",
    maxAge: config.session.maxAgeSeconds
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, config.session.cookieName, {
    path: "/"
  });
}

export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, config.session.cookieName);
}

export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = await currentUserFromToken(readSessionToken(c));
  if (!user) {
    return c.json({ error: { code: "UNAUTHENTICATED", message: "ログインが必要である" } }, 401);
  }

  c.set("user", user);
  await next();
};
