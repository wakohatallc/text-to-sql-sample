# AI SDK

このドキュメントは、Text-to-SQL処理におけるVercel AI SDKの現在の利用方法をまとめたものである。

参照元:

- [apps/api/src/chat.ts](../apps/api/src/chat.ts)
- [apps/api/src/llm.ts](../apps/api/src/llm.ts)
- [apps/api/src/sql.ts](../apps/api/src/sql.ts)
- [apps/api/src/config.ts](../apps/api/src/config.ts)
- [apps/web/src/main.tsx](../apps/web/src/main.tsx)
- [packages/shared/src/index.ts](../packages/shared/src/index.ts)
- [apps/api/package.json](../apps/api/package.json)
- [apps/web/package.json](../apps/web/package.json)

## 位置づけ

Vercel AI SDKは、ストリーミングチャット、multi-step tool calling、UI message streamのために使っている。現在の実装は `generateText` と構造化出力ではなく、`streamText` と `tool(...)` を使う軽量なagent loopである。

認証、tenant解決、SQL検証、SQL実行、履歴保存、利用量保存はアプリケーション側で制御する。LLMはSQLを提案し、toolを呼ぶが、SQLを安全に実行してよいかは常にサーバ側のguardrailが決める。

主な利用箇所は次である。

```ts
import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool
} from "ai";
```

Web側では `@ai-sdk/react` の `useChat` と `ai` の `DefaultChatTransport` を使う。

## 役割分担

| ファイル | 役割 |
| --- | --- |
| `apps/api/src/chat.ts` | `/api/chat` のstream処理、tool定義、SQL試行履歴、永続化 |
| `apps/api/src/llm.ts` | system prompt、fallback SQL、可視化種別選択 |
| `apps/api/src/sql.ts` | schema introspection、SQL検証、read-only SQL実行 |
| `apps/api/src/config.ts` | `OPENAI_API_KEY` と `OPENAI_MODEL` をサーバ環境変数から読む |
| `apps/web/src/main.tsx` | `useChat` によるstream受信、trace/SQL/表/チャート描画 |
| `packages/shared/src/index.ts` | UI message custom data partsとmetadataの共有型 |

実行時の呼び出し経路は次である。

```text
POST /api/chat
  -> handleChatStream(user, messages, threadId)
    -> ensureThread(...)
    -> getDbConnection(...)
    -> createUIMessageStream(...)
      -> streamText({
           model: openai(config.openai.model),
           system: systemPrompt(),
           messages: convertToModelMessages(messages),
           tools: { inspectSchema, executeSql },
           stopWhen: stepCountIs(5)
         })
      -> inspectSchema tool
         -> inspectTenantSchema(...)
         -> formatSchemaContext(...)
      -> executeSql tool
         -> validateAndNormalizeSql(...)
         -> executeReadOnlySql(...)
         -> data-sql / data-sql-result / data-visualization をstream
    -> onFinish
      -> chat_messages / sql_runs / llm_usages へ保存
```

## Tool Calling

現在のtoolは2つである。

| Tool | 役割 |
| --- | --- |
| `inspectSchema` | tenant DBの許可済みtable/column/type/primary keyを取得し、LLMへschema contextとして返す |
| `executeSql` | SQLを検証・正規化し、読み取り専用transactionで実行する |

`systemPrompt()` は、SQLを書く前に必ず `inspectSchema` を呼び、SQL実行でエラーが返った場合はSQLを修正して `executeSql` を再実行するよう指示する。

`executeSql` は最大3回までの試行に制限している。失敗時はDBや内部詳細をそのまま漏らさず、`SQL_VALIDATION_FAILED` または `SQL_EXECUTION_FAILED` と短いmessageへ丸めてLLMへ返す。検証拒否、DB実行失敗、成功はいずれも `sql_runs` に保存する。

AI SDKのmulti-step停止条件は、導入済みバージョンのAPIに合わせて `stepCountIs(5)` を使う。これはtool結果を受けた後の追加stepを最大5stepまで許可するための上限である。

## UI Message Stream

`POST /api/chat` はJSONではなくAI SDK UI message streamを返す。Web側は `useChat<AppChatMessage>` でstreamを受け取り、`messages[].parts` を描画する。

custom data partsは `packages/shared/src/index.ts` で定義している。

| Part | 内容 |
| --- | --- |
| `data-trace` | schema確認、SQL実行、SQL拒否、SQLエラーなどの作業ログ |
| `data-sql` | 正規化済みSQL |
| `data-sql-result` | `columns`、`rows`、`rowCount`、`durationMs` |
| `data-visualization` | `table`、`bar`、`line`、`pie` と描画キー |

`data-trace` はユーザーへ公開してよい観測可能な作業ログである。隠れたchain-of-thoughtは出さない。

assistant message metadataには `threadId` を含める。Web側は `onFinish` で `message.metadata.threadId` を読み、次回送信時に `{ body: { threadId } }` として渡す。

## グラフ描画

グラフ描画は、LLMが画像やReact componentを生成する仕組みではない。SQL実行結果をtyped dataとしてstreamし、Web UIが決定的に描画する。

流れは次である。

```text
user message
  -> executeSql tool
    -> validateAndNormalizeSql(...)
    -> executeReadOnlySql(...)
    -> chooseVisualization(question, result)
    -> data-sql-result / data-visualization をstream
  -> Web
    -> data-visualization.kind を読む
    -> ResultChart が table / bar / line / pie を描画
```

`chooseVisualization()` はユーザーの自然言語指示から初期表示形式を選ぶ。

| ユーザー指示 | `data-visualization.kind` |
| --- | --- |
| `テーブル`、`表`、`table` | `table` |
| `棒グラフ`、`bar` | `bar` |
| `折れ線`、`line` | `line` |
| `円グラフ`、`pie` | `pie` |

グラフ描画には、SQL結果のうち文字列列をx軸候補、数値列をy軸候補として使う。該当列がない場合、または可視化指定が成立しない場合は表へfallbackする。これにより、LLMに任意のchart configを生成させず、UI側で扱える安全な表示形式だけに限定している。

現在の初期実装では、可視化指定は「そのリクエストで実行されたSQL結果」に対して付与する。前回のSQL結果を再実行せずに「同じ結果を棒グラフにして」といった再描画だけを行う場合は、Web側で直近の `data-sql-result` を再利用して `data-visualization` だけを差し替える経路を追加する必要がある。

## グラフ描画をtool化しない理由

グラフ描画はtoolにしていない。理由は、toolの責務を外部状態の確認・副作用のある処理・安全境界が必要な処理に限定するためである。

現在のtoolは `inspectSchema` と `executeSql` である。どちらもDBアクセスを伴い、tenant境界、SQL guardrail、監査ログが必要である。一方、グラフ描画はすでに取得済みの `columns` と `rows` を表示するだけの純粋なUI変換であり、DBや外部サービスへアクセスしない。

グラフ描画をtool化すると、次の問題が増える。

- chart config生成をLLMに任せることになり、UI表示が不安定になる。
- tool surfaceが広がり、検証すべき入出力schemaが増える。
- 同じSQL結果の表示切り替えにもLLM round tripが必要になる。
- React/Rechartsの実装詳細がLLM toolの契約に漏れやすくなる。

そのため、サーバは `data-visualization` という小さな宣言的specだけをstreamし、実際の描画はWeb UIの責務にしている。将来、より高度な可視化推薦が必要になった場合も、tool化する対象は「可視化specの提案」までに留め、実際の描画は引き続きclient componentで行う。

## Prompt

promptは `apps/api/src/llm.ts` の `systemPrompt()` で管理する。主な制約は次である。

- SQL作成前に `inspectSchema` を必ず呼ぶ。
- SQL実行は `executeSql` toolで行う。
- `executeSql` がエラーを返した場合はSQLを修正して再試行する。
- hidden chain-of-thoughtは出さず、ユーザー向けの短い観測だけを返す。
- 実行済みSQL結果に基づいて回答する。
- 可視化は `table`、`bar`、`line`、`pie` をサポートする。

業務ルールはsystem promptに含める。

- 「2018年」は `order_purchase_timestamp >= TIMESTAMP '2018-01-01 00:00:00'` かつ `< TIMESTAMP '2019-01-01 00:00:00'` と解釈する。
- 「売り上げ」または「売上」は、ユーザーが支払額を明示しない限り `SUM(order_items.price)` と解釈する。
- rankingは降順 `ORDER BY` と、top N指定に応じた `LIMIT` を使う。

schema contextは固定文字列ではなく、`inspectTenantSchema()` がtenant DBの `information_schema.columns` と `pg_catalog` から取得する。対象tableは許可リストに限定している。

## Fallback

`OPENAI_API_KEY` が未設定の場合は、OpenAIを呼ばずにfallback streamを返す。この場合も `inspectTenantSchema()` を実行し、`data-trace`、`data-sql`、`data-sql-result`、`data-visualization` をstreamする。

fallback SQLは `apps/api/src/llm.ts` で管理する。2018年売上ランキングの代表質問はcanonical SQLを使い、それ以外は注文件数と注文日時範囲を返す集計SQLを使う。

## 安全境界

LLMのtool callは信用境界ではない。`executeSql` tool内部で必ず `validateAndNormalizeSql()` を通し、次を強制する。

- 空SQLを拒否する。
- DDL、DML、管理系keywordを拒否する。
- 危険関数を拒否する。
- `pgsql-ast-parser` で単一SELECTであることを確認する。
- `LIMIT` を最大100へ丸める。未指定なら `LIMIT 100` を付与する。

tenant DB実行は読み取り専用ユーザーで行い、実行時にも `BEGIN READ ONLY` と `SET LOCAL statement_timeout = '5s'` を使う。

## 永続化

stream完了時に `createUIMessageStream` の `onFinish` で保存する。

| Table | 保存内容 |
| --- | --- |
| `chat_messages` | user messageとassistant messageのparts |
| `sql_runs` | 各SQL試行の生成SQL、正規化SQL、status、結果、エラー |
| `llm_usages` | OpenAI provider/modelとtoken usage |

`streamText` の `onFinish` で `totalUsage` を取得し、`llm_usages` へ保存する。fallback時のtoken usageは0である。

## Web表示

Webは `@ai-sdk/react` の `useChat` を使う。transportは次の形である。

```ts
new DefaultChatTransport<AppChatMessage>({
  api: "/api/chat",
  credentials: "include"
});
```

`data-visualization.kind` に応じて表示を切り替える。表は既存table component、棒グラフ・折れ線・円グラフは `recharts` を使う。可視化キーが不足する場合や数値列がない場合は表へfallbackする。
