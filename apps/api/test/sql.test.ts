import { describe, expect, it } from "vitest";
import { validateAndNormalizeSql } from "../src/sql";

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
