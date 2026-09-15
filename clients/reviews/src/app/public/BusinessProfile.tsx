/* Public business profile — unauthenticated. A directory listing is a LOCATION,
 * so the canonical URL is /directory/:brandSlug/:locationSlug. Legacy one-segment
 * URLs (the old brand-level /directory/:slug and the combined slugs that briefly
 * replaced it) still resolve server-side and are replaced in the address bar with
 * the canonical path here — see resolveDirectoryTarget.
 *
 * Shows the location's rating block, industry rank, sibling locations and a wall
 * of consented public reviews. Manages its own SEO head (title / description /
 * canonical / JSON-LD) since this page is the crawlable surface. Mirrors
 * ReviewFlow's scoped `verdiict` shell + tRPC/useQuery. No auth. */
import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { CheckCircle, ExternalLink, Loader2, Trophy } from 'lucide-react';
import { Stars } from '../components';
import { VerdiictLogo } from '../VerdiictLogo';
import { fmtDate, num } from '../lib';
import type { DirectoryProfileData } from '../lib';
import { LazyImage } from '@shared/components/ui/lazy-image';

const JSONLD_ID = 'profile-jsonld';

/* Gold / silver / bronze pill tints for industry ranks 1-3. */
const RANK_TINTS = [
  { background: 'color-mix(in srgb, #f59e0b 20%, transparent)', color: '#8a5b06' },
  { background: 'color-mix(in srgb, #64748b 16%, transparent)', color: '#475569' },
  { background: 'color-mix(in srgb, #c2410c 16%, transparent)', color: '#9a3412' },
];

export function BusinessProfilePage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const params = useParams<{ slug: string; location?: string }>();
  const slug = params.slug ?? '';
  const locationSlug = params.location;

  const { data, isLoading, error } = useQuery({
    ...trpc.reviews.directory.profile.queryOptions({ slug, locationSlug }),
    retry: false,
  });
  const { data: industries } = useQuery(trpc.reviews.industries.list.queryOptions());

  /* Arrived on a legacy or non-canonical URL — swap the address bar for the
   * canonical one without adding a history entry, so Back still leaves the page
   * and search engines only ever index one URL per listing. */
  const canonicalPath = data?.path ?? null;
  const needsRedirect = !!data && !data.isCanonical && !!canonicalPath;
  useEffect(() => {
    if (needsRedirect && canonicalPath) navigate(canonicalPath, { replace: true });
  }, [needsRedirect, canonicalPath, navigate]);

  /* SEO head: title, meta description, canonical, JSON-LD (LocalBusiness +
   * AggregateRating + top-5 Reviews). Recreated whenever the payload changes;
   * fully cleaned up / restored on unmount. */
  useEffect(() => {
    if (!data) return;
    document.title = `${data.name} — Reviews | Verdiict`;

    const canonicalUrl = `${window.location.origin}${data.path}`;
    const metaDesc = data.description
      ? `${data.description.slice(0, 155)}…`
      : `Read verified reviews for ${data.name}${data.city ? ` in ${data.city}` : ''}. ` +
        `${data.totalReviews} verified review${data.totalReviews !== 1 ? 's' : ''} on Verdiict.`;

    const existingDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const createdDesc = !existingDesc;
    const prevDesc = existingDesc?.content ?? '';
    const desc =
      existingDesc ??
      (() => {
        const m = document.createElement('meta');
        m.name = 'description';
        document.head.appendChild(m);
        return m;
      })();
    desc.content = metaDesc;

    const existingCanon = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    const createdCanon = !existingCanon;
    const prevCanon = existingCanon?.href ?? '';
    const canon =
      existingCanon ??
      (() => {
        const l = document.createElement('link');
        l.rel = 'canonical';
        document.head.appendChild(l);
        return l;
      })();
    canon.href = canonicalUrl;

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: data.name,
      url: data.websiteUrl ?? canonicalUrl,
      ...(data.city ? { address: { '@type': 'PostalAddress', addressLocality: data.city } } : {}),
      ...(data.totalReviews > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: data.avgRating.toFixed(1),
              reviewCount: data.totalReviews,
              bestRating: '5',
              worstRating: '1',
            },
          }
        : {}),
      ...(data.publicReviews.length > 0
        ? {
            review: data.publicReviews.slice(0, 5).map((r) => ({
              '@type': 'Review',
              reviewRating: { '@type': 'Rating', ratingValue: r.stars },
              reviewBody: r.generatedReview ?? '',
              datePublished: new Date(r.createdAt).toISOString().split('T')[0],
            })),
          }
        : {}),
    };
    document.getElementById(JSONLD_ID)?.remove();
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = JSONLD_ID;
    script.text = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      document.title = 'Verdiict';
      if (createdDesc) desc.remove();
      else desc.content = prevDesc;
      if (createdCanon) canon.remove();
      else canon.href = prevCanon;
      document.getElementById(JSONLD_ID)?.remove();
    };
  }, [data]);

  if (isLoading) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '64px 0' }}>
          <Loader2 className="animate-spin" style={{ margin: '0 auto' }} />
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <div className="vempty">
          <span className="serif">Business not found</span>
          <p>This business isn't listed in the directory, or its profile is no longer public.</p>
          <a className="vbtn vbtn-primary" href="/directory">Browse the directory</a>
        </div>
      </Shell>
    );
  }

  const profile: DirectoryProfileData = data;
  const industryLabel =
    (industries ?? []).find((i) => i.slug === profile.primaryIndustry)?.label ??
    profile.primaryIndustry;
  const rank = profile.industryRank?.rank ?? null;
  const rankTint = rank != null && rank <= 3 ? RANK_TINTS[rank - 1] : null;
  /* This location's own logo, already resolved server-side with the brand logo
   * as the fallback — picking "the first sibling that happens to have one" put
   * another branch's logo on this profile. */
  const logoUrl = profile.logoUrl;

  return (
    <Shell>
      <div className="vcard pad-lg" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 18, minWidth: 0, flex: 1 }}>
            <span className="vavatar" style={{ width: 64, height: 64, borderRadius: 14, fontSize: 24 }}>
              {logoUrl ? <LazyImage src={logoUrl} alt={profile.name} wrapperClassName="w-full h-full" /> : initials(profile.name)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <h1 className="serif" style={{ fontSize: 40, fontWeight: 400, letterSpacing: '-0.02em', margin: 0 }}>
                  {profile.name}
                </h1>
                <span
                  className="vbadge"
                  style={{
                    background: 'color-mix(in srgb, var(--v-success) 14%, transparent)',
                    color: 'var(--v-success)',
                  }}
                >
                  <CheckCircle size={11} /> Verdiict Verified
                </span>
                {rankTint && (
                  <span className="vbadge" style={rankTint}>
                    <Trophy size={11} /> #{rank} Best {industryLabel}
                  </span>
                )}
              </div>
              <div className="vmuted" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
                {profile.city && <span>{profile.city}</span>}
                {profile.websiteUrl && (
                  <a
                    href={profile.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--v-ink)' }}
                  >
                    <ExternalLink size={14} /> Website
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <span className="vbadge">{industryLabel}</span>
              </div>
              {profile.description && (
                <p className="vmuted" style={{ margin: '16px 0 0', fontSize: 14, maxWidth: 560, lineHeight: 1.5 }}>
                  {profile.description}
                </p>
              )}
            </div>
          </div>
          {profile.totalReviews > 0 && (
            <div style={{ display: 'flex', gap: 28, flexShrink: 0 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {profile.avgRating}
                </div>
                <div style={{ margin: '8px 0 6px', display: 'flex', justifyContent: 'center' }}>
                  <Stars value={Math.round(profile.avgRating)} size={18} />
                </div>
                <div className="vmuted" style={{ fontSize: 13 }}>{num(profile.totalReviews)} reviews</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {num(profile.locations.length)}
                </div>
                <div className="vmuted" style={{ fontSize: 13, marginTop: 10 }}>
                  location{profile.locations.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {profile.locations.length > 1 && (
        <div style={{ marginBottom: 24 }}>
          <p className="veyebrow" style={{ marginBottom: 10 }}>
            Other locations of {profile.brandName}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {profile.locations.map((loc) =>
              loc.isCurrent ? (
                <span
                  key={loc.id}
                  aria-current="page"
                  className="vbadge"
                  style={{
                    fontSize: 13,
                    padding: '6px 12px',
                    background: 'var(--v-ink)',
                    color: 'var(--v-paper)',
                  }}
                >
                  {loc.name}
                </span>
              ) : (
                <Link
                  key={loc.id}
                  href={loc.path}
                  className="vbadge"
                  style={{ fontSize: 13, padding: '6px 12px', textDecoration: 'none' }}
                >
                  {loc.name}
                </Link>
              ),
            )}
          </div>
        </div>
      )}

      <p className="veyebrow" style={{ marginBottom: 14 }}>What customers say</p>
      {profile.publicReviews.length === 0 ? (
        <div className="vempty">
          <span className="serif">No public reviews yet</span>
          <p>This business hasn't collected any public reviews so far.</p>
        </div>
      ) : (
        <div className="vgrid cols-2">
          {profile.publicReviews.map((r) => (
            <div key={r.id} className="vcard" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Stars value={r.stars} />
              {r.generatedReview && (
                <p className="serif" style={{ fontSize: 17, lineHeight: 1.5, margin: 0 }}>
                  “{r.generatedReview}”
                </p>
              )}
              {r.selectedTags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {r.selectedTags.map((t) => (
                    <span key={t} className="vbadge">{t}</span>
                  ))}
                </div>
              )}
              <div className="vmuted" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, marginTop: 'auto' }}>
                <span>{r.locationName}</span>
                <span>{fmtDate(r.createdAt)}</span>
              </div>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--v-success)' }}
              >
                <CheckCircle size={11} /> Verified via Verdiict
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="vmuted"
        style={{
          marginTop: 36,
          paddingTop: 18,
          borderTop: '1px solid var(--v-line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          fontSize: 12.5,
        }}
      >
        <span>
          Reviews collected and verified by{' '}
          <Link href="/directory" style={{ color: 'var(--v-ink)', fontWeight: 500 }}>Verdiict</Link>{' '}
          — the review capture platform for local businesses.
        </span>
        <Link
          href={`/directory/industry/${profile.primaryIndustry}`}
          style={{ color: 'var(--v-muted)', textDecoration: 'none' }}
        >
          Browse all {industryLabel} businesses →
        </Link>
      </div>

      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <a className="vbtn vbtn-quiet" href="/directory">← Browse the directory</a>
      </div>
    </Shell>
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
      <a href="/directory" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
        <VerdiictLogo height={18} />
      </a>
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
