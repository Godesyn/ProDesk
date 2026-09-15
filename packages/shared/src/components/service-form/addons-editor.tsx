import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Field } from '../../pages/agency/form-bits';
import { SectionHeader, MoneyInput } from './section-header';
import { type ServiceAddon, rid } from './types';
import { toNumberInput, formatNumber } from '../../lib/utils';

/**
 * Extra Add-ons section (ports `_buildAddonsSection`, service_addon_dialog).
 * Recurring billing shows Upfront + Weekly differences; one-off shows a single
 * Price Difference.
 */
export function AddonsEditor({
  addons,
  onChange,
  isBillingRecurring,
}: {
  addons: ServiceAddon[];
  onChange: (next: ServiceAddon[]) => void;
  isBillingRecurring: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceAddon | null>(null);

  const fmt = (n: number) => `${n >= 0 ? '+' : '-'}$${formatNumber(Math.abs(n))}`;

  function save(addon: ServiceAddon) {
    const idx = addons.findIndex((a) => a.id === addon.id);
    onChange(idx === -1 ? [...addons, addon] : addons.map((a) => (a.id === addon.id ? addon : a)));
    setOpen(false);
    setEditing(null);
  }

  return (
    <div>
      <SectionHeader title="Extra Add-ons" subtitle="Offer optional upgrades or extras that buyers can add to this service." />
      {addons.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-default)]">
          {addons.map((a, i) => (
            <div key={a.id} className={i > 0 ? 'flex items-center justify-between border-t border-[color:var(--color-border-default)] px-4 py-2.5' : 'flex items-center justify-between px-4 py-2.5'}>
              <div>
                <div className="text-sm font-semibold text-ink-100">{a.name}</div>
                <div className="text-[13px] text-ink-60">
                  {isBillingRecurring ? `${fmt(a.recurringUpfrontDifference)} upfront / ${fmt(a.recurringWeeklyDifference)} wk` : fmt(a.oneOffUpfrontDifference)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setEditing(a); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => onChange(addons.filter((x) => x.id !== a.id))}><Trash2 className="h-4 w-4 text-danger" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" className="w-full" onClick={() => { setEditing(null); setOpen(true); }}>
        <Plus className="h-4 w-4" /> Add Service Add-on
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        {open && <AddonDialog initial={editing} isBillingRecurring={isBillingRecurring} onSave={save} />}
      </Dialog>
    </div>
  );
}

function AddonDialog({ initial, isBillingRecurring, onSave }: { initial: ServiceAddon | null; isBillingRecurring: boolean; onSave: (a: ServiceAddon) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [oneOff, setOneOff] = useState(toNumberInput(initial?.oneOffUpfrontDifference ?? 0));
  const [recUpfront, setRecUpfront] = useState(toNumberInput(initial?.recurringUpfrontDifference ?? 0));
  const [recWeekly, setRecWeekly] = useState(toNumberInput(initial?.recurringWeeklyDifference ?? 0));
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setErr('Add-on name is required');
    onSave({
      id: initial?.id ?? rid(),
      name: name.trim(),
      oneOffUpfrontDifference: Number(oneOff) || 0,
      recurringUpfrontDifference: Number(recUpfront) || 0,
      recurringWeeklyDifference: Number(recWeekly) || 0,
    });
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit Add-on' : 'Add Add-on'}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label="Name" error={err}>
          <Input value={name} placeholder="e.g. Express Delivery, Source Files" onChange={(e) => setName(e.target.value)} />
        </Field>
        {isBillingRecurring ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Upfront Difference">
              <MoneyInput value={recUpfront} onChange={setRecUpfront} signed />
            </Field>
            <Field label="Weekly Difference">
              <MoneyInput value={recWeekly} onChange={setRecWeekly} signed />
            </Field>
          </div>
        ) : (
          <Field label="Price Difference">
            <MoneyInput value={oneOff} onChange={setOneOff} signed />
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button variant="accent" onClick={submit}>Save Add-on</Button>
      </DialogFooter>
    </DialogContent>
  );
}
