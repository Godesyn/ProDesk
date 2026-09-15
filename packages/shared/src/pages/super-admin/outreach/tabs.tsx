import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib/trpc';
import { cn } from '../../../lib/utils';

/**
 * The five Outreach surfaces (§4).
 *
 * Ordered the way the work flows — write the email, build a list for it, watch
 * what comes back, answer it — rather than alphabetically or by how often each
 * is opened. Sending Email leads the pipeline because there is now one campaign
 * per environment and it is what a list is scraped INTO: a list built before the
 * sequence exists is contacts sitting in a campaign that cannot send.
 *
 * The Sending Floor sits apart from the other four, behind a divider, because it
 * is not a step in that sequence: it is the infrastructure the whole sequence
 * runs on, and nothing downstream is safe to touch while it is unhealthy.
 */
const TABS = [
  { href: '/super-admin/outreach/mailboxes', label: 'Sending Floor', group: 'floor' },
  { href: '/super-admin/outreach/campaigns', label: 'Sending Email', group: 'pipeline' },
  { href: '/super-admin/outreach/lists', label: 'List Builder', group: 'pipeline' },
  { href: '/super-admin/outreach/prospects', label: 'Prospects', group: 'pipeline' },
  { href: '/super-admin/outreach/replies', label: 'Reply Queue', group: 'pipeline' },
] as const;

export function OutreachTabs({ pendingReplies }: { pendingReplies?: number }) {
  const [location] = useLocation();
  const trpc = useTRPC();

  /**
   * The queue depth, on every tab.
   *
   * It used to be passed in by the Reply Queue alone, which meant the one number
   * telling you there is work waiting was only visible from the screen you were
   * already standing on. The page's own count still wins when it is there —
   * clearing a reply should shrink the badge immediately, not in a minute.
   */
  const pendingQuery = useQuery({
    ...trpc.outreach.pendingReplyCount.queryOptions(),
    enabled: pendingReplies === undefined,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const pending = pendingReplies ?? pendingQuery.data ?? 0;

  return (
    <nav
      aria-label="Outreach"
      // Full-bleed: the bar spans the page gutters rather than stopping at the
      // content edge, so content scrolling underneath it is covered rather than
      // sliding past in the margin.
      className={cn(
        'sticky top-0 z-20 mb-5 -mx-4 overflow-x-auto px-4 md:-mx-8 md:px-8',
        'border-b border-[color:var(--color-border-hairline)] bg-paper/85 backdrop-blur',
      )}
    >
      <div className="flex gap-1">
        {TABS.map((t, i) => {
          // Prefix, not equality: a run has its own screen under the List
          // Builder's address, and a tab that unlights the moment you open one
          // of its rows says you have left the section you are standing in.
          const active = location === t.href || location.startsWith(`${t.href}/`);
          const startsPipeline = i > 0 && t.group !== TABS[i - 1].group;
          return (
            <div key={t.href} className="flex items-center">
              {startsPipeline && (
                <span
                  aria-hidden
                  className="mx-2 h-4 w-px shrink-0 bg-[color:var(--color-border-default)]"
                />
              )}
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'text-ui-sm relative -mb-px flex h-11 items-center whitespace-nowrap px-3',
                  'transition-colors duration-[var(--duration-quick)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                  active
                    ? 'border-b-2 border-ink-100 text-ink-100'
                    : 'border-b-2 border-transparent text-ink-40 hover:text-ink-80',
                )}
              >
                {t.label}
                {/* The queue is the one tab with work waiting in it, so it is the
                    one tab that gets to interrupt. */}
                {t.label === 'Reply Queue' && pending > 0 && (
                  <span className="tnum ml-1.5 rounded-[var(--radius-pill)] bg-ink-100 px-1.5 py-0.5 text-[10px] text-paper">
                    {pending > 99 ? '99+' : pending}
                  </span>
                )}
              </Link>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
