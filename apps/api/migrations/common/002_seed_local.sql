INSERT INTO accounts (id, name)
VALUES (1, 'Demo Account')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    updated_at = now();

INSERT INTO users (id, account_id, email, name, password_hash)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  1,
  'demo@example.com',
  'Demo User',
  '$2b$10$local.development.password.hash.placeholder'
)
ON CONFLICT (email) DO UPDATE
SET account_id = EXCLUDED.account_id,
    name = EXCLUDED.name,
    password_hash = EXCLUDED.password_hash,
    updated_at = now();

INSERT INTO db_connections (
  id,
  account_id,
  engine,
  host,
  port,
  database_name,
  credentials_secret_arn,
  sslmode,
  enabled
)
VALUES (
  '00000000-0000-0000-0000-000000000101',
  1,
  'postgres',
  'localhost',
  5432,
  'data_0001',
  'local-env://tenant_readonly',
  'disable',
  true
)
ON CONFLICT (id) DO UPDATE
SET host = EXCLUDED.host,
    port = EXCLUDED.port,
    database_name = EXCLUDED.database_name,
    credentials_secret_arn = EXCLUDED.credentials_secret_arn,
    sslmode = EXCLUDED.sslmode,
    enabled = EXCLUDED.enabled,
    updated_at = now();

INSERT INTO model_pricing_snapshots (
  provider,
  model_id,
  input_price_per_1k_tokens_usd,
  output_price_per_1k_tokens_usd,
  effective_from
)
SELECT 'openai', 'gpt-4.1-mini', 0.0004, 0.0016, '2026-06-23T00:00:00Z'
WHERE NOT EXISTS (
  SELECT 1
  FROM model_pricing_snapshots
  WHERE provider = 'openai'
    AND model_id = 'gpt-4.1-mini'
    AND effective_from = '2026-06-23T00:00:00Z'
);
