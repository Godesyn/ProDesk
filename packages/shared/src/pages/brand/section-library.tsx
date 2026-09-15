import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, FileText, Check } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Switch } from '../super-admin/components';
import { cn } from '../../lib/utils';
import type { SpotForm } from './spot-view';

/**
 * Section Library — the multi-select template picker an agency/admin uses to add
 * SPOT sections to a brand profile. Ports app_add_forms_dialog.dart: splits
 * templates into "Default Templates" (auto-applied) and "Standard Forms", shows
 * already-added templates as disabled, supports Select All + bulk Add Selected,
 * and (for owners/admins) an inline Make Default switch (form_tile.dart).
 */
export function SectionLibraryPicker({
  brandId,
  forms,
  usedTemplateIds,
  actingAgencyId,
  canSetDefault,
  onDone,
}: {
  brandId: string;
  forms: SpotForm[];
  usedTemplateIds: Set<string>;
  actingAgencyId?: string;
  canSetDefault?: boolean;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const create = useMutation(trpc.spot.createComponent.mutationOptions());
  const setDefault = useMutation({
    ...trpc.spot.updateForm.mutationOptions(),
    onSuccess: (_d, vars) => {
      toast.success(vars.isDefault ? 'Set as default template' : 'Removed from defaults');
      qc.invalidateQueries({ queryKey: trpc.spot.listFormsForBrand.queryKey({ brandId }) });
    },
    onError: (e) => toastError(e),
  });

  // When an agency is adding sections to a client, it may only offer its OWN
  // templates (Flutter agencyTemplatesStreamProvider → watchAgencyForms(agencyId)).
  // The brand/admin sees everything available to the brand.
  const scopedForms = useMemo(
    () => (actingAgencyId ? forms.filter((f) => f.agencyId === actingAgencyId) : forms),
    [forms, actingAgencyId],
  );
  const defaultForms = useMemo(() => scopedForms.filter((f) => f.isDefault), [scopedForms]);
  const standardForms = useMemo(() => scopedForms.filter((f) => !f.isDefault), [scopedForms]);
  const availableIds = useMemo(() => scopedForms.filter((f) => !usedTemplateIds.has(f.id)).map((f) => f.id), [scopedForms, usedTemplateIds]);
  const allSelected = availableIds.length > 0 && availableIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () =>
    setSelected((s) => (availableIds.every((id) => s.has(id)) ? new Set() : new Set(availableIds)));

  const addSelected = async () => {
    try {
      await Promise.all(
        [...selected].map((id) => {
          const f = forms.find((x) => x.id === id);
          if (!f) return Promise.resolve();
          return create.mutateAsync({
            brandId,
            templateId: f.id,
            templateName: f.name,
            agencyId: actingAgencyId ?? f.agencyId ?? undefined,
            answers: {},
            isSecret: f.isSecret,
          });
        }),
      );
      toast.success(selected.size === 1 ? 'Section added' : 'Sections added');
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add sections');
    }
  };

  const Tile = ({ f }: { f: SpotForm }) => {
    const added = usedTemplateIds.has(f.id);
    const isSelected = selected.has(f.id);
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-sm)] border p-3 transition-colors',
          added
            ? 'cursor-default border-[color:var(--color-border-default)] opacity-60'
            : isSelected
              ? 'cursor-pointer border-accent bg-accent/8'
              : 'cursor-pointer border-[color:var(--color-border-default)] hover:bg-inset',
        )}
        onClick={() => !added && toggle(f.id)}
      >
        <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)]', f.isDefault ? 'bg-amber-400/15 text-amber-500' : 'bg-inset text-ink-60')}>
          {f.isDefault ? <Star className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink-100">{f.name}</span>
            {f.brandId && <Badge variant="outline">Custom</Badge>}
            {f.isSecret && <Badge variant="warn">Secret</Badge>}
          </div>
          {f.description && <div className="truncate text-xs text-ink-40">{f.description}</div>}
          <div className="mt-0.5 text-xs text-ink-40">{(f.questions as unknown[])?.length ?? 0} question{((f.questions as unknown[])?.length ?? 0) === 1 ? '' : 's'}</div>
        </div>

        {/* Inline Make-Default switch — owners/admins only (form_tile.dart). */}
        {canSetDefault && !f.brandId && (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-xs text-ink-40">Default</span>
            <Switch checked={f.isDefault} disabled={setDefault.isPending} onChange={(v) => setDefault.mutate({ id: f.id, isDefault: v })} />
          </div>
        )}

        {added ? (
          <Badge variant="muted">Added</Badge>
        ) : (
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border', isSelected ? 'border-accent bg-accent text-white' : 'border-[color:var(--color-border-default)]')}>
            {isSelected && <Check className="h-3.5 w-3.5" />}
          </span>
        )}
      </div>
    );
  };

  const Group = ({ title, list }: { title: string; list: SpotForm[] }) =>
    list.length === 0 ? null : (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-40">
          {title} <span className="rounded-full bg-inset px-1.5 text-ink-60">{list.length}</span>
        </div>
        {list.map((f) => <Tile key={f.id} f={f} />)}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {scopedForms.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-40">No templates available. Build a section from the “Add new” tab.</p>
      ) : (
        <div className="max-h-[55vh] space-y-5 overflow-y-auto pr-1">
          <Group title="Default Templates" list={defaultForms} />
          <Group title="Standard Forms" list={standardForms} />
        </div>
      )}

      {scopedForms.length > 0 && (
        <div className="flex items-center justify-between border-t border-[color:var(--color-border-default)] pt-3">
          <Button variant="ghost" size="sm" disabled={availableIds.length === 0} onClick={selectAll}>
            {allSelected ? 'Clear selection' : 'Select All Available'}
          </Button>
          <Button variant="accent" disabled={selected.size === 0 || create.isPending} onClick={addSelected}>
            {create.isPending ? 'Adding…' : `Add Selected${selected.size ? ` (${selected.size})` : ''}`}
          </Button>
        </div>
      )}
    </div>
  );
}
