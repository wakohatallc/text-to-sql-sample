# Text-to-SQL Sample

自然言語のチャット入力からSQLを生成し、アカウントごとに分離されたtenant DBへ読み取りクエリを実行し、SQL実行結果を返すAIエージェントのサンプルプロジェクトである。

詳細なDesignDocは [docs/plan_260623.md](docs/plan_260623.md) を参照する。

## 目的

代表ユースケースは次である。

```text
2018年の売り上げランキング上位10位を出して
```

この入力に対して、バックエンドはtenant DBのスキーマを踏まえてSQL候補を生成し、SQL安全性を検証し、読み取り専用接続で実行し、結果行をチャット画面へ返す。

サンプルデータは `data/` のOlist風CSVである。MVPでは、2018年を `2018-01-01 00:00:00` 以上 `2019-01-01 00:00:00` 未満として扱う。

## ローカル環境

### 前提

- localhostで利用できるPostgreSQL、またはDocker Desktop
- Node.js / npm
- Ruby
- PostgreSQL client tools (`psql`, `createdb`)

### セットアップ

```bash
npm run db:setup
```

このコマンドは次を実行する。

- 既存の `localhost:5432` PostgreSQLがあればそれを使う
- PostgreSQLが未起動の場合はDocker ComposeでPostgreSQLを起動する
- 共通DB `common` とtenant DB `data_0001` を作成する
- 共通DB migrationとlocal seedを適用する
- tenant DB migrationを適用する
- `data/` のCSVをtenant DBへ投入する
- 代表SQLと読み取り専用ユーザーの接続を検証する

ローカルPostgreSQLで `postgres` ロールにDB作成権限がない場合、スクリプトは現在のOSユーザーと同名のPostgreSQLロールがDB作成可能か確認し、可能であればそのロールを使う。

### DB接続情報

デフォルト値は次である。

```text
host: localhost
port: 5432
admin user: postgres
admin password: postgres
common db: common
tenant db: data_0001
tenant readonly user: tenant_readonly
tenant readonly password: tenant_readonly
```

共通DBの `db_connections` には、`account_id=1` のtenant接続先として `localhost:5432/data_0001` をseedする。

### 個別コマンド

```bash
npm run db:up       # Docker PostgreSQL起動
npm run db:migrate  # migration適用
npm run db:seed     # common DBのlocal seed適用
npm run db:import   # tenant DBへCSV再投入
npm run db:check    # local DB検証
npm run db:reset    # Docker volume削除後に再構築
```

## アプリ起動

```bash
npm run dev
```

ローカルURLは次である。

```text
Web: http://127.0.0.1:3000/
API: http://127.0.0.1:3001/
```

デモログイン情報は次である。

```text
email: demo@example.com
password: password
```

### 代表SQL

ローカル検証では次のSQLが通ることを確認している。

```sql
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
LIMIT 10;
```

## 主な要件

- 自然言語からPostgreSQL向けSQLを生成する。
- 生成SQLを実行し、SQL実行結果を表形式で返す。
- アカウントごとにDBを分けるマルチテナント構成とする。
- `account_id=1` のtenantデータは `data_0001` DBに格納する。
- 共通DBの `db_connections` でtenant DB接続先を管理する。
- ユーザーごとにチャットスレッドとメッセージ履歴を永続化する。
- tenant別のLLM token利用量と推定利用料を永続化する。
- SQL実行は読み取り専用に限定し、DDL/DML/複文/危険関数を拒否する。

## 検証

```bash
npm run lint
npm test
npm run build
```
