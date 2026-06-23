import "dotenv/config";
import { config as loadDotenv } from "dotenv";

/**
 * ローカル実行時の`.env.local`を読み込み、既存の環境変数を優先する。
 */
loadDotenv({ path: ".env.local", override: false });

/**
 * PostgreSQL管理ユーザーの既定値である。
 *
 * Homebrew PostgreSQLでは`postgres`ロールにDB作成権限がない場合があるため、
 * 明示指定がなければOSユーザー名のロールを優先する。
 */
const defaultAdminUser = process.env.POSTGRES_USER ?? process.env.USER ?? "postgres";

/**
 * APIサーバ、DB、OpenAI、Cookieセッションのランタイム設定である。
 */
export const config = {
  port: Number(process.env.API_PORT ?? "3001"),
  commonDb: {
    host: process.env.POSTGRES_HOST ?? "localhost",
    port: Number(process.env.POSTGRES_PORT ?? "5432"),
    database: process.env.POSTGRES_COMMON_DB ?? "common",
    user: defaultAdminUser,
    password: process.env.POSTGRES_PASSWORD || undefined
  },
  tenantReadonly: {
    user: process.env.TENANT_READONLY_USER ?? "tenant_readonly",
    password: process.env.TENANT_READONLY_PASSWORD ?? "tenant_readonly"
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini"
  },
  session: {
    cookieName: "sid",
    maxAgeSeconds: 60 * 60 * 24 * 14
  }
} as const;
