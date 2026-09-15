import {
  LayoutDashboard, Package, Users, Building2, FileText, ShoppingBag, FolderKanban,
  Wallet, UserCog, Receipt, Layers, SlidersHorizontal, LibraryBig, Repeat, Landmark,
  Info, Share2, Settings, Folder, BookOpen, CreditCard, ListTodo, LayoutTemplate, Briefcase,
  Bot, Sparkles, Link2, Star, Bell, LifeBuoy, ThumbsDown, FlaskConical, Send,
  type LucideIcon,
} from 'lucide-react';

export type UserRole =
  | 'brandOwner' | 'agencyOwner' | 'individualContractor'
  | 'agencyStaff' | 'brandStaff' | 'superAdmin';

/**
 * Mirrors lib/src/shared/components/side_navigation/nav_items_builder.dart.
 * Owners (agencyOwner/brandOwner) see everything; staff are gated by their
 * granular StaffPermission set. Dividers/headers and the pending-verification
 * rail match the Flutter app exactly.
 */
export type StaffPermission =
  | 'agencyDashboard' | 'brandDashboard' | 'clients' | 'catalog' | 'agencyProjects'
  | 'brandProjects' | 'manageResources' | 'documents' | 'resources' | 'brandGuidelines'
  | 'invoice' | 'subscriptions' | 'bankAccount' | 'staffManagement' | 'rolesAndCommissions'
  | 'manageContractors' | 'proposals' | 'infin8' | 'agencyBusinessInfo' | 'brandBusinessInfo' | 'agencyInfo'
  | 'projectBoard' | 'production' | 'addBrief' | 'allocatePeople' | 'approveDeliverable'
  | 'moveToInternalApproval' | 'fromClientApprovalToCompleted' | 'agencies' | 'payments' | 'links';

export type NavEntry =
  | { kind: 'item'; title: string; icon: LucideIcon; href: string; badge?: number }
  | { kind: 'divider' }
  | { kind: 'header'; title: string; icon: LucideIcon }
  | { kind: 'pending' };

export interface NavContext {
  role: UserRole | undefined;
  permissions: StaffPermission[];
  /** Agency verification state for the pending-verification rail. */
  agencyVerified?: boolean;
  agencyDeleted?: boolean;
  counts?: Partial<Record<string, number>>;
}

export function buildNavItems(ctx: NavContext): NavEntry[] {
  const { role, permissions } = ctx;
  const isOwner = role === 'agencyOwner' || role === 'brandOwner';
  const has = (p: StaffPermission) => isOwner || permissions.includes(p);

  if (role === 'agencyOwner' || role === 'agencyStaff') {
    if (ctx.agencyVerified === false && !ctx.agencyDeleted) {
      // Pending verification: a trimmed nav so the agency can still set up its
      // catalog while awaiting approval (Dashboard + Catalog only).
      const pendingItems: (NavEntry | false)[] = [
        has('agencyDashboard') && { kind: 'item', title: 'Dashboard', icon: LayoutDashboard, href: '/agency-dashboard' },
        has('catalog') && { kind: 'item', title: 'Catalog', icon: Package, href: '/catalog' },
      ];
      return pendingItems.filter(Boolean) as NavEntry[];
    }
    const showMiddle =
      has('clients') || has('proposals') || has('agencyProjects') || has('catalog') ||
      has('staffManagement') || isOwner || has('manageResources') || has('manageContractors');
    const items: (NavEntry | false)[] = [
      role === 'agencyStaff' && { kind: 'item', title: 'Production', icon: ListTodo, href: '/contracts' },
      has('agencyDashboard') && { kind: 'item', title: 'Dashboard', icon: LayoutDashboard, href: '/agency-dashboard' },
      showMiddle && { kind: 'divider' },
      has('clients') && { kind: 'item', title: 'Clients', icon: Users, href: '/clients' },
      (isOwner || has('agencyBusinessInfo')) && { kind: 'item', title: 'Info Hub Setup', icon: Layers, href: '/section-library' },
      has('proposals') && { kind: 'item', title: 'Proposals', icon: FileText, href: '/proposals', badge: ctx.counts?.proposals || undefined },
      has('agencyProjects') && { kind: 'item', title: 'Projects', icon: FolderKanban, href: '/agency-projects' },
      has('catalog') && { kind: 'item', title: 'Catalog', icon: Package, href: '/catalog' },
      has('staffManagement') && { kind: 'item', title: 'Team', icon: UserCog, href: '/staff' },
      (isOwner || has('manageContractors')) && { kind: 'item', title: 'Contractors', icon: Briefcase, href: '/agency-contractors' },
      (isOwner || has('rolesAndCommissions')) && { kind: 'item', title: 'Roles & Commissions', icon: SlidersHorizontal, href: '/workflow-settings' },
      has('manageResources') && { kind: 'item', title: 'Manage Resources', icon: LibraryBig, href: '/manage-resources' },
      showMiddle && { kind: 'divider' },
      { kind: 'item', title: 'Earnings', icon: Wallet, href: '/earnings' },
      (isOwner || has('invoice')) && { kind: 'item', title: 'Invoice', icon: Receipt, href: '/agency-invoices' },
      (isOwner || has('subscriptions')) && { kind: 'item', title: 'Subscriptions', icon: Repeat, href: '/agency-subscriptions' },
      (isOwner || has('bankAccount')) && { kind: 'item', title: 'Bank Account', icon: Landmark, href: '/agency-bank-account' },
      (isOwner || has('agencyInfo')) && { kind: 'item', title: 'Agency Info', icon: Info, href: '/edit-agency' },
      { kind: 'item', title: 'Affiliate', icon: Share2, href: '/agency-affiliate' },
    ];
    return items.filter(Boolean) as NavEntry[];
  }

  if (role === 'brandOwner' || role === 'brandStaff') {
    const showMiddle =
      has('proposals') || has('infin8') || has('brandBusinessInfo') || has('brandProjects') ||
      has('documents') || has('resources');
    const showBottom = isOwner || has('staffManagement') || has('payments') || has('subscriptions');
    const items: (NavEntry | false)[] = [
      has('brandDashboard') && { kind: 'item', title: 'Dashboard', icon: LayoutDashboard, href: '/brand-dashboard' },
      showMiddle && { kind: 'divider' },
      has('proposals') && { kind: 'item', title: 'Proposals', icon: FileText, href: '/proposals', badge: ctx.counts?.proposals || undefined },
      has('infin8') && { kind: 'item', title: 'Marketplace', icon: ShoppingBag, href: '/marketplace' },
      (isOwner || has('brandBusinessInfo')) && { kind: 'item', title: 'Brand Profile', icon: Settings, href: '/brand-profile' },
      has('brandBusinessInfo') && { kind: 'item', title: 'Info Hub', icon: Building2, href: '/info-hub' },
      has('brandProjects') && { kind: 'item', title: 'Projects', icon: FolderKanban, href: '/brand-projects' },
      has('documents') && { kind: 'item', title: 'My Documents', icon: Folder, href: '/documents' },
      has('resources') && { kind: 'item', title: 'Resources & Templates', icon: BookOpen, href: '/resources' },
      (isOwner || has('links')) && { kind: 'item', title: 'Links & QR', icon: Link2, href: '/links' },
      showBottom && { kind: 'divider' },
      (isOwner || has('payments')) && { kind: 'item', title: 'Payments', icon: CreditCard, href: '/payments' },
      (isOwner || has('subscriptions')) && { kind: 'item', title: 'Subscriptions', icon: Repeat, href: '/subscriptions' },
      has('staffManagement') && { kind: 'item', title: 'Team', icon: UserCog, href: '/staff' },
      (isOwner || has('staffManagement')) && { kind: 'item', title: 'Agencies', icon: Building2, href: '/agencies' },
    ];
    return items.filter(Boolean) as NavEntry[];
  }

  if (role === 'individualContractor') {
    return [
      { kind: 'header', title: 'CONTRACTOR', icon: LayoutDashboard },
      { kind: 'item', title: 'Dashboard', icon: LayoutDashboard, href: '/contractor-dashboard' },
      // The assigned-project workspace (deliverables) — Flutter's /contracts.
      { kind: 'item', title: 'Contracts', icon: FolderKanban, href: '/my-projects' },
      // Agency relationships: accept invites, leave (Flutter "My Agencies").
      { kind: 'item', title: 'My Agencies', icon: Building2, href: '/contracts' },
      // Discover & apply to default agencies.
      { kind: 'item', title: 'Find Agencies', icon: ShoppingBag, href: '/contractor-agencies' },
      { kind: 'item', title: 'Earnings', icon: Wallet, href: '/earnings' },
      // Incoming invoices — those addressed TO me (I am the beneficiary).
      { kind: 'item', title: 'Invoices', icon: Receipt, href: '/invoices' },
      { kind: 'item', title: 'Info', icon: Info, href: '/contractor-info' },
    ];
  }

  if (role === 'superAdmin') {
    // Grouped into collapsible sections by area (the sidebar renders `header`
    // entries as collapsible group toggles). Tool-specific consoles (Reviews,
    // Payments) get their own section so the platform admin stays uncluttered.
    return [
      { kind: 'header', title: 'Accounts', icon: Users },
      { kind: 'item', title: 'Users', icon: Users, href: '/super-admin/users' },
      { kind: 'item', title: 'Brands', icon: Building2, href: '/super-admin/brands' },
      { kind: 'item', title: 'Agencies', icon: ShoppingBag, href: '/super-admin/agencies' },
      { kind: 'item', title: 'Tickets', icon: LifeBuoy, href: '/super-admin/tickets', badge: ctx.counts?.tickets || undefined },
      { kind: 'item', title: 'Push Notifications', icon: Bell, href: '/super-admin/push-notifications' },

      { kind: 'header', title: 'Subscriptions', icon: Wallet },
      { kind: 'item', title: 'Feature Subscriptions', icon: Sparkles, href: '/super-admin/feature-subscriptions' },
      // Beta cohorts sit under Subscriptions because that is what they waive: a
      // beta member is entitled to every feature subscription until their end date.
      { kind: 'item', title: 'Beta Programme', icon: FlaskConical, href: '/super-admin/beta' },
      { kind: 'item', title: 'Strategy Feedback', icon: ThumbsDown, href: '/super-admin/strategy-feedback' },

      { kind: 'header', title: 'AI', icon: Bot },
      { kind: 'item', title: 'AI Spend', icon: Wallet, href: '/super-admin/ai-spend' },
      { kind: 'item', title: 'Model Chooser', icon: Bot, href: '/super-admin/ai-models' },

      // Our OWN outbound cold email — agency infrastructure, not a tenant tool.
      { kind: 'header', title: 'Outreach', icon: Send },
      { kind: 'item', title: 'Mailboxes', icon: Send, href: '/super-admin/outreach/mailboxes' },
      { kind: 'item', title: 'Sending Email', icon: Send, href: '/super-admin/outreach/campaigns' },
      { kind: 'item', title: 'List Builder', icon: ListTodo, href: '/super-admin/outreach/lists' },
      { kind: 'item', title: 'Prospects', icon: Users, href: '/super-admin/outreach/prospects' },
      { kind: 'item', title: 'Reply Queue', icon: LifeBuoy, href: '/super-admin/outreach/replies' },

      { kind: 'header', title: 'Reviews', icon: Star },
      { kind: 'item', title: 'Reviews admin', icon: Star, href: '/super-admin/reviews' },

      { kind: 'header', title: 'Payments', icon: Star },
      { kind: 'item', title: 'Payments admin', icon: CreditCard, href: '/super-admin/payments' },
      
      { kind: 'header', title: 'Prodesk', icon: Layers },
      { kind: 'item', title: 'Disciplines', icon: Layers, href: '/super-admin/disciplines' },
      { kind: 'item', title: 'Resources', icon: LibraryBig, href: '/super-admin/resources' },
      { kind: 'item', title: 'Info Hub Templates', icon: LayoutTemplate, href: '/super-admin/info-hub-templates' },
      { kind: 'item', title: 'Settings', icon: Settings, href: '/super-admin/settings' },
      { kind: 'item', title: 'Payouts', icon: Wallet, href: '/super-admin/payouts' },
      { kind: 'item', title: 'Invoices', icon: Receipt, href: '/super-admin/invoices' },

      // { kind: 'header', title: 'Finance', icon: Wallet },
      // { kind: 'header', title: 'Payments', icon: CreditCard },
      // { kind: 'header', title: 'Platform', icon: ShieldCheck },
    ];
  }

  return [];
}
