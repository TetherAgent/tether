const MASK = '[REDACTED]';

const PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g
];

export function maskSensitiveOutput(value: string): string {
  return PATTERNS.reduce((text, pattern) => text.replace(pattern, MASK), value);
}
