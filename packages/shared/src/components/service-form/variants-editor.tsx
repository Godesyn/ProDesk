import { useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Field } from '../../pages/agency/form-bits';
import { SectionHeader, MoneyInput } from './section-header';
import { formatNumber, toNumberInput } from '../../lib/utils';
import { type ServiceOption, type ServiceVariant, generateServiceVariants, rid } from './types';

/**
 * Product Options & Variants section (ports `_buildVariantsSection`,
 * service_option_dialog, service_variant_pricing_dialog). Options generate the
 * cartesian-product variants; the pricing dialog edits per-variant price diffs.
 */
export function VariantsEditor({
  options,
  variants,
  onOptions,
  onVariants,
  isBillingRecurring,
  basePrice,
  baseUpfrontFee,
  baseRecurringFee,
}: {
  options: ServiceOption[];
  variants: ServiceVariant[];
  onOptions: (o: ServiceOption[]) => void;
  onVariants: (v: ServiceVariant[]) => void;
  isBillingRecurring: boolean;
  basePrice: number;
  baseUpfrontFee: number;
  baseRecurringFee: number;
}) {
  const [optionOpen, setOptionOpen] = useState(false);
  const [editingOption, setEditingOption] = useState<{ option: ServiceOption; index: number } | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);

  function applyOptions(next: ServiceOption[]) {
    onOptions(next);
    onVariants(generateServiceVariants(next, variants));
  }

  function saveOption(option: ServiceOption) {
    if (editingOption) {
      const next = options.map((o, i) => (i === editingOption.index ? option : o));
      applyOptions(next);
    } else {
      applyOptions([...options, option]);
    }
    setOptionOpen(false);
    setEditingOption(null);
  }

  return (
    <div>
      <SectionHeader title="Product Options & Variants" subtitle="Provide different choices for this service (e.g. Size, Type) and adjust pricing per variant." />
      {options.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-default)]">
          {options.map((o, i) => (
            <div key={i} className={i > 0 ? 'flex items-center justify-between border-t border-[color:var(--color-border-default)] px-4 py-2.5' : 'flex items-center justify-between px-4 py-2.5'}>
              <div>
                <div className="text-sm font-semibold text-ink-100">{o.name}</div>
                <div className="text-[13px] text-ink-60">{o.choices.join(', ')}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setEditingOption({ option: o, index: i }); setOptionOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => applyOptions(options.filter((_, x) => x !== i))}><Trash2 className="h-4 w-4 text-danger" /></Button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-[color:var(--color-border-default)] px-4 py-3">
            <span className="text-[13px] text-ink-60">{variants.length} combinations generated</span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPricingOpen(true)}>Change Variant Pricing</Button>
          </div>
        </div>
      )}
      <Button type="button" variant="outline" className="w-full" onClick={() => { setEditingOption(null); setOptionOpen(true); }}>
        <Plus className="h-4 w-4" /> Add Option
      </Button>

      <Dialog open={optionOpen} onOpenChange={(o) => { setOptionOpen(o); if (!o) setEditingOption(null); }}>
        {optionOpen && <OptionDialog initial={editingOption?.option ?? null} onSave={saveOption} />}
      </Dialog>
      <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
        {pricingOpen && (
          <VariantPricingDialog
            variants={variants}
            isBillingRecurring={isBillingRecurring}
            basePrice={basePrice}
            baseUpfrontFee={baseUpfrontFee}
            baseRecurringFee={baseRecurringFee}
            onSave={(v) => { onVariants(v); setPricingOpen(false); }}
          />
        )}
      </Dialog>
    </div>
  );
}

function OptionDialog({ initial, onSave }: { initial: ServiceOption | null; onSave: (o: ServiceOption) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [choices, setChoices] = useState<string[]>(initial?.choices ?? []);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  function add() {
    const c = draft.trim();
    if (c && !choices.includes(c)) {
      setChoices([...choices, c]);
      setDraft('');
    }
  }
  function submit() {
    if (!name.trim()) return setErr('Option name is required');
    if (choices.length === 0) return setErr('Please add at least one choice.');
    onSave({ id: initial?.id ?? rid(), name: name.trim(), choices });
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit Service Option' : 'Add Service Option'}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label="Option Name" error={err && !name.trim() ? err : null}>
          <Input value={name} placeholder="e.g. Size, Color, Length" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Choices">
          <div className="flex items-center gap-2">
            <Input className="flex-1" value={draft} placeholder="Add a choice (e.g. Small, Medium)" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
            <Button type="button" variant="outline" onClick={add}>Add</Button>
          </div>
        </Field>
        {choices.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {choices.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-[6px] bg-inset px-2.5 py-1 text-[13px] text-ink-100">
                {c}
                <button type="button" onClick={() => setChoices(choices.filter((x) => x !== c))} className="text-ink-60 hover:text-ink-100"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        {err && choices.length === 0 && name.trim() && <span className="text-xs text-danger">{err}</span>}
      </div>
      <DialogFooter>
        <Button variant="accent" onClick={submit}>Save Option</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function VariantPricingDialog({
  variants,
  isBillingRecurring,
  basePrice,
  baseUpfrontFee,
  baseRecurringFee,
  onSave,
}: {
  variants: ServiceVariant[];
  isBillingRecurring: boolean;
  basePrice: number;
  baseUpfrontFee: number;
  baseRecurringFee: number;
  onSave: (v: ServiceVariant[]) => void;
}) {
  const [rows, setRows] = useState<ServiceVariant[]>(() => variants.map((v) => ({ ...v })));
  const [err, setErr] = useState<string | null>(null);

  const comboName = (v: ServiceVariant) =>
    Object.entries(v.options)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => `${k}: ${val}`)
      .join(', ');

  /** Signed money delta vs. the base price, e.g. "+$50", "−$20", or "No change". */
  const fmtDiff = (diff: number) => {
    if (!diff) return 'No change';
    const sign = diff > 0 ? '+' : '−';
    return `${sign}$${formatNumber(Math.abs(diff))}`;
  };
  const diffClass = (diff: number) =>
    diff > 0 ? 'text-accent' : diff < 0 ? 'text-danger' : 'text-ink-40';

  function setRow(i: number, patch: Partial<ServiceVariant>) {
    setRows(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
  }

  function save() {
    const invalid = rows.some((v) =>
      isBillingRecurring
        ? baseRecurringFee + v.recurringWeeklyDifference < 1 || baseUpfrontFee + v.recurringUpfrontDifference < 0
        : basePrice + v.oneOffUpfrontDifference < 1,
    );
    if (invalid) return setErr('Please fix the pricing errors before saving.');
    onSave(rows);
  }

  return (
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Variant Pricing</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-ink-60">Specify the total actual price for specific variant combinations.</p>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-60">No variants generated. Add options first.</p>
      ) : (
        <div className="flex flex-col divide-y divide-[color:var(--color-border-default)]">
          {rows.map((v, i) => {
            const recurringErr = isBillingRecurring && (baseRecurringFee + v.recurringWeeklyDifference < 1 || baseUpfrontFee + v.recurringUpfrontDifference < 0);
            const oneOffErr = !isBillingRecurring && basePrice + v.oneOffUpfrontDifference < 1;
            const hasErr = recurringErr || oneOffErr;
            return (
              <div key={v.id} className={hasErr ? 'rounded-[var(--radius-sm)] border border-danger p-2 py-3' : 'py-3'}>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="min-w-[140px] flex-1">
                    <div className="text-sm font-medium text-ink-100">{comboName(v)}</div>
                    <div className="mt-0.5 text-xs">
                      {isBillingRecurring ? (
                        <span className="flex flex-wrap gap-x-2 text-ink-40">
                          <span>Upfront <span className={diffClass(v.recurringUpfrontDifference)}>{fmtDiff(v.recurringUpfrontDifference)}</span></span>
                          <span>·</span>
                          <span>Recurring <span className={diffClass(v.recurringWeeklyDifference)}>{fmtDiff(v.recurringWeeklyDifference)}</span></span>
                        </span>
                      ) : (
                        <span className={diffClass(v.oneOffUpfrontDifference)}>{fmtDiff(v.oneOffUpfrontDifference)}</span>
                      )}
                    </div>
                  </div>
                  {isBillingRecurring && (
                    <div className="w-32">
                      <span className="mb-1 block text-xs text-ink-60">Upfront</span>
                      <MoneyInput
                        value={toNumberInput(baseUpfrontFee + v.recurringUpfrontDifference)}
                        onChange={(val) => setRow(i, { recurringUpfrontDifference: (Number(val) || 0) - baseUpfrontFee })}
                      />
                    </div>
                  )}
                  <div className="w-32">
                    <span className="mb-1 block text-xs text-ink-60">{isBillingRecurring ? 'Recurring' : 'Price'}</span>
                    <MoneyInput
                      value={toNumberInput(isBillingRecurring ? baseRecurringFee + v.recurringWeeklyDifference : basePrice + v.oneOffUpfrontDifference)}
                      onChange={(val) => {
                        const price = Number(val) || 0;
                        if (isBillingRecurring) setRow(i, { recurringWeeklyDifference: price - baseRecurringFee });
                        else setRow(i, { oneOffUpfrontDifference: price - basePrice });
                      }}
                    />
                  </div>
                </div>
                {hasErr && <p className="mt-1 text-xs text-danger">{recurringErr ? (baseRecurringFee + v.recurringWeeklyDifference < 1 ? 'Recurring price must be at least 1.' : 'Upfront price cannot be negative.') : 'Price must be at least 1.'}</p>}
              </div>
            );
          })}
        </div>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
      <DialogFooter>
        <Button variant="accent" onClick={save}>Save Details</Button>
      </DialogFooter>
    </DialogContent>
  );
}
