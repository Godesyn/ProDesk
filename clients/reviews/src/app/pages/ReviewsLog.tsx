/* Verdiict — Reviews log. The per-location stat tiles plus a filterable table of
 * every submission (public 5★ reviews and private ≤4★ feedback). */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { ChevronLeft } from 'lucide-react';
import { EmptyState, Seg, SkeletonRows, StatTile, Stars } from '../components';
import { fmtDateTime } from '../lib';
import type { PageProps } from '../lib';

type Filter = 'all' | 'public' | 'private';

export function ReviewsLog(props: PageProps) {
  const { params, go } = props;
  const locationId = params.id!;
  const trpc = useTRPC();

  const [filter, setFilter] = useState<Filter>('all');

  const { data: stats, isLoading: statsLoading } = useQuery(
    trpc.reviews.dashboard.stats.queryOptions({ locationId }),
  );
  const { data: reviews, isLoading: reviewsLoading } = useQuery(
    trpc.reviews.dashboard.reviews.queryOptions({ locationId, limit: 100 }),
  );
  const isLoading = statsLoading || reviewsLoading;

  const filtered = (reviews ?? []).filter((r) =>
    filter === 'all' ? true : r.submissionType === filter,
  );

  return (
    <>
      <div className="vpagehead">
        <div>
          <button
            className="vbtn vbtn-quiet vbtn-sm"
            style={{ marginBottom: 8 }}
            onClick={() => go('locations')}
          >
            <ChevronLeft size={14} />
            Locations
          </button>
          <h1>Reviews log</h1>
          <p>Every review and private feedback captured for this location.</p>
        </div>
      </div>

      {isLoading ? (
        <>
          <div className="vgrid cols-3" style={{ marginBottom: 16 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="vskel" style={{ height: 86 }} />
            ))}
          </div>
          <SkeletonRows />
        </>
      ) : (
        <>
          <div className="vgrid cols-3" style={{ marginBottom: 16 }}>
            <StatTile n={stats?.total ?? 0} l="Total reviews" />
            <StatTile
              n={stats && stats.total > 0 ? stats.avgStars.toFixed(1) : '—'}
              l="Average stars"
            />
            <StatTile n={stats?.publicCount ?? 0} l="Public" />
            <StatTile n={stats?.privateCount ?? 0} l="Private" />
          </div>

          <div className="vrow-between" style={{ marginBottom: 12 }}>
            <Seg<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'public', label: 'Public' },
                { value: 'private', label: 'Private' },
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No reviews yet"
              body="Share this location's review link to start collecting reviews."
            />
          ) : (
            <table className="vtable">
              <thead>
                <tr>
                  <th style={{ minWidth: 150 }}>Date</th>
                  <th>Rating</th>
                  <th>Type</th>
                  <th>Platform</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.createdAt)}</td>
                    <td>
                      <Stars value={r.stars} />
                    </td>
                    <td>
                      <span className="vbadge">{r.submissionType}</span>
                    </td>
                    <td>
                      {r.platformClicked ? (
                        <span style={{ textTransform: 'capitalize' }}>→ {r.platformClicked}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {r.selectedTags.length > 0 ? (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            marginBottom: r.generatedReview || r.privateFeedback ? 8 : 0,
                          }}
                        >
                          {r.selectedTags.map((tag) => (
                            <span key={tag} className="vbadge">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {r.generatedReview ? <p style={{ margin: 0 }}>{r.generatedReview}</p> : null}
                      {r.privateFeedback ? (
                        <p
                          className="vmuted"
                          style={{ margin: r.generatedReview ? '6px 0 0' : 0, fontStyle: 'italic' }}
                        >
                          "{r.privateFeedback}"
                        </p>
                      ) : null}
                      {!r.generatedReview && !r.privateFeedback && r.selectedTags.length === 0
                        ? '—'
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
