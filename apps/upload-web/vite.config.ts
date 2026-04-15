/// <reference types="vitest/config" />

import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

function manualVendorChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined;
  }
  if (id.includes('react-router')) {
    return 'router-vendor';
  }
  if (id.includes('react-dom') || id.includes('/react/') || id.includes('\\react\\') || id.includes('scheduler')) {
    return 'react-vendor';
  }
  return 'vendor';
}

const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000',
    changeOrigin: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: manualVendorChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
} as any);
