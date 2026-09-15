import { useEffect, useState } from 'react';
import { useRoute, useSearch, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { SpotComponentView, spotAnswerIsEmpty } from '../brand/spot-view';
import { briefFieldDef, toSpotQuestion } from '../projects/brief-fields';

/**
 * Post-checkout brief-collection stepper. Polls the purchase until projects are
 * created, then walks the buyer through each project's custom-field brief,
 * submitting via projects.submitBrief. Ports post_checkout_stepper_screen.dart.
 */
export function PostCheckoutStepperPage() {
  const [, params] = useRoute('/post-checkout/:purchaseId');
  const searchStr = useSearch();
  const purchaseId = params?.purchaseId ?? new URLSearchParams(searchStr).get('purchaseId') ?? '';
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { workspace } = useActiveContext();

  const [step, setStep] = useState(0);
  const [responses, setResponses] = useState<Record<string, Record<string, unknown>>>({});

  // Clear the client-side cart on a successful purchase landing.
  useEffect(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('prodesk.cart.')) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }, []);

  const poll = useQuery({
    ...trpc.marketplace.briefProjects.queryOptions({ purchaseId }),
    enabled: !!purchaseId,
    // Poll while the purchase is still being fulfilled.
    refetchInterval: (q) => (q.state.data?.ready ? false : 1500),
  });

  const submitBrief = useMutation(trpc.projects.submitBrief.mutationOptions());

  const projectsList = poll.data?.projects ?? [];
  const goHome = () => navigate(workspace === 'brand' ? '/brand-projects' : '/agency-projects');

  // No briefs needed → straight to projects once fulfilled.
  useEffect(() => {
    if (poll.data?.ready && projectsList.length === 0) goHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.data?.ready, projectsList.length]);

  if (!poll.data?.ready) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-center text-ink-60">
        <div>
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-lg font-medium">Setting up your projects…</p>
          <p className="text-sm text-ink-40">Please don't close this page.</p>
        </div>
      </div>
    );
  }

  if (projectsList.length === 0) return null;

  const current = projectsList[step];
  // Each project's brief questions, rendered with the Info Hub field renderer so
  // every configured type (selects, dates, uploads, colour palettes, addresses,
  // …) is honoured rather than collapsed to a text box.
  const defs = (current.fields ?? []).map(briefFieldDef);
  const questions = defs.map((def, i) => toSpotQuestion(def, i));
  const projResponses = responses[current.id] ?? {};
  const isLast = step === projectsList.length - 1;

  const setAnswer = (fieldId: string, value: unknown) =>
    setResponses((prev) => ({ ...prev, [current.id]: { ...(prev[current.id] ?? {}), [fieldId]: value } }));

  const saveAndContinue = async () => {
    if (questions.some((q) => q.isRequired && spotAnswerIsEmpty(projResponses[q.id]))) {
      toast.error(`Please fill in all required fields for ${current.serviceName ?? 'this project'}`);
      return;
    }
    try {
      // Persist responses back into the customFieldResponses shape ({ question, answer }),
      // matching the client-brief project form's `{ value }` envelope.
      const payload = defs.map((def, i) => ({ question: def, answer: { value: projResponses[questions[i].id] ?? '' } }));
      await submitBrief.mutateAsync({ id: current.id, customFieldResponses: payload });
      qc.invalidateQueries({ queryKey: trpc.marketplace.briefProjects.queryKey({ purchaseId }) });
      if (isLast) {
        toast.success('All details submitted');
        goHome();
      } else {
        setStep((s) => s + 1);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Provide Project Details"
        description="Fill in these details so the team can start working."
        action={<Button variant="ghost" size="sm" onClick={goHome}>Skip for now</Button>}
      />

      <ol className="mb-4 flex flex-wrap gap-2">
        {projectsList.map((p, i) => (
          <li
            key={p.id}
            className={`rounded-full px-3 py-1 text-xs ${i === step ? 'bg-accent text-white' : i < step ? 'bg-success/15 text-success' : 'bg-inset text-ink-40'}`}
          >
            {i + 1}. {p.serviceName ?? 'Project'}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="space-y-5 p-5">
          <h3 className="font-semibold text-ink-100">{current.serviceName ?? 'Project'}</h3>
          {questions.length === 0 ? (
            <p className="text-sm text-ink-60">No additional details required.</p>
          ) : (
            <SpotComponentView
              component={{ id: current.id, templateName: current.serviceName ?? 'Project', answers: projResponses, questionOrder: null }}
              questions={questions}
              editable
              answers={projResponses}
              onChange={setAnswer}
              hideTitle
            />
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="accent" className="flex-1" onClick={saveAndContinue} disabled={submitBrief.isPending}>
              {isLast ? 'Submit & finish' : 'Save & continue'}
            </Button>
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={submitBrief.isPending}>
                Back
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
