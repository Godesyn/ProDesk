import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Plus, Pencil, Trash2, Star } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Field } from './form-bits';
import { QuestionEditor, questionsValid, type Question } from '../brand/spot-questions-editor';

export type FormRow = { id: string; name: string; description: string | null; questions: unknown[]; isSecret: boolean; isDefault: boolean };

/** 'agency' → an agency's own templates (defaults apply to every CONNECTED brand);
 *  'global' → platform-wide super-admin templates (defaults apply to EVERY brand). */
export type TemplateScope = 'agency' | 'global';

/**
 * Shared Info Hub template builder — the SPOT form-builder. Lists reusable
 * section templates and lets the owner create, edit, delete and mark them
 * default (auto-applied to brands). Ports form_builder_screen.dart +
 * inline_form_builder.dart, and drives both the agency Info Hub setup screen
 * and the super-admin global-defaults manager via the shared `spot` router.
 */
export function InfoHubTemplateManager({
  mode,
  agencyId,
  title,
  description,
}: {
  mode: TemplateScope;
  agencyId?: string;
  title: string;
  description: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<FormRow | null>(null);
  const [creating, setCreating] = useState(false);

  // 'agency' lists that agency's templates; 'global' (no agencyId) lists admin globals.
  const queryAgencyId = mode === 'agency' ? agencyId : undefined;
  const ready = mode === 'global' || !!agencyId;
  const key = trpc.spot.listForms.queryKey({ agencyId: queryAgencyId });
  const list = useQuery({ ...trpc.spot.listForms.queryOptions({ agencyId: queryAgencyId }), enabled: ready });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    ...trpc.spot.deleteForm.mutationOptions(),
    onSuccess: () => { toast.success('Section deleted'); invalidate(); },
    onError: (e) => toastError(e),
  });

  const forms = (list.data ?? []) as FormRow[];

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        action={
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild><Button variant="accent" disabled={!ready}><Plus className="h-4 w-4" /> New section</Button></DialogTrigger>
            {ready && creating && (
              <FormBuilderDialog mode={mode} agencyId={agencyId} onDone={() => { setCreating(false); invalidate(); }} />
            )}
          </Dialog>
        }
      />

      {!ready ? (
        <Card className="p-0"><EmptyState icon={LayoutTemplate} title="No agency selected" description="Pick an agency workspace to manage its Info Hub sections." /></Card>
      ) : list.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : forms.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={LayoutTemplate}
            title="No sections yet"
            description="Create reusable SPOT sections and questions for client onboarding."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {forms.map((f) => (
            <Card key={f.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                {/* flex-wrap so the Default/Secret badges drop below the title on
                    a narrow phone instead of squeezing the title to ~40% width. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-ink-100">{f.name}</span>
                  {f.isDefault && <Badge variant="success"><Star className="mr-1 h-3 w-3" /> Default</Badge>}
                  {f.isSecret && <Badge variant="warn">Secret</Badge>}
                </div>
                <div className="truncate text-sm text-ink-60">
                  {(f.questions?.length ?? 0)} question{(f.questions?.length ?? 0) === 1 ? '' : 's'}
                  {f.description ? ` · ${f.description}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(f)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={async () => { if (await confirm({ title: 'Delete template', description: `Delete "${f.name}"?`, confirmLabel: 'Delete', destructive: true })) remove.mutate({ id: f.id }); }}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <FormBuilderDialog mode={mode} agencyId={agencyId} form={editing} onDone={() => { setEditing(null); invalidate(); }} />
        )}
      </Dialog>
    </div>
  );
}

/** Create/edit a SPOT template. Exported so the brand Info Hub can let a
 *  connected agency edit a template it owns inline from a section card. */
export function FormBuilderDialog({ mode, agencyId, form, onDone }: { mode: TemplateScope; agencyId?: string; form?: FormRow; onDone: () => void }) {
  const trpc = useTRPC();
  const [name, setName] = useState(form?.name ?? '');
  const [description, setDescription] = useState(form?.description ?? '');
  const [isSecret, setIsSecret] = useState(form?.isSecret ?? false);
  const [isDefault, setIsDefault] = useState(form?.isDefault ?? false);
  const [questions, setQuestions] = useState<Question[]>(
    ((form?.questions ?? []) as Question[]).map((q) => ({ ...q, options: q.options ?? [] })),
  );

  const create = useMutation({ ...trpc.spot.createForm.mutationOptions(), onSuccess: () => { toast.success('Section created'); onDone(); }, onError: (e) => toastError(e) });
  const update = useMutation({ ...trpc.spot.updateForm.mutationOptions(), onSuccess: () => { toast.success('Section updated'); onDone(); }, onError: (e) => toastError(e) });
  const pending = create.isPending || update.isPending;

  const valid = name.trim().length > 0 && questionsValid(questions);

  const save = () => {
    const payload = { name: name.trim(), description: description || undefined, isSecret, isDefault, questions };
    if (form) update.mutate({ id: form.id, ...payload });
    // Omitting agencyId + brandId on create makes a global/admin template; agency mode passes agencyId.
    else if (mode === 'agency') create.mutate({ agencyId, ...payload });
    else create.mutate(payload);
  };

  const defaultHint = mode === 'global'
    ? 'Default — automatically added to every brand on the platform'
    : 'Default — automatically added to every connected brand’s Info Hub';

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{form ? 'Edit section' : 'New section'}</DialogTitle>
        <DialogDescription>Define the questions clients answer for this Info Hub section.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <Field label="Section name" htmlFor="sf-name"><Input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brand Basics" /></Field>
        <Field label="Description" htmlFor="sf-desc"><Input id="sf-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this section captures" /></Field>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-80">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            {defaultHint}
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-80">
            <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)} />
            Secret — never shown on the public brand profile
          </label>
        </div>

        <QuestionEditor questions={questions} onChange={setQuestions} />
      </div>

      <DialogFooter>
        <Button variant="accent" disabled={!valid || pending} onClick={save}>
          {pending ? 'Saving…' : form ? 'Save changes' : 'Create section'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
