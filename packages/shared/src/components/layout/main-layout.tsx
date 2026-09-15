import { useEffect, useState, Suspense, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, User as UserIcon, Menu, CheckCircle2 } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { useCurrentUser, signOut } from '../../auth/auth-context';
import { useActiveContext } from '../../hooks/use-active-context';
import { Sidebar, type StaffPermission, type UserRole } from './sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useConfirm } from '../ui/confirm-dialog';
import { ContextSelector } from './context-selector/context-selector';
import { FloatingMessagePanel } from './floating-message-panel';
import { ChatNavProvider } from '../../pages/chat/chat-nav-context';
import { GlobalRealtime } from '../../lib/realtime-registry';
import { ChatToasts } from './chat-toasts';
import { usePresenceHeartbeat } from '../../hooks/use-presence-heartbeat';

const WORKSPACE_LABEL: Record<string, string> = {
  agency: 'Agency', brand: 'Brand', contractor: 'Contractor', admin: 'Platform Admin',
};

export function MainLayout({ children, hideNav = false }: { children: ReactNode; hideNav?: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  // Presence heartbeat — marks the user "online" while the app is open so the
  // chat-digest worker suppresses email for active users.
  usePresenceHeartbeat(!!user);
  const { workspace, role, activeAgency, activeBrand } = useActiveContext();
  const confirm = useConfirm();
  const [, navigate] = useLocation();
  const handleSignOut = async () => {
    if (await confirm({
      title: 'Sign out?',
      description: 'You’ll need to log in again to get back in.',
      confirmLabel: 'Sign out',
      destructive: true,
    })) void signOut();
  };
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop rail collapse — persisted per user in uiPreferences.sidebarCollapsed
  // so it follows the user across devices and survives logout/login. localStorage
  // seeds the first paint (before auth.me resolves) to avoid a layout flash.
  const [collapsed, setCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage.getItem('pd.sidebar.collapsed') === '1',
  );
  // Adopt the server-stored preference once the current user loads (source of truth).
  const serverCollapsed = (user?.uiPreferences as { sidebarCollapsed?: boolean } | undefined)?.sidebarCollapsed;
  useEffect(() => {
    if (typeof serverCollapsed === 'boolean') {
      setCollapsed(serverCollapsed);
      window.localStorage.setItem('pd.sidebar.collapsed', serverCollapsed ? '1' : '0');
    }
  }, [serverCollapsed]);

  const savePref = useMutation({
    ...trpc.users.updateUiPreference.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
  });
  // Apply + persist a new collapsed state: instant local update, localStorage seed
  // for next reload, and a server write so it sticks across sessions.
  const applyCollapsed = (next: boolean) => {
    setCollapsed(next);
    window.localStorage.setItem('pd.sidebar.collapsed', next ? '1' : '0');
    savePref.mutate({ key: 'sidebarCollapsed', value: next });
  };

  const activeOrg = activeAgency ?? activeBrand ?? null;
  const orgName = activeOrg?.businessName ?? WORKSPACE_LABEL[workspace];
  const initials =
    `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() ||
    user?.email?.[0]?.toUpperCase() || '?';
  const fullName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

  // Staff permissions for the active org come from auth.me (resolved server-side
  // against the selected agency/brand); owners see the full rail via isOwner.
  const permissions = (user?.permissions ?? []) as StaffPermission[];
  const canSeeProposals =
    role === 'agencyOwner' || role === 'brandOwner' || permissions.includes('proposals');

  // Proposals nav badge — count of proposals awaiting my action in the active org
  // (brand: received-but-unopened; agency: change-requested). Live via GlobalRealtime.
  const proposalsAttentionQ = useQuery({
    ...trpc.proposals.attentionCount.queryOptions(
      workspace === 'agency' && activeAgency?.id
        ? { agencyId: activeAgency.id }
        : workspace === 'brand' && activeBrand?.id
          ? { brandId: activeBrand.id }
          : {},
    ),
    enabled:
      canSeeProposals &&
      ((workspace === 'agency' && !!activeAgency?.id) || (workspace === 'brand' && !!activeBrand?.id)),
  });

  const navCtx = {
    role: role as UserRole | undefined,
    permissions,
    agencyVerified: activeAgency ? activeAgency.emailVerified : undefined,
    agencyDeleted: activeAgency ? activeAgency.username === 'deleted' && !activeAgency.emailVerified : undefined,
    counts: { proposals: proposalsAttentionQ.data?.count ?? 0 },
  };

  return (
    <ChatNavProvider>
    <GlobalRealtime />
    <ChatToasts />
    <div className="flex min-h-screen bg-paper">
      {!hideNav && (
        <Sidebar
          nav={navCtx}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => applyCollapsed(!collapsed)}
          contextSelector={(isCollapsed) => (
            <ContextSelector
              collapsed={isCollapsed}
              onExpand={() => applyCollapsed(false)}
              onCollapse={() => applyCollapsed(true)}
              onClose={() => setMobileOpen(false)}
            />
          )}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 border-b border-[color:var(--color-border-hairline)] bg-card/80 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {!hideNav && (
              <button
                className="shrink-0 rounded-[var(--radius-sm)] p-1.5 text-ink-60 hover:bg-inset md:hidden"
                aria-label="Open menu"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            {/* Truncate so a long org name doesn't wrap to two lines / push the
                badge off on a phone. */}
            <span className="truncate font-medium text-ink-100">{orgName}</span>
            {/* When there's no real org (super-admin / contractor), `orgName` already
                falls back to the workspace label, so the badge would duplicate it.
                Hide the redundant badge on mobile in that case. */}
            <Badge variant="outline" className={cn('shrink-0', !activeOrg && 'max-md:hidden')}>{WORKSPACE_LABEL[workspace]}</Badge>
          </div>
          <div className="flex items-center gap-1">
          <TasksBell />
          {/* modal={false} is deliberate: a modal Radix menu sets
              `pointer-events: none` on <body> while open and restores it on a
              deferred tick. Signing out unmounts this whole layout (the shell
              swaps to the login screen) before that cleanup runs, leaving
              <body> locked so the login screen becomes unclickable (text is
              still selectable — the tell-tale sign). Non-modal never locks. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger className="outline-none">
              <Avatar>
                {user?.profileUrl && <AvatarImage src={user.profileUrl} />}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="flex items-center gap-3 px-2 py-2.5">
                <Avatar className="h-9 w-9">
                  {user?.profileUrl && <AvatarImage src={user.profileUrl} />}
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink-100">{fullName || 'Your account'}</div>
                  <div className="truncate text-xs text-ink-40">{user?.email}</div>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <UserIcon className="h-4 w-4" /> Profile
              </DropdownMenuItem>
              <DropdownMenuItem destructive onClick={() => void handleSignOut()}>
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </header>
        {/* Full-viewport content (Flutter apps fill the viewport; containerMax is marketing-only).
            Large bottom padding keeps the last component clear of the floating chat
            launcher / docked panel that overlays the bottom-right of every screen. */}
        <main className="w-full flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-[500px]">
          {/* Boundary for code-split route pages — keeps the shell mounted while a
              lazy page chunk loads (only the content area shows the fallback). */}
          <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-ink-40">Loading…</div>}>
            {children}
          </Suspense>
        </main>
      </div>
      {/* Global chat launcher + docked panel (floating_message_panel.dart). */}
      <FloatingMessagePanel />
    </div>
    </ChatNavProvider>
  );
}

/**
 * Header tasks button with a count badge — mirrors main_layout_header.dart's
 * _TasksIcon (task_alt icon + volt pill showing the inbox count, capped at 99+).
 */
function TasksBell() {
  const trpc = useTRPC();
  const counts = useQuery({ ...trpc.tasks.counts.queryOptions(), staleTime: 30_000 });
  const n = counts.data?.inbox ?? 0;
  return (
    <Link
      href="/tasks"
      aria-label="Tasks"
      title="Tasks"
      className="relative rounded-[var(--radius-sm)] p-1.5 text-ink-60 transition-colors hover:bg-inset hover:text-ink-100"
    >
      <CheckCircle2 className="h-5 w-5" />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 grid min-h-[15px] min-w-[15px] place-items-center rounded-pill border border-ink-100 bg-accent px-1 font-mono text-[9px] font-semibold leading-none text-white">
          {n > 99 ? '99+' : n}
        </span>
      )}
    </Link>
  );
}
