/// <reference types="vitest/config" />

import { defineConfig } from 'vite';
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

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
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
