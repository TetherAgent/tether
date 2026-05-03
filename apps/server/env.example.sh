# 复制到服务器并填入真实值：
#   cp apps/server/env.example.sh /data/env/tether.sh
#   nano /data/env/tether.sh

# ── 服务器基础配置 ────────────────────────────────────
# 运行环境，生产环境固定填 prod
export EGG_SERVER_ENV=prod

# 服务监听端口，需与 nginx 代理端口一致
export TETHER_SERVER_PORT=4800

# JWT 签名密钥，必填，可用以下命令生成：openssl rand -hex 32
export TETHER_SERVER_JWT_SECRET=

# 前端域名，用于 CORS 跨域校验，必填，多个域名用逗号分隔
export TETHER_SERVER_WEB_ORIGIN=https://tether.earntools.me

# ── 数据库配置 ────────────────────────────────────────
export TETHER_SERVER_MYSQL_HOST=rm-j6c5939hk4w250v5xxo.mysql.rds.aliyuncs.com
export TETHER_SERVER_MYSQL_PORT=3306
export TETHER_SERVER_MYSQL_USER=tether_prod
# 数据库密码，必填
export TETHER_SERVER_MYSQL_PASSWORD=
export TETHER_SERVER_MYSQL_DATABASE=tether_prd

# ── Redis 配置 ────────────────────────────────────────
export TETHER_SERVER_REDIS_HOST=127.0.0.1
export TETHER_SERVER_REDIS_PORT=6379
# Redis 密码，没有密码则注释掉此行
# export TETHER_SERVER_REDIS_PASSWORD=

# ── Relay 配置 ────────────────────────────────────────
export TETHER_RELAY_HOST=127.0.0.1
export TETHER_RELAY_PORT=4889

# Relay 鉴权密钥，必填，可用以下命令生成：openssl rand -hex 32
export TETHER_RELAY_SECRET=

# Relay 调用 server 校验 token 的地址，与 TETHER_SERVER_PORT 保持一致
export TETHER_SERVER_URL=http://127.0.0.1:4800
