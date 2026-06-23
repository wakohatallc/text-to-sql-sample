import { describe, expect, it } from "vitest";
import { validateAndNormalizeSql } from "../src/sql";

describe("validateAndNormalizeSql", () => {
  it("allows select and adds limit", () => {
    expect(validateAndNormalizeSql("SELECT seller_id FROM sellers")).toBe("SELECT seller_id FROM sellers LIMIT 100");
  });

  it("caps large limits", () => {
    expect(validateAndNormalizeSql("SELECT seller_id FROM sellers LIMIT 1000")).toBe(
      "SELECT seller_id FROM sellers LIMIT 100"
    );
  });

  it("rejects dml", () => {
    expect(() => validateAndNormalizeSql("DELETE FROM sellers")).toThrow(/SQL_VALIDATION_FAILED/);
  });

  it("rejects dangerous functions", () => {
    expect(() => validateAndNormalizeSql("SELECT pg_sleep(10)")).toThrow(/SQL_VALIDATION_FAILED/);
  });
});
