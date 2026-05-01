import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type GatewayRecord = {
  id: string;
  host: string;
  port: number;
  url: string;
  pid: number;
  startedAt: number;
  lastSeenAt: number;
};

const registryPath = path.join(os.homedir(), '.tether', 'gateways.json');
const staleAfterMs = 30_000;

export async function registerGateway(record: GatewayRecord): Promise<void> {
  const records = await readRegistry();
  const liveRecords = records.filter((item) => item.id !== record.id && isRecordLive(item));
  liveRecords.push(record);
  await writeRegistry(liveRecords);
}

export async function touchGateway(id: string, now = Date.now()): Promise<void> {
  const records = await readRegistry();
  let changed = false;
  const next = records
    .filter(isRecordLive)
    .map((record) => {
      if (record.id !== id) {
        return record;
      }
      changed = true;
      return { ...record, lastSeenAt: now };
    });
  if (changed) {
    await writeRegistry(next);
  }
}

export async function unregisterGateway(id: string): Promise<void> {
  const records = await readRegistry();
  await writeRegistry(records.filter((record) => record.id !== id && isRecordLive(record)));
}

export async function listGateways(): Promise<GatewayRecord[]> {
  const records = await readRegistry();
  const liveRecords = records.filter(isRecordLive);
  if (liveRecords.length !== records.length) {
    await writeRegistry(liveRecords);
  }
  return liveRecords.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function isRecordLive(record: GatewayRecord): boolean {
  if (Date.now() - record.lastSeenAt > staleAfterMs) {
    return false;
  }
  try {
    process.kill(record.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readRegistry(): Promise<GatewayRecord[]> {
  const text = await readFile(registryPath, 'utf8').catch(() => undefined);
  if (!text) {
    return [];
  }
  const data = parseRegistry(text);
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter(isGatewayRecord);
}

async function writeRegistry(records: GatewayRecord[]): Promise<void> {
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(records, null, 2)}\n`);
}

function isGatewayRecord(value: unknown): value is GatewayRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as GatewayRecord;
  return (
    typeof record.id === 'string' &&
    typeof record.host === 'string' &&
    typeof record.port === 'number' &&
    typeof record.url === 'string' &&
    typeof record.pid === 'number' &&
    typeof record.startedAt === 'number' &&
    typeof record.lastSeenAt === 'number'
  );
}

function parseRegistry(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}
