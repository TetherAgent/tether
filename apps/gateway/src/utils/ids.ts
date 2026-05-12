import { randomBytes } from 'node:crypto';

export function createSessionId(now = new Date()): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix = randomBytes(4).toString('hex');
  return `tth_${yyyy}${mm}${dd}_${suffix}`;
}
