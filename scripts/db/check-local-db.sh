#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
source scripts/db/env.sh

psql "${COMMON_DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "SELECT database_name FROM db_connections WHERE account_id = 1 AND enabled" | grep -qx "data_0001"

psql "${TENANT_DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM orders" | grep -qx "99441"
psql "${TENANT_DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM order_items" | grep -qx "112650"
psql "${TENANT_DATABASE_URL}" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM geolocations" | grep -qx "1000163"

psql "${TENANT_DATABASE_URL}" -v ON_ERROR_STOP=1 -c "
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
" >/dev/null

TENANT_READONLY_COUNT="$(PGPASSWORD=tenant_readonly psql "postgres://tenant_readonly:tenant_readonly@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_TENANT_DB}" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM orders")"
test "${TENANT_READONLY_COUNT}" = "99441"

echo "Local database check passed"
