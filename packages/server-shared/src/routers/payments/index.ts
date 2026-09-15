/**
 * Payments (EziQuotes) router namespace — the Manus export's appRouter
 * (prodesk-payments/server/routers.ts) re-expressed as a single `payments.*`
 * sub-router so its 24 feature routers don't collide with the platform's own
 * proposals/billing/invoices. Dropped vs the source: `system` + `auth` (Manus
 * plumbing — Supabase auth + shared profile replace them), `team` (platform
 * staff + invites), `totp` (platform account security).
 * See docs/agents/manus-migration.md + prodesk-payments/MIGRATION-NOTES.md.
 */
import { router } from '../../trpc/trpc.js';
import { accountsRouter } from './accounts.js';
import { clientsRouter } from './clients.js';
import { proposalsRouter } from './proposals.js';
import { templatesRouter } from './templates.js';
import { pricingRouter } from './pricing.js';
import { adminRouter } from './admin.js';
import { integrationsRouter } from './integrations.js';
import { paymentsRouter } from './payments.js';
import { chaseRouter } from './chase.js';
import { affiliatesRouter } from './affiliates.js';
import { aiRouter } from './ai.js';
import { analyticsRouter } from './analytics.js';
import { analyticsExtraRouter } from './analyticsExtra.js';
import { clientPortalRouter } from './clientPortal.js';
import { installmentsRouter } from './installments.js';
import { revisionsRouter } from './revisions.js';
import { surveysRouter } from './surveys.js';
import { recurringInvoicesRouter } from './recurringInvoices.js';
import { annotationsRouter } from './annotations.js';
import { billingRouter } from './billing.js';
import { sequencesRouter } from './sequences.js';
import { lifecycleRouter } from './lifecycle.js';
import { outboundWebhooksRouter } from './outboundWebhooks.js';
import { categoriesRouter } from './categories.js';

export const paymentsNamespaceRouter = router({
  accounts: accountsRouter,
  clients: clientsRouter,
  proposals: proposalsRouter,
  templates: templatesRouter,
  pricing: pricingRouter,
  admin: adminRouter,
  integrations: integrationsRouter,
  payments: paymentsRouter,
  chase: chaseRouter,
  affiliates: affiliatesRouter,
  ai: aiRouter,
  analytics: analyticsRouter,
  analyticsExtra: analyticsExtraRouter,
  clientPortal: clientPortalRouter,
  installments: installmentsRouter,
  revisions: revisionsRouter,
  surveys: surveysRouter,
  recurringInvoices: recurringInvoicesRouter,
  annotations: annotationsRouter,
  billing: billingRouter,
  sequences: sequencesRouter,
  lifecycle: lifecycleRouter,
  outboundWebhooks: outboundWebhooksRouter,
  categories: categoriesRouter,
});
