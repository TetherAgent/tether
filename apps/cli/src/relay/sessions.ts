import WebSocket from 'ws';
import type { ProviderDefinition } from '@tether/core';

export type CliSession = {
  id: string;
  status: string;
  transport?: string;
  projectPath?: string;
  tmuxSessionName?: string;
};

export type CreatedGatewaySession = {
  id: string;
};

export type CreateRelaySessionOptions = {
  title?: string;
  providerArgs?: string[];
};

export type NewPtySessionFrame = {
  type: 'client.new-pty-session';
  provider: ProviderDefinition['name'];
  command: string;
  cwd: string;
  cols: number;
  rows: number;
  gatewayId: string;
  title?: string;
  providerArgs?: string[];
};

export async function listSessionsViaRelay(relayUrl: string, accessToken: string): Promise<CliSession[]> {
  const ws = new WebSocket(relayClientUrl(relayUrl));
  return await new Promise<CliSession[]>((resolve, reject) => {
    let settled = false;
    let listTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, sessions?: CliSession[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (listTimer) {
        clearTimeout(listTimer);
      }
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        reject(error);
      } else {
        resolve(sessions ?? []);
      }
    };
    const timer = setTimeout(() => {
      finish(new Error('relay auth timeout'));
    }, 5_000);
    ws.once('error', (err) => {
      finish(err instanceof Error ? err : new Error(String(err)));
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
    });
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.type === 'client.auth.failed') {
        finish(new Error(`relay auth failed: ${String(frame.message ?? 'unknown error')}`));
        return;
      }
      if (frame.type === 'client.auth.ok') {
        clearTimeout(timer);
        listTimer = setTimeout(() => finish(new Error('relay list timeout')), 5_000);
        ws.send(JSON.stringify({ type: 'client.list' }));
        return;
      }
      if (frame.type === 'sessions') {
        finish(undefined, Array.isArray(frame.sessions) ? frame.sessions as CliSession[] : []);
        return;
      }
      if (frame.type === 'error') {
        finish(new Error(String(frame.message ?? frame.code ?? 'relay error')));
      }
    });
  });
}

export async function stopSessionViaRelay(id: string, relayUrl: string, accessToken: string): Promise<void> {
  const ws = new WebSocket(relayClientUrl(relayUrl));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let stopAckTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stopAckTimer) {
        clearTimeout(stopAckTimer);
      }
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('relay stop timeout')), 5_000);
    ws.once('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    ws.once('open', () => ws.send(JSON.stringify({ type: 'client.auth', token: accessToken })));
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.type === 'client.auth.failed') {
        finish(new Error(`relay auth failed: ${String(frame.message ?? 'unknown error')}`));
        return;
      }
      if (frame.type === 'client.auth.ok') {
        // relay sets subscription synchronously before forwarding to gateway,
        // so subscribe+stop can be sent back-to-back
        ws.send(JSON.stringify({ type: 'client.subscribe', sessionId: id, mode: 'control' }));
        ws.send(JSON.stringify({ type: 'client.stop', sessionId: id }));
        stopAckTimer = setTimeout(() => finish(), 300);
        return;
      }
      if (frame.type === 'error' || frame.type === 'gateway_unavailable') {
        finish(new Error(String(frame.message ?? frame.code ?? 'relay error')));
      }
    });
  });
}

export async function createSessionViaRelay(
  provider: ProviderDefinition,
  options: CreateRelaySessionOptions,
  relayUrl: string,
  accessToken: string,
  gatewayId: string
): Promise<CreatedGatewaySession> {
  const ws = new WebSocket(relayClientUrl(relayUrl));
  return await new Promise<CreatedGatewaySession>((resolve, reject) => {
    let authOk = false;
    let settled = false;
    let createTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, session?: CreatedGatewaySession) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (createTimer) {
        clearTimeout(createTimer);
      }
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(session as CreatedGatewaySession);
    };
    const timer = setTimeout(() => {
      finish(new Error(authOk ? 'relay PTY session create timeout' : 'relay auth timeout'));
    }, authOk ? 10_000 : 5_000);
    ws.once('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'client.auth', token: accessToken }));
    });
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (frame.type === 'client.auth.failed') {
        finish(new Error(`relay auth failed: ${String(frame.message ?? 'unknown error')}`));
        return;
      }
      if (!authOk && frame.type === 'client.auth.ok') {
        authOk = true;
        clearTimeout(timer);
        createTimer = setTimeout(() => {
          finish(new Error('relay PTY session create timeout'));
        }, 10_000);
        ws.send(JSON.stringify(buildNewPtySessionFrame(provider, options, gatewayId)));
        return;
      }
      if (frame.type === 'gateway.session-created' && typeof frame.sessionId === 'string') {
        finish(undefined, { id: frame.sessionId });
        return;
      }
      if (frame.type === 'error') {
        finish(new Error(`session create error: ${String(frame.message ?? frame.code ?? 'unknown error')}`));
      }
    });
  });
}

export function buildNewPtySessionFrame(
  provider: ProviderDefinition,
  options: CreateRelaySessionOptions,
  gatewayId: string,
  terminal: { columns?: number; rows?: number } = process.stdout
): NewPtySessionFrame {
  const title = normalizeSessionTitle(options.title);
  return {
    type: 'client.new-pty-session',
    provider: provider.name,
    command: provider.command,
    cwd: process.cwd(),
    cols: terminal.columns ?? 120,
    rows: terminal.rows ?? 40,
    gatewayId,
    ...(title ? { title } : {}),
    ...(Array.isArray(options.providerArgs) && options.providerArgs.length > 0
      ? { providerArgs: options.providerArgs }
      : {})
  };
}

export function relayClientUrl(relayUrl: string): string {
  const url = new URL(relayUrl);
  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }
  url.pathname = '/ws/client';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function normalizeSessionTitle(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  return trimmed ? trimmed : undefined;
}
