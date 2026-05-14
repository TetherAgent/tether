export type WebDefaultDeployment = 'earntools' | 'fundingrate';

// Web 内置官方部署域名，作为非浏览器环境或 file:// 场景的兜底。
//
// 只改默认使用哪套域名：修改 DEFAULT_WEB_DEPLOYMENT。
//
// 注意：VITE_TETHER_RELAY_URL 拥有最高优先级。
// 例如根脚本 `dev:web:remote` 注入 wss://tether.fundingrate.cn，本地页面会强制连接远端 Relay。
export const WEB_DEFAULT_DEPLOYMENTS = {
  earntools: {
    relayUrl: 'wss://tether.earntools.me'
  },
  fundingrate: {
    relayUrl: 'wss://tether.fundingrate.cn'
  }
} as const satisfies Record<WebDefaultDeployment, { relayUrl: string }>;

// Web 默认使用哪套官方 Relay 域名。
// 'earntools' 会默认连接 wss://tether.earntools.me。
// 'fundingrate' 会默认连接 wss://tether.fundingrate.cn。
export const DEFAULT_WEB_DEPLOYMENT: WebDefaultDeployment = 'fundingrate';

export function defaultWebRelayUrl(): string {
  const injected = import.meta.env.VITE_TETHER_RELAY_URL;
  if (injected) {
    return injected;
  }
  if (
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
  ) {
    return window.location.origin;
  }
  return WEB_DEFAULT_DEPLOYMENTS[DEFAULT_WEB_DEPLOYMENT].relayUrl;
}

export function readWebRelayUrl(): string {
  return defaultWebRelayUrl();
}
