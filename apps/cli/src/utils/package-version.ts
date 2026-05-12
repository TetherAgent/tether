import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolvePackageVersion(startUrl: string, packageName: string): string | undefined {
  let current = path.dirname(fileURLToPath(startUrl));
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = path.join(current, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: unknown; version?: unknown };
        if (parsed.name === packageName && typeof parsed.version === 'string') {
          return parsed.version;
        }
      } catch {
        return undefined;
      }
    }
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return undefined;
}
