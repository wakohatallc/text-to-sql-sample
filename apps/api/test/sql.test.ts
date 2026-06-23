import { describe, expect, it } from "vitest";
import { formatSchemaContext, inspectTenantSchema, validateAndNormalizeSql } from "../src/sql";

/**
 * SQL guardrailが読み取り専用SELECTだけを通すことを確認するテスト群である。
 */
describe("validateAndNormalizeSql", () => {
  /**
   * LIMITなしのSELECTに最大100行のLIMITを付与することを検証する。
   */
  it("allows select and adds limit", () => {
    expect(validateAndNormalizeSql("SELECT seller_id FROM sellers")).toBe("SELECT seller_id FROM sellers LIMIT 100");
  });

  /**
   * 大きすぎるLIMITを100へ丸めることを検証する。
   */
  it("caps large limits", () => {
    expect(validateAndNormalizeSql("SELECT seller_id FROM sellers LIMIT 1000")).toBe(
      "SELECT seller_id FROM sellers LIMIT 100"
    );
  });

  /**
   * DMLを拒否することを検証する。
   */
  it("rejects dml", () => {
    expect(() => validateAndNormalizeSql("DELETE FROM sellers")).toThrow(/SQL_VALIDATION_FAILED/);
  });

  /**
   * 危険関数を含むSELECTを拒否することを検証する。
   */
  it("rejects dangerous functions", () => {
    expect(() => validateAndNormalizeSql("SELECT pg_sleep(10)")).toThrow(/SQL_VALIDATION_FAILED/);
  });
});

describe("formatSchemaContext", () => {
  /**
   * inspect結果がtable単位のprompt contextへ変換されることを検証する。
   */
  it("formats inspected columns", () => {
    expect(
      formatSchemaContext([
        {
          tableName: "orders",
          columnName: "order_id",
          dataType: "text",
          ordinalPosition: 1,
          isPrimaryKey: true
        },
        {
          tableName: "orders",
          columnName: "order_purchase_timestamp",
          dataType: "timestamp without time zone",
          ordinalPosition: 2,
          isPrimaryKey: false
        }
      ])
    ).toBe("orders(order_id text primary key, order_purchase_timestamp timestamp without time zone)");
  });
});

describe("inspectTenantSchema", () => {
  /**
   * ローカルDBが利用可能な場合に、許可済みtenant tableのschemaを実DBから取得できることを検証する。
   */
  it("inspects the local tenant schema when database is available", async () => {
    try {
      const columns = await inspectTenantSchema({
        id: "00000000-0000-0000-0000-000000000000",
        accountId: 1,
        host: process.env.POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        databaseName: process.env.POSTGRES_TENANT_DB ?? "data_0001"
      });
      expect(new Set(columns.map((column) => column.tableName))).toEqual(
        new Set([
          "customers",
          "sellers",
          "product_category_translations",
          "products",
          "orders",
          "order_items",
          "order_payments",
          "order_reviews",
          "geolocations"
        ])
      );
      expect(columns.some((column) => column.tableName === "orders" && column.columnName === "order_id")).toBe(true);
      expect(
        columns.some((column) => column.tableName === "orders" && column.columnName === "order_id" && column.isPrimaryKey)
      ).toBe(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/ECONNREFUSED|database .* does not exist|password authentication failed|role .* does not exist/i.test(message)) {
        return;
      }
      throw error;
    }
  });
});
