import type { Application } from 'egg';

import { configureMysqlRuntime } from './app/service/storage';

module.exports = (app: Application) => {
  app.beforeStart(async () => {
    const env = app.config.env;
    const mysqlClient = app.config.mysql?.client;
    if (!mysqlClient) {
      return;
    }

    configureMysqlRuntime({
      enabled: env === 'local' || process.env.TETHER_SERVER_ENABLE_MYSQL === '1' || process.env.TETHER_SERVER_ENABLE_MYSQL === 'true',
      client: {
        host: mysqlClient.host,
        port: mysqlClient.port,
        user: mysqlClient.user,
        password: mysqlClient.password,
        database: mysqlClient.database
      }
    });
  });
};
