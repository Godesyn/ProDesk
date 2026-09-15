/**
 * Centralized client-side route authorization — a faithful port of
 * lib/src/core/router/route_access.dart. The router consults canAccess() before
 * rendering a route so URL-bar manipulation cannot reach screens the user's
 * active identity (role + staff permissions) does not grant. Unknown shell
 * routes deny by default.
 */
import type { StaffPermission, UserRole } from '../components/layout/sidebar';

export interface AccessIdentity {
  role: UserRole | undefined;
  isSuperAdmin: boolean;
  permissions: StaffPermission[];
  /** Active agency verification state (for the pending-verification lockdown). */
  agencyVerified?: boolean;
  agencyDeleted?: boolean;
}

const ALWAYS_ALLOWED_EXACT = new Set<string>([
  '/', '/profile', '/chat', '/tasks', '/role-selection',
  '/create-brand', '/create-agency', '/create-contractor',
  '/payment-success', '/payment-cancel', '/post-checkout-stepper',
  '/staff-dashboard', '/login', '/signup', '/forgot-password',
]);

function normalize(path: string): string {
  const q = path.indexOf('?');
  let s = q === -1 ? path : path.slice(0, q);
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function isAlwaysAllowed(p: string): boolean {
  if (ALWAYS_ALLOWED_EXACT.has(p)) return true;
  if (p.startsWith('/public/')) return true;
  if (p === '/loading' || p.startsWith('/loading/')) return true;
  if (p === '/auth/action' || p === '/auth/confirm' || p === '/auth/handoff') return true;
  if (p === '/post-checkout' || p.startsWith('/post-checkout')) return true;
  // Support tickets are available to every authenticated user, any role.
  if (p === '/support' || p.startsWith('/support/')) return true;
  return false;
}

const isAgency = (r?: UserRole) => r === 'agencyOwner' || r === 'agencyStaff';
const isBrand = (r?: UserRole) => r === 'brandOwner' || r === 'brandStaff';

function agencyAccess(p: string, has: (x: StaffPermission) => boolean, isOwner: boolean): boolean | null {
  switch (p) {
    case '/agency-dashboard': return has('agencyDashboard');
    case '/clients': return has('clients');
    case '/section-library': return isOwner || has('agencyBusinessInfo');
    case '/agency-projects': return has('agencyProjects');
    case '/catalog': return has('catalog');
    case '/workflow-settings': return isOwner || has('rolesAndCommissions');
    case '/manage-resources': return has('manageResources');
    case '/agency-invoices': return isOwner || has('invoice');
    case '/agency-subscriptions': return isOwner || has('subscriptions');
    case '/agency-bank-account': return isOwner || has('bankAccount');
    case '/edit-agency': return isOwner || has('agencyInfo');
    case '/agency-affiliate': return true;
    case '/agency-contractors': return isOwner || has('manageContractors');
  }
  return null;
}

function brandAccess(p: string, has: (x: StaffPermission) => boolean, isOwner: boolean): boolean | null {
  switch (p) {
    case '/brand-dashboard': return has('brandDashboard');
    case '/brand-profile': return isOwner || has('brandBusinessInfo');
    case '/info-hub': return has('brandBusinessInfo');
    case '/brand-projects': return has('brandProjects');
    case '/documents': return has('documents');
    case '/resources': return has('resources');
    case '/brand-guidelines': return isOwner || has('brandGuidelines');
    case '/links': return isOwner || has('links');
    case '/agencies': return isOwner || has('staffManagement');
    // Brand billing tabs — owner always, staff with the matching permission.
    case '/payments': return has('payments');
    case '/subscriptions': return has('subscriptions');
  }
  return null;
}

export function canAccess(path: string, id: AccessIdentity): boolean {
  const p = normalize(path);
  if (isAlwaysAllowed(p)) return true;

  // Super-admin namespace — gated by the flag, independent of active role.
  if (p === '/super-admin' || p.startsWith('/super-admin/')) return id.isSuperAdmin;

  const role = id.role;
  const isOwner = role === 'agencyOwner' || role === 'brandOwner';
  const has = (perm: StaffPermission) => isOwner || id.permissions.includes(perm);

  if (isAgency(role)) {
    const isPending = id.agencyVerified === false && !id.agencyDeleted;
    // Unverified agencies are limited to Dashboard + Catalog (so they can build
    // their catalog while awaiting verification).
    if (isPending) return p === '/agency-dashboard' || (p === '/catalog' && has('catalog'));
    const d = agencyAccess(p, has, isOwner);
    if (d !== null) return d;
  }
  if (isBrand(role)) {
    const d = brandAccess(p, has, isOwner);
    if (d !== null) return d;
  }

  // Parameterized routes (the React stack uses /proposal/:id etc. where Flutter
  // used flat paths) — match by prefix.
  if (p === '/proposals' || p === '/create-proposal' || p === '/proposal' || p.startsWith('/proposal/')) {
    return (isAgency(role) || isBrand(role)) && has('proposals');
  }
  if (p.startsWith('/project/')) return isAgency(role) || isBrand(role) || role === 'individualContractor';
  if (p.startsWith('/clients/')) return isAgency(role) && has('clients');
  if (p === '/my-projects') return role === 'individualContractor' || role === 'agencyStaff';
  // Super-admins reach invoice details from their platform-wide invoices list
  // (/super-admin/invoices links to /invoices/:id); `invoices.byId` is open, so
  // grant them the view here too.
  if (p === '/invoices' || p.startsWith('/invoices/')) return id.isSuperAdmin || isAgency(role) || isBrand(role) || role === 'individualContractor';
  if (p.startsWith('/checkout/')) return isBrand(role);

  switch (p) {
    case '/staff':
      return (isAgency(role) || isBrand(role)) && has('staffManagement');
    case '/contractor-dashboard':
    case '/contractor-agencies':
    case '/contractor-info':
      return role === 'individualContractor';
    case '/contracts':
      return role === 'individualContractor' || role === 'agencyStaff';
    case '/earnings':
      return isAgency(role) || role === 'individualContractor';
  }

  if (p === '/payments' || p === '/subscriptions') return role === 'brandOwner';
  if (p.startsWith('/payments/') || p.startsWith('/subscriptions/')) return isAgency(role);
  if (p === '/marketplace' || p.startsWith('/marketplace/')) return isBrand(role) && has('infin8');

  return false; // unknown shell route → deny
}

/** Dashboard landing per role (mirrors app_router_notifier dashboard resolution). */
export function dashboardFor(id: Pick<AccessIdentity, 'role' | 'isSuperAdmin'>): string {
  if (id.isSuperAdmin && !id.role) return '/super-admin/users';
  switch (id.role) {
    case 'agencyOwner': return '/agency-dashboard';
    case 'brandOwner': return '/brand-dashboard';
    case 'agencyStaff':
    case 'brandStaff': return '/tasks'; // staff land on tasks (app_router_notifier:393)
    case 'individualContractor': return '/contractor-dashboard';
    default: return id.isSuperAdmin ? '/super-admin/users' : '/role-selection';
  }
}
