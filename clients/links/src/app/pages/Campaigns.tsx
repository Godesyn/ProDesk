/* C1 — Campaigns: scheduled short links. One slug/QR whose destination changes on
 * the dates you choose, with a fallback for everything in between.
 *
 * The "Now serving" column is the same resolution the redirector computes (both
 * call resolveCampaignDestination on the server), so this list always shows what
 * visitors actually get rather than a client-side guess. */
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon, StatusPill, Toggle, EmptyState, SkeletonTable } from '../components';
import { fmtDateTime, num, shortDisplay, shortUrl } from '../lib';
import type { Campaign } from '../lib';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';
import { useLinkToggle } from '../use-link-toggle';
import { useCanEditLinks } from '../use-can-edit';
import { useLinksInvalidate } from '../use-invalidate';
import type { PageProps } from '../types';

type StatusFilter = 'all' | 'active' | 'inactive';
const PAGE_SIZE = 25;

/**
 * What the campaign serves right now, in one short phrase. Mirrors the server's
 * CampaignResolution union: an active window, the fallback URL, or fallback text.
 */
function NowServing({ c }: { c: Campaign }) {
  if (!c.current) {
    // Only reachable if a row somehow has no fallback at all (the
    // short_links_destination_ck constraint forbids it) — flag it rather than
    // rendering an empty cell, because visitors would be getting a 404.
    return <span style={{ color: 'var(--danger)' }}>Nothing configured</span>;
  }
  if (c.current.type === 'text') {
    return (
      <span title={c.current.text}>
        <span className="achip" style={{ marginRight: 6 }}>
          Message
        </span>
        <span className="mutetext">{c.current.text}</span>
      </span>
    );
  }
  const host = c.current.url.replace(/^https?:\/\//, '');
  return (
    <span title={c.current.url}>
      {c.activeWindowId ? (
        <span className="achip active" style={{ marginRight: 6 }}>
          {c.current.label || 'Scheduled'}
        </span>
      ) : (
        <span className="achip" style={{ marginRight: 6 }}>
          Fallback
        </span>
      )}
      {host}
    </span>
  );
}

export function Campaigns({ brandId, go, entitlement }: PageProps) {
  const trpc = useTRPC();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = useCanEditLinks();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const listQuery = useInfiniteQuery(
    trpc.linkCampaigns.list.infiniteQueryOptions(
      {
        brandId,
        limit: PAGE_SIZE,
        search: debouncedQ || undefined,
        isActive: status === 'all' ? undefined : status === 'active',
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
  const campaigns = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [listQuery.data],
  );

  const { afterCampaignChange: invalidate } = useLinksInvalidate();

  const { setActive, pending: togglePending } = useLinkToggle(brandId, entitlement);
  const remove = useMutation({
    ...trpc.linkCampaigns.remove.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Campaign deleted.');
    },
    onError: (e) => toast('Error: ' + e.message),
  });

  const isInitialLoading = listQuery.isLoading;
  const noFilters = !debouncedQ && status === 'all';
  const isEmptyOverall = noFilters && campaigns.length === 0 && !isInitialLoading;

  return (
    <div>
      <div className="apage-head">
        <h1>Campaigns</h1>
        <span className="spacer" />
        {canEdit && (
          <button className="abtn abtn-primary" onClick={() => go('campaignNew')}>
            <Icon name="plus" size={15} />
            New campaign
          </button>
        )}
      </div>

      {isInitialLoading ? (
        <SkeletonTable rows={5} />
      ) : isEmptyOverall ? (
        <EmptyState
          title="One link, many destinations."
          body="A campaign is a short link whose destination changes on a schedule — print the QR once, then point it wherever you need on the dates you choose. Between windows it falls back to a URL or a message you set."
          cta={canEdit ? 'New campaign' : undefined}
          onCta={canEdit ? () => go('campaignNew') : undefined}
        />
      ) : (
        <>
          <div className="filterbar">
            <div className="search">
              <Icon name="search" size={15} />
              <input
                className="ainput"
                placeholder="Search campaigns"
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

          {campaigns.length === 0 ? (
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
                    <th>Now serving</th>
                    <th className="r">Windows</th>
                    <th>Next change</th>
                    <th className="r">Clicks</th>
                    <th>Status</th>
                    <th className="r">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => go('campaignDetail', { campaignId: c.id })}
                    >
                      <td
                        className="tslug"
                        title="Click to copy the short link"
                        style={{ cursor: 'copy' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard?.writeText(shortUrl(c.slug));
                          toast('Copied ' + shortDisplay(c.slug));
                        }}
                      >
                        {shortDisplay(c.slug)}
                      </td>
                      <td>{c.nickname || <span className="mutetext">·</span>}</td>
                      <td className="tdest">
                        <NowServing c={c} />
                      </td>
                      <td className="tnum">{num(c.windows.length)}</td>
                      <td className="tdate">
                        {c.nextChangeAt ? (
                          fmtDateTime(c.nextChangeAt)
                        ) : (
                          <span className="mutetext">·</span>
                        )}
                      </td>
                      <td className="tnum">{num(c.clickCount)}</td>
                      <td>
                        <StatusPill
                          on={c.isActive}
                          disabledAt={c.disabledAt}
                          createdAt={c.createdAt}
                        />
                      </td>
                      <td
                        className="r"
                        onClick={(e) => e.stopPropagation()}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        <div
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                        >
                          <button
                            className="abtn abtn-ghost abtn-sm"
                            title="Copy short link"
                            onClick={() => {
                              navigator.clipboard?.writeText(shortUrl(c.slug));
                              toast('Copied ' + shortDisplay(c.slug));
                            }}
                          >
                            <Icon name="copy" size={14} />
                          </button>
                          {canEdit && (
                            <>
                              <Toggle
                                on={c.isActive}
                                disabled={togglePending}
                                onChange={(next) => setActive(c.id, next, 'campaign')}
                              />
                              <button
                                className="abtn abtn-quiet abtn-sm"
                                title="Delete"
                                onClick={async () => {
                                  if (
                                    await confirm({
                                      title: 'Delete campaign?',
                                      description: `${shortDisplay(c.slug)} and its ${c.windows.length} scheduled window${c.windows.length === 1 ? '' : 's'} — this can't be undone.`,
                                      confirmLabel: 'Delete',
                                      destructive: true,
                                    })
                                  ) {
                                    remove.mutate({ id: c.id });
                                  }
                                }}
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {listQuery.hasNextPage && (
                <div style={{ marginTop: 14, textAlign: 'center' }}>
                  <button
                    className="abtn abtn-quiet"
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
