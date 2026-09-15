/** Standard disciplines (ports agency_profile_form_disciplines_list.dart). */
export const DISCIPLINES: string[] = [
  'Business Strategy',
  'Branding & Design',
  'Copywriting',
  'Website development',
  'Commercial Law',
  'Business Plan Development',
  'Software & Custom Apps',
  'Automation',
  'Public relations',
  'Sales & Business Development',
  'Accounting',
  'Bookkeeping',
  'Capital Raising',
  'Pre-insolvency and Corporate turnaround',
  'Human Resources',
  'Recruitment',
  'Digital Advertising',
  'Media Buying (ooh, tv, radio, print)',
  'Telecommunications',
  'Payments Infrastructure',
  'Film Production',
  'Audio Production',
  'Offset printing',
  'Digital Offset printing',
  'Signage Manufacturing',
  'Banner Manufacturing',
  'Warehousing',
  'Shipping & Logistics',
  'Clothing',
  'Promotional Products',
  'Shop Fitout',
  'Industrial Design',
  'Search Engine Optimisation',
  'Social Media',
  'Direct Marketing',
  'Business Coaching',
  'Debt Collection',
  'Supplement Manufacturing',
  'Skin Care Manufacturing',
  'Affiliate Networking',
  'Rewards Programs',
  'Sponsorships & Influencers',
  'Events & Activations',
  'Publishing',
  'Surveys & Feedback',
  'Competitions, Incentives & Giveaways',
  'Member & Group Management',
  'IP Protection',
  'Domain Name Management',
];

/** Infin8 lifecycle stages (heading grouping in the catalog). */
export const INFIN8_STAGES = [
  'Discover',
  'Define',
  'Design',
  'Develop',
  'Deploy',
  'Drive',
  'Defend',
  'Disrupt',
] as const;

export const SERVICE_TYPE_LABEL: Record<string, string> = {
  oneOff: 'One-off',
  recurring: 'Recurring',
  digital: 'Digital',
  meeting: 'Meeting',
};

export const CATALOG_SORTS = [
  { value: 'infin8', label: 'Infin8 stages' },
  { value: 'organized', label: 'Custom order' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'nameAsc', label: 'Name (A–Z)' },
  { value: 'nameDesc', label: 'Name (Z–A)' },
  { value: 'priceAsc', label: 'Price (low–high)' },
  { value: 'priceDesc', label: 'Price (high–low)' },
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number]['value'];

/**
 * Friendly labels for staff permission keys (ports StaffPermissionExtension.displayName).
 * Keyed by the server's permission strings (staff.ts PERMISSIONS).
 */
export const PERMISSION_LABELS: Record<string, string> = {
  agencyDashboard: 'Dashboard',
  brandDashboard: 'Dashboard',
  agencyProjects: 'View Projects',
  brandProjects: 'Projects',
  // Project Management (Kanban workflow) — each gates a set of board transitions.
  addBrief: 'Briefing',
  allocatePeople: 'Manage Allocations',
  approveDeliverable: 'Approval Manager',
  infin8: 'Infin8 Marketplace',
  catalog: 'Catalog',
  clients: 'Clients',
  proposals: 'Proposals',
  manageResources: 'Manage Resources',
  manageContractors: 'Manage Contractors',
  staffManagement: 'Team Management',
  documents: 'Documents',
  resources: 'Resources',
  brandGuidelines: 'Brand Guidelines',
  links: 'Links & QR (Manage)',
  linksViewer: 'Links & QR (View)',
  reviews: 'Reviews (Manage)',
  reviewsViewer: 'Reviews (View)',
  signatures: 'Email Signatures (Manage)',
  logo: 'Logo Studio (Manage)',
  agencyBusinessInfo: 'Business Info',
  brandBusinessInfo: 'Business Info',
  agencyInfo: 'Agency Info',
  rolesAndCommissions: 'Roles & Commissions',
  invoice: 'Invoice',
  payments: 'Payments (Manage)',
  paymentsViewer: 'Payments (View)',
  subscriptions: 'Subscriptions',
  bankAccount: 'Bank Account',
  chatWithContractors: 'Chat with Contractors',
  chatWithStaffs: 'Chat with Staff',
  chatWithBrands: 'Chat with Brands',
};

export const permissionLabel = (p: string): string => PERMISSION_LABELS[p] ?? p;

/**
 * Permission groups for the staff editor, by org type (ports getGroupedPermissions).
 * Each org type lists ONLY the permissions valid in that context — agency staff see
 * agency permissions, brand staff see brand permissions. The editor renders strictly
 * these (no cross-org fallback), so the two contexts never bleed into each other.
 */
export const PERMISSION_GROUPS: Record<
  'agency' | 'brand',
  { title: string; keys: string[]; all?: boolean }[]
> = {
  agency: [
    { title: 'General Access', keys: ['agencyDashboard', 'infin8'] },
    // Project Management. `all` renders an "All" convenience chip that selects/clears
    // every key in the group at once. View Projects is implied server-side for anyone
    // holding a workflow permission or a role designee (see kanban-permissions.md).
    {
      title: 'Project Management',
      keys: [
        'agencyProjects',
        'addBrief',
        'allocatePeople',
        'approveDeliverable',
      ],
      all: true,
    },
    { title: 'Business Operations', keys: ['catalog', 'clients', 'proposals'] },
    {
      title: 'Resource Management',
      keys: [
        'manageResources',
        'manageContractors',
        'staffManagement',
        'documents',
        'resources',
      ],
    },
    {
      title: 'Communication',
      keys: ['chatWithContractors', 'chatWithStaffs', 'chatWithBrands'],
    },
    {
      title: 'Settings & Financials',
      keys: [
        'rolesAndCommissions',
        'invoice',
        'subscriptions',
        'bankAccount',
        'agencyInfo',
        'agencyBusinessInfo',
      ],
    },
  ],
  // Brand staff manage ONE team that spans every Prodesk frontend, so the app-tool
  // permissions are grouped by the frontend they unlock (Links & QR, Reviews,
  // Payments, Email Signatures) — the core Prodesk staff editor then reads as a
  // per-app access matrix. Each tool's own Team panel edits just its own group;
  // see docs/permissions.md "Cross-frontend team".
  brand: [
    {
      title: 'General Access',
      keys: ['brandDashboard', 'brandProjects', 'infin8'],
    },
    {
      title: 'Business Assets',
      keys: ['brandBusinessInfo', 'brandGuidelines', 'documents', 'resources'],
    },
    { title: 'Links & QR', keys: ['links', 'linksViewer'] },
    { title: 'Reviews', keys: ['reviews', 'reviewsViewer'] },
    { title: 'Payments', keys: ['payments', 'paymentsViewer'] },
    { title: 'Email Signatures', keys: ['signatures'] },
    { title: 'Logo Studio', keys: ['logo'] },
    { title: 'Subscriptions & Billing', keys: ['subscriptions'] },
    { title: 'Management', keys: ['staffManagement', 'proposals'] },
    { title: 'Communication', keys: ['chatWithStaffs'] },
  ],
};

/**
 * The org's permission groups, narrowed to the keys the server actually exposes
 * (drops any group left empty). This is the single source of truth for what the
 * staff editor shows for a given org type.
 */
export function groupedPermissionsForOrg(
  orgType: 'agency' | 'brand',
  available: readonly string[],
) {
  const set = new Set(available);
  return PERMISSION_GROUPS[orgType]
    .map((g) => ({
      title: g.title,
      keys: g.keys.filter((k) => set.has(k)),
      all: g.all,
    }))
    .filter((g) => g.keys.length > 0);
}

/** Flat list of permission keys valid for an org type (intersected with server options). */
export function orgPermissionKeys(
  orgType: 'agency' | 'brand',
  available: readonly string[],
): string[] {
  const set = new Set(available);
  return PERMISSION_GROUPS[orgType]
    .flatMap((g) => g.keys)
    .filter((k) => set.has(k));
}

/** View Projects + the workflow actions that depend on it (see kanban-permissions.md). */
const PROJECT_VIEW = 'agencyProjects';
const PROJECT_ACTIONS = ['addBrief', 'allocatePeople', 'approveDeliverable'];

/**
 * Toggle a permission while keeping the project dependency consistent: any
 * workflow action implies View Projects (you can't act on a board you can't
 * see), and removing View Projects removes the dependent actions.
 */
export function togglePermission(
  selected: Set<string>,
  p: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(p)) {
    next.delete(p);
    if (p === PROJECT_VIEW) PROJECT_ACTIONS.forEach((k) => next.delete(k));
  } else {
    next.add(p);
    if (PROJECT_ACTIONS.includes(p)) next.add(PROJECT_VIEW);
  }
  return next;
}
