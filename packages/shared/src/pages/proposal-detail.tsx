import { useEffect, useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, MessageSquare, Pencil, X, FileText, Download, Copy, Package as PackageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { formatCurrency, formatDate } from '../lib/utils';
import { printHtmlDocument } from '../lib/print';
import { PageHeader } from '../components/layout/page-header';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { BillingSidebar } from './proposals/billing-sidebar';
import { computeSubtotals, type BillingItem, type PaymentPlan } from './proposals/billing';
import { priceSummary } from './marketplace/pricing';
import { Textarea } from './proposals/ui';
import { useConfirm } from '../components/ui/confirm-dialog';
import { statusLabel } from '../lib/proposal-status';

type Phase = { id: string; name: string; sortOrder: number; startDelayDays: number | null };
type Item = {
  id: string; phaseId: string | null; type: 'service' | 'heading' | 'custom';
  description: string | null; headingText: string | null; amount: string; quantity: number;
  upfrontFee: string | null; isRecurring: boolean; isOptional: boolean;
  isExcludedByBrand: boolean; removalProposedByBrand: boolean; packageId: string | null; packageName: string | null; sortOrder: number;
};

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

export function ProposalDetailPage() {
  const [, params] = useRoute('/proposal/:id');
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { workspace } = useActiveContext();
  const id = params?.id;
  const isAgency = workspace === 'agency' || workspace === 'admin';

  const key = trpc.proposals.byId.queryKey({ id: id! });
  const q = useQuery({ ...trpc.proposals.byId.queryOptions({ id: id! }), enabled: !!id });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [comment, setComment] = useState('');
  // Brand negotiation: local exclusion/removal sets before submitting.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [proposedRemoval, setProposedRemoval] = useState<Set<string>>(new Set());
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeNote, setChangeNote] = useState('');
  // Selected payment plan from the billing sidebar (null = pay in full).
  const [selectedPaymentPlan, setSelectedPaymentPlan] = useState<PaymentPlan | null>(null);

  const markViewed = useMutation(trpc.proposals.markViewed.mutationOptions());
  const respond = useMutation({ ...trpc.proposals.respond.mutationOptions(), onSuccess: () => { invalidate(); }, onError: (e) => toastError(e) });
  const resend = useMutation({ ...trpc.proposals.resend.mutationOptions(), onSuccess: () => { toast.success('Resent to client'); invalidate(); }, onError: (e) => toastError(e) });
  const duplicate = useMutation({
    ...trpc.proposals.duplicate.mutationOptions(),
    onSuccess: (copy) => { toast.success('Proposal duplicated'); navigate(`/proposal/${copy.id}/edit`); },
    onError: (e) => toastError(e),
  });
  const addComment = useMutation({ ...trpc.proposals.addComment.mutationOptions(), onSuccess: () => { setComment(''); invalidate(); } });
  // "Download PDF" — render the EXACT proposal email (proposals.pdf reuses the
  // email template) in a print window so the saved PDF matches what the client
  // receives, with a working "View & Accept" link.
  const pdf = useMutation({
    ...trpc.proposals.pdf.mutationOptions(),
    onSuccess: (res) => printHtmlDocument(res.html),
    onError: (e) => toastError(e),
  });
  // Persist the brand's instalment choice so it survives refresh and is carried
  // into the purchase (proposals.selectedPaymentPlan).
  const setPlan = useMutation(trpc.proposals.setPaymentPlan.mutationOptions());
  // Accepting a proposal creates its pending purchase, then starts checkout and
  // redirects to Stripe; the proposal only flips to `accepted` once payment
  // succeeds. `convertToPurchase` returns the purchase (no URL), so we chain
  // `checkoutPurchase` to obtain the hosted checkout URL.
  const startCheckout = useMutation({
    ...trpc.purchases.checkoutPurchase.mutationOptions(),
    onError: (e) => toastError(e),
  });
  const convert = useMutation({
    ...trpc.proposals.convertToPurchase.mutationOptions(),
    onError: (e) => toastError(e),
  });

  const p = q.data;
  const status = p?.status;
  const brandEditable = !isAgency && (status === 'sent' || status === 'viewed');

  // Auto mark-as-viewed when a brand opens a sent proposal.
  useEffect(() => {
    if (p && !isAgency && status === 'sent' && id) markViewed.mutate({ id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, status, isAgency]);

  const phases = useMemo(() => ((p?.phases ?? []) as Phase[]).slice().sort((a, b) => a.sortOrder - b.sortOrder), [p]);
  const items = useMemo(() => ((p?.items ?? []) as unknown as Item[]).slice().sort((a, b) => a.sortOrder - b.sortOrder), [p]);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!p) return <p className="text-ink-60">Proposal not found.</p>;

  // Editable view: reflect local exclusions on top of stored flags for the sidebar total.
  const effectiveItems: BillingItem[] = items.map((i) => ({
    type: i.type, amount: i.amount, quantity: i.quantity, upfrontFee: i.upfrontFee, isRecurring: i.isRecurring, phaseId: i.phaseId,
    isExcludedByBrand: brandEditable ? excluded.has(i.id) : i.isExcludedByBrand,
  }));
  const subtotals = computeSubtotals(effectiveItems, true);
  const nonHeadingCount = items.filter((i) => i.type !== 'heading').length;
  const hasRemovalProposals = proposedRemoval.size > 0;

  const toggleExclusion = (item: Item) => {
    if (!brandEditable || !item.isOptional) return;
    setExcluded((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
  };
  const toggleRemoval = (item: Item) => {
    if (!brandEditable || item.isOptional) return;
    setProposedRemoval((prev) => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; });
  };

  // Render a phase's items, grouping any package's items under a single bundled
  // header (matching the proposal email / PDF) instead of listing them loose.
  const renderItemRow = (item: Item, inPackage = false) => (
    <ItemRow
      key={item.id}
      item={item}
      inPackage={inPackage}
      brandEditable={brandEditable}
      excluded={excluded.has(item.id)}
      proposedRemoval={proposedRemoval.has(item.id)}
      onToggleExclusion={() => toggleExclusion(item)}
      onToggleRemoval={() => toggleRemoval(item)}
    />
  );
  const renderItemList = (list: Item[]) => (
    <div className="divide-y divide-[color:var(--color-border-hairline)] rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
      {groupItemEntries(list).map((e) =>
        e.kind === 'item' ? (
          renderItemRow(e.item)
        ) : (
          <PackageGroupView
            key={e.items[0].id}
            name={e.name}
            count={e.items.length}
            total={e.items.reduce((s, it) => s + Number(it.amount) * it.quantity, 0)}
            allExcluded={e.items.every((it) => excluded.has(it.id))}
          >
            {e.items.map((it) => renderItemRow(it, true))}
          </PackageGroupView>
        ),
      )}
    </div>
  );

  const accept = async () => {
    const ok = await confirm({
      title: 'Accept proposal',
      description: excluded.size
        ? 'Accept your selected items and proceed to payment?'
        : 'Accept this proposal and proceed to payment?',
      confirmLabel: 'Accept & pay',
    });
    if (!ok) return;
    // Acceptance is recorded on payment: build the purchase, start checkout, then
    // redirect this tab to the hosted Stripe Checkout. (No reserved tab — the
    // confirm + two async mutations would get a pre-opened popup blocked, and a
    // blank tab would linger; a same-tab redirect is the standard Stripe flow and
    // `/payment-success` & `/payment-cancel` bring the buyer back.)
    convert.mutate(
      {
        id: p.id,
        excludedItemIds: [...excluded],
        selectedPaymentPlan: (selectedPaymentPlan ?? (p.selectedPaymentPlan as PaymentPlan | null)) ?? undefined,
      },
      {
        onSuccess: (purchase) => {
           startCheckout.mutate(
            {
              id: purchase.id,
              successUrl: `${window.location.origin}/payment-success`,
              cancelUrl: `${window.location.origin}/payment-cancel`,
            },
            {
              onSuccess: (res) => {
                const url = (res as { checkoutUrl?: string | null }).checkoutUrl;
                // Stripe configured → hosted checkout; dev (no Stripe) fulfils
                // immediately and returns no URL, so go straight to success.
                if (url) window.location.href = url;
                else navigate(`/payment-success?purchaseId=${purchase.id}`);
              },
            },
          );
        },
      },
    );
  };
  const decline = async () => {
    const ok = await confirm({
      title: 'Decline proposal',
      description: 'Are you sure you want to decline this proposal? This cannot be undone.',
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;
    respond.mutate({ id: p.id, action: 'reject' }, { onSuccess: () => { toast.success('Proposal declined'); } });
  };
  const submitChanges = () => {
    respond.mutate(
      { id: p.id, action: 'requestChange', note: changeNote || undefined, removalProposedItemIds: [...proposedRemoval] },
      { onSuccess: () => { toast.success('Change request sent'); setChangeOpen(false); setChangeNote(''); } },
    );
  };

  return (
    <div>
      <button onClick={() => navigate('/proposals')} className="mb-4 flex items-center gap-1 text-sm text-ink-60 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> Proposals
      </button>
      <PageHeader
        title={p.title ?? 'Untitled proposal'}
        description={`Total ${priceSummary(subtotals.oneOffSubtotal + subtotals.recurringUpfrontTotal, subtotals.recurringWeeklyTotal)}${p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}`}
        action={
          // On mobile the labelled buttons overflow, so collapse them to icon-only
          // squares (text hidden) and let the row wrap; full text returns at md.
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{statusLabel(p.status, isAgency)}</Badge>
            <Button variant="ghost" className="max-md:w-10 max-md:px-0" disabled={pdf.isPending} onClick={() => pdf.mutate({ id: p.id })}><Download className="h-4 w-4" /> <span className="max-md:hidden">PDF</span></Button>
            {isAgency && <Button variant="ghost" className="max-md:w-10 max-md:px-0" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ id: p.id })}><Copy className="h-4 w-4" /> <span className="max-md:hidden">Duplicate</span></Button>}
            {isAgency && p.status === 'draft' && <Button variant="accent" className="max-md:w-10 max-md:px-0" onClick={() => navigate(`/proposal/${p.id}/edit`)}><Pencil className="h-4 w-4" /> <span className="max-md:hidden">Edit</span></Button>}
            {isAgency && p.status === 'changeRequested' && <Button variant="accent" className="max-md:w-10 max-md:px-0" onClick={() => navigate(`/proposal/${p.id}/edit`)}><Pencil className="h-4 w-4" /> <span className="max-md:hidden">Edit & resend</span></Button>}
          </div>
        }
      />

      {p.status === 'changeRequested' && p.changeRequestNote && (
        <div className="mb-4 rounded-[var(--radius-sm)] border border-warn/35 bg-warn/10 p-3 text-sm text-ink-80 break-words">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-warn">{isAgency ? 'Changes requested by client' : 'Changes you requested'}</span>
            {isAgency && <Button size="sm" variant="outline" onClick={() => resend.mutate({ id: p.id })}>Resend as-is</Button>}
          </div>
          {p.changeRequestNote}
        </div>
      )}

      {/* `grid-cols-1` (= minmax(0,1fr)) on mobile is load-bearing: a bare `grid`
          gives an implicit `auto` column that grows to its widest descendant
          (grid items default to min-width:auto), so any long string stretched the
          whole column past the viewport. The explicit 0-min column shrinks to fit. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {/* Items grouped by phase */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Services & Line Items</CardTitle>
              {brandEditable && <p className="text-xs text-ink-40">Toggle off optional items or propose removal of others.</p>}
            </CardHeader>
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
              <CardContent><pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink-80">{p.termsAndConditions}</pre></CardContent>
            </Card>
          )}

          {(p.documents ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Attachments</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(p.documents as { id: string; url: string; fileName: string | null }[]).map((d) => (
                  <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-inset/40 px-2.5 py-1.5 text-sm text-ink-80 hover:text-ink-100">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-40" />
                    {/* min-w-0 + break-all so a long UUID filename wraps instead of
                        forcing the whole page to scroll sideways on a phone. */}
                    <span className="min-w-0 break-all">{d.fileName ?? d.url}</span>
                  </a>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Discussion */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Discussion</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
                {(p.comments ?? []).length === 0 && <p className="text-sm text-ink-40">No comments yet.</p>}
                {(p.comments as { id: string; authorName: string | null; authorRole: string | null; message: string; createdAt: string | Date }[]).map((c) => (
                  <div key={c.id} className="rounded-[var(--radius-sm)] bg-inset/60 p-2.5 text-sm break-words">
                    <div className="mb-0.5 text-xs font-medium text-ink-40">{c.authorName} · {c.authorRole} · {formatDate(c.createdAt)}</div>
                    {c.message}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button variant="outline" disabled={!comment} onClick={() => addComment.mutate({ proposalId: p.id, message: comment, authorRole: isAgency ? 'agency' : 'brand' })}>Send</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <BillingSidebar
            brandName={(p.brandSnapshot as { name?: string } | null)?.name ?? null}
            itemCount={nonHeadingCount}
            validityDays={p.validityDays}
            subtotals={subtotals}
            items={effectiveItems}
            phases={phases}
            excludeBrandExcluded
            sellingOwnServices={!(p as { createdBySalesAgencyId?: string | null }).createdBySalesAgencyId}
            salesMode={!!(p as { createdBySalesAgencyId?: string | null }).createdBySalesAgencyId}
            ownAgencyId={(p as { agencyId?: string | null }).agencyId}
            isBrandView={!isAgency}
            initialPlan={p.selectedPaymentPlan as PaymentPlan | null}
            onPlanChange={(plan) => {
              setSelectedPaymentPlan(plan);
              // Persist the choice (brand reviewing or agency building).
              if (id) setPlan.mutate({ id, selectedPaymentPlan: plan });
            }}
          />

          {brandEditable && (
            <div className="space-y-2">
              <Button variant="accent" className="w-full" disabled={respond.isPending || convert.isPending} onClick={accept}><Check className="h-4 w-4" /> Accept &amp; pay</Button>
              <Button variant="outline" className="w-full" disabled={respond.isPending} onClick={() => setChangeOpen(true)}>Request changes</Button>
              <Button variant="ghost" className="w-full" disabled={respond.isPending} onClick={decline}><X className="h-4 w-4" /> Decline</Button>
              {hasRemovalProposals && <p className="text-center text-[11px] text-warn">{proposedRemoval.size} removal(s) proposed — submit via Request changes.</p>}
            </div>
          )}
        </div>
      </div>

      {/* Request changes dialog */}
      <Dialog open={changeOpen} onOpenChange={setChangeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request changes</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-60">Tell the agency what you'd like changed. Any items you flagged for removal are included.</p>
          <Textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="Describe the changes you'd like…" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setChangeOpen(false)}>Cancel</Button>
            <Button variant="accent" disabled={respond.isPending || (!changeNote.trim() && !hasRemovalProposals)} onClick={submitChanges}>Send request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A package's items shown as one bundle (header: name · count · total), mirroring
 *  the proposal email/PDF so the brand and agency read it as a single offering. */
function PackageGroupView({ name, count, total, allExcluded, children }: {
  name: string; count: number; total: number; allExcluded: boolean; children: React.ReactNode;
}) {
  return (
    <div className={allExcluded ? 'opacity-60' : ''}>
      <div className="flex items-center gap-2 bg-accent/[0.05] px-3 py-2">
        <PackageIcon className="h-4 w-4 shrink-0 text-accent" />
        <span className={`min-w-0 flex-1 truncate text-sm font-semibold text-accent ${allExcluded ? 'line-through' : ''}`}>{name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-40">{count} item{count !== 1 ? 's' : ''} · {formatCurrency(total)}</span>
      </div>
      <div className="divide-y divide-[color:var(--color-border-hairline)] border-t border-[color:var(--color-border-hairline)]">
        {children}
      </div>
    </div>
  );
}

function ItemRow({ item, inPackage, brandEditable, excluded, proposedRemoval, onToggleExclusion, onToggleRemoval }: {
  item: Item; inPackage?: boolean; brandEditable: boolean; excluded: boolean; proposedRemoval: boolean;
  onToggleExclusion: () => void; onToggleRemoval: () => void;
}) {
  if (item.type === 'heading') {
    return <div className="bg-inset/30 px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink-60">{item.headingText}</div>;
  }
  const dimmed = excluded;
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${dimmed ? 'opacity-50' : ''}`}>
      {brandEditable && item.isOptional && (
        <input type="checkbox" checked={!excluded} onChange={onToggleExclusion} title="Include this optional item" />
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm text-ink-100 ${proposedRemoval ? 'line-through' : ''}`}>{item.description ?? '—'}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          {!inPackage && item.packageName && <Badge variant="muted">{item.packageName}</Badge>}
          {item.isRecurring && <Badge variant="accent">Weekly</Badge>}
          {item.isOptional && <Badge variant="outline">Optional</Badge>}
          {proposedRemoval && <Badge variant="warn">Removal proposed</Badge>}
          {brandEditable && !item.isOptional && (
            <button onClick={onToggleRemoval} className="text-[11px] text-ink-40 underline-offset-2 hover:text-warn hover:underline">
              {proposedRemoval ? 'Keep' : 'Propose removal'}
            </button>
          )}
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
