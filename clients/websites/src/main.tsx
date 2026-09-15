import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from '@shared/providers';
import { App } from './App';
import { applyStoredAccent } from '@shared/lib/theme-accent';
import './index.css';

// Apply the last-cached agency accent before React mounts to avoid a flash of
// the default theme. See packages/shared/src/lib/theme-accent.ts.
applyStoredAccent();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
