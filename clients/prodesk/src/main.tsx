import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from '@shared/providers';
import { App } from './App';
import { AuthLoadingScreen } from '@shared/components/auth-loading-screen';
import { applyStoredAccent } from '@shared/lib/theme-accent';
import './index.css';

// Paint the last-known tenant accent before React mounts, so we don't flash the
// default theme while the real theme is still resolving from the network.
applyStoredAccent();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      {/* Root boundary for code-split route pages rendered outside the app shell
          (auth / public screens). In-app routes have their own boundary in the
          layouts so the shell stays mounted during navigation. */}
      <Suspense fallback={<AuthLoadingScreen />}>
        <App />
      </Suspense>
    </Providers>
  </React.StrictMode>,
);
