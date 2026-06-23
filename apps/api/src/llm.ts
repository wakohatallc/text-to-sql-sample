import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { config } from "./config";
import { schemaContext } from "./schema-context";

/**
 * SQL生成処理の出力である。
 */
export type GeneratedSql = {
  sql: string;
  explanation: string;
  generationMode: "openai" | "fallback";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

/**
 * LLMの構造化出力として期待するSQL候補のschemaである。
 */
const sqlSchema = z.object({
  sql: z.string(),
  explanation: z.string()
});

/**
 * MVP代表ユースケースに該当する質問かどうかを判定する。
 *
 * @param question ユーザーが入力した自然言語質問。
 * @returns 2018年売上ランキング質問であればtrue。
 */
function isCanonicalSalesRankingQuestion(question: string): boolean {
  return /2018/i.test(question) && /売り上げ|売上/i.test(question) && /ランキング|上位|top/i.test(question);
}

/**
 * 計画書で定義した代表ユースケース用のcanonical SQLを返す。
 *
 * @returns 2018年のseller別売上ランキングSQL。
 */
function canonicalSalesRankingSql(): string {
  return `
    SELECT
      oi.seller_id,
      SUM(oi.price) AS total_sales,
      COUNT(DISTINCT o.order_id) AS order_count
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_purchase_timestamp >= TIMESTAMP '2018-01-01 00:00:00'
      AND o.order_purchase_timestamp < TIMESTAMP '2019-01-01 00:00:00'
    GROUP BY oi.seller_id
    ORDER BY total_sales DESC
    LIMIT 10
  `;
}

/**
 * OpenAI APIが使えない場合でもローカル検証を完了できるSQLを返す。
 *
 * @param question ユーザーが入力した自然言語質問。
 * @returns fallbackとして実行するSELECT SQL。
 */
function fallbackSql(question: string): string {
  if (isCanonicalSalesRankingQuestion(question)) {
    return canonicalSalesRankingSql();
  }

  return `
    SELECT
      COUNT(*) AS order_count,
      MIN(order_purchase_timestamp) AS first_order_at,
      MAX(order_purchase_timestamp) AS last_order_at
    FROM orders
  `;
}

/**
 * 自然言語質問からPostgreSQL向けSELECT SQLを生成する。
 *
 * MVP代表質問は結果の揺れを避けるためcanonical SQLを優先し、それ以外はOpenAIの構造化出力を使う。
 * OpenAI API key未設定または生成失敗時はローカルfallback SQLへ切り替える。
 *
 * @param question ユーザーが入力した自然言語質問。
 * @returns SQL、説明、生成経路、token利用量。
 */
export async function generateSql(question: string): Promise<GeneratedSql> {
  if (isCanonicalSalesRankingQuestion(question)) {
    return {
      sql: canonicalSalesRankingSql(),
      explanation: "MVP代表ユースケースのため、計画書のcanonical SQLを使った。",
      generationMode: "fallback",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }

  if (!config.openai.apiKey) {
    return {
      sql: fallbackSql(question),
      explanation: "OpenAI API keyが未設定であるため、ローカルfallback SQLを使った。",
      generationMode: "fallback",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }

  try {
    const result = await generateText({
      model: openai(config.openai.model),
      output: Output.object({ schema: sqlSchema }),
      abortSignal: AbortSignal.timeout(15_000),
      system: [
        "You are a senior PostgreSQL text-to-SQL generator.",
        "Return one safe PostgreSQL SELECT statement only in the sql field.",
        "Do not return DDL, DML, COPY, CALL, DO, multiple statements, comments, or explanatory text inside SQL.",
        schemaContext
      ].join("\n\n"),
      prompt: `User question: ${question}`
    });

    return {
      sql: result.output.sql,
      explanation: result.output.explanation,
      generationMode: "openai",
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        totalTokens: result.usage.totalTokens ?? 0
      }
    };
  } catch {
    return {
      sql: fallbackSql(question),
      explanation: "OpenAI SQL生成が失敗したため、ローカルfallback SQLを使った。",
      generationMode: "fallback",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    };
  }
}
