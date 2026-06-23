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

Vercel AI SDKとGoogle ADK / Strands Agents SDKは、担当するレイヤーが異なる。

- Vercel AI SDKは、チャットUI、streaming response、message transport、tool callingのためのSDKである。
- Google ADKやStrands Agents SDKは、agent runtime、agent loop、tool orchestration、session / memory、複数agent coordinationのためのSDKである。

両者を組み合わせる構成は成立する。その場合、Vercel AI SDKをフロントエンドまたはNext.js API側のUI transportとして使い、Google ADKやStrands Agents SDKをバックエンド側のagent runtimeとして使う。ただし、MVPではこの構成は採用しない。理由は、UI message、agent session、アプリケーションDB上のチャット履歴という3つの状態表現を接続するadapterが必要になり、責務境界が増えるためである。

ここでいう「チャット履歴を保存して次回のagent実行へ渡す」とは、1回のユーザー入力に対してagentが応答を生成する1サイクルを1回のagent実行とみなし、2回目以降の入力時に過去のuser / assistant messagesをcontextとして再投入することである。

例えば、1回目の入力が「私は東京在住です」で、2回目の入力が「明日の服装は？」である場合、2回目のagent実行には1回目のuser messageとassistant responseを含める必要がある。そうしなければ、LLMやagent runtimeは「東京在住」という前提を知らない。

Vercel AI SDKは、ブラウザ上の現在のmessages管理、送信、streaming表示は支援するが、リロード後、別端末、別プロセス、サーバ再起動後にも会話を継続するための永続化正本は提供しない。したがって、`chat_threads` / `chat_messages` への保存、`chat_id` ごとの履歴復元、所有権確認、modelへ渡す履歴範囲の制御はアプリケーション側で実装する。

## Decision

MVPではGoogle ADKとStrands Agents SDKを採用しない。

チャットUI、streaming、tool calling、usage取得にはVercel AI SDKを使う。チャットセッション、履歴、SQL実行監査、token利用量はPostgreSQLに自前で永続化する。

agent loopはNode.js API内で明示的に制御する。LLMが呼び出せるtoolは最小限にし、SQL検証とtenant境界チェックはLLMに任せず、サーバ側で必ず実行する。

## Selection Criteria

agent frameworkを採用するかどうかは、チャットが単発か複数回かだけでは判断しない。複数回のチャットであっても、必要なことが「過去messagesをDBに保存し、次回リクエスト時に必要範囲をmodelへ渡す」だけであれば、Vercel AI SDKとアプリケーションDBで十分である。

Vercel AI SDKを選ぶ基準は次のとおりである。

- 主な責務がチャットUI、streaming response、tool calling、usage取得である。
- チャット履歴、SQL実行履歴、token利用量、tenant境界の正本をアプリケーションDBで管理したい。
- agent実行が1リクエスト内で完結し、`tools` と `stopWhen: isStepCount(n)` による軽量なmulti-step tool callingで足りる。
- session / memoryをagent runtime側の正本にせず、サーバ側guardrailとPostgreSQLの監査ログを中心にしたい。

Google ADKやStrands Agents SDKを検討する基準は次のとおりである。

- agent runtime側でsession state、memory、tool実行履歴、context managementを管理したい。
- 会話要約、長期記憶、user preference、semantic memoryなどをframeworkやmanaged serviceに寄せたい。
- 複数agent coordination、agent delegation、durable workflow、human approval、再開可能な長時間実行が必要である。
- Google Cloud Agent Platform / Vertex AI、またはAmazon Bedrock AgentCore / Bedrockをagent基盤の中心にする。

したがって、単発ならVercel AI SDKで十分である。複数回のチャットでも、履歴保存と再投入が主目的であればVercel AI SDKと自前DBで十分である。ADKやStrands Agents SDKを採用するのは、複数回チャットであること自体ではなく、agent runtime側のsession / memory / orchestrationを正本として使う必要が出た場合である。

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

Vercel AI SDKとGoogle ADKを組み合わせる場合、Vercel AI SDKはUI transport、Google ADKはagent runtimeという分担になる。この構成では、ADKのSessionServiceをagent execution contextの正本にし、Next.js側はUI projectionとして扱う設計が自然である。しかし今回のMVPでは、PostgreSQL上のチャットスレッドとSQL監査ログを正本にするため、ADK sessionを別正本として導入しない。

### Strands Agents SDK

Strands Agents SDKはtool orchestration、multi-agent、session manager、AgentCore Memory連携などに強い。AWS AgentCoreやBedrock中心のagent基盤に寄せる場合は有力である。しかし今回の方針ではBedrockを採用せず、LLM providerはOpenAI APIである。Strandsだけを導入すると責務と依存が増えるため、不採用とした。

Vercel AI SDKとStrands Agents SDKを組み合わせる場合、Vercel AI SDKはUI transport、Strands Agents SDKはAWS親和性の高いagent runtimeという分担になる。さらにBedrock AgentCore RuntimeやAgentCore Memoryまで使う場合は、AWS上のmanaged agent基盤として有力である。しかし今回のMVPでは、Bedrock / AgentCoreを前提にしないため、Strandsのsession managerやmemory integrationは過剰である。

### Vercel AI SDK WorkflowAgent

`@ai-sdk/workflow` の `WorkflowAgent` はdurable/resumable agentやapproval flowに向く。今回のMVPは1リクエスト内のText-to-SQL処理であり、workflow runtimeを導入する必要はない。将来、承認付きの長時間agent実行が必要になった段階で再検討する。

## Implementation Notes

- `streamText` に `tools` と `stopWhen: isStepCount(n)` を指定し、軽量なmulti-step tool callingを実装する。
- LLMに任せるtoolは `proposeSql` など最小限にする。
- `validateSql` と `executeSql` はサーバ側の必須処理として扱い、LLMが呼ぶかどうかに依存しない。
- チャット履歴は `chat_threads` / `chat_messages` に保存する。
- SQL実行履歴は `sql_runs` に保存する。
- token利用量は `llm_usages` に保存する。
