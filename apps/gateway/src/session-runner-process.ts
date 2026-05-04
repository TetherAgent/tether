import { Buffer } from 'node:buffer';
import { SessionRunner, type CreateSessionRunnerOptions } from './session-runner.js';
import { Store } from './store.js';

type RunnerProcessPayload = {
  dbPath: string;
  options: CreateSessionRunnerOptions;
};

async function main(): Promise<void> {
  const payload = parsePayload(process.argv[2]);
  const store = new Store(payload.dbPath);
  const runner = new SessionRunner(store, payload.options);
  await runner.start();

  const shutdown = () => {
    runner.close().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

function parsePayload(raw: string | undefined): RunnerProcessPayload {
  if (!raw) {
    throw new Error('missing runner process payload');
  }
  const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as RunnerProcessPayload;
  if (!decoded || typeof decoded.dbPath !== 'string' || !decoded.options || typeof decoded.options !== 'object') {
    throw new Error('invalid runner process payload');
  }
  return decoded;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
