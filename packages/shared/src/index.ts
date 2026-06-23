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
 * ユーザーへ公開してよい、観測可能な作業ログである。
 */
export type TraceData = {
  label: string;
  status: "running" | "succeeded" | "failed";
  detail?: string;
};

/**
 * UIへstreamするSQL本文である。
 */
export type SqlData = {
  sql: string;
};

/**
 * UIへstreamするSQL実行結果である。
 */
export type SqlResultData = {
  columns: string[];
  rows: SqlResultRow[];
  rowCount: number;
  durationMs: number;
};

/**
 * SQL結果の描画形式である。
 */
export type VisualizationKind = "table" | "bar" | "line" | "pie";

/**
 * UIへstreamする可視化指定である。
 */
export type VisualizationData = {
  kind: VisualizationKind;
  xKey?: string;
  yKey?: string;
  seriesKey?: string;
};

/**
 * AI SDK UI messageのcustom data partsである。
 */
export type ChatDataParts = {
  trace: TraceData;
  sql: SqlData;
  "sql-result": SqlResultData;
  visualization: VisualizationData;
};

/**
 * assistant message metadataである。
 */
export type ChatMetadata = {
  threadId?: string;
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
