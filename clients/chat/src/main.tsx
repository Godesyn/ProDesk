import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from '@shared/providers';
import { App } from './App';
import { applyStoredAccent } from '@shared/lib/theme-accent';
import { applyStoredGround } from './lib/ground';
import './index.css';

// Apply the last-cached agency accent before React mounts to avoid a flash of
// the default theme. See packages/shared/src/lib/theme-accent.ts.
applyStoredAccent();

// Chat is dark-first, so the ground is painted in the same breath. See
// lib/ground.ts for why this is a device preference and not an account one.
applyStoredGround();

/**
 * The rail starts COLLAPSED here, unlike every other frontend.
 *
 * A messenger's navigation is four items; the horizontal budget belongs to the
 * conversation, and the thread list already does the job an expanded rail would.
 * The shared AppShell persists collapse under `psp.collapsed.<appKey>` and treats
 * a missing key as "expanded", so first boot seeds it once. After that the user's
 * own choice is what is read — we only ever write when nothing is there.
 */
try {
  if (localStorage.getItem('psp.collapsed.chat') === null) {
    localStorage.setItem('psp.collapsed.chat', '1');
  }
} catch {
  /* private mode / storage disabled — the rail just starts expanded */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
