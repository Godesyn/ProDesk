/**
 * Reviews super-admin portal — ported from the Verdiict reviews client's
 * AdminPortal into the shared prodesk design system. UI-only re-skin: every
 * `trpc.reviews.admin.*` call, input and output field is identical to the
 * source. Five tabs — Overview KPIs + billing health + recent reviews,
 * Customers (with a drill-in detail: members, activity timeline, locations +
 * purge), Industries (CRUD + tag presets), claimed Rewards fulfilment
 * (mark shipped / delivered) and the admin audit log. The route is gated to
 * super-admins by the shell; sections are local state.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Gift,
  Plus,
  RefreshCw,
  ScrollText,
  Shield,
  Star,
  Tags,
  Trash2,
  Users,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { formatDate, formatNumber } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { SearchBar, StatCard } from './components';

type Section = 'overview' | 'customers' | 'industries' | 'rewards' | 'audit';

const TABS: { value: Section; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'customers', label: 'Customers' },
  { value: 'industries', label: 'Industries' },
  { value: 'rewards', label: 'Rewards' },
  { value: 'audit', label: 'Audit' },
];

const STATUS_LABEL: Record<string, string> = {
  subscribed: 'Subscribed',
  beta: 'Beta',
  trial: 'Trial',
  trial_exhausted: 'Trial ended',
};

const ACTION_LABEL: Record<string, string> = {
  upsert_industry: 'Industry saved',
  archive_industry: 'Industry archived',
  unarchive_industry: 'Industry restored',
  set_tag_presets: 'Tag presets',
  force_delete_location: 'Location purged',
  mark_reward_shipped: 'Reward shipped',
  mark_reward_delivered: 'Reward delivered',
};

/** Local date+time formatter (shared utils only exposes date-only formatDate). */
function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

export function ReviewsAdminPage() {
  const [section, setSection] = useState<Section>('overview');
  const [detailBrandId, setDetailBrandId] = useState<string | null>(null);

  const openBrand = (brandId: string) => {
    setDetailBrandId(brandId);
    setSection('customers');
  };

  return (
    <div>
      <PageHeader title="Reviews admin" description="Platform-wide reviews administration." />

      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => {
              setSection(t.value);
              if (t.value !== 'customers') setDetailBrandId(null);
            }}
            className={
              'rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ' +
              (section === t.value ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'overview' ? <OverviewSection onOpenBrand={openBrand} /> : null}
      {section === 'customers' ? (
        detailBrandId ? (
          <CustomerDetail brandId={detailBrandId} onBack={() => setDetailBrandId(null)} />
        ) : (
          <CustomersSection onOpenBrand={openBrand} />
        )
      ) : null}
      {section === 'industries' ? <IndustriesSection /> : null}
      {section === 'rewards' ? <RewardsSection /> : null}
      {section === 'audit' ? <AuditSection /> : null}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

/** Failed-query card with a retry button (shared by every section). */
function ErrorCard({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertCircle className="h-6 w-6 text-ink-40" />
      <div>
        <p className="font-medium text-ink-100">Couldn't load this section</p>
        <p className="mt-1 text-sm text-ink-60">
          {message || 'The request failed. Check your connection and try again.'}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </Button>
    </Card>
  );
}

function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-ink-100">
      {value}
      <Star className="h-3.5 w-3.5 fill-warn text-warn" />
    </span>
  );
}

/** Small uppercase section eyebrow used inside cards. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-wide text-ink-40">{children}</p>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function OverviewSection({ onOpenBrand }: { onOpenBrand: (brandId: string) => void }) {
  const trpc = useTRPC();
  const overviewQ = useQuery(trpc.reviews.admin.overview.queryOptions());
  const recentQ = useQuery(trpc.reviews.admin.recentReviews.queryOptions({ limit: 25 }));
  const overview = overviewQ.data;

  return (
    <div className="space-y-4">
      {overviewQ.isError ? (
        <ErrorCard message={overviewQ.error?.message} onRetry={() => overviewQ.refetch()} />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <StatCard label="Brands" value={overview?.totalBrands ?? 0} />
            <StatCard label="Locations" value={overview?.totalLocations ?? 0} />
            <StatCard label="Reviews" value={overview?.totalReviews ?? 0} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <StatCard label="Subscribed brands" value={overview?.subscribedBrands ?? 0} tone="success" />
            <StatCard label="On free trial" value={overview?.trialBrands ?? 0} />
            <StatCard label="Trial almost out" value={overview?.trialNearlyExhausted ?? 0} tone="warn" />
          </div>

          <Card className="p-0">
            <div className="p-4">
              <SectionLabel>Billing health</SectionLabel>
              <p className="mt-1 text-sm text-ink-60">
                Brands at {Math.max(0, (overview?.trialNearEnd[0]?.trialLimit ?? 10) - 2)}+ of{' '}
                {overview?.trialNearEnd[0]?.trialLimit ?? 10} free-trial reviews with no
                subscription — good moments to nudge for an upgrade.
              </p>
            </div>
            {overviewQ.isLoading ? (
              <SkeletonRows rows={3} />
            ) : (overview?.trialNearEnd.length ?? 0) === 0 ? (
              <p className="px-4 pb-4 text-sm text-ink-60">
                No brands in the conversion window right now.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Trial used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.trialNearEnd ?? []).map((b) => (
                    <TableRow
                      key={b.brandId}
                      className="cursor-pointer"
                      onClick={() => onOpenBrand(b.brandId)}
                    >
                      <TableCell className="font-medium text-ink-100">{b.brandName}</TableCell>
                      <TableCell className="text-ink-60">{b.ownerEmail ?? '—'}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="warn">
                          {b.trialUsed}/{b.trialLimit}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </>
      )}

      <Card className="p-0">
        <div className="p-4">
          <SectionLabel>Recent reviews</SectionLabel>
        </div>
        {recentQ.isLoading ? (
          <SkeletonRows />
        ) : recentQ.isError ? (
          <div className="p-4 pt-0">
            <ErrorCard message={recentQ.error?.message} onRetry={() => recentQ.refetch()} />
          </div>
        ) : (recentQ.data?.length ?? 0) === 0 ? (
          <p className="px-4 pb-4 text-sm text-ink-60">No reviews captured anywhere yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Stars</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recentQ.data ?? []).map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpenBrand(r.brandId)}>
                  <TableCell className="font-medium text-ink-100">{r.brandName ?? '—'}</TableCell>
                  <TableCell>{r.locationName}</TableCell>
                  <TableCell>
                    <Stars value={r.stars} />
                  </TableCell>
                  <TableCell>{r.submissionType}</TableCell>
                  <TableCell>{r.platform ?? '—'}</TableCell>
                  <TableCell className="text-ink-60">{formatDate(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ─── Customers list ──────────────────────────────────────────────────────────

function CustomersSection({ onOpenBrand }: { onOpenBrand: (brandId: string) => void }) {
  const trpc = useTRPC();
  const brandsQ = useQuery(trpc.reviews.admin.brands.queryOptions());
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const rows = brandsQ.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (b) =>
        b.brandName.toLowerCase().includes(needle) ||
        (b.ownerEmail ?? '').toLowerCase().includes(needle) ||
        (b.ownerName ?? '').toLowerCase().includes(needle),
    );
  }, [brandsQ.data, q]);

  if (brandsQ.isError) {
    return <ErrorCard message={brandsQ.error?.message} onRetry={() => brandsQ.refetch()} />;
  }

  return (
    <div>
      <SearchBar value={q} onChange={setQ} placeholder="Search by brand, owner email or name…" />
      <Card className="p-0">
        {brandsQ.isLoading ? (
          <SkeletonRows />
        ) : (brandsQ.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Users}
            title="No customers yet"
            description="Brands appear here once they create their first review location."
          />
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-ink-60">No customers match “{q}”.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Locations</TableHead>
                <TableHead>Reviews</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow
                  key={b.brandId}
                  className="cursor-pointer"
                  onClick={() => onOpenBrand(b.brandId)}
                >
                  <TableCell className="font-medium text-ink-100">{b.brandName}</TableCell>
                  <TableCell className="text-ink-60">{b.ownerEmail ?? '—'}</TableCell>
                  <TableCell>{formatNumber(b.locationCount)}</TableCell>
                  <TableCell>{formatNumber(b.reviewCount)}</TableCell>
                  <TableCell>
                    <Badge variant="muted">{STATUS_LABEL[b.status] ?? b.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ─── Customer drill-in ───────────────────────────────────────────────────────

function CustomerDetail({ brandId, onBack }: { brandId: string; onBack: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const detailQ = useQuery(trpc.reviews.admin.brandDetail.queryOptions({ brandId }));
  const activityQ = useQuery(trpc.reviews.admin.brandActivity.queryOptions({ brandId, limit: 50 }));

  const purge = useMutation({
    ...trpc.reviews.admin.forceDeleteLocation.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.brandDetail.queryKey({ brandId }) });
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.brandActivity.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.brands.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.overview.queryKey() });
      toast.success('Location permanently deleted.');
    },
    onError: (err) => toastError(err, "Couldn't delete the location."),
  });

  const back = (
    <Button variant="outline" size="sm" className="mb-4" onClick={onBack}>
      <ArrowLeft className="h-3.5 w-3.5" /> All customers
    </Button>
  );

  if (detailQ.isLoading) {
    return (
      <div>
        {back}
        <Card className="p-0">
          <SkeletonRows />
        </Card>
      </div>
    );
  }
  if (detailQ.isError || !detailQ.data) {
    return (
      <div>
        {back}
        <ErrorCard message={detailQ.error?.message} onRetry={() => detailQ.refetch()} />
      </div>
    );
  }

  const { brand, members, locations, totalReviews, entitlement } = detailQ.data;
  const entLabel = entitlement.entitled
    ? entitlement.betaExempt
      ? 'Beta'
      : 'Subscribed'
    : entitlement.trialActive
      ? `Trial ${entitlement.trialUsed}/${entitlement.trialLimit}`
      : 'Trial exhausted';

  return (
    <div className="space-y-4">
      {back}

      <Card className="p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <SectionLabel>Customer</SectionLabel>
            <h2 className="mt-1 text-lg font-semibold text-ink-100">{brand.businessName}</h2>
            <p className="mt-1.5 text-sm text-ink-60">
              {brand.ownerName ? `${brand.ownerName} · ` : ''}
              {brand.ownerEmail ?? 'unknown owner'} · joined{' '}
              {brand.createdAt ? formatDate(brand.createdAt) : '—'} · {formatNumber(totalReviews)}{' '}
              reviews captured
            </p>
          </div>
          <Badge variant="accent" className="shrink-0">
            {entLabel}
          </Badge>
        </div>
      </Card>

      <div className="grid items-start gap-4 md:grid-cols-2">
        <Card className="p-4 md:p-6">
          <SectionLabel>Members</SectionLabel>
          {members.length === 0 ? (
            <p className="mt-3 text-sm text-ink-60">No members.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {members.map((m) => (
                <div key={m.key} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink-100">{m.name ?? m.email ?? '—'}</div>
                    {m.name && m.email ? (
                      <div className="truncate text-xs text-ink-60">{m.email}</div>
                    ) : null}
                  </div>
                  <Badge variant="muted" className="shrink-0">
                    {m.role}
                    {m.status === 'pending' ? ' · pending' : ''}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 md:p-6">
          <SectionLabel>Activity timeline</SectionLabel>
          {activityQ.isLoading ? (
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : activityQ.isError ? (
            <div className="mt-3">
              <ErrorCard message={activityQ.error?.message} onRetry={() => activityQ.refetch()} />
            </div>
          ) : (activityQ.data?.length ?? 0) === 0 ? (
            <p className="mt-3 text-sm text-ink-60">No activity yet for this brand.</p>
          ) : (
            <div className="mt-2 flex flex-col">
              {(activityQ.data ?? []).map((ev) => (
                <div
                  key={`${ev.type}-${ev.id}`}
                  className="flex items-start gap-2.5 border-b border-[color:var(--color-border-hairline)] py-2.5 last:border-0"
                >
                  {ev.type === 'review' ? (
                    <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-40" />
                  ) : (
                    <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-40" />
                  )}
                  <div className="min-w-0 text-sm">
                    {ev.type === 'review' ? (
                      <>
                        <span className="font-medium text-ink-100">
                          {ev.stars}★{' '}
                          {ev.submissionType === 'public' ? 'public review' : 'private feedback'}
                        </span>
                        <span className="text-ink-60"> · {ev.locationName}</span>
                        {ev.platform ? (
                          <Badge variant="muted" className="ml-1.5">
                            {ev.platform}
                          </Badge>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-ink-100">
                          {ACTION_LABEL[ev.action] ?? ev.action}
                        </span>
                        <span className="text-ink-60"> · by {ev.actorName ?? ev.actorEmail ?? 'admin'}</span>
                      </>
                    )}
                    <div className="text-xs text-ink-40">
                      {ev.createdAt ? formatDateTime(ev.createdAt) : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <div className="p-4">
          <SectionLabel>Locations</SectionLabel>
        </div>
        {locations.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-ink-60">This brand has no locations.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Reviews</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium text-ink-100">{l.name}</TableCell>
                  <TableCell className="font-mono text-xs text-ink-60">/r/{l.slug}</TableCell>
                  <TableCell>{formatNumber(l.reviewCount)}</TableCell>
                  <TableCell className="text-ink-60">
                    {l.createdAt ? formatDate(l.createdAt) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={l.deletedAt ? 'muted' : 'success'}>
                      {l.deletedAt ? 'Trash' : 'Live'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={purge.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Permanently delete location?',
                          description: (
                            <>
                              This hard-deletes{' '}
                              <span className="font-medium text-ink-100">{l.name}</span> and every
                              review captured for it. This cannot be undone.
                            </>
                          ),
                          confirmLabel: 'Purge location',
                          destructive: true,
                        });
                        if (ok) purge.mutate({ locationId: l.id });
                      }}
                    >
                      {purge.isPending && purge.variables?.locationId === l.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Purge
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ─── Industries ──────────────────────────────────────────────────────────────

function IndustriesSection() {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const industriesQ = useQuery(trpc.reviews.admin.listIndustries.queryOptions());
  const industries = industriesQ.data;

  const [editing, setEditing] = useState<{ slug: string; label: string; description: string } | null>(
    null,
  );
  const [presetSlug, setPresetSlug] = useState<string | null>(null);

  // Keep the customer-facing onboarding picker fresh in-session too.
  const invalidatePublicIndustries = () => {
    qc.invalidateQueries({ queryKey: trpc.reviews.industries.list.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.reviews.industries.tags.queryKey() });
  };

  const upsert = useMutation({
    ...trpc.reviews.admin.upsertIndustry.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.listIndustries.queryKey() });
      invalidatePublicIndustries();
      setEditing(null);
      toast.success('Industry saved.');
    },
    onError: (err) => toastError(err, "Couldn't save the industry."),
  });

  const archive = useMutation({
    ...trpc.reviews.admin.archiveIndustry.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.listIndustries.queryKey() });
      invalidatePublicIndustries();
      toast.success('Industry updated.');
    },
    onError: (err) => toastError(err, "Couldn't update the industry."),
  });

  return (
    <>
      <Card className="p-0">
        <div className="flex items-center justify-between gap-3 p-4">
          <SectionLabel>Industries</SectionLabel>
          <Button
            variant="accent"
            size="sm"
            onClick={() => setEditing({ slug: '', label: '', description: '' })}
          >
            <Plus className="h-3.5 w-3.5" /> New industry
          </Button>
        </div>
        {industriesQ.isLoading ? (
          <SkeletonRows />
        ) : industriesQ.isError ? (
          <div className="p-4 pt-0">
            <ErrorCard message={industriesQ.error?.message} onRetry={() => industriesQ.refetch()} />
          </div>
        ) : (industries?.length ?? 0) === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState
              icon={Tags}
              title="No industries yet"
              description="Create the industries brands can pick from during onboarding."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slug</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(industries ?? []).map((i) => (
                <TableRow key={i.slug}>
                  <TableCell className="font-mono text-xs text-ink-60">{i.slug}</TableCell>
                  <TableCell className="font-medium text-ink-100">{i.label}</TableCell>
                  <TableCell>
                    <Badge variant={i.isActive ? 'success' : 'muted'}>
                      {i.isActive ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            slug: i.slug,
                            label: i.label,
                            description: i.description ?? '',
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setPresetSlug(i.slug)}>
                        Tags
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={archive.isPending}
                        onClick={() => archive.mutate({ slug: i.slug, isActive: !i.isActive })}
                      >
                        {i.isActive ? 'Archive' : 'Restore'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing ? (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing.slug ? 'Edit industry' : 'New industry'}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ind-slug">Slug</Label>
                <Input
                  id="ind-slug"
                  className="font-mono"
                  value={editing.slug}
                  disabled={!!industries?.some((i) => i.slug === editing.slug)}
                  placeholder="cafe"
                  onChange={(e) => setEditing((s) => (s ? { ...s, slug: e.target.value } : s))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ind-label">Label</Label>
                <Input
                  id="ind-label"
                  value={editing.label}
                  placeholder="Café"
                  onChange={(e) => setEditing((s) => (s ? { ...s, label: e.target.value } : s))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ind-desc">Description</Label>
                <textarea
                  id="ind-desc"
                  className="flex min-h-20 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing((s) => (s ? { ...s, description: e.target.value } : s))
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                variant="accent"
                disabled={!editing.slug.trim() || !editing.label.trim() || upsert.isPending}
                onClick={() =>
                  upsert.mutate({
                    slug: editing.slug.trim(),
                    label: editing.label.trim(),
                    description: editing.description.trim() || undefined,
                  })
                }
              >
                Save industry
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>

      {presetSlug ? (
        <TagPresetModal slug={presetSlug} onClose={() => setPresetSlug(null)} />
      ) : null}
    </>
  );
}

function TagPresetModal({ slug, onClose }: { slug: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.reviews.admin.getTagPresets.queryOptions({ slug }));
  const [text, setText] = useState<string | null>(null);

  const value = text ?? (data ? data.join('\n') : '');

  const save = useMutation({
    ...trpc.reviews.admin.setTagPresets.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.getTagPresets.queryKey() });
      // The onboarding picker consumes these too — refresh it in-session.
      qc.invalidateQueries({ queryKey: trpc.reviews.industries.tags.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.reviews.industries.list.queryKey() });
      toast.success('Tag presets saved.');
      onClose();
    },
    onError: (err) => toastError(err, "Couldn't save tag presets."),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tag presets · {slug}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tag-presets">Tags (one per line)</Label>
            <textarea
              id="tag-presets"
              className="flex min-h-44 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
              value={value}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={save.isPending || isLoading}
            onClick={() =>
              save.mutate({
                slug,
                tags: value
                  .split('\n')
                  .map((t) => t.trim())
                  .filter(Boolean),
              })
            }
          >
            Save presets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rewards ─────────────────────────────────────────────────────────────────

function formatAddress(a: {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postcode: string;
  country: string;
  phone?: string;
} | null): string | null {
  if (!a?.line1) return null;
  return [
    a.name,
    a.line1,
    a.line2,
    `${a.city}${a.state ? ` ${a.state}` : ''} ${a.postcode}`,
    a.country,
    a.phone ? `☎ ${a.phone}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function RewardsSection() {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const rewardsQ = useQuery(trpc.reviews.admin.listClaimedRewards.queryOptions());
  const [shipping, setShipping] = useState<string | null>(null);
  const [tracking, setTracking] = useState('');

  const markShipped = useMutation({
    ...trpc.reviews.admin.markRewardShipped.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.listClaimedRewards.queryKey() });
      setShipping(null);
      setTracking('');
      toast.success('Marked as shipped.');
    },
    onError: (err) => toastError(err, "Couldn't mark as shipped."),
  });
  const markDelivered = useMutation({
    ...trpc.reviews.admin.markRewardDelivered.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.reviews.admin.listClaimedRewards.queryKey() });
      toast.success('Marked as delivered.');
    },
    onError: (err) => toastError(err, "Couldn't mark as delivered."),
  });

  const rewardStatusVariant = (status: string) =>
    status === 'delivered' ? 'success' : status === 'shipped' ? 'accent' : 'warn';

  return (
    <>
      <Card className="p-0">
        <div className="p-4">
          <SectionLabel>Sticker packs & plaques</SectionLabel>
        </div>
        {rewardsQ.isLoading ? (
          <SkeletonRows />
        ) : rewardsQ.isError ? (
          <div className="p-4 pt-0">
            <ErrorCard message={rewardsQ.error?.message} onRetry={() => rewardsQ.refetch()} />
          </div>
        ) : (rewardsQ.data?.length ?? 0) === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState
              icon={Gift}
              title="Nothing to ship"
              description="Claimed milestone rewards land here for fulfilment."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand</TableHead>
                <TableHead>Reviews</TableHead>
                <TableHead>Reward</TableHead>
                <TableHead>Ship to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Claimed</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rewardsQ.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-ink-100">{r.brandName}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-ink-60">
                    {formatNumber(r.reviewCount)}
                    {r.avgRating != null ? <span> · {r.avgRating.toFixed(1)}★ avg</span> : null}
                  </TableCell>
                  <TableCell className="capitalize">{r.kind.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="max-w-[260px] whitespace-normal text-sm text-ink-60">
                    {formatAddress(r.address) ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={rewardStatusVariant(r.status)} className="capitalize">
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-ink-60">
                    {r.claimedAt ? formatDate(r.claimedAt) : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-60">
                    {r.trackingNumber ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === 'claimed' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShipping(r.id);
                          setTracking('');
                        }}
                      >
                        Mark shipped
                      </Button>
                    ) : r.status === 'shipped' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={markDelivered.isPending}
                        onClick={() => markDelivered.mutate({ rewardId: r.id })}
                      >
                        {markDelivered.isPending && markDelivered.variables?.rewardId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : null}
                        Mark delivered
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!shipping} onOpenChange={(o) => !o && setShipping(null)}>
        {shipping ? (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Mark reward shipped</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tracking">Tracking number</Label>
              <Input
                id="tracking"
                value={tracking}
                autoFocus
                placeholder="Optional"
                onChange={(e) => setTracking(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShipping(null)}>
                Cancel
              </Button>
              <Button
                variant="accent"
                disabled={markShipped.isPending}
                onClick={() =>
                  markShipped.mutate({
                    rewardId: shipping,
                    trackingNumber: tracking.trim() || undefined,
                  })
                }
              >
                {markShipped.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Mark shipped
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

// ─── Audit log ───────────────────────────────────────────────────────────────

function AuditSection() {
  const trpc = useTRPC();
  const auditQ = useQuery(trpc.reviews.admin.auditLog.queryOptions({ limit: 200 }));

  return (
    <Card className="p-0">
      <div className="p-4">
        <SectionLabel>Audit log</SectionLabel>
        <p className="mt-1 text-sm text-ink-60">Every admin action recorded — last 200 events.</p>
      </div>
      {auditQ.isLoading ? (
        <SkeletonRows />
      ) : auditQ.isError ? (
        <div className="p-4 pt-0">
          <ErrorCard message={auditQ.error?.message} onRetry={() => auditQ.refetch()} />
        </div>
      ) : (auditQ.data?.length ?? 0) === 0 ? (
        <div className="p-4 pt-0">
          <EmptyState
            icon={ScrollText}
            title="No admin actions yet"
            description="Industry edits, purges and reward shipments will be recorded here."
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(auditQ.data ?? []).map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-ink-60">
                  {row.createdAt ? formatDateTime(row.createdAt) : '—'}
                </TableCell>
                <TableCell>
                  <div className="font-medium text-ink-100">
                    {row.actorName ?? row.actorEmail ?? '—'}
                  </div>
                  {row.actorName && row.actorEmail ? (
                    <div className="text-xs text-ink-60">{row.actorEmail}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant="muted">{ACTION_LABEL[row.action] ?? row.action}</Badge>
                  {row.meta ? (
                    <div className="mt-1 font-mono text-[0.6875rem] text-ink-40">
                      {JSON.stringify(row.meta)}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs text-ink-60">
                  {row.targetType ? `${row.targetType} · ${row.targetId ?? ''}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
