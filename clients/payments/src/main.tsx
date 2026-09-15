import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from '@shared/providers';
import { TooltipProvider } from '@/components/ui/tooltip';
import { App } from './App';
import { applyStoredAccent } from '@shared/lib/theme-accent';
import './index.css';

// Apply the last-cached agency accent before React mounts to avoid a flash of
// the default theme. See packages/shared/src/lib/theme-accent.ts.
applyStoredAccent();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      {/* TooltipProvider sat at the export's app root — kept here so every
          ported page's <Tooltip> works (shared Providers has none). The sonner
          Toaster is rendered by shared Providers, so we don't mount a 2nd one
          (that double-rendered every toast). */}
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </Providers>
  </React.StrictMode>,
);
