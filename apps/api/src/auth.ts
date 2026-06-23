import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { config } from "./config";
import { commonPool } from "./db";

/**
 * Cookieセッションから復元される認証済みユーザーである。
 */
export type AuthUser = {
  id: string;
  accountId: number;
  email: string;
  name: string;
};

/**
 * Honoのコンテキストへ注入するアプリケーション変数である。
 */
export type AppVariables = {
  user: AuthUser;
};

/**
 * セッションtokenをDB保存用のSHA-256 hashへ変換する。
 *
 * @param value hash化する平文token。
 * @returns 16進文字列のSHA-256 hash。
 */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * 文字列比較のタイミング差を抑えるための等価判定である。
 *
 * @param a 比較対象の文字列。
 * @param b 比較対象の文字列。
 * @returns 文字列が同一であればtrue。
 */
function equalString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * デモユーザーのメールアドレスとパスワードを検証し、Cookieへ入れるセッションtokenを発行する。
 *
 * @param email ログイン対象のメールアドレス。
 * @param password デモログイン用パスワード。
 * @returns 発行したセッションtokenとユーザー情報。
 * @throws 認証に失敗した場合は`INVALID_CREDENTIALS`を投げる。
 */
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

/**
 * セッションtokenに対応するセッションを失効済みに更新する。
 *
 * @param token Cookieから読み取ったセッションtoken。
 */
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

/**
 * Cookieのセッションtokenから現在の認証済みユーザーを復元する。
 *
 * @param token Cookieから読み取ったセッションtoken。
 * @returns 有効なセッションがあればユーザー情報、なければnull。
 */
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

/**
 * ブラウザへHTTP onlyのセッションCookieを書き込む。
 *
 * @param c Honoのリクエストコンテキスト。
 * @param token 発行済みセッションtoken。
 */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, config.session.cookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    path: "/",
    maxAge: config.session.maxAgeSeconds
  });
}

/**
 * ブラウザ上のセッションCookieを削除する。
 *
 * @param c Honoのリクエストコンテキスト。
 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, config.session.cookieName, {
    path: "/"
  });
}

/**
 * リクエストCookieからセッションtokenを読み取る。
 *
 * @param c Honoのリクエストコンテキスト。
 * @returns セッションtoken。Cookieがなければundefined。
 */
export function readSessionToken(c: Context): string | undefined {
  return getCookie(c, config.session.cookieName);
}

/**
 * 認証済みユーザーだけにroute処理を通すHono middlewareである。
 */
export const requireAuth: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
  const user = await currentUserFromToken(readSessionToken(c));
  if (!user) {
    return c.json({ error: { code: "UNAUTHENTICATED", message: "ログインが必要である" } }, 401);
  }

  c.set("user", user);
  await next();
};
