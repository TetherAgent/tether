import path from 'node:path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api/auth': {
        target: 'http://127.0.0.1:4800'
      },
      '/api/admin': {
        target: 'http://127.0.0.1:4800'
      },
      '/api/gateway-auth': {
        target: 'http://127.0.0.1:4800'
      },
      '/api': {
        target: 'http://127.0.0.1:4789',
        ws: true
      }
    }
  }
});
