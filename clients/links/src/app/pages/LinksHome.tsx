/* L1 — Links home. Server-side search + keyset pagination via shortLinks.list. */
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon, StatusPill, Toggle, EmptyState, SkeletonTable } from '../components';
import { fmtDate, num, shortDisplay, shortUrl } from '../lib';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';
import { useLinkToggle } from '../use-link-toggle';
import { useCanEditLinks } from '../use-can-edit';
import { useLinksInvalidate } from '../use-invalidate';
import type { PageProps } from '../types';

type StatusFilter = 'all' | 'active' | 'inactive';
const PAGE_SIZE = 25;

export function LinksHome({ brandId, go, onNewLink, entitlement }: PageProps) {
  const trpc = useTRPC();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = useCanEditLinks();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  // Debounce the search box so each keystroke doesn't hit the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const listInput = {
    brandId,
    limit: PAGE_SIZE,
    search: debouncedQ || undefined,
    // Plain links only — campaigns are the same table with kind='campaign' and
    // have their own screen, so they must not show up twice.
    kind: 'link' as const,
    isActive: status === 'all' ? undefined : status === 'active',
  };
  const listQuery = useInfiniteQuery(
    trpc.shortLinks.list.infiniteQueryOptions(listInput, {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const links = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [listQuery.data],
  );

  const { afterLinkChange: invalidate } = useLinksInvalidate();

  const { setActive, pending: togglePending } = useLinkToggle(
    brandId,
    entitlement,
  );
  const remove = useMutation({
    ...trpc.shortLinks.remove.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Link deleted.');
    },
    onError: (e) => toast('Error: ' + e.message),
  });

  // First load (no filters applied yet) shows the skeleton / empty state.
  const isInitialLoading = listQuery.isLoading;
  const noFilters = !debouncedQ && status === 'all';
  const isEmptyOverall = noFilters && links.length === 0 && !isInitialLoading;

  return (
    <div>
      <div className="apage-head">
        <h1>Links</h1>
        <span className="spacer" />
        {canEdit && (
          <button className="abtn abtn-primary" onClick={onNewLink}>
            <Icon name="plus" size={15} />
            New link
          </button>
        )}
      </div>

      {isInitialLoading ? (
        <SkeletonTable rows={6} />
      ) : isEmptyOverall ? (
        <EmptyState
          title="Your first code is waiting."
          body="Paste a long link, get a short one and its QR code."
          cta={canEdit ? 'New link' : undefined}
          onCta={canEdit ? onNewLink : undefined}
        />
      ) : (
        <>
          <div className="filterbar">
            <div className="search">
              <Icon name="search" size={15} />
              <input
                className="ainput"
                placeholder="Search links and destinations"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={'achip' + (status === s ? ' active' : '')}
                onClick={() => setStatus(s)}
              >
                {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>

          {links.length === 0 ? (
            <EmptyState
              title="Nothing matches."
              body="Try a different search, or clear the filters."
            />
          ) : (
            <>
              <table className="atable">
                <thead>
                  <tr>
                    <th>Short link</th>
                    <th>Label</th>
                    <th>Destination</th>
                    <th className="r">Clicks</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={l.id} onClick={() => go('detail', { linkId: l.id })}>
                      <td
                        className="tslug"
                        title="Click to copy the short link"
                        style={{ cursor: 'copy' }}
                        onClick={(e) => {
                          // Copy the link instead of opening detail — the rest of
                          // the row still navigates.
                          e.stopPropagation();
                          navigator.clipboard?.writeText(shortUrl(l.slug));
                          toast('Copied ' + shortDisplay(l.slug));
                        }}
                      >
                        {shortDisplay(l.slug)}
                      </td>
                      <td>{l.nickname || <span className="mutetext">·</span>}</td>
                      <td className="tdest" title={l.destinationUrl ?? undefined}>
                        {(l.destinationUrl ?? '').replace(/^https?:\/\//, '')}
                      </td>
                      <td className="tnum">{num(l.clickCount)}</td>
                      <td>
                        <StatusPill on={l.isActive} disabledAt={l.disabledAt} createdAt={l.createdAt} />
                      </td>
                      <td className="tdate">{fmtDate(l.createdAt)}</td>
                      <td
                        className="r"
                        onClick={(e) => e.stopPropagation()}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <button
                            className="abtn abtn-ghost abtn-sm"
                            title="Copy short link"
                            onClick={() => {
                              navigator.clipboard?.writeText(shortUrl(l.slug));
                              toast('Copied ' + shortDisplay(l.slug));
                            }}
                          >
                            <Icon name="copy" size={14} />
                          </button>
                          <Toggle
                            on={l.isActive}
                            disabled={togglePending}
                            onChange={(next) => setActive(l.id, next)}
                          />
                          <button
                            className="abtn abtn-quiet abtn-sm"
                            title="Delete"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: 'Delete link?',
                                  description: `${shortDisplay(l.slug)} — this can't be undone.`,
                                  confirmLabel: 'Delete',
                                  destructive: true,
                                })
                              )
                                remove.mutate({ id: l.id });
                            }}
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {listQuery.hasNextPage && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
                  <button
                    className="abtn abtn-ghost"
                    disabled={listQuery.isFetchingNextPage}
                    onClick={() => listQuery.fetchNextPage()}
                  >
                    {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
