import { useState } from 'react';
import { Plus, Pencil, Trash2, X, PlusCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Field, Select } from '../../pages/agency/form-bits';
import { SectionHeader } from './section-header';
import {
  type CustomField,
  type CustomFieldType,
  type CustomFieldOption,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_DISPLAY_NAME,
  rid,
} from './types';

/**
 * Custom Requirement Fields section + builder dialog (ports
 * `custom_field_builder_dialog.dart`). Options sub-editor only appears for
 * single/multi select types.
 */
export function CustomFieldBuilder({ fields, onChange }: { fields: CustomField[]; onChange: (next: CustomField[]) => void }) {
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [open, setOpen] = useState(false);

  function startAdd() {
    setEditing(null);
    setOpen(true);
  }
  function startEdit(f: CustomField) {
    setEditing(f);
    setOpen(true);
  }
  function save(field: CustomField) {
    const idx = fields.findIndex((f) => f.id === field.id);
    onChange(idx === -1 ? [...fields, field] : fields.map((f) => (f.id === field.id ? field : f)));
    setOpen(false);
  }

  return (
    <div>
      <SectionHeader title="Custom Requirement Fields" subtitle="Fields that brands must fill out after purchasing this service." />
      {fields.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-default)]">
          {fields.map((f, i) => (
            <div key={f.id} className={i > 0 ? 'flex items-center justify-between border-t border-[color:var(--color-border-default)] px-4 py-2.5' : 'flex items-center justify-between px-4 py-2.5'}>
              <div>
                <div className="text-sm font-semibold text-ink-100">{f.label}</div>
                <div className="text-xs text-ink-60">
                  {CUSTOM_FIELD_TYPE_DISPLAY_NAME[f.type]}
                  {f.required ? ' • Required' : ''}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => startEdit(f)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => onChange(fields.filter((x) => x.id !== f.id))}><Trash2 className="h-4 w-4 text-danger" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Button type="button" variant="outline" className="w-full" onClick={startAdd}>
        <Plus className="h-4 w-4" /> Add Custom Field
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {open && <CustomFieldDialog initial={editing} onSave={save} />}
      </Dialog>
    </div>
  );
}

function CustomFieldDialog({ initial, onSave }: { initial: CustomField | null; onSave: (f: CustomField) => void }) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [type, setType] = useState<CustomFieldType>(initial?.type ?? 'text');
  const [placeholder, setPlaceholder] = useState(initial?.placeholder ?? '');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [options, setOptions] = useState<CustomFieldOption[]>(initial?.options ?? []);
  const [optDraft, setOptDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const isSelect = type === 'singleSelect' || type === 'multiSelect';

  function addOption() {
    const o = optDraft.trim();
    if (o) {
      setOptions([...options, { id: rid(), label: o }]);
      setOptDraft('');
    }
  }

  function submit() {
    if (!label.trim()) return setErr('Field label is required');
    if (isSelect && options.length === 0) return setErr('Please add at least one option for select fields');
    onSave({
      id: initial?.id ?? rid(),
      label: label.trim(),
      type,
      required,
      options: isSelect ? options : undefined,
      placeholder: placeholder.trim() || undefined,
    });
  }

  return (
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{initial ? 'Edit Custom Field' : 'Add Custom Field'}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label="Field Label" error={err && !label.trim() ? err : null}>
          <Input value={label} placeholder="e.g. Project Name" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Field Type">
          <Select value={type} onChange={(v) => setType(v as CustomFieldType)}>
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>{CUSTOM_FIELD_TYPE_DISPLAY_NAME[t]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Placeholder (Optional)">
          <Input value={placeholder} placeholder="Hint text for the field" onChange={(e) => setPlaceholder(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          <span>
            <span className="font-medium text-ink-100">Required Field</span>
            <span className="block text-xs text-ink-60">Brand must fill this field before checkout</span>
          </span>
        </label>
        {isSelect && (
          <div>
            <Field label="Option">
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  value={optDraft}
                  placeholder="Add an option..."
                  onChange={(e) => setOptDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addOption();
                    }
                  }}
                />
                <Button type="button" size="icon" variant="ghost" onClick={addOption}><PlusCircle className="h-5 w-5" /></Button>
              </div>
            </Field>
            {options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-3">
                {options.map((o) => (
                  <span key={o.id} className="inline-flex items-center gap-1.5 rounded-[6px] bg-inset px-2.5 py-1 text-xs text-ink-100">
                    {o.label}
                    <button type="button" onClick={() => setOptions(options.filter((x) => x.id !== o.id))} className="text-ink-60 hover:text-ink-100"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
            {err && isSelect && options.length === 0 && <span className="mt-1 block text-xs text-danger">{err}</span>}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="accent" onClick={submit}>{initial ? 'Update Field' : 'Add Field'}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
