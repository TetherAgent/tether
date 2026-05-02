import path from 'node:path';
import type { ProviderDefinition } from '@tether/core';

export type CreateSessionPayload = {
  provider: ProviderDefinition['name'];
  projectPath: string;
  cols: number;
  rows: number;
};

export function buildCreateSessionPayload(
  provider: ProviderDefinition,
  options: { project: string },
  terminal: { columns?: number; rows?: number } = process.stdout
): CreateSessionPayload {
  return {
    provider: provider.name,
    projectPath: path.resolve(options.project),
    cols: terminal.columns || 120,
    rows: terminal.rows || 40
  };
}
