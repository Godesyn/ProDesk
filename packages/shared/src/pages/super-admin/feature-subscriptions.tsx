import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Plus, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { cn, formatCurrency } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Switch } from './components';

type Catalog = ReturnType<typeof useCatalog>['data'];
type Product = NonNullable<Catalog>[number];
type Tier = Product['tiers'][number];
type Price = Tier['prices'][number];

function useCatalog() {
  const trpc = useTRPC();
  return useQuery(trpc.featureSubscriptions.adminListProducts.queryOptions());
}

const fieldClass =
  'flex h-10 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm text-ink-100 outline-none focus:ring-2 focus:ring-[color:var(--color-accent-ring)]';

export function FeatureSubscriptionsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const list = useCatalog();
  const features = useQuery(trpc.featureSubscriptions.adminFeatureKeys.queryOptions());

  const [productDialog, setProductDialog] = useState<{ product?: Product } | null>(null);
  const [tierDialog, setTierDialog] = useState<{ productId: string; tier?: Tier } | null>(null);
  const [priceDialog, setPriceDialog] = useState<{ tierId: string; price?: Price } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.featureSubscriptions.adminListProducts.queryKey() });
  const onMut = {
    onSuccess: () => {
      toast.success('Saved');
      invalidate();
    },
    onError: (e: { message: string }) => toastError(e),
  };

  const setProductActive = useMutation({ ...trpc.featureSubscriptions.adminSetProductActive.mutationOptions(), ...onMut });
  const setTierActive = useMutation({ ...trpc.featureSubscriptions.adminSetTierActive.mutationOptions(), ...onMut });
  const setPriceActive = useMutation({ ...trpc.featureSubscriptions.adminSetPriceActive.mutationOptions(), ...onMut });

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const products = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Feature Subscriptions"
        description="Subscription products that unlock features. Manage tiers and monthly prices."
      />

      <div className="mb-4">
        <Button variant="accent" onClick={() => setProductDialog({})}>
          <Plus className="h-4 w-4" /> New product
        </Button>
      </div>

      {list.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : products.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-60">No feature subscriptions yet.</Card>
      ) : (
        <div className="space-y-3">
          {products.map((product) => {
            const open = expanded.has(product.id);
            return (
              <Card key={product.id} className="p-0">
                {/* Product header */}
                <div className="flex items-start gap-3 p-4">
                  <button onClick={() => toggleExpand(product.id)} className="mt-0.5 text-ink-40 hover:text-ink-100">
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/12 text-accent">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink-100">{product.name}</p>
                      <Badge variant="muted">{product.slug}</Badge>
                      {(product.featureKeys?.length ? product.featureKeys : [product.featureKey]).map((k) => (
                        <Badge key={k} variant="accent">{k}</Badge>
                      ))}
                      {!product.active && <Badge variant="danger">Inactive</Badge>}
                    </div>
                    {product.description && <p className="mt-0.5 text-sm text-ink-60">{product.description}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch checked={product.active} onChange={(v) => setProductActive.mutate({ id: product.id, active: v })} />
                    <Button variant="ghost" size="icon" onClick={() => setProductDialog({ product })} aria-label="Edit product">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Tiers + prices */}
                {open && (
                  <div className="border-t border-[color:var(--color-border-hairline)] bg-inset/30 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-40">Tiers</p>
                      <Button variant="outline" size="sm" onClick={() => setTierDialog({ productId: product.id })}>
                        <Plus className="h-3.5 w-3.5" /> Add tier
                      </Button>
                    </div>
                    {product.tiers.length === 0 ? (
                      <p className="py-2 text-sm text-ink-40">No tiers yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {product.tiers.map((tier) => (
                          <div key={tier.id} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-card p-3">
                            <div className="flex items-center gap-2">
                              <p className="flex-1 font-medium text-ink-100">
                                {tier.name}
                                {!tier.active && <Badge variant="danger" className="ml-2">Inactive</Badge>}
                              </p>
                              <Switch checked={tier.active} onChange={(v) => setTierActive.mutate({ id: tier.id, active: v })} />
                              <Button variant="ghost" size="icon" onClick={() => setTierDialog({ productId: product.id, tier })} aria-label="Edit tier">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {tier.prices.map((price) => (
                                <button
                                  key={price.id}
                                  onClick={() => setPriceDialog({ tierId: tier.id, price })}
                                  className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-inset',
                                    price.active
                                      ? 'border-accent/30 bg-accent/[0.06] text-ink-100'
                                      : 'border-[color:var(--color-border-default)] text-ink-40 line-through',
                                  )}
                                >
                                  <span className="font-medium">{formatCurrency(Number(price.amount))}</span>
                                  <span className="text-ink-40">/{price.interval === 'week' ? 'wk' : 'mo'}</span>
                                </button>
                              ))}
                              <Button variant="ghost" size="sm" onClick={() => setPriceDialog({ tierId: tier.id })}>
                                <Plus className="h-3.5 w-3.5" /> Add price
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {productDialog && (
        <ProductDialog
          product={productDialog.product}
          featureKeys={features.data ?? []}
          onClose={() => setProductDialog(null)}
          onSaved={() => {
            setProductDialog(null);
            invalidate();
          }}
        />
      )}
      {tierDialog && (
        <TierDialog
          productId={tierDialog.productId}
          tier={tierDialog.tier}
          onClose={() => setTierDialog(null)}
          onSaved={() => {
            setTierDialog(null);
            invalidate();
          }}
        />
      )}
      {priceDialog && (
        <PriceDialog
          tierId={priceDialog.tierId}
          price={priceDialog.price}
          onClose={() => setPriceDialog(null)}
          onSaved={() => {
            setPriceDialog(null);
            invalidate();
          }}
          onToggleActive={(id, active) => setPriceActive.mutate({ id, active })}
        />
      )}
    </div>
  );
}

/* ── Dialogs ─────────────────────────────────────────────────────────────────── */

function ProductDialog({
  product,
  featureKeys,
  onClose,
  onSaved,
}: {
  product?: Product;
  featureKeys: { key: string; label: string; gates: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const trpc = useTRPC();
  const editing = !!product;
  const [form, setForm] = useState({
    name: product?.name ?? '',
    slug: product?.slug ?? '',
    description: product?.description ?? '',
    cardTitle: product?.cardTitle ?? '',
    cardSubtitle: product?.cardSubtitle ?? '',
    cardDescription: product?.cardDescription ?? '',
    cardButtonLabel: product?.cardButtonLabel ?? '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Quantity-scaled billing: charge per unit (e.g. $1 per active short link)
  // instead of a flat fee. The unit count is resolved from the feature key.
  const [perUnit, setPerUnit] = useState<boolean>(product?.perUnit ?? false);

  // Features this single subscription unlocks (one subscription → many features).
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    product?.featureKeys?.length ? product.featureKeys : product?.featureKey ? [product.featureKey] : [],
  );
  const toggleKey = (key: string) =>
    setSelectedKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  const create = useMutation({ ...trpc.featureSubscriptions.adminCreateProduct.mutationOptions(), onSuccess: onSaved, onError: (e) => toastError(e) });
  const update = useMutation({ ...trpc.featureSubscriptions.adminUpdateProduct.mutationOptions(), onSuccess: onSaved, onError: (e) => toastError(e) });
  const pending = create.isPending || update.isPending;

  const submit = () => {
    if (editing) {
      const { slug: _slug, ...rest } = form;
      update.mutate({ id: product!.id, ...rest, perUnit, featureKeys: selectedKeys });
    } else {
      create.mutate({ ...form, perUnit, featureKeys: selectedKeys });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit product' : 'New feature subscription'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Growth Strategy" />
          </Field>
          {!editing && (
            <Field label="Slug" hint="Lowercase letters, numbers and dashes.">
              <Input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="growth-strategy" />
            </Field>
          )}
          <Field label="Features it unlocks" hint="One subscription can unlock multiple features — tick all that apply.">
            <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] p-2.5">
              {featureKeys.map((f) => (
                <label key={f.key} className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-inset">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-accent)]"
                    checked={selectedKeys.includes(f.key)}
                    onChange={() => toggleKey(f.key)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-ink-100">{f.label} <span className="text-ink-40">({f.key})</span></span>
                    <span className="block text-xs text-ink-40">{f.gates}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1 hover:bg-inset">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-[color:var(--color-accent)]"
              checked={perUnit}
              onChange={(e) => setPerUnit(e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block text-sm text-ink-100">Per-unit (quantity-scaled) billing</span>
              <span className="block text-xs text-ink-40">
                Charge the price × live unit count (e.g. $1 per active short link / month) instead of a flat fee.
              </span>
            </span>
          </label>

          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-40">Upsell card</p>
          <Field label="Card title">
            <Input value={form.cardTitle} onChange={(e) => set('cardTitle', e.target.value)} placeholder="New AI Growth Strategy" />
          </Field>
          <Field label="Card subtitle">
            <Input value={form.cardSubtitle} onChange={(e) => set('cardSubtitle', e.target.value)} placeholder="Get your growth strategy for {price} with AI" />
            <p className="mt-1 text-xs text-ink-40">
              Use <code>{'{price}'}</code> to insert the live price (e.g. $299/mo) — never type the amount, so it always matches the configured price.
            </p>
          </Field>
          <Field label="Card description">
            <textarea
              className={cn(fieldClass, 'h-20 py-2')}
              value={form.cardDescription}
              onChange={(e) => set('cardDescription', e.target.value)}
            />
          </Field>
          <Field label="Card button label">
            <Input value={form.cardButtonLabel} onChange={(e) => set('cardButtonLabel', e.target.value)} placeholder="Generate my strategy" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={pending || !form.name || (!editing && !form.slug) || selectedKeys.length === 0} onClick={submit}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TierDialog({ productId, tier, onClose, onSaved }: { productId: string; tier?: Tier; onClose: () => void; onSaved: () => void }) {
  const trpc = useTRPC();
  const editing = !!tier;
  const [name, setName] = useState(tier?.name ?? '');
  const [description, setDescription] = useState(tier?.description ?? '');
  const [features, setFeatures] = useState((tier?.features ?? []).join('\n'));

  const create = useMutation({ ...trpc.featureSubscriptions.adminCreateTier.mutationOptions(), onSuccess: onSaved, onError: (e) => toastError(e) });
  const update = useMutation({ ...trpc.featureSubscriptions.adminUpdateTier.mutationOptions(), onSuccess: onSaved, onError: (e) => toastError(e) });
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const feats = features.split('\n').map((s) => s.trim()).filter(Boolean);
    if (editing) update.mutate({ id: tier!.id, name, description, features: feats });
    else create.mutate({ productId, name, description, features: feats });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit tier' : 'New tier'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard" />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Features" hint="One per line.">
            <textarea className={cn(fieldClass, 'h-24 py-2')} value={features} onChange={(e) => setFeatures(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={pending || !name} onClick={submit}>{editing ? 'Save' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({
  tierId,
  price,
  onClose,
  onSaved,
  onToggleActive,
}: {
  tierId: string;
  price?: Price;
  onClose: () => void;
  onSaved: () => void;
  onToggleActive: (id: string, active: boolean) => void;
}) {
  const trpc = useTRPC();
  const editing = !!price;
  const [amount, setAmount] = useState(price ? String(Number(price.amount)) : '');
  // Weekly billing was retired — only monthly prices are offered now. Legacy
  // weekly prices still display (see the /wk suffix) but can't be created here.
  const [interval, setInterval] = useState<'week' | 'month'>(price?.interval ?? 'month');

  const create = useMutation({ ...trpc.featureSubscriptions.adminCreatePrice.mutationOptions(), onSuccess: onSaved, onError: (e) => toastError(e) });
  const update = useMutation({ ...trpc.featureSubscriptions.adminUpdatePrice.mutationOptions(), onSuccess: onSaved, onError: (e) => toastError(e) });
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (editing) update.mutate({ id: price!.id, amount: amt, interval });
    else create.mutate({ tierId, amount: amt, interval });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit price' : 'New price'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Amount (AUD)">
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="299.00" />
          </Field>
          <Field label="Billing interval">
            <div className="flex gap-2">
              {(['month'] as const).map((i) => (
                <button
                  key={i}
                  onClick={() => setInterval(i)}
                  className={cn(
                    'flex-1 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium transition-colors',
                    interval === i ? 'border-accent bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset',
                  )}
                >
                  Monthly
                </button>
              ))}
            </div>
          </Field>
          {editing && (
            <p className="text-xs text-ink-40">
              Changing the amount or interval replaces this price (Stripe prices are immutable); existing subscriptions keep their current price.
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button variant="outline" onClick={() => onToggleActive(price!.id, !price!.active)}>
              {price!.active ? 'Deactivate' : 'Activate'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="accent" disabled={pending || !amount} onClick={submit}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-ink-40">{hint}</p>}
    </div>
  );
}
