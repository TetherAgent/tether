import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

const serverApiTarget = process.env.TETHER_WEB_SERVER_API_URL ?? 'http://127.0.0.1:4800';
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
