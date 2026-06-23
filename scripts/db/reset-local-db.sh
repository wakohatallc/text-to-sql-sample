#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

docker compose down -v
scripts/db/setup-local-db.sh
