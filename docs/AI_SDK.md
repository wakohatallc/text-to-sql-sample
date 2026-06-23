# AI SDK

このドキュメントは、Text-to-SQL処理におけるVercel AI SDKの利用方法をまとめたものである。

参照元:

- [docs/arch.md](./arch.md)
- [apps/api/src/llm.ts](../apps/api/src/llm.ts)
- [apps/api/src/schema-context.ts](../apps/api/src/schema-context.ts)
- [apps/api/src/chat.ts](../apps/api/src/chat.ts)
- [apps/api/src/sql.ts](../apps/api/src/sql.ts)
- [apps/api/src/config.ts](../apps/api/src/config.ts)
- [apps/api/package.json](../apps/api/package.json)

## 位置づけ

Vercel AI SDKは、自然言語からSQL候補を生成するLLM呼び出しの薄いadapterとしてだけ使っている。認証、tenant解決、SQL検証、SQL実行、履歴保存はAI SDKへ委譲せず、アプリケーション側で制御する。

利用箇所は `apps/api/src/llm.ts` である。`apps/web` ではAI SDKを直接使っていない。

```ts
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
```

## 役割分担

| ファイル | 役割 |
| --- | --- |
| `apps/api/package.json` | `ai` と `@ai-sdk/openai` をAPI側dependencyとして持つ |
| `apps/api/src/config.ts` | `OPENAI_API_KEY` と `OPENAI_MODEL` をサーバ環境変数から読む |
| `apps/api/src/llm.ts` | AI SDKを呼び、`sql` / `explanation` の構造化出力を受け取る |
| `apps/api/src/chat.ts` | `generateSql` の結果をSQL検証・実行へ渡し、token usageを `llm_usages` に保存する |
| `apps/api/src/schema-context.ts` | LLMへ渡す固定schema contextを定義する |
| `apps/api/src/sql.ts` | AI SDKの出力を信用せず、実行前に必ずSQLを検証・正規化する |

実行時の呼び出し経路は次である。

```text
POST /api/chat
  -> handleChat(user, question, threadId)
    -> generateSql(question)
      -> generateText({ model: openai(config.openai.model), output: Output.object({ schema }), system, prompt })
    -> validateAndNormalizeSql(generated.sql)
    -> executeReadOnlySql(...)
    -> chat_messages / sql_runs / llm_usages へ保存
```

## 構造化出力

`generateText` と `Output.object` を使う理由は、LLM出力を自由文ではなくZod schemaに合わせたobjectとして受け取るためである。

```ts
const sqlSchema = z.object({
  sql: z.string(),
  explanation: z.string()
});
```

`apps/api/src/llm.ts` は、AI SDKから返る `result.output.sql` をSQL候補、`result.output.explanation` を生成理由として扱う。加えて `result.usage` から `inputTokens`、`outputTokens`、`totalTokens` を取得し、`apps/api/src/chat.ts` が `llm_usages` に保存する。

現在の実装は `ai` v6系の `generateText` と `Output.object` を前提にしている。将来AI SDKの構造化出力APIが変わる場合も、`apps/api/src/llm.ts` のadapter部分だけを更新する。

## Tool Calling

現在の実装では、AI SDKのtool callingは使っていない。`tool(...)` や `tools` は定義しておらず、LLMにSQL検証やSQL実行をtoolとして選択させる設計ではない。

AI SDKは構造化されたSQL候補の生成だけを担当する。SQL検証とSQL実行は常にサーバ側の通常処理として実行する。この境界により、LLMがSQL実行可否を判断することを避けている。

将来、対話的なSQL修正やschema inspectionを導入する場合は、`inspectSchema` や `proposeSql` のような限定的なtool callingを検討できる。ただし、`validateSql` と `executeSql` はLLMの任意判断に依存させず、サーバ側の必須処理として残す。

## Prompt

AI SDKへ渡すpromptは2層で構成している。

- `system`: PostgreSQL向けText-to-SQL generatorとしての役割、安全な単一SELECTだけを返す制約、固定schema contextを渡す。
- `prompt`: ユーザーの自然言語質問を `User question: ...` として渡す。

実際のsystem promptは次の要素を改行で連結する。

```text
You are a senior PostgreSQL text-to-SQL generator.

Return one safe PostgreSQL SELECT statement only in the sql field.

Do not return DDL, DML, COPY, CALL, DO, multiple statements, comments, or explanatory text inside SQL.

<schemaContext>
```

`schemaContext` は `apps/api/src/schema-context.ts` に定義した固定文字列であり、LLMへ渡すtenant DBのスキーマ情報と業務ルールを含む。現状ではDBから動的に introspection しているわけではない。

含めているテーブルは次である。

- `customers`
- `sellers`
- `product_category_translations`
- `products`
- `orders`
- `order_items`
- `order_payments`
- `order_reviews`
- `geolocations`

含めている主な業務ルールは次である。

- 「2018年」は `order_purchase_timestamp >= TIMESTAMP '2018-01-01 00:00:00'` かつ `< TIMESTAMP '2019-01-01 00:00:00'` と解釈する。
- 「売り上げ」または「売上」は、ユーザーが支払額を明示しない限り `SUM(order_items.price)` と解釈する。
- rankingは降順 `ORDER BY` と、top N指定に応じた `LIMIT` を使う。
- 返すSQLはPostgreSQLの `SELECT` のみとする。

この固定schema contextがあるため、LLMは `orders` と `order_items` のjoin、`price` の集計、日時カラムの条件指定などを推論できる。逆に、この情報にないテーブル・カラム・リレーションを正しく扱うことは期待しない。

## 分岐

すべての質問でAI SDKを呼ぶわけではない。MVP代表質問は結果を安定させるためcanonical SQLを返す。

また、`OPENAI_API_KEY` 未設定時や生成失敗時もfallback SQLを返す。この場合 `generationMode` は `fallback`、token usageは0で保存される。

モデルは `model: openai(config.openai.model)` で指定する。モデル名は `OPENAI_MODEL` で差し替え可能で、未指定時は `gpt-4.1-mini` を使う。`OPENAI_API_KEY` はサーバ側環境変数としてだけ扱い、ブラウザへ渡さない。

## 安全境界

重要な境界は、AI SDKが「SQL候補を生成するだけ」である点である。SQLを実行してよいかは `apps/api/src/sql.ts` のguardrailが決める。したがって、LLMが危険なSQLや複数statementを返しても、tenant DB実行前に拒否または正規化される。

SQL実行はtenant DBの読み取り専用ユーザーで行い、実行時にも `BEGIN READ ONLY` と `statement_timeout` を使う。このため、LLM出力を直接DBへ渡す構成にはしていない。

## 現状の弱点

`schemaContext` が実DBスキーマから自動生成されていない点が弱点である。migrationでテーブルやカラムが変わった場合は、`apps/api/src/schema-context.ts` も合わせて更新する必要がある。

将来の改善では、`information_schema` や許可済みschema metadataからプロンプト用schema contextを生成し、DB定義とLLM入力のズレを避ける。
