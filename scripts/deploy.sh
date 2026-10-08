#!/bin/sh
# Run from a checkout on the Linux Docker/Coolify host. Never stops dependencies.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
ENV_FILE=${FATBOY_ENV_FILE:-$ROOT/.env.deploy}
[ -f "$ENV_FILE" ] || { echo "Copia infra/deploy/.env.example a .env.deploy y configura sus valores." >&2; exit 1; }
action=${1:-help}
service=${2:-}
compose() {
  component=$1
  shift
  docker compose --env-file "$ENV_FILE" -f "infra/deploy/$component.compose.yml" "$@"
}
resource_name() {
  configured=$(awk -v key="$1" 'index($0,key "=")==1 { value=substr($0,length(key)+2); sub(/\r$/, "", value); print value; exit }' "$ENV_FILE")
  configured=${configured:-$2}
  case "$configured" in *[!a-zA-Z0-9_.-]*|'') echo "Nombre de recurso inválido: $1" >&2; exit 1;; esac
  printf '%s' "$configured"
}
case "$action" in
  prepare)
    network=$(resource_name DEPLOY_NETWORK fatboy-production)
    docker network inspect "$network" >/dev/null 2>&1 || docker network create "$network"
    docker volume create "$(resource_name POSTGRES_VOLUME fatboy-postgres)"
    docker volume create "$(resource_name UPLOADS_VOLUME fatboy-uploads)"
    docker volume create "$(resource_name BACKUP_STATUS_VOLUME fatboy-backup-status)"
    ;;
  database) compose database up -d --no-deps --wait --wait-timeout 120 database ;;
  build-api) compose api build api ;;
  seed) compose migrate run --rm --no-deps migrate sh -c 'pnpm db:migrate && pnpm db:seed' ;;
  migrate) compose migrate run --rm --no-deps migrate ;;
  api) compose api up -d --no-build --no-deps --wait --wait-timeout 120 api ;;
  frontend)
    compose frontend build frontend
    compose frontend up -d --no-build --no-deps --wait --wait-timeout 90 frontend
    ;;
  backup) compose backup up -d --build --no-deps backup ;;
  status)
    for component in database api frontend backup; do compose "$component" ps; done
    ;;
  *) echo "Uso: sh scripts/deploy.sh {prepare|database|build-api|seed|migrate|api|frontend|backup|status}"; exit 1 ;;
esac
