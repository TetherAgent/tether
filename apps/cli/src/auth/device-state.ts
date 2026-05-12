import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type DeviceState = {
  deviceKey: string;
  deviceName: string;
};

export function deviceStatePath(): string {
  return process.env.TETHER_DEVICE_PATH ?? path.join(os.homedir(), '.tether', 'device.json');
}

export async function loadOrCreateDeviceState(): Promise<DeviceState> {
  const raw = await readFile(deviceStatePath(), 'utf8').catch(() => undefined);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<DeviceState>;
      if (typeof parsed.deviceKey === 'string' && parsed.deviceKey.startsWith('dev_')) {
        return {
          deviceKey: parsed.deviceKey,
          deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : os.hostname()
        };
      }
    } catch {
      // Regenerate malformed local device metadata below.
    }
  }
  const { randomBytes } = await import('node:crypto');
  const state: DeviceState = {
    deviceKey: `dev_${randomBytes(12).toString('hex')}`,
    deviceName: os.hostname()
  };
  await mkdir(path.dirname(deviceStatePath()), { recursive: true });
  await writeFile(deviceStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return state;
}
