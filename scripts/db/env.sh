#!/usr/bin/env bash

: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_COMMON_DB:=common}"
: "${POSTGRES_TENANT_DB:=data_0001}"

if [[ -z "${POSTGRES_PASSWORD+x}" ]]; then
  POSTGRES_PASSWORD=postgres
fi

export POSTGRES_HOST
export POSTGRES_PORT
export POSTGRES_USER
export POSTGRES_PASSWORD
export POSTGRES_COMMON_DB
export POSTGRES_TENANT_DB
export PGPASSWORD="${POSTGRES_PASSWORD}"

set_database_urls() {
  if [[ -n "${POSTGRES_PASSWORD}" ]]; then
    COMMON_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_COMMON_DB}"
    TENANT_DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_TENANT_DB}"
  else
    COMMON_DATABASE_URL="postgres://${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_COMMON_DB}"
    TENANT_DATABASE_URL="postgres://${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_TENANT_DB}"
  fi

  export COMMON_DATABASE_URL
  export TENANT_DATABASE_URL
}

set_database_urls

admin_database_url() {
  if [[ -n "${POSTGRES_PASSWORD}" ]]; then
    printf 'postgres://%s:%s@%s:%s/postgres' "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" "${POSTGRES_HOST}" "${POSTGRES_PORT}"
  else
    printf 'postgres://%s@%s:%s/postgres' "${POSTGRES_USER}" "${POSTGRES_HOST}" "${POSTGRES_PORT}"
  fi
}

prefer_local_createdb_user() {
  if [[ -z "${USER:-}" || "${POSTGRES_USER}" != "postgres" ]]; then
    return
  fi

  local configured_can_create_db
  configured_can_create_db="$(psql "$(admin_database_url)" -tAc "SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user" 2>/dev/null || true)"
  if [[ "${configured_can_create_db}" = "t" ]]; then
    return
  fi

  local local_user_url="postgres://${USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/postgres"
  local local_user_can_create_db
  local_user_can_create_db="$(psql "${local_user_url}" -tAc "SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user" 2>/dev/null || true)"
  if [[ "${local_user_can_create_db}" = "t" ]]; then
    POSTGRES_USER="${USER}"
    POSTGRES_PASSWORD=""
    PGPASSWORD=""
    export POSTGRES_USER POSTGRES_PASSWORD PGPASSWORD
    set_database_urls
  fi
}

prefer_local_createdb_user
