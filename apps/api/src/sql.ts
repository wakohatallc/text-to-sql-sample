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
 * LLMに公開してよいtenant DB schema情報である。
 */
export type InspectedColumn = {
  tableName: string;
  columnName: string;
  dataType: string;
  ordinalPosition: number;
  isPrimaryKey: boolean;
};

/**
 * Text-to-SQLで参照を許可するtenant tableである。
 */
const allowedTables = [
  "customers",
  "sellers",
  "product_category_translations",
  "products",
  "orders",
  "order_items",
  "order_payments",
  "order_reviews",
  "geolocations"
] as const;

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

/**
 * tenant DBからText-to-SQL用のschema metadataを取得する。
 *
 * @param connection tenant DB接続定義。
 * @returns 許可tableのcolumn metadata。
 */
export async function inspectTenantSchema(connection: DbConnection): Promise<InspectedColumn[]> {
  const pool = createTenantPool(connection);
  const client = await pool.connect();

  try {
    const result = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      ordinal_position: number;
      is_primary_key: boolean;
    }>(
      `SELECT
         c.table_name,
         c.column_name,
         c.data_type,
         c.ordinal_position,
         EXISTS (
           SELECT 1
             FROM pg_index i
             JOIN pg_class t ON t.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_attribute a ON a.attrelid = t.oid
            WHERE n.nspname = c.table_schema
              AND t.relname = c.table_name
              AND a.attname = c.column_name
              AND i.indisprimary
              AND a.attnum = ANY(i.indkey)
         ) AS is_primary_key
       FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND c.table_name = ANY($1::text[])
       ORDER BY c.table_name, c.ordinal_position`,
      [allowedTables]
    );

    return result.rows.map((row) => ({
      tableName: row.table_name,
      columnName: row.column_name,
      dataType: row.data_type,
      ordinalPosition: row.ordinal_position,
      isPrimaryKey: row.is_primary_key
    }));
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * schema metadataをLLM prompt向けの短い文字列へ整形する。
 *
 * @param columns inspectTenantSchemaで取得したcolumn metadata。
 * @returns table単位のschema context。
 */
export function formatSchemaContext(columns: InspectedColumn[]): string {
  const grouped = new Map<string, InspectedColumn[]>();
  for (const column of columns) {
    const tableColumns = grouped.get(column.tableName) ?? [];
    tableColumns.push(column);
    grouped.set(column.tableName, tableColumns);
  }

  return Array.from(grouped.entries())
    .map(([tableName, tableColumns]) => {
      const fields = tableColumns
        .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
        .map((column) => `${column.columnName} ${column.dataType}${column.isPrimaryKey ? " primary key" : ""}`)
        .join(", ");
      return `${tableName}(${fields})`;
    })
    .join("\n");
}
