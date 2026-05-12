import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Button, InfoBlock } from '@tether/design';
import { WebAuthShell } from '../components/console/web-auth-shell.js';
import { useAuth } from '../hooks/use-auth.js';
import { gatewayAuthHeaders, readGatewayData, readStoredNormalAuth } from '../lib/api.js';

type GatewayBindResult = {
  gateway: { id: string };
  accountId: string;
  gatewayAccessToken: string;
  gatewayRefreshToken: string;
};

export function GatewayAuthPage() {
  const location = useLocation();
  const { authReady, normalAuth } = useAuth();
  const storedNormalAuth = normalAuth ?? readStoredNormalAuth();

  const params = new URLSearchParams(location.search);
  const port = params.get('port');
  const hostname = params.get('hostname') ?? 'unknown';
  const deviceKey = params.get('deviceKey') ?? '';

  const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  if (!authReady) return null;

  if (!storedNormalAuth) {
    return <Navigate replace to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`} />;
  }

  if (!port) {
    return (
      <WebAuthShell title="授权 Gateway" description="参数无效，请重新运行 tether gateway login。">
        <div />
      </WebAuthShell>
    );
  }

  if (!deviceKey) {
    return (
      <WebAuthShell title="授权 Gateway" description="缺少设备标识，请重新运行 tether gateway login。">
        <div />
      </WebAuthShell>
    );
  }

  const authorize = async () => {
    setStatus('loading');
    setError(null);
    try {
      const response = await fetch('/api/server/gateway-auth/bind', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...gatewayAuthHeaders() },
        body: JSON.stringify({ hostname, deviceKey, port: Number(port) })
      });
      if (!response.ok) {
        throw new Error(`授权失败：HTTP ${response.status}`);
      }
      const data = await readGatewayData<GatewayBindResult>(response);
      const callbackUrl = new URL(`http://localhost:${port}/callback`);
      callbackUrl.searchParams.set('gatewayId', data.gateway.id);
      callbackUrl.searchParams.set('accountId', data.accountId);
      callbackUrl.searchParams.set('gatewayAccessToken', data.gatewayAccessToken);
      callbackUrl.searchParams.set('gatewayRefreshToken', data.gatewayRefreshToken);
      setStatus('done');
      window.location.href = callbackUrl.toString();
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : '未知错误');
    }
  };

  return (
    <WebAuthShell
      title="授权 Gateway"
      description={`允许本机 "${hostname}" (${deviceKey.slice(0, 12)}...) 作为 Gateway 连接到你的账号？`}
    >
      {status === 'done' ? (
        <p>授权成功，可以关闭此窗口。</p>
      ) : (
        <>
          {error ? <InfoBlock variant="error" title="授权失败" description={error} /> : null}
          <Button disabled={status === 'loading'} size="lg" className="w-full" onClick={authorize}>
            {status === 'loading' ? '授权中...' : '授权'}
          </Button>
        </>
      )}
    </WebAuthShell>
  );
}
