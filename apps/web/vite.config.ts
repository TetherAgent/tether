import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const authApiTarget = process.env.TETHER_WEB_AUTH_API_URL ?? 'http://127.0.0.1:4800';
const gatewayApiTarget = process.env.TETHER_WEB_GATEWAY_API_URL ?? 'http://127.0.0.1:4789';
const relayWsTarget = process.env.TETHER_WEB_RELAY_WS_URL ?? 'ws://127.0.0.1:4889';

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
      '/api/auth': {
        target: authApiTarget,
        changeOrigin: true
      },
      '/api/admin': {
        target: authApiTarget,
        changeOrigin: true
      },
      '/api/gateway-auth': {
        target: authApiTarget,
        changeOrigin: true
      },
      '/api': {
        target: gatewayApiTarget,
        changeOrigin: true,
        ws: true
      },
      '/client': {
        target: relayWsTarget,
        changeOrigin: true,
        ws: true
      },
      '/gateway': {
        target: relayWsTarget,
        changeOrigin: true,
        ws: true
      }
    }
  }
});
