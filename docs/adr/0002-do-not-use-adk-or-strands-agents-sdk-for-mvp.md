# ADR-0002: MVPではGoogle ADKとStrands Agents SDKを採用しない

## Status

Accepted

## Date

2026-06-23

## Context

Text-to-SQL AIエージェントでは、複数toolをagentが自律的に選び、複数stepで実行する能力があると便利である。一方で、今回のMVPで必要な永続化は、agent memoryよりもSaaSアプリケーションとしての正本管理である。

具体的には、次の情報はアプリケーションDBで明示的に管理する必要がある。

- Cookieログインセッション
- `account_id` / `user_id`
- チャットスレッド
- チャットメッセージ履歴
- SQL実行監査ログ
- tenant別token利用量
- tenant DB接続境界

Google ADKやStrands Agents SDKは、agent orchestration、tool実行、context management、short-term / long-term memory、複数agent連携などに強い。一方、上記のSaaS境界、監査、課金集計の正本を代替するものではない。

また、Vercel AI SDKでも `tools` と `stopWhen: isStepCount(n)` により、1リクエスト内のmulti-step tool callingは実装できる。今回のText-to-SQL MVPでは、この軽量なagent loopで十分である。

## Decision

MVPではGoogle ADKとStrands Agents SDKを採用しない。

チャットUI、streaming、tool calling、usage取得にはVercel AI SDKを使う。チャットセッション、履歴、SQL実行監査、token利用量はPostgreSQLに自前で永続化する。

agent loopはNode.js API内で明示的に制御する。LLMが呼び出せるtoolは最小限にし、SQL検証とtenant境界チェックはLLMに任せず、サーバ側で必ず実行する。

## Consequences

### Positive

- 依存SDKとruntime概念を増やさず、MVPの実装境界を単純に保てる。
- `account_id` 境界、SQL安全性、監査ログ、課金集計の正本をPostgreSQLに集約できる。
- Vercel AI SDKのmulti-step tool callingで、必要な範囲のtool orchestrationを実現できる。
- ADKのGoogle Cloud寄りのmemory/runtime設計や、StrandsのAWS AgentCore寄りの設計に引きずられない。

### Negative

- 長期記憶、会話要約、複数agent連携、durable agent workflowは自動では提供されない。
- 将来、長時間実行、再開可能なagent、human approval、複数agent coordinationが必要になった場合は再検討が必要である。
- agent execution traceやmemory retrievalをframework標準機能として得ることはできない。

### Neutral

- Vercel AI SDKはチャット履歴の永続化を丸ごと提供しないため、履歴保存は従来どおり自前実装する。
- SQL安全性の観点では、frameworkに任せるよりサーバ側guardrailを明示する方針を維持する。

## Alternatives Considered

### Google ADK

Google ADKはagent、tool、session、memory、artifact、context managementを扱うagent frameworkである。Google Cloud Agent PlatformやMemory Bankへ寄せる場合は有力である。しかし今回の構成はOpenAI API、ECS、PostgreSQLを中心にしており、MVPでGoogle Cloud側のagent runtimeやmemory基盤を導入する必要はない。不採用とした。

### Strands Agents SDK

Strands Agents SDKはtool orchestration、multi-agent、session manager、AgentCore Memory連携などに強い。AWS AgentCoreやBedrock中心のagent基盤に寄せる場合は有力である。しかし今回の方針ではBedrockを採用せず、LLM providerはOpenAI APIである。Strandsだけを導入すると責務と依存が増えるため、不採用とした。

### Vercel AI SDK WorkflowAgent

`@ai-sdk/workflow` の `WorkflowAgent` はdurable/resumable agentやapproval flowに向く。今回のMVPは1リクエスト内のText-to-SQL処理であり、workflow runtimeを導入する必要はない。将来、承認付きの長時間agent実行が必要になった段階で再検討する。

## Implementation Notes

- `streamText` に `tools` と `stopWhen: isStepCount(n)` を指定し、軽量なmulti-step tool callingを実装する。
- LLMに任せるtoolは `proposeSql` など最小限にする。
- `validateSql` と `executeSql` はサーバ側の必須処理として扱い、LLMが呼ぶかどうかに依存しない。
- チャット履歴は `chat_threads` / `chat_messages` に保存する。
- SQL実行履歴は `sql_runs` に保存する。
- token利用量は `llm_usages` に保存する。
