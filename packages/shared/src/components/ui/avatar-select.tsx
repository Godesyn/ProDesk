import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn, initialsOf } from '../../lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';

export interface AvatarSelectOption {
  id: string;
  name: string;
  /** Profile picture (people) or logo (agency/brand). */
  imageUrl?: string | null;
  /** Trailing muted text, e.g. "(owner)". */
  suffix?: string;
}

/**
 * A select/dropdown that shows a profile picture (or organisation logo) beside
 * each option's name — the avatar-bearing replacement for a native `<select>`,
 * whose `<option>` elements can't render images. Built on the design-system
 * DropdownMenu so it stays keyboard-accessible and on-brand.
 *
 * Use `square` for organisation logos (agencies / brands) and the default round
 * avatar for people (contractors / staff / users).
 *
 * Pass `loading` while the option source is still fetching: the trigger is
 * disabled and shows a spinner, and the menu reads "Loading…" — never the
 * misleading "No options" of a genuinely empty (loaded) list.
 */
export function AvatarSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  loading,
  square,
  id,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  options: AvatarSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  square?: boolean;
  id?: string;
  className?: string;
}) {
  const selected = options.find((o) => o.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        disabled={disabled || loading}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm outline-none transition-colors hover:bg-inset focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-accent/40',
          className,
        )}
      >
        {selected ? (
          <OptionContent option={selected} square={square} />
        ) : (
          <span className="truncate text-ink-40">{loading ? 'Loading…' : placeholder}</span>
        )}
        {loading ? (
          <Loader2 className="ml-auto h-4 w-4 shrink-0 animate-spin text-ink-40" />
        ) : (
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-ink-40" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-ink-40">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : options.length === 0 ? (
          <div className="px-2.5 py-2 text-sm text-ink-40">No options</div>
        ) : (
          options.map((o) => (
            <DropdownMenuItem key={o.id} onSelect={() => onChange(o.id)}>
              <OptionContent option={o} square={square} />
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionContent({ option, square }: { option: AvatarSelectOption; square?: boolean }) {
  const shape = square ? 'rounded-[var(--radius-sm)]' : '';
  return (
    <>
      <Avatar className={cn('h-6 w-6 shrink-0', shape)}>
        {option.imageUrl && <AvatarImage src={option.imageUrl} />}
        <AvatarFallback className={cn('text-[10px]', shape)}>{initialsOf(option.name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 truncate text-ink-100">{option.name}</span>
      {option.suffix && <span className="shrink-0 text-ink-40">{option.suffix}</span>}
    </>
  );
}
