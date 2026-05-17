#!/usr/bin/env bash

use_nvm_node() {
  local root_dir="${1:-$PWD}"
  local nvm_script=""
  local node_version="${TETHER_NODE_VERSION:-}"

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    nvm_script="$NVM_DIR/nvm.sh"
  elif [ -s "/opt/homebrew/opt/nvm/nvm.sh" ]; then
    nvm_script="/opt/homebrew/opt/nvm/nvm.sh"
  elif [ -s "/usr/local/opt/nvm/nvm.sh" ]; then
    nvm_script="/usr/local/opt/nvm/nvm.sh"
  fi

  if [ -z "$nvm_script" ]; then
    return 0
  fi

  # shellcheck source=/dev/null
  . "$nvm_script"

  if [ -z "$node_version" ] && [ -f "$root_dir/.nvmrc" ]; then
    node_version="$(tr -d '[:space:]' < "$root_dir/.nvmrc")"
  fi

  if [ -z "$node_version" ]; then
    local default_version
    default_version="$(nvm version default 2>/dev/null || true)"
    if [ -n "$default_version" ] && [ "$default_version" != "N/A" ]; then
      node_version="default"
    else
      node_version="24"
    fi
  fi

  if [ "$(nvm version "$node_version" 2>/dev/null || true)" != "N/A" ]; then
    nvm use --silent "$node_version" >/dev/null
  fi
}
