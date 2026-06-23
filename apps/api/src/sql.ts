import { parse } from "pgsql-ast-parser";
import type { DbConnection } from "./db";
import { createTenantPool } from "./db";

/**
 * SELECT以外の操作や管理系SQLを拒否するためのキーワード検出である。
 */
const blockedPattern =
  /\b(insert|update|delete|merge|create|alter|drop|truncate|copy|call|do|grant|revoke|vacuum|analyze|listen|notify|set|reset|show)\b/i;

/**
 * 読み取り用途でも副作用や遅延が大きい危険関数を拒否するための検出である。
 */
const dangerousFunctionPattern = /\b(pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_ls_dir)\s*\(/i;

/**
 * tenant DBで実行したSQL結果の標準表現である。
 */
export type ExecutedSql = {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  durationMs: number;
};

/**
 * SQLをASTで検証し、単一SELECTかつ最大100行に正規化する。
 *
 * @param inputSql LLMまたはfallbackが生成したSQL候補。
 * @returns 実行可能な正規化済みSQL。
 * @throws SQL安全条件を満たさない場合は`SQL_VALIDATION_FAILED`を投げる。
 */
export function validateAndNormalizeSql(inputSql: string): string {
  const sql = inputSql.trim().replace(/;+\s*$/g, "");
  if (!sql) throw new Error("SQL_VALIDATION_FAILED: Empty SQL");
  if (blockedPattern.test(sql)) throw new Error("SQL_VALIDATION_FAILED: Blocked statement or keyword");
  if (dangerousFunctionPattern.test(sql)) throw new Error("SQL_VALIDATION_FAILED: Dangerous function");

  const statements = parse(sql);
  if (statements.length !== 1) throw new Error("SQL_VALIDATION_FAILED: Only single statement is allowed");

  const statement = statements[0] as { type?: string };
  if (statement.type !== "select") {
    throw new Error("SQL_VALIDATION_FAILED: Only SELECT or WITH statements are allowed");
  }

  if (/\blimit\s+\d+/i.test(sql)) {
    return sql.replace(/\blimit\s+(\d+)/i, (_match, limit: string) => `LIMIT ${Math.min(Number(limit), 100)}`);
  }

  return `${sql} LIMIT 100`;
}

/**
 * tenant DBへ読み取り専用transactionでSQLを実行する。
 *
 * @param connection tenant DB接続定義。
 * @param sql 検証済みのSELECT SQL。
 * @returns 列名、行、行数、実行時間。
 */
export async function executeReadOnlySql(connection: DbConnection, sql: string): Promise<ExecutedSql> {
  const pool = createTenantPool(connection);
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query<Record<string, string | number | boolean | null>>(sql);
    await client.query("COMMIT");

    return {
      columns: result.fields.map((field) => field.name),
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
