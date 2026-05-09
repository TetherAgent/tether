import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Service } from 'egg';

let schemaReady: Promise<void> | undefined;

type MysqlApplication = {
  mysql: {
    get(name: string): any;
  };
};

export default class DbService extends Service {
  public mysqlModeEnabled() {
    const { app } = this;
    const env = app.config.env ?? process.env.EGG_SERVER_ENV ?? process.env.NODE_ENV;
    return env !== 'test' && env !== 'unittest';
  }

  public mysql() {
    const { app } = this;
    return (app as unknown as MysqlApplication).mysql.get('tether');
  }

  public async ensureSchema() {
    if (!this.mysqlModeEnabled()) {
      return;
    }
    if (!schemaReady) {
      schemaReady = (async () => {
        const sqlDir = path.resolve(__dirname, '../../sql');
        const files = readdirSync(sqlDir)
          .filter(f => f.endsWith('.sql'))
          .sort();
        for (const file of files) {
          const sql = await readFile(path.join(sqlDir, file), 'utf8');
          await this.mysql().query(sql);
        }
      })();
    }
    await schemaReady;
  }

  public async query(sql: string, values: any[] = []) {
    await this.ensureSchema();
    return await this.mysql().query(sql, values);
  }

  public async transaction<T>(run: (connection: any) => Promise<T>): Promise<T> {
    const { ctx } = this;
    await this.ensureSchema();
    return await this.mysql().beginTransactionScope(
      async connection => await run(connection),
      ctx
    ) as T;
  }
}
