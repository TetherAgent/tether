#!/usr/bin/env bash
set -euo pipefail

SESSION_NAME="${TETHER_ZELLIJ_SESSION:-tether-dev}"
PORTS=(
  "${TETHER_SERVER_PORT:-4800}"
  "${TETHER_RELAY_PORT:-4889}"
  "${TETHER_WEB_PORT:-4790}"
  "${TETHER_GATEWAY_PORT:-4799}"
)

log() {
  printf '[tether-dev-stop] %s\n' "$*"
}

stop_zellij_session() {
  if ! command -v zellij >/dev/null 2>&1; then
    return
  fi

  if zellij list-sessions --short 2>/dev/null | grep -Fxq "$SESSION_NAME"; then
    log "deleting zellij session: ${SESSION_NAME}"
    zellij delete-session --force "$SESSION_NAME" >/dev/null 2>&1 || true
  fi
}

stop_port_listener() {
  local port="$1"
  local pids

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return
  fi

  log "stopping listener(s) on port ${port}: ${pids//$'\n'/ }"
  local pid
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done

  sleep 1
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      log "force stopping pid ${pid}"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

stop_zellij_session
for port in "${PORTS[@]}"; do
  stop_port_listener "$port"
done

rm -rf .tether-dev-logs 2>/dev/null || true
log "done"
