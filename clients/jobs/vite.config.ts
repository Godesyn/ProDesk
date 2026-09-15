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
  // Identifies the bundle to the API via the X-Prodesk-Client header.
  // See packages/shared/src/lib/client-id.ts.
  define: { __PRODESK_CLIENT__: JSON.stringify('jobs') },
  // healthcheck() serves /health on `vite preview` for the platform healthcheck
  // (.railway/configs/clients/<name>.json → "healthcheckPath": "/health").
  plugins: [react(), tailwindcss(), healthcheck({ client: 'jobs' })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@server': path.resolve(__dirname, '../../packages/server-shared/src'),
    },
  },
  server: {
    // prodesk 5173, dashboard 5174, links 5175, reviews 5176, payments 5177,
    // signatures 5178, jobs 5179, websites 5180, design 5181, logo 5182.
    port: 5179,
    allowedHosts: ALLOWED_HOSTS,
    proxy: apiProxy(),
  },
  build: {
    rollupOptions: {
      // Per-library vendor chunks so the entry stays small as the frontend grows.
      // Pass groups to coalesce, e.g. vendorChunks({ charts: ['recharts'] }).
      // See packages/shared/vite/chunks.ts.
      output: { manualChunks: vendorChunks() },
    },
  },
});
