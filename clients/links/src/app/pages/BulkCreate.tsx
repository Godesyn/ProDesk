/* Bulk create — paste many destinations (one per line, optional "url, label")
 * and mint a link for each via shortLinks.bulkCreate. Links are created
 * INACTIVE; switch on the ones you want from the Links list (that's what bills). */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon, EmptyState } from '../components';
import { useToast } from '../toast';
import { useLinksInvalidate } from '../use-invalidate';
import type { PageProps } from '../types';

type ParsedRow = { destinationUrl: string; nickname?: string };

function parseLines(text: string): ParsedRow[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      // "https://… , Label" — split on the first comma only.
      const comma = line.indexOf(',');
      if (comma > -1) {
        return {
          destinationUrl: line.slice(0, comma).trim(),
          nickname: line.slice(comma + 1).trim() || undefined,
        };
      }
      return { destinationUrl: line };
    });
}

export function BulkCreate({ brandId, go }: PageProps) {
  const trpc = useTRPC();
  const { afterLinkChange: invalidate } = useLinksInvalidate();
  const toast = useToast();

  const [text, setText] = useState('');
  const [result, setResult] = useState<{
    createdCount: number;
    errors: { row: number; destinationUrl: string; error: string }[];
  } | null>(null);

  const bulk = useMutation(trpc.shortLinks.bulkCreate.mutationOptions());

  const rows = useMemo(() => parseLines(text), [text]);

  async function submit() {
    if (rows.length === 0) {
      toast('Paste at least one destination URL.');
      return;
    }
    try {
      const res = await bulk.mutateAsync({
        brandId,
        items: rows,
      });
      invalidate();
      setResult({ createdCount: res.createdCount, errors: res.errors });
      setText('');
      toast(`Created ${res.createdCount} link${res.createdCount === 1 ? '' : 's'}.`);
    } catch (e) {
      toast('Error: ' + (e instanceof Error ? e.message : 'bulk create failed'));
    }
  }

  return (
    <div>
      <div className="apage-head">
        <h1>Bulk create</h1>
        <span className="meta">One destination per line</span>
        <span className="spacer" />
        <button className="abtn abtn-ghost" onClick={() => go('links')}>
          <Icon name="back" size={14} />
          Links
        </button>
      </div>

      <div className="abanner">
        <span className="bt">Created switched off.</span>
        <span className="bs">
          Bulk links are added inactive and free. Switch a link on from the Links
          page to take it live — enabling is what starts billing.
        </span>
      </div>

      <div className="detail-grid">
        <div className="dcard">
          <div className="db" style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="afield">
              <label>Destinations</label>
              <textarea
                className="ainput"
                style={{ minHeight: 220, fontFamily: 'var(--font-mono)', fontSize: 13 }}
                placeholder={
                  'https://example.com/page-one, Page one\nhttps://example.com/page-two\nhttps://example.com/page-three, Promo'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <span className="hint">
                Optional label after a comma. Auto endings are generated; links
                start switched off so you only pay for the ones you activate.
              </span>
            </div>


            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                className="abtn abtn-primary abtn-lg"
                disabled={bulk.isPending || rows.length === 0}
                onClick={submit}
              >
                {bulk.isPending
                  ? 'Creating…'
                  : `Create ${rows.length || ''} link${rows.length === 1 ? '' : 's'}`}
              </button>
              <span className="mutetext">{rows.length} parsed</span>
            </div>
          </div>
        </div>

        {/* Result panel */}
        <div className="dcard" style={{ position: 'sticky', top: 20 }}>
          <div className="dh">
            <h2>Result</h2>
          </div>
          <div className="db">
            {!result ? (
              <EmptyState
                title="Nothing yet."
                body="Paste your destinations and create — a summary appears here."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="kpi accent">
                  <div className="lbl">Created</div>
                  <div className="num">{result.createdCount}</div>
                </div>
                {result.errors.length > 0 && (
                  <div>
                    <div className="aeyebrow" style={{ marginBottom: 6 }}>
                      {result.errors.length} skipped
                    </div>
                    {result.errors.map((er) => (
                      <div key={er.row} className="hrow" style={{ alignItems: 'flex-start' }}>
                        <span className="hurls" style={{ wordBreak: 'break-all' }}>
                          {er.destinationUrl || '(empty)'}
                          <span style={{ color: 'var(--danger)', display: 'block' }}>
                            {er.error}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <button className="abtn abtn-primary" onClick={() => go('links')}>
                  View links
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
