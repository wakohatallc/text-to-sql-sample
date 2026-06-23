import type { ChatResponse } from "@text-to-sql/shared";
import { commonPool, getDbConnection } from "./db";
import type { AuthUser } from "./auth";
import { generateSql } from "./llm";
import { executeReadOnlySql, validateAndNormalizeSql } from "./sql";

function titleFromQuestion(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  return trimmed.length > 40 ? `${trimmed.slice(0, 39)}...` : trimmed || "新しいチャット";
}

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

export async function handleChat(user: AuthUser, question: string, threadId?: string): Promise<ChatResponse> {
  const actualThreadId = await ensureThread(user, threadId, question);
  const dbConnection = await getDbConnection(user.accountId);
  const generated = await generateSql(question);
  const normalizedSql = validateAndNormalizeSql(generated.sql);
  const executed = await executeReadOnlySql(dbConnection, normalizedSql);

  const userMessageResult = await commonPool.query<{ id: string }>(
    `INSERT INTO chat_messages (account_id, thread_id, role, parts)
     VALUES ($1, $2, 'user', $3::jsonb)
     RETURNING id`,
    [user.accountId, actualThreadId, JSON.stringify([{ type: "text", text: question }])]
  );
  const userMessageId = userMessageResult.rows[0]!.id;

  const assistantText = "SQLを実行した結果である。";
  const assistantParts = [
    { type: "text", text: assistantText },
    { type: "data-sql", data: { sql: normalizedSql } },
    { type: "data-sql-result", data: { columns: executed.columns, rows: executed.rows } }
  ];

  const assistantMessageResult = await commonPool.query<{ id: string }>(
    `INSERT INTO chat_messages (account_id, thread_id, role, parts)
     VALUES ($1, $2, 'assistant', $3::jsonb)
     RETURNING id`,
    [user.accountId, actualThreadId, JSON.stringify(assistantParts)]
  );
  const assistantMessageId = assistantMessageResult.rows[0]!.id;

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
       duration_ms
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded', $8::jsonb, $9::jsonb, $10, $11)`,
    [
      user.accountId,
      actualThreadId,
      assistantMessageId,
      dbConnection.id,
      dbConnection.databaseName,
      generated.sql,
      normalizedSql,
      JSON.stringify(executed.columns),
      JSON.stringify(executed.rows),
      executed.rowCount,
      executed.durationMs
    ]
  );

  const pricingResult = await commonPool.query<{ id: string }>(
    `SELECT id
       FROM model_pricing_snapshots
      WHERE provider = 'openai'
        AND model_id = $1
      ORDER BY effective_from DESC
      LIMIT 1`,
    [process.env.OPENAI_MODEL ?? "gpt-4.1-mini"]
  );

  const pricingSnapshotId = pricingResult.rows[0]?.id ?? null;
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
      actualThreadId,
      assistantMessageId,
      process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
      generated.usage.inputTokens,
      generated.usage.outputTokens,
      generated.usage.totalTokens,
      pricingSnapshotId
    ]
  );

  await commonPool.query(
    `UPDATE chat_threads
        SET updated_at = now()
      WHERE id = $1`,
    [actualThreadId]
  );

  void userMessageId;

  return {
    threadId: actualThreadId,
    assistantMessage: assistantText,
    sql: normalizedSql,
    columns: executed.columns,
    rows: executed.rows,
    rowCount: executed.rowCount,
    durationMs: executed.durationMs,
    generationMode: generated.generationMode
  };
}
