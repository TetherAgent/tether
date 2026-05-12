import { Buffer } from 'node:buffer';
import { spawnSessionRunnerProcess } from './session-runner-spawn.js';

type DetachFixturePayload = {
  socketDir: string;
  projectPath: string;
};

async function main(): Promise<void> {
  const payload = parsePayload(process.argv[2]);
  await spawnSessionRunnerProcess({
    options: {
      id: 'tth_detach_fixture',
      provider: 'codex',
      command: '/bin/cat',
      projectPath: payload.projectPath,
      cols: 80,
      rows: 24,
      socketDir: payload.socketDir
    }
  });
}

function parsePayload(raw: string | undefined): DetachFixturePayload {
  if (!raw) {
    throw new Error('missing detach fixture payload');
  }
  return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as DetachFixturePayload;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
