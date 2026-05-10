import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const serverApiTarget = process.env.TETHER_WEB_SERVER_API_URL ?? 'http://127.0.0.1:4800';
const relayWsTarget = process.env.TETHER_WEB_RELAY_WS_URL ?? 'ws://127.0.0.1:4889';
const remoteOnly = process.env.TETHER_WEB_REMOTE_ONLY === '1';

if (remoteOnly) {
  assertRemoteTarget('TETHER_WEB_SERVER_API_URL', serverApiTarget);
  assertRemoteTarget('TETHER_WEB_RELAY_WS_URL', relayWsTarget);
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    strictPort: true,
    proxy: {
      '/api': {
        target: serverApiTarget,
        changeOrigin: true
      },
      '/ws': {
        target: relayWsTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});

function assertRemoteTarget(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL when TETHER_WEB_REMOTE_ONLY=1`);
  }
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`${name} must not point to a local target when TETHER_WEB_REMOTE_ONLY=1`);
  }
}
