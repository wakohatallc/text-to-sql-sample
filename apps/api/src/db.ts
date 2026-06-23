import pg from "pg";
import { config } from "./config";

/**
 * 認証、接続定義、チャット履歴、利用量を保持する共通DBへの接続プールである。
 */
export const commonPool = new pg.Pool({
  host: config.commonDb.host,
  port: config.commonDb.port,
  database: config.commonDb.database,
  user: config.commonDb.user,
  password: config.commonDb.password,
  max: 5
});

/**
 * アカウントに紐づくtenant DB接続定義である。
 */
export type DbConnection = {
  id: string;
  accountId: number;
  host: string;
  port: number;
  databaseName: string;
};

/**
 * 共通DBの`db_connections`から、指定アカウントの有効なtenant接続先を取得する。
 *
 * @param accountId tenant接続先を解決するアカウントID。
 * @returns 有効なtenant DB接続定義。
 * @throws 有効な接続定義が存在しない場合は`TENANT_CONNECTION_NOT_FOUND`を投げる。
 */
export async function getDbConnection(accountId: number): Promise<DbConnection> {
  const result = await commonPool.query<{
    id: string;
    account_id: string;
    host: string;
    port: number;
    database_name: string;
  }>(
    `SELECT id, account_id, host, port, database_name
       FROM db_connections
      WHERE account_id = $1 AND enabled = true
      LIMIT 1`,
    [accountId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("TENANT_CONNECTION_NOT_FOUND");
  }

  return {
    id: row.id,
    accountId: Number(row.account_id),
    host: row.host,
    port: row.port,
    databaseName: row.database_name
  };
}

/**
 * tenant DBへ読み取り専用ユーザーで接続するための短命な接続プールを作成する。
 *
 * @param connection 共通DBから解決したtenant DB接続定義。
 * @returns tenant DB向けPostgreSQL接続プール。
 */
export function createTenantPool(connection: DbConnection): pg.Pool {
  return new pg.Pool({
    host: connection.host,
    port: connection.port,
    database: connection.databaseName,
    user: config.tenantReadonly.user,
    password: config.tenantReadonly.password,
    max: 2
  });
}
