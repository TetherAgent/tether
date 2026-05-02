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

export type AuthTokenClass =
  | 'normal_client_access'
  | 'normal_client_refresh'
  | 'management_access'
  | 'management_refresh'
  | 'gateway_access'
  | 'gateway_refresh'
  | 'ws_ticket';

export type SessionAccessMode = 'control' | 'observe';

export type AuthScopePayload = {
  accountId: string;
  workspaceId: string;
  gatewayId?: string;
  sessionId?: string;
  userId?: string;
  adminUserId?: string;
  deviceId?: string;
  mode?: SessionAccessMode;
  tokenClass: AuthTokenClass;
  expiresAt: number;
  jti: string;
};
