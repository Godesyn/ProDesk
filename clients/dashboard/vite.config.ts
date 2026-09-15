import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { healthcheck } from '../../packages/shared/vite/healthcheck';
import { vendorChunks } from '../../packages/shared/vite/chunks';
import { ALLOWED_HOSTS } from '../../packages/shared/vite/allowed-hosts';
import { apiProxy } from '../../packages/shared/vite/proxy';

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  // Identifies this bundle to the API (X-Prodesk-Client header). See
  // packages/shared/src/lib/client-id.ts.
  define: { __PRODESK_CLIENT__: JSON.stringify('dashboard') },
  plugins: [react(), tailwindcss(), healthcheck({ client: 'dashboard' })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@server': path.resolve(__dirname, '../../packages/server-shared/src'),
    },
  },
  server: {
    port: 5174, // Different port from Prodesk (5173)
    allowedHosts: ALLOWED_HOSTS,
    proxy: apiProxy(),
  },
  build: {
    rollupOptions: {
      // Split node_modules into per-library cacheable chunks (was a single
      // ~1.2 MB index chunk). See packages/shared/vite/chunks.ts.
      output: { manualChunks: vendorChunks() },
    },
  },
});
