import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { healthcheck } from '../../packages/shared/vite/healthcheck';
import { vendorChunks } from '../../packages/shared/vite/chunks';
import { ALLOWED_HOSTS } from '../../packages/shared/vite/allowed-hosts';
import { apiProxy } from '../../packages/shared/vite/proxy';
import { sharedPublic } from '../../packages/shared/vite/landing';

export default defineConfig({
  // VITE_* env vars live in the monorepo root .env (shared with the server).
  envDir: path.resolve(__dirname, '../..'),
  // Identifies this bundle to the API (X-Prodesk-Client header). See
  // packages/shared/src/lib/client-id.ts.
  define: { __PRODESK_CLIENT__: JSON.stringify('links') },
  plugins: [
    react(),
    tailwindcss(),
    healthcheck({ client: 'links' }),
    // Serves packages/shared/public — the Adeyy marketing page framed by
    // @shared/pages/landing, shared with the redirector. `%APP_ORIGIN%` resolves
    // to '' here: this frontend owns /login and /signup on its own origin.
    sharedPublic(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      // Import the server's AppRouter *type* for end-to-end tRPC type safety.
      '@server': path.resolve(__dirname, '../../packages/server-shared/src'),
    },
  },
  server: {
    // Unique dev port (prodesk = 5173, dashboard = 5174).
    port: 5175,
    allowedHosts: ALLOWED_HOSTS,
    proxy: apiProxy(),
  },
  build: {
    rollupOptions: {
      // Split node_modules into per-library cacheable chunks (was a single
      // ~730 kB index chunk). See packages/shared/vite/chunks.ts.
      output: { manualChunks: vendorChunks() },
    },
  },
});
