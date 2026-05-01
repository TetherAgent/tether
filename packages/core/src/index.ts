export type ProviderName = 'codex' | 'claude' | 'opencode';

export type Gateway = {
  id: string;
  name: string;
};

export type UISurfaceKind = 'terminal' | 'mobile-web' | 'desktop-web' | 'floating';

export type WorkTargetRole = 'frontend' | 'backend' | 'package' | 'internal' | 'docs' | 'other';
