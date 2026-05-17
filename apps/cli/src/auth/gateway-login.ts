import { rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import { DEFAULT_SERVER_URL } from '@tether/config';
import * as terminal from '../terminal.js';
import { findAvailablePort, openBrowser } from '../utils/process.js';
import { loadOrCreateDeviceState } from './device-state.js';
import { gatewayAuthPath, writeGatewayAuthState } from './gateway-auth-store.js';
import { decodeTokenPayload } from './token.js';

const LOCAL_SERVER_URL = 'http://127.0.0.1:4800';
const GATEWAY_AUTH_CALLBACK_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

export type GatewayLoginEnv = 'local' | 'prod';

export async function performGatewayLogin(options: {
  serverUrl?: string;
  env?: GatewayLoginEnv;
}): Promise<void> {
  const serverUrl = resolveGatewayLoginServerUrl(options);
  if (!serverUrl) {
    throw new Error('缺少 Server URL。请传 --server-url，或设置 TETHER_SERVER_URL');
  }
  const port = await findAvailablePort();
  const hostname = os.hostname();
  const device = await loadOrCreateDeviceState();
  const browserUrl = `${serverUrl}/gateway-auth?port=${port}&hostname=${encodeURIComponent(hostname)}&deviceKey=${encodeURIComponent(device.deviceKey)}`;
  terminal.section('正在打开浏览器进行授权...');
  terminal.warn(`如果浏览器未自动打开，请访问：${browserUrl}`);
  openBrowser(browserUrl);
  const result = await waitForGatewayAuthCallback(port, DEFAULT_GATEWAY_AUTH_TIMEOUT_MS);
  const payload = decodeTokenPayload(result.gatewayAccessToken);
  if (!payload || typeof payload.expiresAt !== 'number') {
    throw new Error('Gateway 登录失败：access token 缺少 expiresAt');
  }
  await writeGatewayAuthState({
    serverUrl,
    accessToken: result.gatewayAccessToken,
    refreshToken: result.gatewayRefreshToken,
    expiresAt: payload.expiresAt
  });
  terminal.success(`Gateway 登录成功，凭据已写入：${gatewayAuthPath()}`);
  terminal.line('已绑定 Gateway ID', result.gatewayId);
  terminal.line('Account ID', result.accountId);
  terminal.line('下一步', 'tether start');
  terminal.line('查看状态', 'tether status');
}

export async function logoutGateway(): Promise<void> {
  await rm(gatewayAuthPath(), { force: true });
  terminal.success(`已删除本机 Gateway 登录凭据：${gatewayAuthPath()}`);
  terminal.warn('服务端 Gateway 绑定未变；如需解绑，请在管理后台取消链接。');
}

type GatewayAuthCallbackResult = {
  gatewayId: string;
  accountId: string;
  gatewayAccessToken: string;
  gatewayRefreshToken: string;
};

async function waitForGatewayAuthCallback(port: number, timeoutMs: number): Promise<GatewayAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: GatewayAuthCallbackResult | undefined, error: Error | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      server.close(() => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as GatewayAuthCallbackResult);
      });
    };
    const timer = setTimeout(() => {
      finish(undefined, new Error('Gateway 授权超时（10 分钟），请重试'));
    }, timeoutMs);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${GATEWAY_AUTH_CALLBACK_HOST}:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { connection: 'close' }).end();
        return;
      }
      const get = (k: string) => url.searchParams.get(k);
      const gatewayId = get('gatewayId');
      const accountId = get('accountId');
      const gatewayAccessToken = get('gatewayAccessToken');
      const gatewayRefreshToken = get('gatewayRefreshToken');

      if (!gatewayId || !accountId || !gatewayAccessToken || !gatewayRefreshToken) {
        const errorHtml = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>授权失败 · Tether</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse 80% 60% at 50% -10%,#2a0d0d 0%,#0a0a0a 70%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e5e5}.card{background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:40px 36px;width:100%;max-width:380px;text-align:center}h1{font-size:20px;font-weight:600;color:#f5f5f5;margin-bottom:8px}p{font-size:14px;color:#a3a3a3;line-height:1.6}</style>
</head><body><div class="card"><h1>授权失败</h1><p>回调参数缺失，请重新运行 tether login。</p></div></body></html>`;
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
          .end(errorHtml, () => {
            req.socket.destroy();
            finish(undefined, new Error('Gateway 授权失败：回调缺少必要参数'));
          });
        return;
      }

      const successHtml = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权成功 · Tether</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse 80% 60% at 50% -10%,#0d2a1a 0%,#0a0a0a 70%);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e5e5}
  .card{background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.08);
    border-radius:16px;padding:40px 36px;width:100%;max-width:380px;
    box-shadow:0 24px 64px rgba(0,0,0,.6);text-align:center}
  .icon{width:52px;height:52px;border-radius:50%;background:rgba(34,197,94,.15);
    border:1.5px solid rgba(34,197,94,.4);display:flex;align-items:center;
    justify-content:center;margin:0 auto 20px}
  .icon svg{width:26px;height:26px;stroke:#22c55e;fill:none;stroke-width:2.5;
    stroke-linecap:round;stroke-linejoin:round}
  h1{font-size:20px;font-weight:600;color:#f5f5f5;margin-bottom:8px}
  p{font-size:14px;color:#a3a3a3;line-height:1.6;margin-bottom:28px}
  button{width:100%;padding:11px 0;border-radius:8px;border:none;cursor:pointer;
    font-size:14px;font-weight:500;
    background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;
    transition:opacity .15s}
  button:hover{opacity:.85}
</style>
</head>
<body>
<div class="card">
  <div class="icon">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <h1>授权成功</h1>
  <p>Gateway 已绑定到你的账号，可以关闭此窗口，返回终端继续操作。</p>
  <button onclick="window.close()">关闭窗口</button>
</div>
</body>
</html>`;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(
        successHtml,
        () => {
          req.socket.destroy();
          finish({ gatewayId, accountId, gatewayAccessToken, gatewayRefreshToken }, undefined);
        }
      );
    });

    server.listen(port, GATEWAY_AUTH_CALLBACK_HOST);
  });
}

function resolveGatewayLoginServerUrl(options: {
  serverUrl?: string;
  env?: GatewayLoginEnv;
}): string {
  const normalized = normalizeServerUrl(
    options.serverUrl ??
    process.env.TETHER_SERVER_URL ??
    (options.env === 'local' ? LOCAL_SERVER_URL : DEFAULT_SERVER_URL)
  );
  if (!normalized) {
    throw new Error('Gateway 登录失败：缺少 Server URL');
  }
  return normalized;
}

function normalizeServerUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/\/+$/, '');
}
