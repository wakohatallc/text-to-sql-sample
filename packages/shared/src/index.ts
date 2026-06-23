export type User = {
  id: string;
  accountId: number;
  email: string;
  name: string;
};

export type SqlResultRow = Record<string, string | number | boolean | null>;

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

export type ChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};
