import type { Entitlement } from './lib';

export type Page =
  | 'links'
  | 'create'
  | 'detail'
  | 'analytics'
  | 'bulk'
  | 'billing'
  | 'settings'
  | 'support'
  | 'campaigns'
  | 'campaignNew'
  | 'campaignDetail';

export type RouteParams = { linkId?: string; campaignId?: string };

export type PageProps = {
  brandId: string;
  go: (page: Page, params?: RouteParams) => void;
  /** Opens the create flow, or starts checkout first when not entitled. */
  onNewLink: () => void;
  entitlement: Entitlement | undefined;
  params: RouteParams;
};
