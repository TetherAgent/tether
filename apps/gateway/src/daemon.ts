import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import { maskSensitiveOutput } from './mask.js';
import { Store } from './store.js';
import { capturePane, sendKeys, sessionExists } from './tmux.js';

export type DaemonOptions = {
  host: string;
  port: number;
  store: Store;
};

export type RunningDaemon = {
  url: string;
  close: () => Promise<void>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '../../../web/dist');

export function localLanAddress(): string | undefined {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return undefined;
}

export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const app = new Hono();

  app.get('/api/sessions', (c) => {
    return c.json({ sessions: options.store.listSessions() });
  });

  app.get('/api/sessions/:id/snapshot', async (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }

    if (!(await sessionExists(session.tmuxSessionName))) {
      options.store.updateSessionStatus(session.id, 'stopped');
      return c.json({ error: 'tmux session is no longer running' }, 410);
    }

    const raw = await capturePane(session.tmuxSessionName);
    const text = maskSensitiveOutput(raw);
    return c.json({ session, text, capturedAt: Date.now() });
  });

  app.post('/api/sessions/:id/send', async (c) => {
    const session = options.store.getSession(c.req.param('id'));
    if (!session) {
      return c.json({ error: 'session not found' }, 404);
    }

    if (!(await sessionExists(session.tmuxSessionName))) {
      options.store.updateSessionStatus(session.id, 'stopped');
      return c.json({ error: 'tmux session is no longer running' }, 410);
    }

    const body = await c.req.json<{ text?: unknown }>().catch(() => undefined);
    if (!body || typeof body.text !== 'string' || body.text.length === 0) {
      return c.json({ error: 'text is required' }, 400);
    }

    if (body.text.length > 4000) {
      return c.json({ error: 'text is too long' }, 400);
    }

    await sendKeys(session.tmuxSessionName, body.text);
    options.store.touchSession(session.id);
    return c.json({ ok: true });
  });

  app.get('/assets/*', async (c) => {
    const assetPath = path.resolve(webDistDir, c.req.path.replace(/^\//, ''));
    if (!assetPath.startsWith(webDistDir)) {
      return c.text('not found', 404);
    }
    const file = await readFile(assetPath).catch(() => undefined);
    if (!file) {
      return c.text('not found', 404);
    }
    return new Response(file);
  });

  app.get('/remote/session/:id', async (c) => {
    const html = await readFile(path.resolve(webDistDir, 'index.html'), 'utf8').catch(() => undefined);
    if (!html) {
      return c.text('Web app is not built. Run: pnpm web:build', 503);
    }
    return c.html(html);
  });

  const server = serve({
    fetch: app.fetch,
    hostname: options.host,
    port: options.port
  }) as ServerType;

  const displayHost = options.host === '0.0.0.0' ? localLanAddress() ?? '127.0.0.1' : options.host;
  return {
    url: `http://${displayHost}:${options.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      })
  };
}
