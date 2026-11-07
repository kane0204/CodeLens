import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const BACKEND = env?.VITE_API_TARGET ?? 'http://127.0.0.1:18766';
const BACKEND_ORIGIN = new URL(BACKEND).origin;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        configure(proxy) {
          // 后端只接受本机页面（127.0.0.1:18766）发起的 POST；
          // 开发服务器把 Origin 改写为后端自身来源，避免联调时被 403 拒绝。
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', BACKEND_ORIGIN);
          });
        },
      },
    },
  },
});
