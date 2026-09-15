/* Public industry leaderboard (/directory/industry/:industry) — unauthenticated.
 * Ranks opt-in businesses in an industry by public review volume. Mirrors the
 * scoped `verdiict` shell + tRPC/useQuery conventions from ReviewFlow. No auth. */
import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { CheckCircle } from 'lucide-react';
import { Stars, SkeletonRows } from '../components';
import { VerdiictLogo } from '../VerdiictLogo';
import { num } from '../lib';

/* Rank 1-3 medal + row tint (ported from the Manus IndustryPage RANK_STYLES). */
const RANK_STYLES = [
  { icon: '🥇', bg: 'color-mix(in srgb, #f59e0b 9%, var(--v-card))' },
  { icon: '🥈', bg: 'color-mix(in srgb, #64748b 8%, var(--v-card))' },
  { icon: '🥉', bg: 'color-mix(in srgb, #c2410c 8%, var(--v-card))' },
];

export function IndustryLeaderboardPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const params = useParams<{ industry: string }>();
  const industry = params.industry ?? '';

  const { data: industries, isLoading: industriesLoading } = useQuery(
    trpc.reviews.industries.list.queryOptions(),
  );
  const industryInfo = (industries ?? []).find((i) => i.slug === industry);
  const label = industryInfo?.label ?? industry;

  const { data, isLoading } = useQuery(
    trpc.reviews.directory.leaderboard.queryOptions({ industry }),
  );

  useEffect(() => {
    document.title = `Best ${label} Businesses | Verdiict`;
    return () => {
      document.title = 'Verdiict';
    };
  }, [label]);

  const rows = data ?? [];

  if (!industriesLoading && industries && !industryInfo) {
    return (
      <Shell>
        <div className="vempty">
          <span className="serif">Industry not found</span>
          <p>We don't have a directory category at this address.</p>
          <Link className="vbtn vbtn-primary" href="/directory">← Back to directory</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div style={{ marginBottom: 28 }}>
        <p className="vmuted" style={{ fontSize: 13, margin: '0 0 10px', display: 'flex', gap: 6 }}>
          <Link href="/directory" style={{ color: 'var(--v-muted)', textDecoration: 'none' }}>
            Directory
          </Link>
          <span>/</span>
          <span>{label}</span>
        </p>
        <p className="veyebrow" style={{ marginBottom: 8 }}>Leaderboard</p>
        <h1 className="serif" style={{ fontSize: 38, fontWeight: 400, letterSpacing: '-0.02em', margin: 0 }}>
          Best {label} businesses
        </h1>
        <p className="vmuted" style={{ margin: '6px 0 0', fontSize: 14 }}>
          Ranked by verified public reviews.
        </p>
      </div>

      {isLoading || industriesLoading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <div className="vempty">
          <span className="serif">No businesses yet</span>
          <p>No businesses in this industry have opted into the directory yet.</p>
          <Link className="vbtn vbtn-primary" href="/signup">
            Be the first — create your profile
          </Link>
        </div>
      ) : (
        <div className="vcard" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="vtable">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Rank</th>
                <th>Business</th>
                <th>City</th>
                <th>Rating</th>
                <th style={{ textAlign: 'right' }}>Reviews</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const medal = r.rank <= 3 ? RANK_STYLES[r.rank - 1] : undefined;
                return (
                  <tr key={r.locationId} style={medal ? { background: medal.bg } : undefined}>
                    <td style={{ fontWeight: 700, fontSize: 16 }}>
                      {medal ? medal.icon : `#${r.rank}`}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="vbtn vbtn-quiet"
                          onClick={() => navigate(r.path)}
                          style={{ padding: 0, fontWeight: 600, fontSize: 15 }}
                        >
                          {r.name}
                        </button>
                        <span
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--v-success)' }}
                        >
                          <CheckCircle size={11} /> Verified
                        </span>
                        {r.rank === 1 && <span className="vbadge">★ Best in {label}</span>}
                      </div>
                    </td>
                    <td className="vmuted">{r.city ?? '—'}</td>
                    <td>
                      {r.reviewCount > 0 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Stars value={Math.round(r.avgRating)} />
                          <span style={{ fontWeight: 600 }}>{r.avgRating}</span>
                        </span>
                      ) : (
                        <span className="vmuted">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{num(r.reviewCount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="verdiict" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <div style={{ flex: 1, width: '100%', maxWidth: 1000, margin: '0 auto', padding: '40px 20px' }}>
        {children}
      </div>
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header
      style={{
        height: 64,
        borderBottom: '1px solid var(--v-line)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Link
        href="/directory"
        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
      >
        <VerdiictLogo height={18} />
      </Link>
    </header>
  );
}

function Footer() {
  return (
    <footer style={{ padding: '24px 0', textAlign: 'center' }}>
      <span className="veyebrow">★ Powered by Verdiict</span>
    </footer>
  );
}
