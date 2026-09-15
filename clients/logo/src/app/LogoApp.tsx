import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Command,
  FolderOpen,
  Grid3x3,
  LayoutGrid,
  LifeBuoy,
  Package,
  Palette,
  PenTool,
  Plus,
  Sparkles,
  User,
  type LucideIcon,
} from 'lucide-react';
import { signOut } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { NewBrandDialog } from '@shared/components/layout/new-brand-dialog';
import { useLogoContext } from './use-context';
import { StudioProvider, useStudio } from './studio-context';
import { CreateBrandOnboarding } from './CreateBrandOnboarding';
import { LogoMark } from '../components/LogoMark';
import { CommandPalette, type CommandItem } from '../components/CommandPalette';
import { Home } from '../pages/Home';
import { Brief } from '../pages/Brief';
import { Concepts } from '../pages/Concepts';
import { Studio } from '../pages/Studio';
import { BrandSystem } from '../pages/BrandSystem';
import { Guidelines } from '../pages/Guidelines';
import { Assets } from '../pages/Assets';
import { Support } from '../pages/Support';
import { Account } from '../pages/Account';

/**
 * Authenticated Logo Studio shell — the shared AppShell side panel (themed as the
 * studio's dark ink frame) around a warm paper stage with a slim topbar. The
 * creation pipeline (Create → Concepts → Editor → Brand system → Guidelines →
 * Assets) is numbered because it genuinely is a sequence; the Studio hub sits
 * above it.
 *
 * Responsive behaviour — fixed column on desktop, slide-over drawer on phones,
 * plus collapse-to-icons — now comes from the shared panel, not from here.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  step?: string;
}

const HUB: NavItem = { href: '/', label: 'Studio', icon: LayoutGrid };
const PIPELINE: NavItem[] = [
  { href: '/create', label: 'Create', icon: Sparkles, step: '01' },
  { href: '/concepts', label: 'Concepts', icon: Grid3x3, step: '02' },
  { href: '/studio', label: 'Editor', icon: PenTool, step: '03' },
  { href: '/brand', label: 'Brand system', icon: Palette, step: '04' },
  { href: '/guidelines', label: 'Guidelines', icon: BookOpen, step: '05' },
  { href: '/assets', label: 'Assets', icon: Package, step: '06' },
];

/* The rail (its own brand switcher, nav links, drawer and footer) used to live
   here. It's now the shared AppShell side panel — see Shell below. Logo Studio
   supplies only its palette, via .psp-theme-logo in index.css, on top of the shared
   `psp-ink` dark-rail contract. */

function Topbar({
  onOpenCommands,
  onNewMark,
  newMarkBusy,
}: {
  onOpenCommands: () => void;
  onNewMark: () => void;
  newMarkBusy: boolean;
}) {
  const { activeBrand } = useLogoContext();
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8"
      style={{
        background: 'color-mix(in srgb, var(--stage) 82%, transparent)',
        borderBottom: '1px solid var(--hair)',
        backdropFilter: 'saturate(1.2) blur(8px)',
      }}
    >
      {/* The breadcrumb is the first thing to go when width is scarce. */}
      <span className="spec hidden min-w-0 truncate sm:block">{activeBrand?.businessName ?? 'No brand'}</span>
      <span className="hidden text-[var(--hair-2)] sm:block">/</span>
      <span className="spec min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
        Logo Studio
      </span>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenCommands}
          className="press flex h-9 items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-3 text-xs font-medium text-[var(--ink-2)] transition hover:bg-[var(--stage-2)]"
          aria-label="Open command palette"
        >
          <Command className="h-3.5 w-3.5" />
          <span className="spec hidden sm:inline" style={{ fontSize: 10 }}>
            ⌘K
          </span>
        </button>
        <button
          onClick={onNewMark}
          disabled={newMarkBusy}
          className="press inline-flex h-9 items-center gap-2 rounded-[var(--radius-pill)] px-3 text-sm font-semibold text-white disabled:opacity-60 sm:px-4"
          style={{ background: 'var(--pigment)' }}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New mark</span>
        </button>
      </div>
    </header>
  );
}

/**
 * Builds the palette's command list: navigation, studio actions, and a row per
 * recent project — so switching projects never requires a trip to Studio home.
 */
function useCommands(closeNav: () => void): CommandItem[] {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const { brandId, openProject, startNewProject } = useStudio();
  const projects = useQuery(
    trpc.logo.project.list.queryOptions({ brandId: brandId! }, { enabled: !!brandId }),
  );

  return useMemo(() => {
    const go = (href: string) => () => {
      closeNav();
      navigate(href);
    };
    const nav: CommandItem[] = [HUB, ...PIPELINE].map((item) => ({
      id: `nav:${item.href}`,
      label: item.label,
      group: 'Go to',
      icon: item.icon,
      hint: item.step,
      keywords: item.href,
      run: go(item.href),
    }));

    const actions: CommandItem[] = [
      {
        id: 'action:new',
        label: 'Start a new mark',
        group: 'Actions',
        icon: Plus,
        keywords: 'create project fresh brief',
        run: async () => {
          closeNav();
          await startNewProject();
          navigate('/create');
        },
      },
      {
        id: 'action:support',
        label: 'Support',
        group: 'Actions',
        icon: LifeBuoy,
        keywords: 'help contact ticket',
        run: go('/support'),
      },
      {
        id: 'action:profile',
        label: 'Account',
        group: 'Actions',
        icon: User,
        keywords: 'profile settings billing password security photo',
        run: go('/profile'),
      },
    ];

    const projectItems: CommandItem[] = (projects.data ?? []).slice(0, 8).map((p) => ({
      id: `project:${p.id}`,
      label: p.name,
      group: 'Switch project',
      icon: FolderOpen,
      hint: p.status,
      keywords: 'project open switch',
      run: () => {
        closeNav();
        openProject(p.id);
        navigate('/');
      },
    }));

    return [...nav, ...actions, ...projectItems];
  }, [projects.data, navigate, closeNav, openProject, startNewProject]);
}

function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  const { startNewProject, isStartingProject } = useStudio();
  const { brands, activeBrand } = useLogoContext();
  const confirm = useConfirm();
  // The palette's "close nav" hook is a no-op now: AppShell closes its own mobile
  // drawer on navigation, and every palette action navigates.
  const commands = useCommands(() => {});

  const handleSignOut = async () => {
    if (
      await confirm({
        title: 'Sign out?',
        description: 'You’ll need to log in again to get back in.',
        confirmLabel: 'Sign out',
        destructive: true,
      })
    )
      void signOut();
  };

  // ⌘K / Ctrl-K anywhere in the studio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNewMark = async () => {
    await startNewProject();
    navigate('/create');
  };

  const isActive = (href: string) =>
    href === '/' ? location === '/' : location.startsWith(href);
  const toItem = (item: NavItem) => ({
    key: item.href,
    label: item.label,
    icon: <item.icon className="h-[18px] w-[18px]" />,
    href: item.href,
    active: isActive(item.href),
    badge: item.step,
  });

  return (
    /* .logo-ui must wrap the PANEL too: .psp-theme-logo reads --rail-* from it. */
    <div className="logo-ui">
    <AppShell
      appKey="logo"
      panelClassName="psp-ink psp-theme-logo"
      logo={
        <span className="flex items-center gap-2.5">
          <LogoMark seed={2} tone="paper" animate={false} strokeWidth={8} className="h-5 w-5" />
          <span className="text-[15px] font-semibold tracking-tight">Logo Studio</span>
        </span>
      }
      groups={[
        { items: [toItem(HUB)] },
        // The pipeline is numbered because it genuinely is a sequence.
        { label: 'Make a mark', items: PIPELINE.map(toItem) },
        {
          label: 'Account',
          items: [
            {
              key: 'account',
              label: 'Account',
              icon: <User className="h-[18px] w-[18px]" />,
              href: '/profile',
              active: isActive('/profile'),
            },
          ],
        },
      ]}
      tail={[
        {
          key: 'support',
          label: 'Support',
          icon: <LifeBuoy className="h-[18px] w-[18px]" />,
          href: '/support',
          active: isActive('/support'),
        },
      ]}
      brand={{
        brands,
        activeBrandId: activeBrand?.id ?? null,
        onCreateBrand: () => setNewBrandOpen(true),
      }}
      onSignOut={() => void handleSignOut()}
    >
      <div className="logo-ui flex min-h-screen flex-col" style={{ background: 'var(--stage)' }}>
        <Topbar
          onOpenCommands={() => setCmdOpen(true)}
          onNewMark={() => void onNewMark()}
          newMarkBusy={isStartingProject}
        />
        <main className="min-w-0 flex-1">{children}</main>
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} items={commands} />
        <NewBrandDialog
          open={newBrandOpen}
          onOpenChange={setNewBrandOpen}
          blurb="Each brand is its own Logo Studio workspace — briefs, concepts and assets."
        />
      </div>
    </AppShell>
    </div>
  );
}

export function LogoApp() {
  const { brandId } = useLogoContext();

  if (!brandId) {
    return (
      <div className="logo-ui">
        <CreateBrandOnboarding />
      </div>
    );
  }

  return (
    <StudioProvider>
      <Shell>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/create" component={Brief} />
          <Route path="/concepts" component={Concepts} />
          <Route path="/studio" component={Studio} />
          <Route path="/brand" component={BrandSystem} />
          <Route path="/guidelines" component={Guidelines} />
          <Route path="/assets" component={Assets} />
          <Route path="/support" component={Support} />
          <Route path="/support/:id" component={Support} />
          <Route path="/profile" component={Account} />
          <Route component={UnknownRouteRedirect} />
        </Switch>
      </Shell>
    </StudioProvider>
  );
}
