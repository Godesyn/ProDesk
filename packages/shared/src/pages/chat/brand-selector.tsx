import { ChevronDown, Lock, Store } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { identityVisuals, identitySubtitle, type ChatIdentity } from './chat-types';

export interface ChatBrand {
  id: string;
  name: string;
  logoUrl?: string | null;
  locked: boolean;
}

function BrandAvatar({ brand, size = 24 }: { brand: ChatBrand; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[8px] bg-success/10"
      style={{ width: size, height: size }}
    >
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="h-full w-full rounded-[8px] object-cover" />
      ) : (
        <Store className="text-success" style={{ width: size * 0.5, height: size * 0.5 }} />
      )}
    </span>
  );
}

/**
 * "Chat about" brand selector. For user / platformAdmin / brand identities the
 * selector is locked and shows a read-only card that mirrors the identity
 * selector style (avatar + name + subtitle) so the two selectors look
 * consistent. For agency / contractor identities it renders a dropdown so the
 * user can pick a connected brand.
 */
export function BrandSelector({
  identity,
  brands,
  selected,
  onSelect,
}: {
  identity: ChatIdentity | null;
  brands: ChatBrand[];
  selected: ChatBrand | null;
  onSelect: (b: ChatBrand) => void;
}) {
  const isLocked =
    !identity ||
    identity.type === 'brand' ||
    identity.type === 'platformAdmin' ||
    identity.type === 'user';

  const label = (
    <div className="mb-1.5 flex h-5 items-center justify-between px-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-60">Chat about</span>
    </div>
  );

  if (!identity) {
    return (
      <div>
        {label}
        <div className="flex h-12 w-full items-center gap-2 rounded-[12px] border border-ink-100 bg-inset px-3 text-sm text-ink-40">
          <Store className="h-5 w-5 text-ink-20" /> Select who to chat as first
        </div>
      </div>
    );
  }

  // For locked identities (user, platformAdmin, brand), show a read-only card
  // that mirrors the identity selector's style — the identity's own avatar,
  // name, and subtitle — rather than a confusing Store icon + app name.
  if (isLocked) {
    const { icon: Icon, tint, fg } = identityVisuals(identity.type);
    return (
      <div>
        {label}
        <div className="flex h-12 w-full items-center gap-2 rounded-[12px] border border-ink-100 bg-inset px-3">
          <span
            className={cn('inline-flex shrink-0 items-center justify-center rounded-[8px]', tint)}
            style={{ width: 24, height: 24 }}
          >
            {identity.entityLogo ? (
              <img src={identity.entityLogo} alt="" className="h-full w-full rounded-[8px] object-cover" />
            ) : (
              <Icon className={fg} style={{ width: 12, height: 12 }} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-100">{identity.entityName}</span>
            <span className="block truncate text-[11px] text-ink-40">{identitySubtitle(identity)}</span>
          </span>
          <Lock className="h-4 w-4 shrink-0 text-ink-40" />
        </div>
      </div>
    );
  }

  if (brands.length === 0) {
    const msg =
      identity.type === 'agency'
        ? 'No connected brands'
        : identity.type === 'contractor'
          ? 'No brand threads found'
          : 'Brand not found';
    return (
      <div>
        {label}
        <div className="flex h-12 w-full items-center gap-2 rounded-[12px] border border-warn/40 bg-warn/10 px-3 text-sm text-warn">
          {msg}
        </div>
      </div>
    );
  }

  return (
    <div>
      {label}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-12 w-full items-center gap-2 rounded-[12px] border border-ink-100 bg-card px-3 text-left"
        >
          {selected ? (
            <>
              <BrandAvatar brand={selected} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">{selected.name}</span>
            </>
          ) : (
            <span className="flex-1 text-sm text-ink-40">Select brand to chat about…</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-40" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {brands.map((b) => (
            <DropdownMenuItem key={b.id} onSelect={() => onSelect(b)} className="flex items-center gap-3 py-2">
              <BrandAvatar brand={b} size={32} />
              <span className="truncate text-sm font-medium text-ink-100">{b.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
