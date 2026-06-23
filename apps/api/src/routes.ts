import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ChatThread, User } from "@text-to-sql/shared";
import {
  clearSessionCookie,
  login,
  logout,
  readSessionToken,
  requireAuth,
  setSessionCookie,
  type AppVariables
} from "./auth";
import { commonPool } from "./db";
import { handleChat } from "./chat";

/**
 * HonoのAPI route定義本体である。
 */
export const app = new Hono<{ Variables: AppVariables }>();

/**
 * Vite dev serverからCookie付きAPI呼び出しを許可するCORS設定である。
 */
app.use(
  "*",
  cors({
    origin: "http://127.0.0.1:3000",
    credentials: true
  })
);

/**
 * APIサーバの疎通確認用エンドポイントである。
 */
app.get("/health", (c) => c.json({ ok: true }));

/**
 * デモユーザーでログインし、HTTP only Cookieセッションを作成する。
 */
app.post("/auth/login", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
  try {
    const result = await login(body.email ?? "", body.password ?? "");
    setSessionCookie(c, result.token);
    const user: User = result.user;
    return c.json({ user });
  } catch {
    return c.json({ error: { code: "INVALID_CREDENTIALS", message: "メールアドレスまたはパスワードが違う" } }, 401);
  }
});

/**
 * 現在のCookieセッションを失効させる。
 */
app.post("/auth/logout", async (c) => {
  await logout(readSessionToken(c));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

/**
 * Cookieセッションから現在ログイン中のユーザーを返す。
 */
app.get("/me", requireAuth, (c) => {
  const user: User = c.get("user");
  return c.json({ user });
});

/**
 * 現在のユーザーが所有するチャットスレッド一覧を返す。
 */
app.get("/chat-threads", requireAuth, async (c) => {
  const user = c.get("user");
  const result = await commonPool.query<{
    id: string;
    title: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, title, created_at, updated_at
       FROM chat_threads
      WHERE account_id = $1 AND user_id = $2
      ORDER BY updated_at DESC
      LIMIT 30`,
    [user.accountId, user.id]
  );

  const threads: ChatThread[] = result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  }));
  return c.json({ threads });
});

/**
 * 自然言語質問をSQLへ変換し、tenant DBの実行結果を返す。
 */
app.post("/api/chat", requireAuth, async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { message?: string; threadId?: string };
  const message = body.message?.trim();
  if (!message) {
    return c.json({ error: { code: "INVALID_REQUEST", message: "質問を入力する必要がある" } }, 400);
  }

  try {
    const response = await handleChat(user, message, body.threadId);
    return c.json(response);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown error";
    const code = messageText.startsWith("SQL_VALIDATION_FAILED")
      ? "SQL_VALIDATION_FAILED"
      : messageText === "TENANT_CONNECTION_NOT_FOUND"
        ? "TENANT_CONNECTION_NOT_FOUND"
        : "CHAT_FAILED";
    return c.json({ error: { code, message: "チャット処理に失敗した" } }, 500);
  }
});
