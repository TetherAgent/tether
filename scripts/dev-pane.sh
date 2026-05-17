#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/use-nvm.sh
. "$ROOT_DIR/scripts/use-nvm.sh"
use_nvm_node "$ROOT_DIR"

PANE="${1:-}"

log() {
  printf '[tether-dev:%s] %s\n' "${PANE:-main}" "$*"
}

load_local_env() {
  set -a
  if [ -f .env.local ]; then
    # shellcheck source=/dev/null
    . ./.env.local
  elif [ -f env.sh ]; then
    log "using env.sh because .env.local is missing"
    # shellcheck source=/dev/null
    . ./env.sh
  elif [ -f .env.local.example ]; then
    log "using .env.local.example defaults; copy it to .env.local for real DB credentials"
    # shellcheck source=/dev/null
    . ./.env.local.example
  else
    log "missing env file"
    exit 1
  fi
  set +a

  export EGG_SERVER_ENV="${EGG_SERVER_ENV:-local}"
  export TETHER_SERVER_HOST="${TETHER_SERVER_HOST:-127.0.0.1}"
  export TETHER_SERVER_PORT="${TETHER_SERVER_PORT:-4800}"
  export TETHER_RELAY_HOST="${TETHER_RELAY_HOST:-127.0.0.1}"
  export TETHER_RELAY_PORT="${TETHER_RELAY_PORT:-4889}"
  export TETHER_WEB_PORT="${TETHER_WEB_PORT:-4790}"
  export TETHER_SERVER_URL="${TETHER_SERVER_URL:-http://127.0.0.1:${TETHER_SERVER_PORT}}"
  export TETHER_WEB_SERVER_API_URL="${TETHER_WEB_SERVER_API_URL:-http://127.0.0.1:${TETHER_SERVER_PORT}}"
  export TETHER_WEB_RELAY_WS_URL="${TETHER_WEB_RELAY_WS_URL:-ws://127.0.0.1:${TETHER_RELAY_PORT}}"
  export TETHER_RELAY_URL="${TETHER_RELAY_URL:-ws://127.0.0.1:${TETHER_RELAY_PORT}}"
  export TETHER_GATEWAY_PROFILE="${TETHER_GATEWAY_PROFILE:-relay}"
  export TETHER_GATEWAY_HOST="${TETHER_GATEWAY_HOST:-127.0.0.1}"
  export TETHER_GATEWAY_PORT="${TETHER_GATEWAY_PORT:-4799}"
  export TETHER_DEV_HOME="${TETHER_DEV_HOME:-.tether-dev-home}"

  if [ -z "${TETHER_RUNTIME_SYNC_SECRET:-}" ] && [ -n "${TETHER_RELAY_SECRET:-}" ]; then
    export TETHER_RUNTIME_SYNC_SECRET="$TETHER_RELAY_SECRET"
  fi
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local max="${3:-120}"
  local i
  for i in $(seq 1 "$max"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$name ready: $url"
      return 0
    fi
    sleep 1
  done
  log "$name did not become ready: $url"
  return 1
}

normalize_gateway_auth_server_url() {
  local dev_home="$1"
  local auth_file="$dev_home/.tether/auth.json"
  if [ ! -f "$auth_file" ]; then
    return
  fi
  node -e "
const fs = require('node:fs');
const file = process.argv[1];
const serverUrl = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.serverUrl = serverUrl;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
" "$auth_file" "$TETHER_SERVER_URL"
}

write_gateway_config() {
  local dev_home="$1"
  mkdir -p "$dev_home/.tether"
  cat > "$dev_home/.tether/config.json" <<JSON
{
  "defaultProfile": "relay",
  "server": {
    "url": "${TETHER_SERVER_URL}"
  },
  "profiles": {
    "relay": {
      "server": {
        "url": "${TETHER_SERVER_URL}"
      },
      "gateway": {
        "host": "${TETHER_GATEWAY_HOST}",
        "port": ${TETHER_GATEWAY_PORT}
      },
      "relay": {
        "url": "${TETHER_RELAY_URL}"
      }
    },
    "local": {
      "server": {
        "url": "${TETHER_SERVER_URL}"
      },
      "gateway": {
        "host": "${TETHER_GATEWAY_HOST}",
        "port": ${TETHER_GATEWAY_PORT}
      }
    }
  }
}
JSON
}

start_gateway() {
  local dev_home
  if [[ "$TETHER_DEV_HOME" = /* ]]; then
    dev_home="$TETHER_DEV_HOME"
  else
    dev_home="$ROOT_DIR/$TETHER_DEV_HOME"
  fi
  write_gateway_config "$dev_home"

  wait_for_http "server" "http://127.0.0.1:${TETHER_SERVER_PORT}/healthz" 180
  wait_for_http "web" "http://127.0.0.1:${TETHER_WEB_PORT}/" 180

  if [ ! -f "$dev_home/.tether/auth.json" ]; then
    log "Gateway auth missing; opening browser login. Finish authorization once, then this pane will continue."
    HOME="$dev_home" \
      TETHER_GATEWAY_PROFILE="$TETHER_GATEWAY_PROFILE" \
      TETHER_RELAY_URL="$TETHER_RELAY_URL" \
      TETHER_SERVER_URL="$TETHER_SERVER_URL" \
      TETHER_GATEWAY_PORT="$TETHER_GATEWAY_PORT" \
      pnpm tether login --server-url "http://127.0.0.1:${TETHER_WEB_PORT}" --env local
  fi
  normalize_gateway_auth_server_url "$dev_home"

  log "starting Gateway on ${TETHER_GATEWAY_HOST}:${TETHER_GATEWAY_PORT}"
  exec env HOME="$dev_home" \
    TETHER_GATEWAY_PROFILE="$TETHER_GATEWAY_PROFILE" \
    TETHER_RELAY_URL="$TETHER_RELAY_URL" \
    TETHER_SERVER_URL="$TETHER_SERVER_URL" \
    TETHER_GATEWAY_PORT="$TETHER_GATEWAY_PORT" \
    pnpm tether serve
}

load_local_env

case "$PANE" in
  server)
    log "cleaning compiled Server artifacts"
    pnpm --filter @tether/server clean
    log "starting Server on ${TETHER_SERVER_HOST}:${TETHER_SERVER_PORT}"
    exec env EGG_SERVER_ENV=local pnpm --filter @tether/server dev
    ;;
  relay)
    wait_for_http "server" "http://127.0.0.1:${TETHER_SERVER_PORT}/healthz" 180
    log "starting Relay on ${TETHER_RELAY_HOST}:${TETHER_RELAY_PORT}"
    exec pnpm exec tsx apps/relay/src/main.ts
    ;;
  web)
    wait_for_http "server" "http://127.0.0.1:${TETHER_SERVER_PORT}/healthz" 180
    log "starting Web on 127.0.0.1:${TETHER_WEB_PORT}"
    exec pnpm --filter @tether/web dev
    ;;
  gateway)
    start_gateway
    ;;
  *)
    echo "Usage: scripts/dev-pane.sh {server|relay|web|gateway}" >&2
    exit 2
    ;;
esac
