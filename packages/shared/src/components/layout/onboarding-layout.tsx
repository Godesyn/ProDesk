import { Suspense, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { LogOut, User as UserIcon, CheckCircle2 } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useCurrentUser, signOut } from '../../auth/auth-context';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useConfirm } from '../ui/confirm-dialog';

/**
 * Chrome for the onboarding screens (role-selection + create-*). Mirrors the
 * Flutter role_selection_screen, which keeps the MainLayoutHeader visible — a
 * top bar with the wordmark and the profile menu (sign out) — so the user always
 * has an identity + escape hatch before they have a role/dashboard.
 */
export function OnboardingLayout({ children }: { children: ReactNode }) {
  const { data: user } = useCurrentUser();
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
  const initials =
    `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.toUpperCase() ||
    user?.email?.[0]?.toUpperCase() || '?';
  const fullName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim();

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[color:var(--color-border-hairline)] bg-card/80 px-4 backdrop-blur md:px-6">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.28em] text-ink-100">Prodesk</span>
          <span className="h-4 w-px bg-[color:var(--color-border-default)]" />
          <span className="text-eyebrow hidden text-ink-40 sm:inline">Get set up</span>
        </div>
        <div className="flex items-center gap-1">
        {/* Tasks button — same as the main-layout header, so a roleless user can
            reach Tasks (and act on invitations) before picking a role. */}
        <TasksBell />
        <DropdownMenu>
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
      <div className="flex-1">
        <Suspense fallback={<div className="grid min-h-[40vh] place-items-center text-ink-40">Loading…</div>}>
          {children}
        </Suspense>
      </div>
    </div>
  );
}

/**
 * Header tasks button with an inbox count badge — a copy of MainLayout's TasksBell
 * (main_layout_header.dart _TasksIcon) so the onboarding shell exposes Tasks too.
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
