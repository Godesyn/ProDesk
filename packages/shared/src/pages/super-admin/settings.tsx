import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, CreditCard, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { SectionCard, Switch } from './components';
import { formatNumber, toNumberInput } from '../../lib/utils';

interface PaymentPlan {
  id?: string;
  name: string;
  upfrontPercentage: number;
  interestRate: number;
  durationWeeks: number;
  isActive: boolean;
}

const COMMISSIONS = [
  { key: 'prodeskCommission', label: 'Prodesk Commission (%)' },
  { key: 'affiliateCommission', label: 'Affiliate Commission (%)' },
  { key: 'agencyCommission', label: 'Agency Commission (%)' },
  { key: 'salesAgencyCommission', label: 'Sales Agency Commission (%)' },
] as const;

type CommissionKey = (typeof COMMISSIONS)[number]['key'];

function CommissionField({ label, value, current, onChange }: { label: string; value: string; current: number; onChange: (v: string) => void }) {
  return (
    <div className="w-[250px]">
      <Label className="mb-1 block">{label}</Label>
      <div className="relative">
        <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="pr-7" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-40">%</span>
      </div>
      <p className="mt-1 text-xs text-ink-60">Current: {current}%</p>
    </div>
  );
}

export function GlobalSettingsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const settings = useQuery(trpc.superAdmin.getSettings.queryOptions());

  const [form, setForm] = useState<Record<CommissionKey, string>>({
    prodeskCommission: '',
    affiliateCommission: '',
    agencyCommission: '',
    salesAgencyCommission: '',
  });
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && settings.data) {
      const s = settings.data;
      setForm({
        prodeskCommission: s.prodeskCommission ?? '0',
        affiliateCommission: s.affiliateCommission ?? '0',
        agencyCommission: s.agencyCommission ?? '0',
        salesAgencyCommission: s.salesAgencyCommission ?? '0',
      });
      setPlans(((s.defaultPaymentPlans as PaymentPlan[]) ?? []).map((p) => ({ ...p })));
      setInitialized(true);
    }
  }, [settings.data, initialized]);

  const save = useMutation({
    ...trpc.superAdmin.updateSettings.mutationOptions(),
    onSuccess: () => {
      toast.success('Settings saved successfully!');
      qc.invalidateQueries({ queryKey: trpc.superAdmin.getSettings.queryKey() });
    },
    onError: (e) => toastError(e),
  });

  const current = (key: CommissionKey) => Number(settings.data?.[key] ?? 0);

  function onSave() {
    save.mutate({
      prodeskCommission: Number(form.prodeskCommission) || 0,
      affiliateCommission: Number(form.affiliateCommission) || 0,
      agencyCommission: Number(form.agencyCommission) || 0,
      salesAgencyCommission: Number(form.salesAgencyCommission) || 0,
      defaultPaymentPlans: plans,
    });
  }

  function updatePlan(i: number, patch: Partial<PaymentPlan>) {
    setPlans((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPlan() {
    setPlans((prev) => [...prev, { id: crypto.randomUUID(), name: 'New Plan', upfrontPercentage: 20, interestRate: 10, durationWeeks: 12, isActive: true }]);
  }
  function removePlan(i: number) {
    setPlans((prev) => prev.filter((_, idx) => idx !== i));
  }

  if (settings.isLoading) {
    return (
      <div>
        <PageHeader title="Global Settings" description="Configure global commissions, payment plans, and agency options" />
        <div className="space-y-6">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Global Settings" description="Configure global commissions, payment plans, and agency options" />
      <div className="space-y-8">
        <SectionCard
          icon={<DollarSign className="h-5 w-5" />}
          title="Global Commissions"
          description="Define fixed commission percentages for the entire platform"
        >
          <div className="flex flex-wrap gap-6">
            {COMMISSIONS.map((c) => (
              <CommissionField
                key={c.key}
                label={c.label}
                value={form[c.key]}
                current={current(c.key)}
                onChange={(v) => setForm((f) => ({ ...f, [c.key]: v }))}
              />
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-60">
            Total must equal 100%. Currently:{' '}
            {formatNumber(COMMISSIONS.reduce((sum, c) => sum + (Number(form[c.key]) || 0), 0))}%
          </p>
        </SectionCard>

        <SectionCard
          icon={<CreditCard className="h-5 w-5" />}
          title="Default Payment Plans"
          description="Default payment plans available to all platforms"
          action={<Button variant="outline" size="sm" onClick={addPlan}><Plus className="h-4 w-4" /> Add Plan</Button>}
        >
          {plans.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-40">No payment plans configured</p>
          ) : (
            <div className="space-y-4">
              {plans.map((plan, i) => (
                <div key={plan.id ?? i} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset/40 p-5">
                  <div className="flex items-center gap-4">
                    <Input className="flex-1" placeholder="Plan Name" value={plan.name} onChange={(e) => updatePlan(i, { name: e.target.value })} />
                    <Switch checked={plan.isActive} onChange={(v) => updatePlan(i, { isActive: v })} />
                    <Button variant="ghost" size="icon" onClick={() => removePlan(i)}><Trash2 className="h-4 w-4 text-danger" /></Button>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[120px]">
                      <Label className="mb-1 block">Upfront %</Label>
                      <Input inputMode="decimal" value={toNumberInput(plan.upfrontPercentage)} onChange={(e) => updatePlan(i, { upfrontPercentage: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <Label className="mb-1 block">Duration (weeks)</Label>
                      <Input inputMode="numeric" value={toNumberInput(plan.durationWeeks)} onChange={(e) => updatePlan(i, { durationWeeks: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <Label className="mb-1 block">Interest Rate (%)</Label>
                      <Input inputMode="decimal" value={toNumberInput(plan.interestRate)} onChange={(e) => updatePlan(i, { interestRate: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <Button className="w-full" variant="accent" disabled={save.isPending} onClick={onSave}>
          {save.isPending ? 'Saving…' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}
