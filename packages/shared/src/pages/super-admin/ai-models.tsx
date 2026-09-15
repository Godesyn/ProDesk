import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { toastError } from '../../lib/errors';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { AiTabs } from './ai-tabs';

/**
 * MODEL CHOOSER — /super-admin/ai-models
 *
 * The "what runs on what" half of the AI section; AI Spend is the "what did it
 * cost" half. Two controls, ordered widest-blast-radius first:
 *
 *   1. **Providers** — which families exist at all.
 *   2. **Models** — which model each feature runs on.
 *
 * ---
 *
 * AI MODELS — which model each feature runs on.
 *
 * Deliberately separate from the AI Providers control next to it. They answer
 * different questions and belong to different owners:
 *
 *   • **Providers** decides which FAMILIES exist for brands to choose between.
 *     The Strategy assistant follows the brand's choice, so its model is a
 *     tenant decision and is not listed here.
 *   • **Models** decides what runs everything else — work no tenant should have
 *     to think about, where the tradeoff is ours to make.
 *
 * The design job here is making a cost/quality tradeoff legible at the moment of
 * choosing. Every option carries its price and a line on what it's for, and each
 * feature says why it is cheap or expensive to run — so the decision is made on
 * the two facts that matter rather than on model-name familiarity.
 */

type Catalogue = {
  id: string;
  label: string;
  family: string;
  input: number;
  output: number;
  note: string;
  available: boolean;
};

/** Relative cost, for the bar beside each option. Log-scaled: the cheapest
 *  model is 60× cheaper than the dearest, and a linear bar would render every
 *  option below Opus as an invisible sliver. */
function costWeight(m: Catalogue, max: number): number {
  const blended = m.input + m.output;
  return Math.max(0.06, Math.log10(1 + blended) / Math.log10(1 + max));
}

function money(v: number): string {
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(2)}`;
}

/**
 * AI PROVIDERS — which families a brand may choose between for its Strategy
 * assistant. Sits above the per-feature map because turning a family off also
 * takes its models out of every picker below.
 */
function AiProvidersPanel() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const providersQuery = useQuery(trpc.superAdmin.aiProviders.queryOptions());
  const providers = providersQuery.data ?? [];
  const enabledCount = providers.filter((p) => p.hasKey && !p.disabled).length;
  const setDisabled = useMutation(
    trpc.superAdmin.setAiProviderDisabled.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.superAdmin.aiProviders.queryKey() }),
    }),
  );

  if (providers.length === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-1 text-sm font-semibold text-ink-100">AI providers</div>
      <div className="mb-3 text-xs text-ink-60">
        Which families a brand can choose between for its Strategy assistant. Everything with an
        API key is available by default, and at least one must stay on. Every other AI feature runs
        on a model you pick below, not on the brand&rsquo;s choice.
      </div>
      <div className="space-y-2">
        {providers.map((p) => {
          const on = p.hasKey && !p.disabled;
          // Don't let the admin turn off the last enabled family (would break every brand).
          const lockOn = on && enabledCount <= 1;
          return (
            <div
              key={p.family}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink-100">{p.label}</div>
                <div className="truncate text-xs text-ink-60">
                  {p.hasKey ? (
                    <>Model: {p.model}</>
                  ) : (
                    <>No API key configured — set the family's key to enable it.</>
                  )}
                </div>
              </div>
              <button
                disabled={!p.hasKey || lockOn || setDisabled.isPending}
                title={lockOn ? 'At least one provider must stay enabled' : undefined}
                onClick={() => setDisabled.mutate({ family: p.family, disabled: on })}
                className={
                  'shrink-0 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ' +
                  (on
                    ? 'bg-ink-100 text-paper'
                    : 'border border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset') +
                  (!p.hasKey || lockOn ? ' cursor-not-allowed opacity-50' : '')
                }
              >
                {on ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** The Model Chooser tab: both controls, under the shared AI tab bar. */
export function AiModelsPage() {
  return (
    <div>
      <PageHeader
        title="AI"
        description="Which providers brands may choose, and which model each feature runs on."
      />
      <AiTabs />
      <AiProvidersPanel />
      <AiModelsPanel />
    </div>
  );
}

export function AiModelsPanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const key = trpc.superAdmin.aiFeatureModels.queryKey();
  const q = useQuery(trpc.superAdmin.aiFeatureModels.queryOptions());
  const [open, setOpen] = useState<string | null>(null);

  const setModel = useMutation({
    ...trpc.superAdmin.setAiFeatureModel.mutationOptions(),
    onMutate: async (vars) => {
      // Optimistic: the picker closes and the row updates on click, so choosing
      // a model for twelve features doesn't mean twelve round trips of waiting.
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<typeof q.data>(key);
      if (prev) {
        qc.setQueryData(key, {
          ...prev,
          features: prev.features.map((f) =>
            f.source === vars.source
              ? {
                  ...f,
                  modelId: vars.modelId ?? f.defaultModelId,
                  isDefault: !vars.modelId,
                }
              : f,
          ),
        });
      }
      return undefined;
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: key });
      toastError(e);
    },
    onSuccess: () => setOpen(null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const catalogue = q.data?.catalogue ?? [];
  const byId = useMemo(
    () => new Map(catalogue.map((m) => [m.id, m])),
    [catalogue],
  );
  const maxBlended = useMemo(
    () => Math.max(1, ...catalogue.map((m) => m.input + m.output)),
    [catalogue],
  );

  // Grouped by product, in the order the server declared them.
  const groups = useMemo(() => {
    const out: { group: string; features: NonNullable<typeof q.data>['features'] }[] = [];
    for (const f of q.data?.features ?? []) {
      const last = out[out.length - 1];
      if (last && last.group === f.group) last.features.push(f);
      else out.push({ group: f.group, features: [f] });
    }
    return out;
  }, [q.data]);

  if (q.isPending || groups.length === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="mb-1 text-sm font-semibold text-ink-100">AI models</div>
      <div className="mb-4 text-xs text-ink-60">
        Which model runs each feature. Prices are per million tokens — high-volume features cost
        far more to run on a big model, and most of them don&rsquo;t need one. The Strategy
        assistant isn&rsquo;t here: each brand picks its own provider for that.
      </div>

      <div className="space-y-5">
        {groups.map(({ group, features }) => (
          <section key={group}>
            <h3 className="eyebrow mb-2">{group}</h3>
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)]">
              {features.map((f) => {
                const model = byId.get(f.modelId);
                const isOpen = open === f.source;
                return (
                  <div
                    key={f.source}
                    className="border-b border-[color:var(--color-border-hairline)] last:border-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-ui-sm text-ink-100">{f.label}</span>
                          {!f.isDefault && (
                            <span className="text-[10px] uppercase tracking-wider text-ink-40">
                              set
                            </span>
                          )}
                        </div>
                        <div className="text-ui-xs mt-0.5 text-ink-40">{f.hint}</div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {!f.isDefault && (
                          <button
                            type="button"
                            title="Restore the default"
                            aria-label={`Restore the default model for ${f.label}`}
                            disabled={setModel.isPending}
                            onClick={() => setModel.mutate({ source: f.source, modelId: null })}
                            className="rounded-[var(--radius-sm)] p-1.5 text-ink-40 hover:bg-inset hover:text-ink-100"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : f.source)}
                          className={cn(
                            'press rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors duration-[var(--duration-quick)]',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                            isOpen
                              ? 'border-[color:var(--color-border-default)] bg-inset'
                              : 'border-[color:var(--color-border-hairline)] hover:bg-inset',
                          )}
                        >
                          <span className="text-ui-xs block text-ink-100">
                            {model?.label ?? f.modelId}
                          </span>
                          {model && (
                            <span className="tnum text-[10px] text-ink-40">
                              {money(model.input)} / {money(model.output)} per 1M
                            </span>
                          )}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-[color:var(--color-border-hairline)] bg-paper px-3 py-3">
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {catalogue.map((m) => {
                            const selected = m.id === f.modelId;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                disabled={!m.available || setModel.isPending}
                                aria-pressed={selected}
                                onClick={() =>
                                  setModel.mutate({
                                    source: f.source,
                                    // Choosing the default explicitly is the same
                                    // as clearing it — keeps the stored map small.
                                    modelId: m.id === f.defaultModelId ? null : m.id,
                                  })
                                }
                                className={cn(
                                  'rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors duration-[var(--duration-quick)]',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                                  selected
                                    ? 'border-ink-100 bg-card'
                                    : 'border-[color:var(--color-border-hairline)] hover:bg-card',
                                  !m.available && 'cursor-not-allowed opacity-45',
                                )}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-ui-xs text-ink-100">{m.label}</span>
                                  <span className="tnum text-[10px] text-ink-40">
                                    {money(m.input)} / {money(m.output)}
                                  </span>
                                </div>

                                {/* Relative cost, so the tradeoff is visible without
                                    doing arithmetic on two numbers. */}
                                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-inset">
                                  <div
                                    className={cn(
                                      'h-full rounded-full',
                                      selected ? 'bg-ink-100' : 'bg-ink-20',
                                    )}
                                    style={{ width: `${costWeight(m, maxBlended) * 100}%` }}
                                  />
                                </div>

                                <div className="text-[11px] mt-1.5 text-ink-40">
                                  {m.available
                                    ? m.note
                                    : `${m.note} — unavailable: no API key, or the family is turned off.`}
                                </div>
                                {m.id === f.defaultModelId && (
                                  <div className="text-[10px] mt-1 uppercase tracking-wider text-ink-40">
                                    Default
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Card>
  );
}
