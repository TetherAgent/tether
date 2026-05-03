#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# 参数：bash deploy.sh [分支] [目标]
# 示例：
#   bash deploy.sh                  → 拉 main，部署全部
#   bash deploy.sh dev              → 拉 dev，部署全部
#   bash deploy.sh main server      → 拉 main，只部署 server
#   bash deploy.sh main relay       → 拉 main，只部署 relay
#   bash deploy.sh main web         → 拉 main，只部署 web
#   bash deploy.sh main admin       → 拉 main，只部署 admin-web
#   bash deploy.sh main all         → 拉 main，部署全部
BRANCH="${1:-main}"
TARGET="${2:-all}"

# 加载环境变量
# shellcheck source=/dev/null
[ -f /data/env/tether.sh ] && source /data/env/tether.sh

log() { echo "[deploy] $*"; }

# 1. 拉代码
log "拉取最新代码（分支：$BRANCH）..."
git fetch origin
git reset --hard "origin/$BRANCH"

# 2. 安装依赖
log "安装依赖..."
pnpm install

# 3. 按目标构建 + 重启
deploy_web() {
  log "构建 web..."
  pnpm build:web
}

deploy_admin() {
  log "构建 admin-web..."
  pnpm build:admin
}

deploy_server() {
  log "构建 server..."
  pnpm build:server
  log "重启 server..."
  pnpm stop:server || true
  pnpm start:server
}

deploy_relay() {
  log "构建 relay..."
  pnpm build:relay
  log "重启 relay..."
  pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs
}

case "$TARGET" in
  web)    deploy_web ;;
  admin)  deploy_admin ;;
  server) deploy_server ;;
  relay)  deploy_relay ;;
  all|*)
    deploy_web
    deploy_admin
    deploy_server
    deploy_relay
    ;;
esac

log "部署完成 ✓"
