import type { EggAppConfig, EggAppInfo, PowerPartial } from 'egg';

type CtxLike = {
  get(name: string): string;
};

type AppConfig = EggAppConfig & {
  jwt: {
    secret: string;
  };
  cors: {
    credentials: boolean;
    origin: (ctx: CtxLike) => string;
    allowMethods: string;
  };
  mysql: {
    client: {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
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

export default (appInfo: EggAppInfo): PowerPartial<AppConfig> => {
  const env = process.env.EGG_SERVER_ENV ?? process.env.NODE_ENV ?? 'development';
  const webOrigins = readOrigins();
  const jwtSecret = assertJwtSecret(env);
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
    mysql: {
      client: {
        host: readEnv('TETHER_SERVER_MYSQL_HOST') ?? '127.0.0.1',
        port: readPort('TETHER_SERVER_MYSQL_PORT', 3306),
        user: readEnv('TETHER_SERVER_MYSQL_USER') ?? 'root',
        password: readEnv('TETHER_SERVER_MYSQL_PASSWORD') ?? '',
        database: readEnv('TETHER_SERVER_MYSQL_DATABASE') ?? 'tether'
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
    // TODO: 上线稳定后关闭，避免暴露错误详情
    onerror: {
      all(err: Error & { status?: number }, ctx: any) {
        ctx.set('Content-Type', 'application/json');
        ctx.body = JSON.stringify({ error: err.message, stack: err.stack });
        ctx.status = err.status || 500;
      }
    }
  };
};
