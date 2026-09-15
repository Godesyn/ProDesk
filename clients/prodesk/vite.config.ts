import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { healthcheck } from '../../packages/shared/vite/healthcheck';
import { vendorChunks } from '../../packages/shared/vite/chunks';
import { ALLOWED_HOSTS } from '../../packages/shared/vite/allowed-hosts';
import { apiProxy } from '../../packages/shared/vite/proxy';

export default defineConfig({
  // VITE_* env vars live in the monorepo root .env (shared with the server),
  // not in clients/prodesk/. Load them from there.
  envDir: path.resolve(__dirname, '../..'),
  // Identifies this bundle to the API (X-Prodesk-Client header). See
  // packages/shared/src/lib/client-id.ts.
  define: { __PRODESK_CLIENT__: JSON.stringify('prodesk') },
  plugins: [react(), tailwindcss(), healthcheck({ client: 'prodesk' })],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../../packages/shared/src'),
      // Import the server's AppRouter *type* for end-to-end tRPC type safety.
      '@server': path.resolve(__dirname, '../../packages/server-shared/src'),
    },
  },
  server: {
    port: 5173,
    allowedHosts: ALLOWED_HOSTS,
    // Everything the Express server (not the SPA) handles — proxied so the dev
    // app runs under a single origin (:5173), matching prod where the server
    // serves both SPA and API, so emailed/redirect links to SERVER_ORIGIN work.
    proxy: apiProxy(),
  },
  build: {
    rollupOptions: {
      // Per-library vendor chunks; @dnd-kit/* coalesced. Lazy-only deps (e.g.
      // @ffmpeg) keep their own on-demand chunks. The pdf.worker chunk is a Web
      // Worker bundle and is independent of this. See packages/shared/vite/chunks.ts.
      output: { manualChunks: vendorChunks({ dnd: ['@dnd-kit'] }) },
    },
  },
});
