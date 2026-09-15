import { useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Building2, Plus, ExternalLink, Package as PackageIcon } from 'lucide-react';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useCurrentUser } from '../../auth/auth-context';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { BillingSidebar } from './billing-sidebar';
import { computeSubtotals, type BillingItem, type PaymentPlan } from './billing';
import { priceSummary } from '../marketplace/pricing';

type Phase = { id: string; name: string; sortOrder: number; startDelayDays: number | null };
type Item = {
  id: string; phaseId: string | null; type: 'service' | 'heading' | 'custom';
  description: string | null; headingText: string | null; amount: string; quantity: number;
  upfrontFee: string | null; isRecurring: boolean; isOptional: boolean;
  packageId: string | null; packageName: string | null; sortOrder: number;
};
type Doc = { id: string; url: string; fileName: string | null };

/** Display entries for a phase: standalone items, or runs of one package's items. */
type ItemEntry = { kind: 'item'; item: Item } | { kind: 'package'; packageId: string; name: string; items: Item[] };
function groupItemEntries(items: Item[]): ItemEntry[] {
  const entries: ItemEntry[] = [];
  let i = 0;
  while (i < items.length) {
    const pkgId = items[i].packageId;
    if (pkgId) {
      const group = [items[i]];
      let j = i + 1;
      while (j < items.length && items[j].packageId === pkgId) group.push(items[j++]);
      entries.push({ kind: 'package', packageId: pkgId, name: items[i].packageName || 'Package', items: group });
      i = j;
    } else {
      entries.push({ kind: 'item', item: items[i] });
      i++;
    }
  }
  return entries;
}

/** Read-only bundled package view (header: name · count · total), matching the email/PDF. */
function PackageGroupView({ name, count, total, children }: { name: string; count: number; total: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 bg-accent/[0.05] px-3 py-2">
        <PackageIcon className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-accent">{name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-40">{count} item{count !== 1 ? 's' : ''} · {formatCurrency(total)}</span>
      </div>
      <div className="divide-y divide-[color:var(--color-border-hairline)] border-t border-[color:var(--color-border-hairline)]">{children}</div>
    </div>
  );
}

/** Render a phase's items, grouping each package's items under one bundled header. */
function renderItemList(items: Item[]) {
  return (
    <div className="divide-y divide-[color:var(--color-border-hairline)] rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
      {groupItemEntries(items).map((e) =>
        e.kind === 'item' ? (
          <ReadonlyItemRow key={e.item.id} item={e.item} />
        ) : (
          <PackageGroupView key={e.items[0].id} name={e.name} count={e.items.length} total={e.items.reduce((s, it) => s + Number(it.amount) * it.quantity, 0)}>
            {e.items.map((it) => <ReadonlyItemRow key={it.id} item={it} />)}
          </PackageGroupView>
        ),
      )}
    </div>
  );
}

/**
 * Public, read-only proposal page opened from the "View & Accept Proposal" email
 * link (`/public/proposal/:token`). Renders the proposal without a session, then
 * adapts its call-to-action to the viewer:
 *   - signed out → sign up (claims the agency's referral brand) or log in;
 *   - signed in  → a chooser to claim the agency's brand, connect an existing
 *                  brand, or create a new one — then opens the proposal to accept.
 */
export function PublicProposalPage() {
  const [, params] = useRoute('/public/proposal/:token');
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const { openFile } = useFileViewer();
  const token = params?.token ?? '';
  const { isAuthenticated } = useCurrentUser();

  const q = useQuery({ ...trpc.proposals.publicByToken.queryOptions({ token }), enabled: !!token });
  const [chooserOpen, setChooserOpen] = useState(false);

  const phases = useMemo(() => ((q.data?.phases ?? []) as Phase[]).slice().sort((a, b) => a.sortOrder - b.sortOrder), [q.data]);
  const items = useMemo(() => ((q.data?.items ?? []) as unknown as Item[]).slice().sort((a, b) => a.sortOrder - b.sortOrder), [q.data]);

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center">
        <div>
          <p className="text-lg font-semibold text-ink-100">This proposal link is invalid or has expired.</p>
          <p className="mt-1 text-sm text-ink-60">Ask the agency to resend the proposal, or log in to view it.</p>
          <Button variant="accent" className="mt-4" onClick={() => (window.location.href = '/login')}>Go to login</Button>
        </div>
      </div>
    );
  }

  const p = q.data;
  const billingItems: BillingItem[] = items.map((i) => ({
    type: i.type, amount: i.amount, quantity: i.quantity, upfrontFee: i.upfrontFee, isRecurring: i.isRecurring, phaseId: i.phaseId, isExcludedByBrand: false,
  }));
  const subtotals = computeSubtotals(billingItems, true);
  const nonHeadingCount = items.filter((i) => i.type !== 'heading').length;
  const alreadyDecided = p.status === 'accepted' || p.status === 'rejected';

  // Signed-in viewers connect through the chooser; signed-out viewers go through
  // signup/login carrying the token so the proposal connects after verifying.
  const signupUrl = `/signup?invite=${encodeURIComponent(token)}`;
  const loginUrl = `/login?invite=${encodeURIComponent(token)}`;

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex h-16 items-center gap-3 border-b border-[color:var(--color-border-hairline)] bg-card/80 px-4 backdrop-blur md:px-8">
        <Avatar className="h-8 w-8">
          {p.agency?.logoUrl && <AvatarImage src={p.agency.logoUrl} />}
          <AvatarFallback>{(p.agency?.businessName ?? 'A')[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="font-medium text-ink-100">{p.agency?.businessName ?? 'Proposal'}</span>
        <Badge variant="outline" className="ml-auto">{p.status}</Badge>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-ink-40">
            Proposal #{p.invoiceNumber || p.id.slice(0, 8).toUpperCase()}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-ink-100">{p.title ?? 'Proposal'}</h1>
          <p className="mt-1 text-sm text-ink-60">
            For {p.brandName ?? 'you'} · {priceSummary(subtotals.oneOffSubtotal + subtotals.recurringUpfrontTotal, subtotals.recurringWeeklyTotal)}
            {p.expiresAt ? ` · Valid until ${formatDate(p.expiresAt)}` : ''}
          </p>
          {p.description && <p className="mt-3 max-w-2xl text-sm text-ink-80">{p.description}</p>}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Services & Line Items</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {items.length === 0 && <p className="text-sm text-ink-40">No items.</p>}
                {phases.map((phase) => {
                  const phaseItems = items.filter((i) => i.phaseId === phase.id || (phase.id === phases[0]?.id && i.phaseId === null));
                  if (phaseItems.length === 0) return null;
                  return (
                    <div key={phase.id}>
                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-ink-100">{phase.name}</h3>
                        {phase.startDelayDays != null && phase.startDelayDays > 0 && <Badge variant="muted">+{phase.startDelayDays}d</Badge>}
                      </div>
                      {renderItemList(phaseItems)}
                    </div>
                  );
                })}
                {phases.length === 0 && items.length > 0 && renderItemList(items)}
              </CardContent>
            </Card>

            {p.termsAndConditions && (
              <Card>
                <CardHeader><CardTitle>Terms & Conditions</CardTitle></CardHeader>
                <CardContent><pre className="whitespace-pre-wrap font-sans text-sm text-ink-80">{p.termsAndConditions}</pre></CardContent>
              </Card>
            )}

            {((p.documents ?? []) as Doc[]).length > 0 && (
              <Card>
                <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {(p.documents as Doc[]).map((d) => (
                    <button key={d.id} type="button" onClick={() => openFile({ url: d.url, title: d.fileName ?? d.url })} className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] bg-inset/40 px-2.5 py-1.5 text-left text-sm text-ink-80 hover:text-ink-100">
                      <FileText className="h-4 w-4 text-ink-40" /> {d.fileName ?? d.url}
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <BillingSidebar
              brandName={p.brandName}
              itemCount={nonHeadingCount}
              validityDays={p.validityDays}
              subtotals={subtotals}
              items={billingItems}
              phases={phases}
              isBrandView
              initialPlan={p.selectedPaymentPlan as PaymentPlan | null}
            />

            {alreadyDecided ? (
              <div className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-inset/40 p-3 text-center text-sm text-ink-60">
                This proposal has already been {p.status}.
                {isAuthenticated && (
                  <Button variant="outline" className="mt-2 w-full" onClick={() => setChooserOpen(true)}>Open proposal</Button>
                )}
              </div>
            ) : isAuthenticated ? (
              <Button variant="accent" className="w-full" onClick={() => setChooserOpen(true)}>
                <Check className="h-4 w-4" /> Review & accept
              </Button>
            ) : (
              <div className="space-y-2">
                <a href={signupUrl} className="block">
                  <Button variant="accent" className="w-full"><Check className="h-4 w-4" /> Sign up & accept</Button>
                </a>
                <a href={loginUrl} className="block text-center text-sm text-ink-60 hover:text-ink-100">
                  Already have an account? Log in to accept
                </a>
              </div>
            )}
          </div>
        </div>
      </main>

      {isAuthenticated && (
        <ConnectChooser
          open={chooserOpen}
          onOpenChange={setChooserOpen}
          token={token}
          brandName={p.brandName}
          brandClaimable={p.brandClaimable}
          onConnected={(proposalId) => navigate(`/proposal/${proposalId}`)}
        />
      )}
    </div>
  );
}

function ReadonlyItemRow({ item }: { item: Item }) {
  if (item.type === 'heading') {
    return <div className="bg-inset/30 px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-60">{item.headingText}</div>;
  }
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink-100">{item.description ?? '—'}</div>
        <div className="mt-0.5 flex items-center gap-2">
          {item.isRecurring && <Badge variant="accent">Weekly</Badge>}
          {item.isOptional && <Badge variant="outline">Optional</Badge>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tabular-nums text-sm text-ink-100">
          {item.isRecurring
            ? priceSummary(Number(item.upfrontFee ?? 0) * item.quantity, Number(item.amount) * item.quantity)
            : formatCurrency(Number(item.amount) * item.quantity)}
        </div>
        {item.quantity > 1 && (
          <div className="text-[11px] text-ink-40">
            {item.quantity} × {formatCurrency(item.amount)}{item.isRecurring ? ' per week' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

/** Brand chooser for a signed-in recipient: claim the agency's brand, connect an existing one, or create a new one. */
function ConnectChooser({ open, onOpenChange, token, brandName, brandClaimable, onConnected }: {
  open: boolean; onOpenChange: (v: boolean) => void; token: string;
  brandName: string | null; brandClaimable: boolean; onConnected: (proposalId: string) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const myBrands = useQuery({ ...trpc.brands.mine.queryOptions(), enabled: open });
  const connect = useMutation({
    ...trpc.proposals.connectViaToken.mutationOptions(),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
      onConnected(res.proposalId);
    },
    onError: (e) => toastError(e),
  });
  const busy = connect.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Connect this proposal to a brand</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {brandClaimable && (
            <button
              disabled={busy}
              onClick={() => connect.mutate({ token, mode: 'claim' })}
              className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-accent/40 bg-accent/5 p-3 text-left hover:bg-accent/10 disabled:opacity-50"
            >
              <Building2 className="h-5 w-5 text-accent" />
              <div>
                <div className="text-sm font-semibold text-ink-100">Use {brandName ?? 'the brand the agency set up'}</div>
                <div className="text-xs text-ink-60">Claim the brand this proposal was sent to.</div>
              </div>
            </button>
          )}

          {(myBrands.data ?? []).length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-40">Your brands</div>
              <div className="space-y-1.5">
                {(myBrands.data ?? []).map((b) => (
                  <button
                    key={b.id}
                    disabled={busy}
                    onClick={() => connect.mutate({ token, mode: 'existing', brandId: b.id })}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-3 text-left hover:bg-inset disabled:opacity-50"
                  >
                    <Avatar className="h-7 w-7">
                      {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                      <AvatarFallback>{b.businessName[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-ink-100">{b.businessName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <a
            href={`/create-brand?proposalToken=${encodeURIComponent(token)}`}
            className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border-default)] p-3 text-left hover:bg-inset"
          >
            <Plus className="h-5 w-5 text-ink-60" />
            <div className="text-sm font-medium text-ink-100">Create a new brand</div>
            <ExternalLink className="ml-auto h-4 w-4 text-ink-40" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
