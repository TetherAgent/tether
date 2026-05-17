#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/use-nvm.sh
. "$ROOT_DIR/scripts/use-nvm.sh"
use_nvm_node "$ROOT_DIR"

TARGET="${1:-all}"
ENV_FILE="${TETHER_PROD_ENV_FILE:-}"

log() {
  printf '[tether-prod] %s\n' "$*"
}

load_prod_env() {
  if [ -n "$ENV_FILE" ]; then
    if [ ! -f "$ENV_FILE" ]; then
      echo "TETHER_PROD_ENV_FILE does not exist: $ENV_FILE" >&2
      exit 1
    fi
    # shellcheck source=/dev/null
    . "$ENV_FILE"
    return
  fi

  if [ -f /data/env/tether.sh ]; then
    # shellcheck source=/dev/null
    . /data/env/tether.sh
    return
  fi

  if [ -f env.sh ]; then
    log "using repo env.sh; production servers should prefer /data/env/tether.sh"
    # shellcheck source=/dev/null
    . ./env.sh
    return
  fi

  echo "Missing production env. Provide /data/env/tether.sh, env.sh, or TETHER_PROD_ENV_FILE." >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

validate_prod_env() {
  : "${TETHER_SERVER_JWT_SECRET:?TETHER_SERVER_JWT_SECRET is required}"
  : "${TETHER_SERVER_MYSQL_HOST:?TETHER_SERVER_MYSQL_HOST is required}"
  : "${TETHER_SERVER_MYSQL_USER:?TETHER_SERVER_MYSQL_USER is required}"
  : "${TETHER_SERVER_MYSQL_PASSWORD:?TETHER_SERVER_MYSQL_PASSWORD is required}"
  : "${TETHER_SERVER_MYSQL_DATABASE:?TETHER_SERVER_MYSQL_DATABASE is required}"
  : "${TETHER_RELAY_SECRET:?TETHER_RELAY_SECRET is required}"
  export TETHER_RUNTIME_SYNC_SECRET="${TETHER_RUNTIME_SYNC_SECRET:-$TETHER_RELAY_SECRET}"
}

start_server() {
  log "building server"
  pnpm build:server
  log "restarting server"
  pnpm stop:server || true
  pnpm start:server
}

start_relay() {
  require_command pm2
  log "building relay"
  pnpm build:relay
  log "restarting relay with pm2"
  pm2 delete tether-relay || true
  pm2 start ecosystem.config.cjs --update-env
  pm2 save
}

build_web() {
  log "building web"
  pnpm build:web
}

build_admin() {
  log "building admin-web"
  pnpm build:admin
}

load_prod_env
validate_prod_env

case "$TARGET" in
  all)
    start_server
    start_relay
    build_web
    build_admin
    ;;
  backend)
    start_server
    start_relay
    ;;
  server)
    start_server
    ;;
  relay)
    start_relay
    ;;
  web)
    build_web
    build_admin
    ;;
  web-only)
    build_web
    ;;
  admin)
    build_admin
    ;;
  *)
    echo "Usage: scripts/start-prod.sh [all|backend|server|relay|web|web-only|admin]" >&2
    exit 2
    ;;
esac

log "done"
