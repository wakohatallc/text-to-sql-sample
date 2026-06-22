# ADR-0001: Bedrockを使わずOpenAI APIをAI SDKから利用する

## Status

Accepted

## Date

2026-06-23

## Context

Text-to-SQL AIエージェントでは、自然言語からSQLを生成するLLM providerが必要である。当初案ではAmazon Bedrockを採用候補としていたが、Bedrock Agentsを使わない場合、Bedrockの役割は実質的にLLM inference providerに限定される。

今回のMVPでは、agent runtime、チャットセッション、tenant解決、SQL検証、SQL実行、履歴保存、token利用量保存をアプリケーション側で制御する。したがって、Bedrock固有のagent機能やsession managementを利用する必然性は低い。

また、開発環境ではAI SDKの標準的なOpenAI providerを使い、`OPENAI_API_KEY` を環境変数として参照する構成の方が単純である。

## Decision

MVPではAmazon Bedrockを採用しない。

LLM呼び出しはVercel AI SDKのOpenAI providerで実装する。バックエンドは `@ai-sdk/openai` を利用し、API keyはサーバ環境変数 `OPENAI_API_KEY` から参照する。利用モデルは `OPENAI_MODEL` で指定する。

ECS環境では `OPENAI_API_KEY` をSecrets Managerに保存し、ECS task definitionのsecret環境変数として注入する。ローカル開発では `.env` 等で `OPENAI_API_KEY` を設定する。

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

### Mock providerのみ

固定SQLを返すmock providerだけで進める案である。SQL検証やtenant DB実行の開発には有効だが、自然言語からSQLを生成する主要体験を検証できない。ローカルテスト用の補助providerとしては採用する余地がある。

## Implementation Notes

- `OPENAI_API_KEY` はサーバ側だけで保持し、フロントエンドへ渡さない。
- `OPENAI_MODEL` は環境変数で指定し、DesignDoc上では特定モデルに固定しない。
- `llm_usages.provider` は `openai` とする。
- `model_pricing_snapshots` はOpenAI APIのモデル単価をsnapshotとして保存し、token利用量から推定利用料を計算する。
- ECS private subnet構成では、OpenAI APIへ到達するためのNAT Gateway等のegress経路を用意する。
