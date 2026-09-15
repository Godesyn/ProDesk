import { router } from './trpc.js';
import { authRouter } from '../routers/auth.js';
import { usersRouter } from '../routers/users.js';
import { agenciesRouter } from '../routers/agencies.js';
import { brandsRouter } from '../routers/brands.js';
import { contactsRouter } from '../routers/contacts.js';
import { servicesRouter } from '../routers/services.js';
import { packagesRouter } from '../routers/packages.js';
import { staffRouter } from '../routers/staff.js';
import { connectionsRouter } from '../routers/connections.js';
import { proposalsRouter } from '../routers/proposals.js';
import { projectsRouter } from '../routers/projects.js';
import { projectTagsRouter } from '../routers/project-tags.js';
import { purchasesRouter } from '../routers/purchases.js';
import { marketplaceRouter } from '../routers/marketplace.js';
import { tasksRouter } from '../routers/tasks.js';
import { payoutsRouter } from '../routers/payouts.js';
import { invoicesRouter } from '../routers/invoices.js';
import { chatRouter } from '../routers/chat/index.js';
import { superAdminRouter } from '../routers/superAdmin.js';
import { resourcesRouter } from '../routers/resources.js';
import { filesRouter } from '../routers/files.js';
import { meetingsRouter } from '../routers/meetings.js';
import { contractorRouter } from '../routers/contractor.js';
import { spotRouter } from '../routers/spot.js';
import { mediaRouter } from '../routers/media.js';
import { billingRouter } from '../routers/billing.js';
import { featureSubscriptionsRouter } from '../routers/featureSubscriptions.js';
import { shortLinksRouter } from '../routers/shortLinks.js';
import { linkCampaignsRouter } from '../routers/linkCampaigns.js';
import { placesRouter } from '../routers/places.js';
import { reviewsRouter } from '../routers/reviews.js';
import { paymentsNamespaceRouter } from '../routers/payments/index.js';
import { signaturesRouter } from '../routers/signatures.js';
import { jobsRouter } from '../routers/jobs.js';
import { websitesRouter } from '../routers/websites.js';
import { designRouter } from '../routers/design.js';
import { logoRouter } from '../routers/logo.js';
import { supportRouter } from '../routers/support.js';
import { betaRouter } from '../routers/beta.js';
import { outreachRouter } from '../routers/outreach.js';

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  agencies: agenciesRouter,
  brands: brandsRouter,
  contacts: contactsRouter,
  services: servicesRouter,
  packages: packagesRouter,
  staff: staffRouter,
  connections: connectionsRouter,
  proposals: proposalsRouter,
  projects: projectsRouter,
  projectTags: projectTagsRouter,
  purchases: purchasesRouter,
  marketplace: marketplaceRouter,
  tasks: tasksRouter,
  payouts: payoutsRouter,
  invoices: invoicesRouter,
  chat: chatRouter,
  superAdmin: superAdminRouter,
  resources: resourcesRouter,
  files: filesRouter,
  meetings: meetingsRouter,
  contractor: contractorRouter,
  spot: spotRouter,
  media: mediaRouter,
  billing: billingRouter,
  featureSubscriptions: featureSubscriptionsRouter,
  shortLinks: shortLinksRouter,
  linkCampaigns: linkCampaignsRouter,
  places: placesRouter,
  reviews: reviewsRouter,
  // Payments (EziQuotes) tool — the whole migrated appRouter namespaced to
  // avoid colliding with the platform's own proposals/billing/invoices.
  payments: paymentsNamespaceRouter,
  // Signatures (SIGKITT) email-signature builder — migrated from the Manus
  // "email-signature-builder" export; brand-scoped (see routers/signatures.ts).
  signatures: signaturesRouter,
  // Satellite-tool scaffolds — one namespace per new frontend (clients/jobs,
  // websites, design, logo). Starter routers with an `overview` endpoint and no
  // data model yet; jobs = multi-role, design = user-level, websites/logo =
  // brand-scoped. See each routers/<name>.ts.
  jobs: jobsRouter,
  websites: websitesRouter,
  design: designRouter,
  logo: logoRouter,
  // Platform-wide customer support tickets (shared /support page + admin console).
  support: supportRouter,
  beta: betaRouter,
  // Our OWN outbound cold email, run through Smartlead. Super-admin only and
  // ProDesk only — agency infrastructure, not a tenant-facing feature.
  outreach: outreachRouter,
});

export type AppRouter = typeof appRouter;

// Inference helpers for the client (which can't resolve '@trpc/server' directly).
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
