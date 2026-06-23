# ADR-0001: Bedrockを使わずOpenAI APIをAI SDKから利用する

## Status

Accepted

## Date

2026-06-23

## Context

Text-to-SQL AIエージェントでは、自然言語からSQLを生成するLLM providerが必要である。当初案ではAmazon Bedrockを採用候補としていたが、Bedrock Agentsを使わない場合、Bedrockの役割は実質的にLLM inference providerに限定される。

今回のMVPでは、agent runtime、チャットセッション、tenant解決、SQL検証、SQL実行、履歴保存、token利用量保存をアプリケーション側で制御する。したがって、Bedrock固有のagent機能やsession managementを利用する必然性は低い。

Amazon Bedrock Runtimeを単なるLLM inference providerとして使う場合、OpenAI APIとの差分は主に運用境界、IAM、モデル選択、リージョン、価格、レート制限である。一方、Bedrock AgentsやAmazon Bedrock AgentCoreまで採用する場合は、単なるprovider差し替えではなく、agent runtime、managed session、managed memory、tool orchestrationをAWS側へ寄せるアーキテクチャ変更になる。

Bedrock AgentCore Memoryのようなmanaged session / memoryは、通常のチャット履歴保存とは役割が異なる。short-term memoryは同一session内のraw eventsや会話履歴を保持し、long-term memoryは複数sessionをまたいでuser preference、facts、summariesなどを抽出・検索できる形で保持する。これは、agentが「過去messagesを読む」だけでなく、agent runtime側で継続的な文脈や長期記憶を扱うための基盤である。

今回のText-to-SQL MVPで必要な「過去チャットを開いて続きを質問する」機能は、`chat_threads` / `chat_messages` をアプリケーションDBに保存し、次回リクエスト時に必要な履歴をVercel AI SDK経由でmodelへ渡せば実現できる。これはmanaged memoryを必要とするユースケースではない。

managed session / memoryが有効になるのは、例えば次のような場合である。

- カスタマーサポートで、前回問い合わせ、試した手順、未解決事項をagentが継続的に覚える。
- パーソナルアシスタントで、ユーザーの好み、制約、過去の意思決定を複数sessionにまたがって反映する。
- 請求承認、購買、障害対応、調査などの複数step業務をagentが進め、中間状態やtool実行履歴を後続実行で使う。
- 複数agentが同じユーザーや同じ案件のcontextを共有する。
- agent runtimeのコンテナやmicroVMが終了しても、同じsession IDやactor IDでagent状態を復元する。
- 会話全文を毎回promptへ詰めるのではなく、重要なmemoryを検索・要約してcontextへ注入する。

一方、SQL実行監査、tenant境界、実行したSQL、token利用量、課金集計はmanaged memoryではなく、アプリケーションDBに明示的な正本として残す必要がある。これらはagentが思い出すための記憶ではなく、SaaSとして検証可能でなければならない監査・権限・課金データである。

また、開発環境ではAI SDKの標準的なOpenAI providerを使い、`OPENAI_API_KEY` を環境変数として参照する構成の方が単純である。

## Decision

MVPではAmazon Bedrockを採用しない。

LLM呼び出しはVercel AI SDKのOpenAI providerで実装する。バックエンドは `@ai-sdk/openai` を利用し、API keyはサーバ環境変数 `OPENAI_API_KEY` から参照する。利用モデルは `OPENAI_MODEL` で指定する。

ECS環境では `OPENAI_API_KEY` をSecrets Managerに保存し、ECS task definitionのsecret環境変数として注入する。ローカル開発では `.env` 等で `OPENAI_API_KEY` を設定する。

## Selection Criteria

OpenAI APIを選ぶ基準は次のとおりである。

- Bedrockをagent platformとして使わず、LLM inference providerとしてだけ使う想定である。
- agent loop、tool calling、チャット履歴、SQL監査ログ、token利用量をアプリケーション側で制御したい。
- Vercel AI SDKのOpenAI providerで、streaming、tool calling、usage取得を最小構成で実装したい。
- ローカル開発とMVP検証を、AWS固有のmodel access、IAM、region compatibility、Marketplace subscriptionに依存させたくない。

Amazon Bedrock Runtimeを検討する基準は次のとおりである。

- LLM inferenceをAWS運用境界、AWS請求、AWS IAM、VPC egress方針に寄せたい。
- 利用したいモデルがBedrock上にあり、model accessやリージョン制約を受け入れられる。
- OpenAI APIへの外部egressや外部API key管理を避けたい。

Bedrock AgentsやBedrock AgentCoreを検討する基準は次のとおりである。

- 単なるLLM inferenceではなく、AWS managedのagent runtime、session、memory、tool orchestrationを使いたい。
- 複数sessionをまたぐlong-term memory、user preference、semantic memory、session summaryをagent基盤側で扱いたい。
- 複数agent、長時間実行、再開可能なagent workflow、managed observabilityをAWS側へ寄せたい。
- Amazon Bedrock AgentCore MemoryやRuntimeを中心に据え、Strands Agents SDKなどAWS親和性の高いagent SDKと組み合わせる。

したがって、過去チャット履歴から再開するだけではBedrock AgentCoreを採用する理由として弱い。履歴再開はアプリケーションDBとVercel AI SDKで実装できる。Bedrock AgentCoreを採用する理由になるのは、再開したい対象がmessagesではなく、agent runtime側のsession state、memory、tool実行履歴、workflow stateになった場合である。

## Consequences

### Positive

- ローカル開発環境を簡素化できる。
- Bedrock model access、AWS Marketplace subscription、Bedrock IAM、Bedrock region compatibilityの初期設定をMVP範囲から外せる。
- AI SDKのOpenAI providerに寄せることで、`streamText`、tool calling、usage取得の実装を素直に進められる。
- OpenAI API keyと `OPENAI_MODEL` の設定だけでモデル差し替えを行える。

### Negative

- LLM inferenceはAWS内に閉じない。
- ECSからOpenAI APIへHTTPS egressが必要になる。
- AWS IAMだけではOpenAI API利用権限を完結管理できない。
- OpenAI APIの利用量、レート制限、障害はAWS外部依存として扱う必要がある。

### Neutral

- tenant分離、SQL AST検証、読み取り専用SQL実行、チャット履歴、token利用量保存は従来どおりアプリケーション側で実装する。
- 将来Bedrockへ切り替える場合は、`apps/api/src/llm` のprovider adapterを差し替える。

## Alternatives Considered

### Amazon Bedrock Runtime

Bedrock RuntimeをLLM providerとして使う案である。AWS運用境界に寄せられる利点はあるが、Bedrock Agentsを使わない場合の役割はOpenAI APIと同じくLLM inferenceに限られる。MVPの開発速度を優先し、不採用とした。

### Bedrock Agents

Bedrock側にagent runtimeや一部のsession context managementを寄せる案である。今回のText-to-SQLでは、tenant解決、SQL安全性、履歴、token利用量の正本をアプリ側に置く必要があるため、責務が分散する。不採用とした。

### Amazon Bedrock AgentCore

Bedrock AgentCore RuntimeやAgentCore Memoryを使い、agent実行環境、session、short-term / long-term memoryをAWS managed基盤へ寄せる案である。複数stepの業務agent、複数agent連携、cross-session personalization、managed memory retrievalが必要な場合は有力である。しかし今回のMVPでは、SQL監査、tenant境界、token利用量、チャット履歴をアプリケーションDBの正本として持つ方針であり、AgentCoreのmanaged session / memoryは過剰である。不採用とした。

### Mock providerのみ

固定SQLを返すmock providerだけで進める案である。SQL検証やtenant DB実行の開発には有効だが、自然言語からSQLを生成する主要体験を検証できない。ローカルテスト用の補助providerとしては採用する余地がある。

## Implementation Notes

- `OPENAI_API_KEY` はサーバ側だけで保持し、フロントエンドへ渡さない。
- `OPENAI_MODEL` は環境変数で指定し、DesignDoc上では特定モデルに固定しない。
- `llm_usages.provider` は `openai` とする。
- `model_pricing_snapshots` はOpenAI APIのモデル単価をsnapshotとして保存し、token利用量から推定利用料を計算する。
- ECS private subnet構成では、OpenAI APIへ到達するためのNAT Gateway等のegress経路を用意する。
