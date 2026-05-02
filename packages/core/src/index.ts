export type ProviderName = 'codex' | 'claude' | 'opencode';

export type ProviderDefinition = {
  name: ProviderName;
  command: string;
};

export const PROVIDERS = {
  codex: { name: 'codex', command: 'codex' },
  claude: { name: 'claude', command: 'claude' },
  opencode: { name: 'opencode', command: 'opencode' }
} satisfies Record<ProviderName, ProviderDefinition>;

export function isProviderName(value: string): value is ProviderName {
  return Object.hasOwn(PROVIDERS, value);
}

export type Gateway = {
  id: string;
  name: string;
};

export type UISurfaceKind = 'terminal' | 'mobile-web' | 'desktop-web' | 'floating';

export type WorkTargetRole = 'frontend' | 'backend' | 'package' | 'internal' | 'docs' | 'other';
