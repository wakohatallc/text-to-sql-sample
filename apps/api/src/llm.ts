import type { SqlResultData, VisualizationData, VisualizationKind } from "@text-to-sql/shared";

/**
 * MVP代表ユースケースに該当する質問かどうかを判定する。
 *
 * @param question ユーザーが入力した自然言語質問。
 * @returns 2018年売上ランキング質問であればtrue。
 */
export function isCanonicalSalesRankingQuestion(question: string): boolean {
  return /2018/i.test(question) && /売り上げ|売上/i.test(question) && /ランキング|上位|top/i.test(question);
}

/**
 * 計画書で定義した代表ユースケース用のcanonical SQLを返す。
 *
 * @returns 2018年のseller別売上ランキングSQL。
 */
export function canonicalSalesRankingSql(): string {
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
export function fallbackSql(question: string): string {
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
 * ユーザー指定と結果列から初期可視化を選ぶ。
 *
 * @param question ユーザーが入力した自然言語質問。
 * @param result SQL実行結果。
 * @returns UIへ渡す可視化指定。
 */
export function chooseVisualization(question: string, result: SqlResultData): VisualizationData {
  const requestedKind = requestedVisualizationKind(question);
  const xKey = result.columns.find((column) => result.rows.some((row) => typeof row[column] === "string"));
  const yKey = result.columns.find((column) => result.rows.some((row) => typeof row[column] === "number"));

  if (requestedKind === "table" || !xKey || !yKey) {
    return { kind: "table" };
  }

  return { kind: requestedKind, xKey, yKey };
}

/**
 * Text-to-SQL agentのsystem promptを作る。
 *
 * @returns system prompt。
 */
export function systemPrompt(): string {
  return [
    "You are a senior PostgreSQL text-to-SQL analyst for a SaaS analytics UI.",
    "Always call inspectSchema before writing SQL.",
    "Use executeSql to run a safe read-only SELECT. If executeSql returns an error, revise the SQL and call executeSql again.",
    "Do not expose hidden chain-of-thought. Explain only concise, user-facing observations.",
    "Only produce answers from executed SQL results.",
    "Supported visualizations are table, bar, line, and pie.",
    "If the user asks for a table, choose table. If the user asks for a bar chart, line chart, or pie chart, say that the result is shown in that chart.",
    "Business rules:",
    "- \"2018年\" means order_purchase_timestamp >= TIMESTAMP '2018-01-01 00:00:00' and < TIMESTAMP '2019-01-01 00:00:00'.",
    "- \"売り上げ\" or \"売上\" means SUM(order_items.price), unless the user explicitly asks for payment amount.",
    "- Ranking should use ORDER BY in descending order and a LIMIT when the user asks for top N."
  ].join("\n");
}

function requestedVisualizationKind(question: string): VisualizationKind {
  if (/テーブル|表|table/i.test(question)) return "table";
  if (/棒グラフ|bar/i.test(question)) return "bar";
  if (/折れ線|line/i.test(question)) return "line";
  if (/円グラフ|pie/i.test(question)) return "pie";
  return "table";
}
