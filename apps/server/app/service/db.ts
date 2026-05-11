import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Service } from 'egg';

let schemaReady: Promise<void> | undefined;
const IDEMPOTENT_DDL_MISSING_CODES = new Set(['ER_CANT_DROP_FIELD_OR_KEY']);
const IDEMPOTENT_DDL_EXISTS_CODES = new Set(['ER_DUP_KEYNAME']);

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
        const sqlDir = resolveSqlDir();
        if (!sqlDir) {
          this.app.logger.warn('Server SQL migration directory is missing; skipping automatic schema migration');
          return;
        }
        const files = readdirSync(sqlDir)
          .filter(f => f.endsWith('.sql'))
          .sort();
        for (const file of files) {
          const sql = await readFile(path.join(sqlDir, file), 'utf8');
          for (const statement of splitSqlStatements(sql)) {
            try {
              await this.mysql().query(statement);
            } catch (error) {
              if (!isIgnorableIdempotentDdlError(error, statement)) {
                throw enrichMigrationError(error, file, statement);
              }
            }
          }
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

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map(statement => statement.trim())
    .filter(Boolean);
}

function isIgnorableIdempotentDdlError(error: unknown, statement: string): boolean {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const normalized = stripSqlLineComments(statement);
  if (IDEMPOTENT_DDL_MISSING_CODES.has(code)) {
    return /^\s*ALTER\s+TABLE\s+\w+\s+DROP\s+/i.test(normalized);
  }
  if (IDEMPOTENT_DDL_EXISTS_CODES.has(code)) {
    return /^\s*ALTER\s+TABLE\s+\w+\s+ADD\s+(?:INDEX|KEY)\s+/i.test(normalized);
  }
  return false;
}

function stripSqlLineComments(statement: string): string {
  return statement
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
    .trim();
}

function resolveSqlDir(): string | undefined {
  const candidates = [
    process.env.TETHER_SERVER_SQL_DIR,
    path.resolve(__dirname, '../../sql'),
    path.resolve(process.cwd(), 'sql'),
    path.resolve(process.cwd(), 'apps/server/sql')
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(candidate => existsSync(candidate));
}

function enrichMigrationError(error: unknown, file: string, statement: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(`schema_migration_failed in ${file}: ${message}\nSQL: ${statement}`);
  if (error instanceof Error && error.stack) {
    wrapped.stack = `${wrapped.message}\nCaused by: ${error.stack}`;
  }
  return wrapped;
}
