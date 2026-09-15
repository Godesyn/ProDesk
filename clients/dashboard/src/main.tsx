import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from '@shared/providers';
import { App } from './App';
import { applyStoredAccent } from '@shared/lib/theme-accent';
import './index.css';

applyStoredAccent();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
