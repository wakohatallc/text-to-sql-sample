CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id bigint PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id bigint NOT NULL REFERENCES accounts(id),
  email citext NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  session_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS db_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id bigint NOT NULL REFERENCES accounts(id),
  engine text NOT NULL CHECK (engine = 'postgres'),
  host text NOT NULL,
  port integer NOT NULL,
  database_name text NOT NULL,
  credentials_secret_arn text NOT NULL,
  sslmode text NOT NULL DEFAULT 'disable',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS db_connections_one_enabled_per_account
  ON db_connections(account_id)
  WHERE enabled;

CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id bigint NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_user_updated_at_idx
  ON chat_threads(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id bigint NOT NULL REFERENCES accounts(id),
  thread_id uuid NOT NULL REFERENCES chat_threads(id),
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  parts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_created_at_idx
  ON chat_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS sql_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id bigint NOT NULL REFERENCES accounts(id),
  thread_id uuid REFERENCES chat_threads(id),
  message_id uuid REFERENCES chat_messages(id),
  db_connection_id uuid NOT NULL REFERENCES db_connections(id),
  database_name text NOT NULL,
  generated_sql text NOT NULL,
  normalized_sql text NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'rejected')),
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sql_runs_account_created_at_idx
  ON sql_runs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_pricing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model_id text NOT NULL,
  input_price_per_1k_tokens_usd numeric NOT NULL,
  output_price_per_1k_tokens_usd numeric NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id bigint NOT NULL REFERENCES accounts(id),
  user_id uuid NOT NULL REFERENCES users(id),
  thread_id uuid REFERENCES chat_threads(id),
  message_id uuid REFERENCES chat_messages(id),
  provider text NOT NULL,
  model_id text NOT NULL,
  input_tokens integer NOT NULL,
  output_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  estimated_cost_usd numeric NOT NULL,
  pricing_snapshot_id uuid REFERENCES model_pricing_snapshots(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_usages_account_created_at_idx
  ON llm_usages(account_id, created_at DESC);
