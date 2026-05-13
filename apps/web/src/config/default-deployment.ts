export type WebDefaultDeployment = 'earntools' | 'fundingrate';

// Web 内置官方部署域名。
//
// 只改默认使用哪套域名：修改 DEFAULT_WEB_DEPLOYMENT。
// 是否强制覆盖浏览器 localStorage['tether:relayUrl']：修改 DEFAULT_FORCE_WEB_LOCAL_CONFIG_SYNC。
//
// 注意：VITE_TETHER_RELAY_URL 仍然拥有最高优先级，方便 dev / preview 临时指向自定义 Relay。
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

// 是否在页面加载时强制覆盖浏览器里保存过的 Relay 地址。
// false：如果 localStorage['tether:relayUrl'] 已存在，继续使用用户之前保存的值。
// true：忽略并覆盖 localStorage['tether:relayUrl']，强制使用 DEFAULT_WEB_DEPLOYMENT 对应的 Relay。
export const DEFAULT_FORCE_WEB_LOCAL_CONFIG_SYNC = true;

export function defaultWebRelayUrl(): string {
  return import.meta.env.VITE_TETHER_RELAY_URL ?? WEB_DEFAULT_DEPLOYMENTS[DEFAULT_WEB_DEPLOYMENT].relayUrl;
}

export function readWebRelayUrl(storage: Storage = window.localStorage): string {
  const defaultRelayUrl = defaultWebRelayUrl();
  if (DEFAULT_FORCE_WEB_LOCAL_CONFIG_SYNC) {
    storage.setItem('tether:relayUrl', defaultRelayUrl);
    return defaultRelayUrl;
  }
  return storage.getItem('tether:relayUrl') ?? defaultRelayUrl;
}
