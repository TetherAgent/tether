function currentEnv(): string {
  return process.env.EGG_SERVER_ENV ?? process.env.NODE_ENV ?? 'development';
}

function isTestEnv(): boolean {
  const env = currentEnv();
  return env === 'test' || env === 'unittest';
}

function redisEnabled(): boolean {
  const value = process.env.TETHER_SERVER_ENABLE_REDIS?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

export default {
  cors: {
    enable: true,
    package: 'egg-cors'
  },
  jwt: {
    enable: true,
    package: 'egg-jwt'
  },
  redis: {
    enable: redisEnabled(),
    package: 'egg-redis'
  },
  socketIO: {
    enable: true,
    package: 'egg-socket.io'
  },
  mysql: {
    enable: !isTestEnv(),
    package: 'egg-mysql'
  },
  bcrypt: {
    enable: true,
    package: 'egg-bcrypt'
  },
  console: {
    enable: true,
    package: 'egg-console'
  }
};
