// Which frontend bundle is running. Injected per client at build time via Vite
// `define` (clients/<name>/vite.config.ts → __PRODESK_CLIENT__). Defaults to
// 'prodesk' when undefined (e.g. tests). Sent to the API as `X-Prodesk-Client`
// so server features (e.g. AI action-tool flags) can differ per client.
declare const __PRODESK_CLIENT__: string | undefined;

export type ProdeskClient =
  | 'prodesk'
  | 'dashboard'
  | 'links'
  | 'reviews'
  | 'payments'
  | 'signatures'
  | 'jobs'
  | 'websites'
  | 'design'
  | 'logo'
  | 'chat';

export const PRODESK_CLIENT: ProdeskClient =
  (typeof __PRODESK_CLIENT__ === 'string' ? __PRODESK_CLIENT__ : 'prodesk') as ProdeskClient;
