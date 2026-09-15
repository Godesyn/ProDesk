import { Link, useLocation } from 'wouter';
import { cn } from '../../lib/utils';

/**
 * The two AI surfaces.
 *
 * Spend first because that is what prompts a visit — you look at the bill, then
 * you go change what is driving it.
 */
const TABS = [
  { href: '/super-admin/ai-spend', label: 'AI Spend' },
  { href: '/super-admin/ai-models', label: 'Model Chooser' },
];

export function AiTabs() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="AI"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-[color:var(--color-border-hairline)]"
    >
      {TABS.map((t) => {
        const active = location === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-ui-sm relative -mb-px whitespace-nowrap px-3 py-2.5 transition-colors duration-[var(--duration-quick)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
              active
                ? 'border-b-2 border-ink-100 text-ink-100'
                : 'border-b-2 border-transparent text-ink-40 hover:text-ink-80',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
