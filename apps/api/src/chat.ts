import { openai } from "@ai-sdk/openai";
import type {
  ChatDataParts,
  ChatMetadata,
  SqlResultData,
  TraceData,
  VisualizationData,
  VisualizationKind
} from "@text-to-sql/shared";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
  type UIMessageStreamWriter
} from "ai";
import { z } from "zod";
import { commonPool, getDbConnection, type DbConnection } from "./db";
import type { AuthUser } from "./auth";
import { config } from "./config";
import { chooseVisualization, fallbackSql, systemPrompt } from "./llm";
import {
  executeReadOnlySql,
  formatSchemaContext,
  inspectTenantSchema,
  validateAndNormalizeSql,
  type ExecutedSql
} from "./sql";

/**
 * このアプリで扱うAI SDK UI messageである。
 */
export type AppChatMessage = UIMessage<ChatMetadata, ChatDataParts>;

type SqlAttempt = {
  generatedSql: string;
  normalizedSql: string;
  status: "succeeded" | "failed" | "rejected";
  columns: string[];
  rows: SqlResultData["rows"];
  rowCount: number;
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
};

type CapturedUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const traceSchema = z.object({
  label: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  detail: z.string().optional()
});

/**
 * 質問文からチャットスレッド一覧向けの短いタイトルを作る。
 *
 * @param question ユーザーが入力した自然言語質問。
 * @returns 40文字以内に丸めたスレッドタイトル。
 */
function titleFromQuestion(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  return trimmed.length > 40 ? `${trimmed.slice(0, 39)}...` : trimmed || "新しいチャット";
}

/**
 * 既存スレッドの所有権を確認し、使えない場合は新規スレッドを作成する。
 *
 * @param user 認証済みユーザー。
 * @param threadId クライアントから指定された既存スレッドID。
 * @param question 新規作成時のタイトル生成に使う質問文。
 * @returns 使用するチャットスレッドID。
 */
async function ensureThread(user: AuthUser, threadId: string | undefined, question: string): Promise<string> {
  if (threadId) {
    const result = await commonPool.query(
      `SELECT id
         FROM chat_threads
        WHERE id = $1
          AND account_id = $2
          AND user_id = $3`,
      [threadId, user.accountId, user.id]
    );
    if (result.rowCount === 1) return threadId;
  }

  const result = await commonPool.query<{ id: string }>(
    `INSERT INTO chat_threads (account_id, user_id, title)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [user.accountId, user.id, titleFromQuestion(question)]
  );
  return result.rows[0]!.id;
}

/**
 * 最新user messageから自然言語質問を取り出す。
 *
 * @param messages AI SDK UI messages。
 * @returns 最新user messageのtext。
 */
function latestUserText(messages: AppChatMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user");
  const text = message?.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("INVALID_REQUEST");
  return text;
}

/**
 * UI streamへtrace partを追加する。
 *
 * @param writer UI stream writer。
 * @param trace 作業ログ。
 */
function writeTrace(writer: UIMessageStreamWriter<AppChatMessage>, trace: TraceData): void {
  const parsed = traceSchema.parse(trace);
  writer.write({ type: "data-trace", data: parsed });
}

/**
 * UI streamへSQL実行結果partsを追加する。
 *
 * @param writer UI stream writer。
 * @param sql 正規化済みSQL。
 * @param result SQL実行結果。
 * @param visualization 可視化指定。
 */
function writeSqlResultParts(
  writer: UIMessageStreamWriter<AppChatMessage>,
  sql: string,
  result: SqlResultData,
  visualization: VisualizationData
): void {
  const sqlPart = { sql };
  writer.write({ type: "data-sql", data: sqlPart });
  writer.write({ type: "data-sql-result", data: result });
  writer.write({ type: "data-visualization", data: visualization });
}

/**
 * SQL実行エラーをユーザー・LLMへ返してよい形へ丸める。
 *
 * @param error 捕捉した例外。
 * @returns sanitized error。
 */
function sanitizeSqlError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : "Unknown SQL error";
  if (message.startsWith("SQL_VALIDATION_FAILED")) {
    return { code: "SQL_VALIDATION_FAILED", message };
  }
  return { code: "SQL_EXECUTION_FAILED", message: message.split("\n")[0] ?? "SQL execution failed" };
}

/**
 * DB実行結果をUI向けのJSON互換値に変換する。
 *
 * @param executed SQL実行結果。
 * @returns UI stream用SQL実行結果。
 */
function toSqlResultData(executed: ExecutedSql): SqlResultData {
  return {
    columns: executed.columns,
    rows: executed.rows,
    rowCount: executed.rowCount,
    durationMs: executed.durationMs
  };
}

/**
 * OpenAI token usageを既存DB schemaへ保存する形へ変換する。
 *
 * @param usage AI SDK usage。
 * @returns token数。
 */
function captureUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): CapturedUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0
  };
}

/**
 * 実行済み会話を既存テーブルへ保存する。
 */
async function persistFinishedChat({
  user,
  threadId,
  dbConnection,
  question,
  responseMessage,
  attempts,
  usage
}: {
  user: AuthUser;
  threadId: string;
  dbConnection: DbConnection;
  question: string;
  responseMessage: AppChatMessage;
  attempts: SqlAttempt[];
  usage: CapturedUsage;
}): Promise<void> {
  const userMessageResult = await commonPool.query<{ id: string }>(
    `INSERT INTO chat_messages (account_id, thread_id, role, parts)
     VALUES ($1, $2, 'user', $3::jsonb)
     RETURNING id`,
    [user.accountId, threadId, JSON.stringify([{ type: "text", text: question }])]
  );
  const userMessageId = userMessageResult.rows[0]!.id;

  const assistantMessageResult = await commonPool.query<{ id: string }>(
    `INSERT INTO chat_messages (account_id, thread_id, role, parts)
     VALUES ($1, $2, 'assistant', $3::jsonb)
     RETURNING id`,
    [user.accountId, threadId, JSON.stringify(responseMessage.parts)]
  );
  const assistantMessageId = assistantMessageResult.rows[0]!.id;

  for (const attempt of attempts) {
    await commonPool.query(
      `INSERT INTO sql_runs (
         account_id,
         thread_id,
         message_id,
         db_connection_id,
         database_name,
         generated_sql,
         normalized_sql,
         status,
         columns,
         rows,
         row_count,
         duration_ms,
         error_code,
         error_message
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14)`,
      [
        user.accountId,
        threadId,
        assistantMessageId,
        dbConnection.id,
        dbConnection.databaseName,
        attempt.generatedSql,
        attempt.normalizedSql,
        attempt.status,
        JSON.stringify(attempt.columns),
        JSON.stringify(attempt.rows),
        attempt.rowCount,
        attempt.durationMs,
        attempt.errorCode ?? null,
        attempt.errorMessage ?? null
      ]
    );
  }

  const pricingResult = await commonPool.query<{ id: string }>(
    `SELECT id
       FROM model_pricing_snapshots
      WHERE provider = 'openai'
        AND model_id = $1
      ORDER BY effective_from DESC
      LIMIT 1`,
    [config.openai.model]
  );

  await commonPool.query(
    `INSERT INTO llm_usages (
       account_id,
       user_id,
       thread_id,
       message_id,
       provider,
       model_id,
       input_tokens,
       output_tokens,
       total_tokens,
       estimated_cost_usd,
       pricing_snapshot_id
     )
     VALUES ($1, $2, $3, $4, 'openai', $5, $6, $7, $8, 0, $9)`,
    [
      user.accountId,
      user.id,
      threadId,
      assistantMessageId,
      config.openai.model,
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
      pricingResult.rows[0]?.id ?? null
    ]
  );

  await commonPool.query(
    `UPDATE chat_threads
        SET updated_at = now()
      WHERE id = $1`,
    [threadId]
  );

  void userMessageId;
}

/**
 * SQL toolを実行し、結果またはsanitized errorを返す。
 */
async function runSqlTool({
  sql,
  dbConnection,
  question,
  writer,
  attempts
}: {
  sql: string;
  dbConnection: DbConnection;
  question: string;
  writer: UIMessageStreamWriter<AppChatMessage>;
  attempts: SqlAttempt[];
}): Promise<
  | { ok: true; sql: string; columns: string[]; rows: SqlResultData["rows"]; rowCount: number; durationMs: number }
  | { ok: false; code: string; message: string }
> {
  if (attempts.length >= 3) {
    writeTrace(writer, {
      label: "再試行上限",
      status: "failed",
      detail: "SQL修正は3回までである"
    });
    return { ok: false, code: "MAX_SQL_ATTEMPTS_REACHED", message: "SQL修正は3回までである" };
  }

  writeTrace(writer, { label: "SQL実行", status: "running", detail: `attempt ${attempts.length + 1}` });

  try {
    const normalizedSql = validateAndNormalizeSql(sql);
    const executed = await executeReadOnlySql(dbConnection, normalizedSql);
    const result = toSqlResultData(executed);
    const visualization = chooseVisualization(question, result);
    attempts.push({
      generatedSql: sql,
      normalizedSql,
      status: "succeeded",
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      durationMs: result.durationMs
    });
    writeTrace(writer, {
      label: "SQL実行",
      status: "succeeded",
      detail: `${result.rowCount} rows / ${result.durationMs} ms`
    });
    writeSqlResultParts(writer, normalizedSql, result, visualization);
    return { ok: true, sql: normalizedSql, ...result };
  } catch (error) {
    const sanitized = sanitizeSqlError(error);
    const status = sanitized.code === "SQL_VALIDATION_FAILED" ? "rejected" : "failed";
    attempts.push({
      generatedSql: sql,
      normalizedSql: "",
      status,
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      errorCode: sanitized.code,
      errorMessage: sanitized.message
    });
    writeTrace(writer, {
      label: status === "rejected" ? "SQL拒否" : "SQLエラー",
      status: "failed",
      detail: sanitized.message
    });
    return { ok: false, ...sanitized };
  }
}

/**
 * OpenAI API keyがない場合のローカルfallback streamを作る。
 */
async function streamFallback({
  writer,
  dbConnection,
  question,
  attempts,
  threadId
}: {
  writer: UIMessageStreamWriter<AppChatMessage>;
  dbConnection: DbConnection;
  question: string;
  attempts: SqlAttempt[];
  threadId: string;
}): Promise<void> {
  writer.write({ type: "start", messageMetadata: { threadId } });
  writeTrace(writer, { label: "schema確認", status: "running" });
  const columns = await inspectTenantSchema(dbConnection);
  writeTrace(writer, {
    label: "schema確認",
    status: "succeeded",
    detail: `${new Set(columns.map((column) => column.tableName)).size} tables`
  });
  const result = await runSqlTool({
    sql: fallbackSql(question),
    dbConnection,
    question,
    writer,
    attempts
  });
  const text =
    result.ok && result.rowCount > 0
      ? "OpenAI API keyが未設定であるため、fallback SQLを実行した結果である。"
      : "OpenAI API keyが未設定であり、fallback SQLの実行にも失敗した。";
  writer.write({ type: "text-start", id: "fallback-answer" });
  writer.write({ type: "text-delta", id: "fallback-answer", delta: text });
  writer.write({ type: "text-end", id: "fallback-answer" });
  writer.write({ type: "finish", finishReason: "stop", messageMetadata: { threadId } });
}

/**
 * 自然言語質問をstreaming chatとして処理する。
 */
export async function handleChatStream(
  user: AuthUser,
  messages: AppChatMessage[],
  threadId?: string
): Promise<Response> {
  const question = latestUserText(messages);
  const actualThreadId = await ensureThread(user, threadId, question);
  const dbConnection = await getDbConnection(user.accountId);
  const attempts: SqlAttempt[] = [];
  let usage: CapturedUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  const stream = createUIMessageStream<AppChatMessage>({
    originalMessages: messages,
    execute: async ({ writer }) => {
      if (!config.openai.apiKey) {
        await streamFallback({ writer, dbConnection, question, attempts, threadId: actualThreadId });
        return;
      }

      const tools = {
        inspectSchema: tool({
          description: "Inspect the allowed PostgreSQL tenant schema before writing SQL.",
          inputSchema: z.object({}),
          execute: async () => {
            writeTrace(writer, { label: "schema確認", status: "running" });
            const columns = await inspectTenantSchema(dbConnection);
            const schema = formatSchemaContext(columns);
            writeTrace(writer, {
              label: "schema確認",
              status: "succeeded",
              detail: `${new Set(columns.map((column) => column.tableName)).size} tables`
            });
            return { schema };
          }
        }),
        executeSql: tool({
          description: "Validate and execute one read-only PostgreSQL SELECT SQL. Returns sanitized errors for revision.",
          inputSchema: z.object({
            sql: z.string().describe("One PostgreSQL SELECT statement.")
          }),
          execute: async ({ sql }) =>
            runSqlTool({
              sql,
              dbConnection,
              question,
              writer,
              attempts
            })
        })
      };

      const result = streamText({
        model: openai(config.openai.model),
        system: systemPrompt(),
        messages: await convertToModelMessages(messages, { ignoreIncompleteToolCalls: true }),
        tools,
        stopWhen: stepCountIs(5),
        abortSignal: AbortSignal.timeout(30_000),
        onFinish: ({ totalUsage }) => {
          usage = captureUsage(totalUsage);
        }
      });

      writer.merge(
        result.toUIMessageStream<AppChatMessage>({
          sendStart: true,
          messageMetadata: ({ part }) =>
            part.type === "start" || part.type === "finish" ? { threadId: actualThreadId } : undefined
        })
      );
    },
    onFinish: async ({ responseMessage }) => {
      await persistFinishedChat({
        user,
        threadId: actualThreadId,
        dbConnection,
        question,
        responseMessage,
        attempts,
        usage
      });
    },
    onError: () => "チャット処理に失敗した"
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * UIから来た任意の可視化指定を許可済みkindへ丸める。
 */
export function normalizeVisualizationKind(value: unknown): VisualizationKind {
  return value === "bar" || value === "line" || value === "pie" || value === "table" ? value : "table";
}
