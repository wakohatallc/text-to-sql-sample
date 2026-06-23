import pg from "pg";
import { config } from "./config";

export const commonPool = new pg.Pool({
  host: config.commonDb.host,
  port: config.commonDb.port,
  database: config.commonDb.database,
  user: config.commonDb.user,
  password: config.commonDb.password,
  max: 5
});

export type DbConnection = {
  id: string;
  accountId: number;
  host: string;
  port: number;
  databaseName: string;
};

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
