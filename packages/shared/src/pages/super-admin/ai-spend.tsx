import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { formatDate, formatNumber } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { AiTabs } from './ai-tabs';

const LIMIT = 20;

const RANGES = [
  { label: 'All time', value: undefined },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 7 days', value: 7 },
] as const;

/** Human-readable labels for ai_usage.source (the feature that spent the tokens). */
const SOURCE_LABELS: Record<string, string> = {
  chat: 'AI Assistant chat',
  card_regenerate: 'Card regenerate',
  review_generate: 'Review copy',
  proposal_draft: 'Proposal draft',
  proposal_rewrite: 'Proposal rewrite',
  proposal_suggest: 'Proposal suggestions',
  proposal_score: 'Proposal score',
  proposal_win_loss: 'Win/loss analysis',
  pricing_benchmark: 'Pricing benchmark',
  upsell_recommendations: 'Upsell suggestions',
  block_copy: 'Block copy',
  sequence_rewrite: 'Sequence rewrite',
  outreach_classify: 'Outreach: reply classification',
  outreach_draft: 'Outreach: reply draft',
  outreach_personalise: 'Outreach: list personalisation',
};

const sourceLabel = (s: string | null | undefined): string =>
  s ? (SOURCE_LABELS[s] ?? s) : 'Untagged';

/** Human-readable labels for ai_usage.model (raw model id otherwise). */
const MODEL_LABELS: Record<string, string> = {
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  // Task model — pinned by specific high-volume call sites (Outreach), never
  // selectable as a brand's provider. See TASK_MODELS in providers/registry.ts.
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash-Lite',
};

const modelLabel = (m: string | null | undefined): string =>
  m ? (MODEL_LABELS[m] ?? m) : 'Unknown model';

function usd(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function AiSpendByBrandPage() {
  const trpc = useTRPC();
  const [offset, setOffset] = useState(0);
  const [sinceDays, setSinceDays] = useState<number | undefined>(undefined);

  const list = useQuery(trpc.superAdmin.aiSpendByBrand.queryOptions({ limit: LIMIT, offset, sinceDays }));
  const rows = list.data?.items ?? [];
  const totals = list.data?.totals;
  const bySource = list.data?.bySource ?? [];
  const byModel = list.data?.byModel ?? [];

  return (
    <div>
      <PageHeader title="AI" description="Per-brand AI usage and cost, across every feature." />
      <AiTabs />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => {
                setSinceDays(r.value);
                setOffset(0);
              }}
              className={
                'rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium ' +
                (sinceDays === r.value ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset')
              }
            >
              {r.label}
            </button>
          ))}
        </div>
        {totals && (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card px-3 py-1.5 text-xs text-ink-60">
            <Bot className="h-4 w-4 text-accent" />
            <span className="font-semibold text-ink-100">{usd(totals.costUsd)}</span> total ·{' '}
            {formatNumber(Number(totals.messages ?? 0))} replies
          </div>
        )}
      </div>

      {bySource.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-60">
            By feature
          </div>
          <div className="flex flex-wrap gap-2">
            {bySource.map((s) => (
              <div
                key={s.source ?? 'untagged'}
                className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card px-3 py-1.5 text-xs"
              >
                <span className="font-medium text-ink-100">{sourceLabel(s.source)}</span>
                <span className="font-semibold text-accent">{usd(s.costUsd)}</span>
                <span className="text-ink-60">· {formatNumber(Number(s.messages ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {byModel.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-60">
            By model
          </div>
          <div className="flex flex-wrap gap-2">
            {byModel.map((m) => (
              <div
                key={m.model ?? 'unknown'}
                className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card px-3 py-1.5 text-xs"
              >
                <span className="font-medium text-ink-100">{modelLabel(m.model)}</span>
                <span className="font-semibold text-accent">{usd(m.costUsd)}</span>
                <span className="text-ink-60">· {formatNumber(Number(m.messages ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Input tokens</TableHead>
                  <TableHead className="text-right">Output tokens</TableHead>
                  <TableHead className="text-right">Cost (USD)</TableHead>
                  <TableHead>Last used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.brandId ?? 'unknown'}>
                    <TableCell className="font-medium text-ink-100">{r.brandName ?? 'Unknown brand'}</TableCell>
                    <TableCell className="text-right text-ink-60">{formatNumber(Number(r.messages ?? 0))}</TableCell>
                    <TableCell className="text-right text-ink-60">{formatNumber(Number(r.inputTokens ?? 0))}</TableCell>
                    <TableCell className="text-right text-ink-60">{formatNumber(Number(r.outputTokens ?? 0))}</TableCell>
                    <TableCell className="text-right font-medium">{usd(r.costUsd)}</TableCell>
                    <TableCell className="text-ink-60">{r.lastUsedAt ? formatDate(r.lastUsedAt) : '—'}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-ink-60">
                      No AI usage yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {list.data && list.data.total > 0 && (
              <div className="px-4 pb-3 pt-3">
                <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
