import type { EggAppConfig, EggAppInfo } from 'egg';
import type { AuthTokenClass } from '@tether/core';

type CtxLike = {
  get(name: string): string;
};

type AppConfig = EggAppConfig & {
  jwt: {
    secret: string;
  };
  verifyLoginWhitelist: string[];
  verifyLogin: {
    expected: AuthTokenClass[];
  };
  logger: {
    consoleLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';
    disableConsoleAfterReady: boolean;
    concentrateError: 'duplicate' | 'redirect' | 'ignore';
  };
  console: {
    consoleLevel: 'debug' | 'info' | 'warn' | 'error';
  };
  cors: {
    credentials: boolean;
    origin: (ctx: CtxLike) => string;
    allowMethods: string;
  };
  mysql: {
    clients: {
      tether: {
        host: string;
        port: string;
        user: string;
        password: string;
        database: string;
      };
    };
    default: {
      multipleStatements: boolean;
    };
    app: boolean;
    agent: boolean;
  };
  redis: {
    client: {
      host: string;
      port: number;
      password?: string;
      db: number;
    };
  };
  bcrypt: {
    saltRounds: number;
  };
  runtimeSyncSecret: string;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readPort(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readOrigins(): string[] {
  const value = readEnv('TETHER_SERVER_WEB_ORIGIN');
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function assertJwtSecret(env: string): string {
  const secret = readEnv('TETHER_SERVER_JWT_SECRET');
  if (secret) {
    return secret;
  }

  if (env === 'test') {
    return 'test-only-jwt-secret';
  }

  if (env === 'local') {
    return 'phase5-local-dev-secret';
  }

  throw new Error('TETHER_SERVER_JWT_SECRET is required outside test mode');
}

function assertMysqlPassword(env: string): void {
  if (env === 'test' || env === 'unittest') {
    return;
  }

  const host = readEnv('TETHER_SERVER_MYSQL_HOST');
  const user = readEnv('TETHER_SERVER_MYSQL_USER');
  const rawPassword = process.env.TETHER_SERVER_MYSQL_PASSWORD;
  const password = rawPassword?.trim();

  if ((host || user) && !password) {
    throw new Error('TETHER_SERVER_MYSQL_PASSWORD is required when MySQL is enabled');
  }
}

export default (appInfo: EggAppInfo) => {
  const env = process.env.EGG_SERVER_ENV ?? process.env.NODE_ENV ?? 'development';
  const webOrigins = readOrigins();
  const jwtSecret = assertJwtSecret(env);
  assertMysqlPassword(env);
  const defaultWebOrigin = webOrigins[0] ?? '';

  return {
    keys: `${appInfo.name}_${jwtSecret}`,
    cluster: {
      listen: {
        hostname: readEnv('TETHER_SERVER_HOST') ?? '127.0.0.1',
        port: readPort('TETHER_SERVER_PORT', 4800)
      }
    },
    security: {
      csrf: {
        enable: false
      }
    },
    middleware: [ 'error', 'verifyLogin' ],
    cors: {
      credentials: true,
      origin: (ctx: CtxLike) => {
        const requestOrigin = ctx.get('origin');
        if (!requestOrigin) {
          return defaultWebOrigin;
        }

        return webOrigins.includes(requestOrigin) ? requestOrigin : defaultWebOrigin;
      },
      allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS'
    },
    jwt: {
      secret: jwtSecret
    },
    verifyLoginWhitelist: [
      '/healthz',
      '/api/server/auth/register',
      '/api/server/auth/login',
      '/api/server/auth/refresh',
      '/api/admin/auth/register',
      '/api/admin/auth/login',
      '/api/admin/auth/refresh',
      '/api/relay/gateway/bind',
      '/api/relay/gateway/refresh',
      '/api/server/token/validate',
      '/api/relay/runtime-sync/gateway/sessions',
      '/api/relay/runtime-sync/gateway/conversation',
      '/api/relay/runtime-sync/gateway/event'
    ],
    verifyLogin: {
      expected: [ 'normal_client_access', 'management_access', 'gateway_access' ]
    },
    logger: {
      // 避免本地 dev 进程在父终端断开后继续向 console 写日志，触发 EPIPE 自刷屏。
      consoleLevel: env === 'local' ? 'NONE' : 'INFO',
      disableConsoleAfterReady: true,
      concentrateError: 'redirect'
    },
    console: {
      // egg-console 不支持 logger.consoleLevel = NONE，单独给它一个合法级别。
      consoleLevel: 'info'
    },
    mysql: {
      clients: {
        tether: {
          host: readEnv('TETHER_SERVER_MYSQL_HOST') ?? '127.0.0.1',
          port: String(readPort('TETHER_SERVER_MYSQL_PORT', 3306)),
          user: readEnv('TETHER_SERVER_MYSQL_USER') ?? 'root',
          password: readEnv('TETHER_SERVER_MYSQL_PASSWORD') ?? '',
          database: readEnv('TETHER_SERVER_MYSQL_DATABASE') ?? 'tether'
        }
      },
      default: {
        multipleStatements: true
      },
      app: true,
      agent: false
    },
    redis: {
      client: {
        host: readEnv('TETHER_SERVER_REDIS_HOST') ?? '127.0.0.1',
        port: readPort('TETHER_SERVER_REDIS_PORT', 6379),
        password: readEnv('TETHER_SERVER_REDIS_PASSWORD'),
        db: 0
      }
    },
    bcrypt: {
      saltRounds: 10
    },
    runtimeSyncSecret: readEnv('TETHER_RUNTIME_SYNC_SECRET') ?? ''
  };
};
