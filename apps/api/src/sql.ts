import { parse } from "pgsql-ast-parser";
import type { DbConnection } from "./db";
import { createTenantPool } from "./db";

const blockedPattern =
  /\b(insert|update|delete|merge|create|alter|drop|truncate|copy|call|do|grant|revoke|vacuum|analyze|listen|notify|set|reset|show)\b/i;
const dangerousFunctionPattern = /\b(pg_sleep|dblink|lo_import|lo_export|pg_read_file|pg_ls_dir)\s*\(/i;

export type ExecutedSql = {
  columns: string[];
  rows: Record<string, string | number | boolean | null>[];
  rowCount: number;
  durationMs: number;
};

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
