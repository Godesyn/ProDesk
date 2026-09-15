/* Public directory search (/directory) — unauthenticated. Visitors search the
 * opt-in directory of businesses by name or city, browse by industry, and jump
 * into a profile. Mirrors ReviewFlow's scoped `verdiict` shell + tRPC/useQuery
 * conventions. No auth. */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Building2, CheckCircle, Search } from 'lucide-react';
import { Stars } from '../components';
import { VerdiictLogo } from '../VerdiictLogo';
import { num } from '../lib';
import type { DirectoryListing, Industry } from '../lib';
import { LazyImage } from '@shared/components/ui/lazy-image';

/* Per-industry emoji, keyed by slug (ported from the Manus DirectoryPage). */
const INDUSTRY_ICONS: Record<string, string> = {
  'agency': '🎨',
  'real-estate': '🏠',
  'retail': '🛍️',
  'hospitality': '🍽️',
  'trades': '🔧',
  'health': '💊',
  'legal': '⚖️',
  'automotive': '🚗',
  'other': '🏢',
};

export function DirectoryPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Business Directory | Verdiict';
    return () => {
      document.title = 'Verdiict';
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  const { data, isLoading } = useQuery({
    ...trpc.reviews.directory.search.queryOptions({ query }),
    enabled: query.trim().length > 0,
  });
  const { data: industries } = useQuery(trpc.reviews.industries.list.queryOptions());

  const results = data ?? [];
  const hasQuery = query.trim().length > 0;
  const industryLabel = (slug: string | null) =>
    (industries ?? []).find((i) => i.slug === slug)?.label ?? slug;

  return (
    <div className="verdiict" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <div style={{ flex: 1, width: '100%', maxWidth: 1000, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <span
            className="vbadge"
            style={{ marginBottom: 16, fontSize: 12, padding: '5px 12px', borderRadius: 999 }}
          >
            <CheckCircle size={12} style={{ color: 'var(--v-success)' }} /> Verified business reviews
          </span>
          <h1 className="serif" style={{ fontSize: 46, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 10px' }}>
            Find a business you can trust
          </h1>
          <p className="vmuted" style={{ fontSize: 15, margin: '0 auto 24px', maxWidth: 520 }}>
            Every review on Verdiict is verified — collected directly from real customers, not
            scraped from the internet. Search any business, branch or city.
          </p>
          <div style={{ position: 'relative', maxWidth: 520, margin: '0 auto' }}>
            <Search
              size={18}
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--v-muted)' }}
            />
            <input
              className="vinput"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Try a business, branch or city…"
              style={{ paddingLeft: 40, fontSize: 15 }}
              autoFocus
            />
          </div>
        </div>

        {hasQuery && (
          <div style={{ marginBottom: 36 }}>
            {isLoading ? (
              <p className="vmuted" style={{ textAlign: 'center' }}>Searching…</p>
            ) : results.length === 0 ? (
              <div className="vempty">
                <span className="serif">No matches</span>
                <p>We couldn't find a business matching “{query}”. Try a different name or city.</p>
              </div>
            ) : (
              <div className="vgrid cols-2">
                {results.map((r) => (
                  <ResultCard
                    key={r.locationId}
                    listing={r}
                    industryLabel={industryLabel(r.primaryIndustry)}
                    /* r.path is the canonical /directory/<brand>/<location>,
                     * built server-side — never re-derive it from a name here. */
                    onOpen={() => navigate(r.path)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {(industries ?? []).length > 0 && (
          <div>
            <p className="veyebrow" style={{ marginBottom: 14 }}>Browse by industry</p>
            <div className="vgrid cols-3">
              {(industries ?? []).map((ind) => (
                <IndustryCard
                  key={ind.slug}
                  industry={ind}
                  onOpen={() => navigate(`/directory/industry/${ind.slug}`)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <OwnBusinessBand />
      <Footer />
    </div>
  );
}

function IndustryCard({ industry, onOpen }: { industry: Industry; onOpen: () => void }) {
  return (
    <button className="vselcard" onClick={onOpen} style={{ width: '100%' }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{INDUSTRY_ICONS[industry.slug] ?? '🏢'}</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{industry.label}</div>
      <div className="vmuted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{industry.description}</div>
    </button>
  );
}

function ResultCard({
  listing,
  industryLabel,
  onOpen,
}: {
  listing: DirectoryListing;
  industryLabel: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      className="vcard"
      onClick={onOpen}
      style={{ display: 'flex', gap: 14, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer', width: '100%' }}
    >
      <span className="vavatar" style={{ width: 44, height: 44, borderRadius: 10, fontSize: 16 }}>
        {listing.logoUrl ? (
          <LazyImage src={listing.logoUrl} alt={listing.name} wrapperClassName="w-full h-full" />
        ) : (
          initials(listing.name)
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{listing.name}</div>
        <div className="vmuted" style={{ fontSize: 13, marginBottom: 8 }}>
          {listing.city ?? 'City not listed'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {industryLabel && <span className="vbadge">{industryLabel}</span>}
          {listing.reviewCount > 0 && (
            <>
              <Stars value={Math.round(listing.avgRating)} />
              <span style={{ fontWeight: 600, fontSize: 13 }}>{listing.avgRating}</span>
              <span className="vmuted" style={{ fontSize: 13 }}>({num(listing.reviewCount)} reviews)</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

function TopBar() {
  return (
    <header style={{ borderBottom: '1px solid var(--v-line)' }}>
      <div
        style={{
          height: 64,
          maxWidth: 1000,
          margin: '0 auto',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Link
          href="/directory"
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
        >
          <VerdiictLogo height={18} />
        </Link>
        <Link href="/login" style={{ fontSize: 14, color: 'var(--v-muted)', textDecoration: 'none' }}>
          Sign in
        </Link>
      </div>
    </header>
  );
}

/* Acquisition band for business owners. No public pricing procedure exists, so
 * the pitch stays price-free (repo rule: never hardcode prices in UI). */
function OwnBusinessBand() {
  return (
    <section style={{ background: 'var(--v-ink)', color: 'var(--v-paper)', padding: '56px 20px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <Building2 size={32} style={{ opacity: 0.6, marginBottom: 14 }} />
        <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 10px' }}>
          Own a business?
        </h2>
        <p style={{ color: 'rgba(246, 244, 236, 0.65)', fontSize: 14.5, lineHeight: 1.6, margin: '0 0 22px' }}>
          Get your Verdiict profile, collect verified reviews, and appear in the directory. Start
          free — no card needed.
        </p>
        <Link
          href="/signup"
          className="vbtn"
          style={{ background: 'var(--v-paper)', color: 'var(--v-ink)', borderColor: 'var(--v-paper)', fontWeight: 600 }}
        >
          Get started free →
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer style={{ padding: '24px 20px' }}>
      <div
        style={{
          maxWidth: 1000,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span className="veyebrow">★ Powered by Verdiict</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 13 }}>
          <span className="vmuted">© {new Date().getFullYear()} Verdiict</span>
          <Link href="/directory" style={{ color: 'var(--v-muted)', textDecoration: 'none' }}>
            Directory
          </Link>
          <Link href="/login" style={{ color: 'var(--v-muted)', textDecoration: 'none' }}>
            Sign in
          </Link>
        </span>
      </div>
    </footer>
  );
}
