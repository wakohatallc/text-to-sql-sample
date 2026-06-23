#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
source scripts/db/env.sh

if ! pg_isready --host="${POSTGRES_HOST}" --port="${POSTGRES_PORT}" --username="${POSTGRES_USER}" >/dev/null 2>&1; then
  docker compose up -d postgres

  until pg_isready --host="${POSTGRES_HOST}" --port="${POSTGRES_PORT}" --username="${POSTGRES_USER}" >/dev/null 2>&1; do
    sleep 1
  done
fi

admin_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/postgres"
if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  admin_url="postgres://${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/postgres"
fi

can_create_db="$(psql "${admin_url}" -tAc "SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user" 2>/dev/null || true)"
if [[ "${can_create_db}" != "t" && -n "${USER:-}" ]]; then
  local_user_url="postgres://${USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/postgres"
  local_user_can_create_db="$(psql "${local_user_url}" -tAc "SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user" 2>/dev/null || true)"
  if [[ "${local_user_can_create_db}" = "t" ]]; then
    POSTGRES_USER="${USER}"
    POSTGRES_PASSWORD=""
    PGPASSWORD=""
    export POSTGRES_USER POSTGRES_PASSWORD PGPASSWORD
    set_database_urls
    admin_url="${local_user_url}"
  fi
fi

for db_name in "${POSTGRES_COMMON_DB}" "${POSTGRES_TENANT_DB}"; do
  exists="$(psql "${admin_url}" -tAc "SELECT 1 FROM pg_database WHERE datname = '${db_name}'")"
  if [[ "${exists}" != "1" ]]; then
    createdb --host="${POSTGRES_HOST}" --port="${POSTGRES_PORT}" --username="${POSTGRES_USER}" "${db_name}"
  fi
done

scripts/db/migrate-local-db.sh
scripts/db/seed-local-db.sh
scripts/db/import-tenant-data.sh
scripts/db/check-local-db.sh
