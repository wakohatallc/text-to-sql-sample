/**
 * Web/API間で共有するユーザー情報である。
 */
export type User = {
  id: string;
  accountId: number;
  email: string;
  name: string;
};

/**
 * SQL実行結果の1行を表すJSON互換の行データである。
 */
export type SqlResultRow = Record<string, string | number | boolean | null>;

/**
 * 自然言語チャットをSQLへ変換し、実行した結果を返すAPIレスポンスである。
 */
export type ChatResponse = {
  threadId: string;
  assistantMessage: string;
  sql: string;
  columns: string[];
  rows: SqlResultRow[];
  rowCount: number;
  durationMs: number;
  generationMode: "openai" | "fallback";
};

/**
 * チャット履歴一覧に表示するスレッド概要である。
 */
export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
