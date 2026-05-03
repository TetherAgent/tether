import path from 'node:path';
import type { ProviderDefinition } from '@tether/core';

export type CreateSessionPayload = {
  provider: ProviderDefinition['name'];
  projectPath: string;
  cols: number;
  rows: number;
  providerArgs?: string[];
};

export function buildCreateSessionPayload(
  provider: ProviderDefinition,
  options: { project: string; providerArgs?: string[] },
  terminal: { columns?: number; rows?: number } = process.stdout
): CreateSessionPayload {
  const payload: CreateSessionPayload = {
    provider: provider.name,
    projectPath: path.resolve(options.project),
    cols: terminal.columns || 120,
    rows: terminal.rows || 40
  };
  if (options.providerArgs && options.providerArgs.length > 0) {
    payload.providerArgs = options.providerArgs;
  }
  return payload;
}
