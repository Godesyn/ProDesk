import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { healthcheck } from '../../packages/shared/vite/healthcheck';
import { legacyStorageRedirect } from '../../packages/shared/vite/legacy-storage';
import { vendorChunks } from '../../packages/shared/vite/chunks';
import { ALLOWED_HOSTS } from '../../packages/shared/vite/allowed-hosts';
import { apiProxy } from '../../packages/shared/vite/proxy';

export default defineConfig({
  envDir: path.resolve(__dirname, '../..'),
  // TODO: set this to your frontend's id. It identifies the bundle to the API
  // via the X-Prodesk-Client header. See packages/shared/src/lib/client-id.ts.
  define: { __PRODESK_CLIENT__: JSON.stringify('signatures') },
  // healthcheck() serves /health on `vite preview` for the platform healthcheck
  // (.railway/configs/clients/<name>.json → "healthcheckPath": "/health").
  // legacyStorageRedirect() keeps the legacy Manus asset URLs alive:
  // /manus-storage/<key> (embedded in already-sent email signatures) 301s to the
  // migrated copy in Supabase Storage (brand-files/signatures/legacy/<key>).
  plugins: [
    react(),
    tailwindcss(),
    healthcheck({ client: 'signatures' }),
    legacyStorageRedirect(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@server': path.resolve(__dirname, '../../packages/server-shared/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@tailwindcss/oxide'],
  },
  server: {
    // prodesk 5173, dashboard 5174, links 5175, reviews 5176, payments 5177.
    port: 5178,
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
