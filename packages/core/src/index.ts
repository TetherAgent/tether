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
  adminEmail?: string;
  deviceId?: string;
  mode?: SessionAccessMode;
  tokenClass: AuthTokenClass;
  expiresAt: number;
  jti: string;
};

export enum ResponseCode {
  SUCCESS = 200,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  TOKEN_ERROR = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  FIELD_VALIDATE_ERROR = 422,
  INTERNAL_SERVER_ERROR = 500
}

export enum ResponseMsg {
  SUCCESS = 'success',
  ERROR = 'error',
  TOKEN_ERROR = 'Token 异常',
  UNAUTHORIZED = '未登录或登录已失效',
  INTERNAL_SERVER_ERROR = 'Internal Server Error'
}

export type ApiSuccess<T = unknown> = {
  code: ResponseCode.SUCCESS | number;
  msg: string;
  data: T;
};

export type ApiFailure = {
  code: number;
  msg: string;
  data: unknown | null;
  stack?: string;
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiFailure;
