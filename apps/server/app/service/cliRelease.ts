import { Service } from 'egg';

const CLI_LATEST_URL = 'https://registry.npmjs.org/@tether-labs/cli/latest';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

let cachedLatest: { value: string | null; expiresAt: number } | undefined;
let inFlight: Promise<string | null> | undefined;

function validVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default class CliReleaseService extends Service {
  public async latestVersion(): Promise<string | null> {
    const now = Date.now();
    if (cachedLatest && cachedLatest.expiresAt > now) {
      return cachedLatest.value;
    }
    if (inFlight) {
      return await inFlight;
    }

    inFlight = this.fetchLatestVersion();
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  }

  public resetCacheForTest(): void {
    cachedLatest = undefined;
    inFlight = undefined;
  }

  private async fetchLatestVersion(): Promise<string | null> {
    let value: string | null = null;
    try {
      const response = await fetch(CLI_LATEST_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (response.ok) {
        const body = await response.json() as { version?: unknown };
        value = validVersion(body.version);
      }
    } catch {
      value = null;
    }
    cachedLatest = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS
    };
    return value;
  }
}
