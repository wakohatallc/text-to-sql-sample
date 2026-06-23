#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
source scripts/db/env.sh

psql "${COMMON_DATABASE_URL}" -v ON_ERROR_STOP=1 -f apps/api/migrations/common/001_schema.sql
psql "${TENANT_DATABASE_URL}" -v ON_ERROR_STOP=1 -f apps/api/migrations/tenant/001_schema.sql
