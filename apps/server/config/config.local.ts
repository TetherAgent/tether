import type { EggAppConfig, PowerPartial } from 'egg';

type AppConfig = EggAppConfig & {
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
};

export default {
  mysql: {
    client: {
      host: 'rm-j6c5939hk4w250v5xxo.mysql.rds.aliyuncs.com',
      port: 3306,
      user: 'tether_prod',
      password: 'tether_prod###DREAMqaz232',
      database: 'tether_prd'
    },
    app: true,
    agent: false
  }
} satisfies PowerPartial<AppConfig>;
