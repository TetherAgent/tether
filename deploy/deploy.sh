#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 用法：
#   bash deploy/deploy.sh                      → 交互选择
#   bash deploy/deploy.sh [分支] [目标]
#
# 目标：
#   all       → 部署全部（server + relay + web + admin）
#   backend   → 部署服务端（server + relay）
#   web       → 部署前端（web + admin）
#   server    → 只部署 server
#   relay     → 只部署 relay
#   web-only  → 只部署 web
#   admin     → 只部署 admin-web
BRANCH="${1:-main}"
TARGET="${2:-}"

# 加载环境变量
# shellcheck source=/dev/null
[ -f /data/env/tether.sh ] && source /data/env/tether.sh

log() { echo "[deploy] $*"; }

deploy_web_only() {
  log "构建 web..."
  pnpm build:web
}

deploy_admin() {
  log "构建 admin-web..."
  pnpm build:admin
}

deploy_server_only() {
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
  pm2 delete tether-relay || true
  pm2 start ecosystem.config.cjs --update-env
  pm2 save
}

do_deploy() {
  local target="$1"
  case "$target" in
    all)
      deploy_web_only
      deploy_admin
      deploy_server_only
      deploy_relay
      ;;
    backend)
      deploy_server_only
      deploy_relay
      ;;
    web)
      deploy_web_only
      deploy_admin
      ;;
    server)
      deploy_server_only
      ;;
    relay)
      deploy_relay
      ;;
    web-only)
      deploy_web_only
      ;;
    admin)
      deploy_admin
      ;;
    *)
      echo "未知目标：$target"
      exit 1
      ;;
  esac
}

# 无目标参数时交互选择
if [ -z "$TARGET" ]; then
  echo ""
  echo "选择部署目标（分支：$BRANCH）："
  echo "  1) all      → 全部（server + relay + web + admin）"
  echo "  2) backend  → 服务端（server + relay）"
  echo "  3) web      → 前端（web + admin）"
  echo "  4) server   → 只部署 server"
  echo "  5) relay    → 只部署 relay"
  echo "  6) web-only → 只部署 web"
  echo "  7) admin    → 只部署 admin-web"
  echo ""
  read -rp "输入序号或名称：" input

  case "$input" in
    1|all)     TARGET="all" ;;
    2|backend) TARGET="backend" ;;
    3|web)     TARGET="web" ;;
    4|server)  TARGET="server" ;;
    5|relay)   TARGET="relay" ;;
    6|web-only) TARGET="web-only" ;;
    7|admin)   TARGET="admin" ;;
    *)
      echo "无效输入：$input"
      exit 1
      ;;
  esac
fi

# 拉代码
log "拉取最新代码（分支：$BRANCH）..."
git fetch origin
git reset --hard "origin/$BRANCH"

# 安装依赖
log "安装依赖..."
pnpm install

# 执行部署
do_deploy "$TARGET"

log "部署完成 ✓"
