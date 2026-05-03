#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BRANCH="${1:-main}"

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

# 3. 构建
log "构建 web..."
pnpm build:web

log "构建 admin-web..."
pnpm build:admin

log "构建 server..."
pnpm build:server

log "构建 relay..."
pnpm build:relay

# 4. 重启 server（egg-scripts）
log "重启 server..."
pnpm stop:server || true
pnpm start:server

# 5. 重启 relay（pm2）
log "重启 relay..."
pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs

log "部署完成 ✓"
