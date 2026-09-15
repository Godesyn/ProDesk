import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import { LayoutTemplate, Plus, Share2, Globe, Lock, ChevronDown, GripVertical, Trash2, Save, ArrowLeft, Wand2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { SortableList } from '../../components/ui/sortable-list';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { cn, initialsOf } from '../../lib/utils';
import { Field } from '../agency/form-bits';
import { QuestionEditor, questionsValid, type Question } from './spot-questions-editor';
import { SpotComponentView, questionsOf, spotAnswerIsEmpty, type SpotComponent, type SpotForm } from './spot-view';
import { SectionLibraryPicker } from './section-library';
import { FormBuilderDialog, type FormRow } from '../agency/info-hub-template-manager';

/** Info Hub Forms — SPOT component builder + Share Profile. Ports business_info_screen.dart. */
export function InfoHubPage() {
  const { brandId } = useActiveContext();
  return (
    <div className="mx-auto max-w-[860px]">
      <InfoHubManager
        brandId={brandId ?? undefined}
        title="Info Hub Forms"
        description="Build the sections clients and agencies see on your brand profile."
      />
    </div>
  );
}

/** Super-admin manager for a specific brand's Info Hub (/super-admin/brands/:id/info-hub). */
export function AdminBrandInfoHubPage() {
  const trpc = useTRPC();
  const [, params] = useRoute('/super-admin/brands/:id/info-hub');
  const id = params?.id;
  const brand = useQuery({ ...trpc.brands.byId.queryOptions({ id: id! }), enabled: !!id });
  if (!id) return null;
  return (
    <div className="mx-auto max-w-[860px]">
      <Link href="/super-admin/brands" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-60 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> Back to brands
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <Avatar className="h-11 w-11">{brand.data?.logoUrl && <AvatarImage src={brand.data.logoUrl} />}<AvatarFallback>{initialsOf(brand.data?.businessName)}</AvatarFallback></Avatar>
        <div>
          <h1 className="text-h3 text-ink-100">{brand.data?.businessName ?? 'Brand'} · Info Hub</h1>
          <p className="mt-0.5 hidden text-sm text-ink-60 md:block">Manage the sections on this brand's profile as a platform admin.</p>
        </div>
      </div>
      <InfoHubManager brandId={id} canSetDefault />
    </div>
  );
}

/* ── Core manager (shared by brand self-service + admin views) ────────────── */

export function InfoHubManager({
  brandId,
  title,
  description,
  actingAgencyId,
  canSetDefault,
}: {
  brandId?: string;
  title?: string;
  description?: string;
  /** Set when an agency (not the brand) is managing this Info Hub: scopes which
   *  sections are editable and tags newly-added sections with the agency. */
  actingAgencyId?: string;
  /** Owners/super-admins may flip a template's Default flag inline (form_tile.dart). */
  canSetDefault?: boolean;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  // Pass the acting agency so an agency viewing a client's hub is scoped server-side
  // to its own sections + public ones (and can edit only its own), even if the
  // operator is also a member of the brand.
  const compsKey = trpc.spot.listComponents.queryKey({ brandId: brandId!, agencyId: actingAgencyId });
  const components = useQuery({ ...trpc.spot.listComponents.queryOptions({ brandId: brandId!, agencyId: actingAgencyId }), enabled: !!brandId });
  // Pass the acting agency so the picker is server-scoped: a brand (no agency) only
  // ever receives platform/global templates — never any agency's templates.
  const forms = useQuery({ ...trpc.spot.listFormsForBrand.queryOptions({ brandId: brandId!, agencyId: actingAgencyId }), enabled: !!brandId });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: compsKey });
    qc.invalidateQueries({ queryKey: trpc.spot.listFormsForBrand.queryKey({ brandId: brandId!, agencyId: actingAgencyId }) });
    // A section an agency builds here creates an agency-scoped template, so refresh
    // the agency's own Info Hub setup list too (where that template now lives).
    if (actingAgencyId) qc.invalidateQueries({ queryKey: trpc.spot.listForms.queryKey({ agencyId: actingAgencyId }) });
  };
  const reorder = useMutation({ ...trpc.spot.reorderComponents.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const formById = useMemo(() => new Map((forms.data ?? []).map((f) => [f.id, f])), [forms.data]);

  const shareProfile = () => {
    if (!brandId) return;
    const link = `${window.location.origin}/public/brand/${brandId}`;
    navigator.clipboard.writeText(link).then(() => toast.success('Profile link copied'), () => toast.error('Copy failed'));
  };

  const list = components.data ?? [];
  // Templates already placed as a section — shown as "Added" (disabled) in the Section
  // Library. Template-less brand-own sections (null templateId) don't participate.
  const usedTemplateIds = useMemo(() => new Set(list.map((c) => c.templateId).filter((id): id is string => !!id)), [list]);
  // When an agency manages the hub, it may only edit the sections it owns (client_detail_screen.dart).
  const canEdit = (c: SpotComponent) => !actingAgencyId || c.agencyId === actingAgencyId;

  // Only the brand (not an agency managing the hub) may reorder its sections.
  const reorderable = !actingAgencyId && list.length > 1;
  const renderCard = (c: SpotComponent, dragHandle?: React.ReactNode) => (
    <ComponentCard
      key={c.id}
      component={c}
      // Questions come resolved on the component (from its template, or inline for a
      // brand-own section) — so agency-added sections render without the brand ever
      // being handed the agency's templates.
      questions={questionsOf(c)}
      editable={canEdit(c)}
      canToggleVisibility={!actingAgencyId}
      actingAgencyId={actingAgencyId}
      // An agency may edit the underlying template only for sections it owns.
      editableTemplate={actingAgencyId && c.templateId ? formById.get(c.templateId) : undefined}
      dragHandle={dragHandle}
      onChanged={invalidate}
    />
  );

  const header = (
    <PageHeader
      title={title ?? 'Info Hub'}
      description={description}
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={!brandId} onClick={shareProfile}><Share2 className="h-4 w-4" /> Share Profile</Button>
          <Button variant="accent" disabled={!brandId} onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create Section</Button>
        </div>
      }
    />
  );

  return (
    <>
      {title && header}

      {!brandId ? (
        <EmptyState icon={LayoutTemplate} title="No brand selected" description="Create a brand profile to build your Info Hub." />
      ) : components.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={LayoutTemplate}
          title="No sections yet"
          description={
            actingAgencyId || canSetDefault
              ? 'Add a section from a template, or build a new reusable one.'
              : 'Add a section from a platform template, or build your own.'
          }
          action={<Button variant="accent" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Create Section</Button>}
        />
      ) : (
        reorderable ? (
          <SortableList
            items={list}
            getId={(c) => c.id}
            onReorder={(ids) => { if (brandId) reorder.mutate({ brandId, agencyId: actingAgencyId, orderedIds: ids }); }}
            className="flex flex-col gap-4"
          >
            {({ item: c, handleProps }) => renderCard(c, (
              <button {...handleProps} className="shrink-0 cursor-grab touch-none text-ink-30 hover:text-ink-60 active:cursor-grabbing" aria-label="Drag to reorder">
                <GripVertical className="h-4 w-4" />
              </button>
            ))}
          </SortableList>
        ) : (
          <div className="flex flex-col gap-4">{list.map((c) => renderCard(c))}</div>
        )
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {createOpen && brandId && (
          <CreateSectionDialog
            brandId={brandId}
            forms={forms.data ?? []}
            usedTemplateIds={usedTemplateIds}
            actingAgencyId={actingAgencyId}
            canSetDefault={canSetDefault}
            onDone={() => { setCreateOpen(false); invalidate(); }}
          />
        )}
      </Dialog>
    </>
  );
}

function ComponentCard({
  component,
  questions,
  editable = true,
  canToggleVisibility = true,
  actingAgencyId,
  editableTemplate,
  dragHandle,
  onChanged,
}: {
  component: SpotComponent;
  questions: ReturnType<typeof questionsOf>;
  editable?: boolean;
  /** Only the brand (not an agency managing the hub) may publish a section. */
  canToggleVisibility?: boolean;
  /** The agency the operator is acting as — sent to mutations so the server
   *  authoritatively resolves the agency identity (own-only edit/delete). */
  actingAgencyId?: string;
  /** When set, the viewing agency owns this section's template and may edit it. */
  editableTemplate?: SpotForm;
  /** Drag-to-reorder grip (only the brand, with >1 section, may reorder). */
  dragHandle?: React.ReactNode;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const confirm = useConfirm();
  const [editTemplateOpen, setEditTemplateOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>((component.answers as Record<string, unknown>) ?? {});
  const baseOrder = ((component.questionOrder as string[] | null) ?? []);
  const [order, setOrder] = useState<string[]>(baseOrder);
  const dirty =
    JSON.stringify(answers) !== JSON.stringify(component.answers ?? {}) ||
    JSON.stringify(order) !== JSON.stringify(baseOrder);
  // Required questions must be answered before the section can be saved.
  const missingRequired = questions.filter((q) => q.isRequired && spotAnswerIsEmpty(answers[q.id]));

  const saveAnswers = useMutation({ ...trpc.spot.updateAnswers.mutationOptions(), onSuccess: () => { toast.success('Saved'); onChanged(); }, onError: (e) => toastError(e) });
  const toggle = useMutation({ ...trpc.spot.toggleVisibility.mutationOptions(), onSuccess: onChanged, onError: (e) => toastError(e) });
  const del = useMutation({ ...trpc.spot.deleteComponent.mutationOptions(), onSuccess: () => { toast.success('Section removed'); onChanged(); }, onError: (e) => toastError(e) });

  const shareSection = () => {
    const link = `${window.location.origin}/public/brand/form/${component.id}`;
    navigator.clipboard.writeText(link).then(() => toast.success('Section link copied'), () => toast.error('Copy failed'));
  };

  return (
    <Card className="p-4 md:p-5">
      {/* Mobile: wrap to two rows (title group full-width row 1, actions row 2);
          desktop (md:) keeps the original single-row justify-between layout. */}
      <div className={cn('flex flex-wrap items-center justify-between gap-2', !collapsed && 'mb-4')}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 max-md:w-full">
          {dragHandle}
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="shrink-0 text-ink-40 hover:text-ink-100" title={collapsed ? 'Expand section' : 'Collapse section'}>
            <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} />
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="min-w-0 flex-1 text-left text-base font-semibold text-ink-100 md:flex-none md:truncate">{component.templateName}</button>
          {component.isPublic ? <Badge variant="success"><Globe className="mr-1 h-3 w-3" /> Public</Badge> : <Badge variant="muted"><Lock className="mr-1 h-3 w-3" /> Private</Badge>}
          {component.isSecret && <Badge variant="warn">Secret</Badge>}
          {!editable && <Badge variant="outline">Managed elsewhere</Badge>}
          {collapsed && dirty && <span className="shrink-0 text-xs text-warn">Unsaved</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1 max-md:w-full max-md:justify-end">
          {component.isPublic && <Button size="icon" variant="ghost" title="Copy section link" onClick={shareSection}><Share2 className="h-4 w-4" /></Button>}
          {editable && canToggleVisibility && !component.isSecret && (
            <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: component.id, agencyId: actingAgencyId, isPublic: !component.isPublic })}>
              {component.isPublic ? 'Make private' : 'Make public'}
            </Button>
          )}
          {editableTemplate && <Button size="icon" variant="ghost" title="Edit template" onClick={() => setEditTemplateOpen(true)}><Pencil className="h-4 w-4" /></Button>}
          {editable && <Button size="icon" variant="ghost" onClick={async () => { if (await confirm({ title: 'Remove section', description: 'Remove this section?', confirmLabel: 'Remove', destructive: true })) del.mutate({ id: component.id, agencyId: actingAgencyId }); }}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </div>
      {!collapsed && (
        <>
          <SpotComponentView
            component={component}
            questions={questions}
            editable={editable}
            answers={answers}
            onChange={(qid, v) => setAnswers((a) => ({ ...a, [qid]: v }))}
            order={order}
            onReorder={editable ? setOrder : undefined}
            hideTitle
          />
          {editable && dirty && (
            <div className="mt-4 flex items-center justify-end gap-3">
              {missingRequired.length > 0 && (
                <span className="text-xs text-danger">{missingRequired.length === 1 ? '1 required field is empty' : `${missingRequired.length} required fields are empty`}</span>
              )}
              <Button
                size="sm"
                variant="accent"
                disabled={saveAnswers.isPending || missingRequired.length > 0}
                onClick={() => saveAnswers.mutate({ id: component.id, agencyId: actingAgencyId, answers, ...(order.length ? { questionOrder: order } : {}) })}
              >
                <Save className="h-4 w-4" /> {saveAnswers.isPending ? 'Saving…' : 'Save section'}
              </Button>
            </div>
          )}
        </>
      )}

      {editableTemplate && (
        <Dialog open={editTemplateOpen} onOpenChange={setEditTemplateOpen}>
          {editTemplateOpen && (
            <FormBuilderDialog
              mode="agency"
              agencyId={component.agencyId ?? undefined}
              form={editableTemplate as FormRow}
              onDone={() => { setEditTemplateOpen(false); onChanged(); }}
            />
          )}
        </Dialog>
      )}
    </Card>
  );
}

/* ── Create section: from a template, or build a custom one ───────────────── */

function CreateSectionDialog({
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
  // Everyone can build a section here. What it creates differs by role: an agency
  // or super-admin builds a reusable TEMPLATE; a plain brand owner builds a
  // template-less section (questions stored inline — brands never own templates).
  // The "From template" picker shows only templates the viewer is allowed to see:
  // a brand sees platform/global templates; an agency sees its own (server-scoped).
  const [mode, setMode] = useState<'template' | 'custom'>('template');
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Section Library</DialogTitle>
        <DialogDescription>Add an existing template, or build a new section.</DialogDescription>
      </DialogHeader>

      <div className="mb-1 inline-flex rounded-[var(--radius-pill)] border border-[color:var(--color-border-default)] p-0.5">
        {([['template', 'From template'], ['custom', 'Add new']] as const).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn('rounded-[var(--radius-pill)] px-4 py-1.5 text-sm transition-colors', mode === m ? 'bg-accent/12 font-medium text-accent' : 'text-ink-60')}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'template' ? (
        <SectionLibraryPicker
          brandId={brandId}
          forms={forms}
          usedTemplateIds={usedTemplateIds}
          actingAgencyId={actingAgencyId}
          canSetDefault={canSetDefault}
          onDone={onDone}
        />
      ) : (
        <CustomSectionBuilder brandId={brandId} actingAgencyId={actingAgencyId} canSetDefault={canSetDefault} onDone={onDone} />
      )}
    </DialogContent>
  );
}

function CustomSectionBuilder({
  brandId,
  actingAgencyId,
  canSetDefault,
  onDone,
}: {
  brandId: string;
  actingAgencyId?: string;
  canSetDefault?: boolean;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const create = useMutation({ ...trpc.spot.createCustomSection.mutationOptions(), onSuccess: () => { toast.success('Section created'); onDone(); }, onError: (e) => toastError(e) });
  const valid = name.trim().length > 0 && questionsValid(questions);
  // An agency (managing a client) or an admin builds a reusable template that may be
  // marked default. A plain brand owner builds a template-less section, so it can
  // never be a default — hide the Default toggle for them.
  const canMakeDefault = !!actingAgencyId || !!canSetDefault;
  const defaultHint = actingAgencyId
    ? 'Default — automatically added to every connected brand’s Info Hub'
    : 'Default — automatically added to every brand on the platform';
  return (
    <div className="flex flex-col gap-4">
      <Field label="Section name" htmlFor="cs-name"><Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Our Story" /></Field>
      <Field label="Description" htmlFor="cs-desc"><Input id="cs-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" /></Field>
      <div className="flex flex-col gap-2">
        {canMakeDefault && (
          <label className="flex items-center gap-2 text-sm text-ink-80">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            {defaultHint}
          </label>
        )}
        <label className="flex items-center gap-2 text-sm text-ink-80">
          <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
          Secret — never shown on the public brand profile
        </label>
      </div>
      <QuestionEditor questions={questions} onChange={setQuestions} />
      <DialogFooter>
        <Button variant="accent" disabled={!valid || create.isPending} onClick={() => create.mutate({ brandId, agencyId: actingAgencyId, name: name.trim(), description: description || undefined, isSecret, isDefault: canMakeDefault ? isDefault : undefined, questions })}>
          <Wand2 className="h-4 w-4" /> {create.isPending ? 'Creating…' : 'Create section'}
        </Button>
      </DialogFooter>
    </div>
  );
}
