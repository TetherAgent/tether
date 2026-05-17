#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/use-nvm.sh
. "$ROOT_DIR/scripts/use-nvm.sh"
use_nvm_node "$ROOT_DIR"

SESSION_NAME="${TETHER_ZELLIJ_SESSION:-tether-dev}"

log() {
  printf '[tether-dev] %s\n' "$*"
}

ensure_zellij() {
  if command -v zellij >/dev/null 2>&1; then
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    log "zellij not found; installing with Homebrew..."
    HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}" brew install zellij
    return
  fi

  echo "zellij is required for local split-pane startup." >&2
  echo "Install it first: https://zellij.dev/documentation/installation" >&2
  exit 1
}

ensure_local_env_hint() {
  if [ -f .env.local ]; then
    return
  fi
  if [ -f env.sh ]; then
    log ".env.local missing; using env.sh. For safer local debugging run: cp env.sh .env.local"
    return
  fi
  if [ -f .env.local.example ]; then
    log ".env.local missing; creating it from .env.local.example"
    cp .env.local.example .env.local
    echo "Fill .env.local with development DB credentials, then rerun: pnpm dev:local" >&2
    exit 1
  fi
}

ensure_fresh_zellij_session() {
  local session_line
  session_line="$(zellij list-sessions --no-formatting 2>/dev/null | grep -E "^${SESSION_NAME}([[:space:]]|$)" || true)"
  if [ -z "$session_line" ]; then
    return
  fi

  if printf '%s\n' "$session_line" | grep -q '(EXITED'; then
    log "removing dead zellij session: ${SESSION_NAME}"
    zellij delete-session "$SESSION_NAME" >/dev/null 2>&1 || true
    return
  fi

  exec zellij attach "$SESSION_NAME"
}

write_layout() {
  local layout_file="$1"
  cat > "$layout_file" <<KDL
layout {
  default_tab_template {
    pane size=1 borderless=true {
      plugin location="tab-bar"
    }
    children
    pane size=2 borderless=true {
      plugin location="status-bar"
    }
  }

  tab name="Tether Dev" {
    pane split_direction="vertical" {
      pane name="Server" command="/bin/bash" {
        args "-c" "cd \"$ROOT_DIR\" && scripts/dev-pane.sh server"
      }
      pane split_direction="horizontal" {
        pane name="Relay" command="/bin/bash" {
          args "-c" "cd \"$ROOT_DIR\" && scripts/dev-pane.sh relay"
        }
        pane name="Web" command="/bin/bash" {
          args "-c" "cd \"$ROOT_DIR\" && scripts/dev-pane.sh web"
        }
        pane name="Gateway" command="/bin/bash" {
          args "-c" "cd \"$ROOT_DIR\" && scripts/dev-pane.sh gateway"
        }
      }
    }
  }
}
KDL
}

ensure_zellij
ensure_local_env_hint

LAYOUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tether-zellij-layout.XXXXXX")"
LAYOUT_FILE="$LAYOUT_DIR/tether-dev.kdl"
write_layout "$LAYOUT_FILE"

log "starting zellij session: ${SESSION_NAME}"
log "web: http://127.0.0.1:${TETHER_WEB_PORT:-4790}"
log "layout: ${LAYOUT_FILE}"
ensure_fresh_zellij_session
exec zellij --session "$SESSION_NAME" --new-session-with-layout "$LAYOUT_FILE"
