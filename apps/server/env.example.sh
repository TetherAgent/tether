# 复制到 /data/env/tether.sh 并填入真实值
# cp apps/server/env.example.sh /data/env/tether.sh

# ── Server ──────────────────────────────────────────
export EGG_SERVER_ENV=prod
export TETHER_SERVER_PORT=4800
export TETHER_SERVER_JWT_SECRET=
export TETHER_SERVER_WEB_ORIGIN=https://your-domain.com

export TETHER_SERVER_MYSQL_HOST=rm-j6c5939hk4w250v5xxo.mysql.rds.aliyuncs.com
export TETHER_SERVER_MYSQL_PORT=3306
export TETHER_SERVER_MYSQL_USER=tether_prod
export TETHER_SERVER_MYSQL_PASSWORD=
export TETHER_SERVER_MYSQL_DATABASE=tether_prd

export TETHER_SERVER_REDIS_HOST=127.0.0.1
export TETHER_SERVER_REDIS_PORT=6379
# export TETHER_SERVER_REDIS_PASSWORD=

# ── Relay ────────────────────────────────────────────
export TETHER_RELAY_HOST=127.0.0.1
export TETHER_RELAY_PORT=4889
export TETHER_RELAY_SECRET=
export TETHER_SERVER_URL=http://127.0.0.1:4800
