#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
source scripts/db/env.sh

psql "${TENANT_DATABASE_URL}" -v ON_ERROR_STOP=1 -f apps/api/migrations/tenant/002_truncate_data.sql

POSTGRES_DB="${POSTGRES_TENANT_DB}" ruby lib/data_importer.rb
