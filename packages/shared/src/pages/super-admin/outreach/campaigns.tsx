import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  MERGE_TAGS,
  findBlankableTags,
  findUnknownTags,
  renderTemplate,
  resolveMergeValues,
} from '@server/modules/outreach/merge-tags';
import { BODY_SYNTAX, renderEmailDocument } from '@server/modules/outreach/email-shell';
import { useTRPC } from '../../../lib/trpc';
import { getErrorMessage, toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useConfirm } from '../../../components/ui/confirm-dialog';
import { OutreachShell } from './shell';
import { useReducedMotion } from './motion';

/**
 * SENDING EMAIL — /super-admin/outreach/campaigns
 *
 * ONE campaign, named by `OUTREACH_CAMPAIGN_NAME`, created on the first visit to
 * this page if Smartlead doesn't have it yet. There is nothing to pick between
 * and nothing to name, so this screen has no list and no "new campaign" form:
 * opening it is what brings the campaign into existence, and what you see is the
 * one thing this environment sends.
 *
 * The vertical used to be the campaign name — one campaign per vertical — which
 * meant every new vertical started a campaign with no sequence, no mailboxes and
 * no schedule. The vertical still travels with the list and the prospect; it
 * just no longer decides who sends.
 *
 * This screen stays deliberately quiet. The Sending Floor is the feature's one
 * hero; everything here is precision work — a spine of sequence steps with the
 * real delays between them, and a preview that shows what a real person receives.
 */

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface DraftStep {
  id: number | null;
  seqNumber: number;
  subject: string;
  body: string;
  delayInDays: number;
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'text-ink-100',
  PAUSED: 'text-warn',
  STOPPED: 'text-danger',
  DRAFTED: 'text-ink-40',
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        status === 'ACTIVE'
          ? 'bg-accent'
          : status === 'PAUSED'
            ? 'bg-warn'
            : status === 'STOPPED'
              ? 'bg-danger'
              : 'bg-ink-20',
      )}
    />
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sequence editor
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The delay between two steps, rendered as the gap that separates them.
 *
 * Numbering the steps is legitimate here in a way it isn't elsewhere in this
 * feature — a sequence genuinely is a sequence, and the order carries meaning
 * the operator needs. The gap height tracks the delay, so a 7-day wait looks
 * longer than a 4-day one.
 */
function DelayGap({
  days,
  onChange,
  disabled,
}: {
  days: number;
  onChange: (d: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pl-[calc(1.5rem+1px)]">
      <div
        className="w-px shrink-0 bg-[color:var(--color-border-default)]"
        style={{ height: `${Math.min(64, 16 + days * 6)}px` }}
      />
      <label className="text-ui-xs flex items-center gap-2 text-ink-40">
        wait
        <input
          type="number"
          min={0}
          max={365}
          value={days}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="tnum h-7 w-14 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-transparent px-2 text-ui-xs text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
        />
        days
      </label>
    </div>
  );
}

function SequenceStep({
  step,
  index,
  disabled,
  onChange,
  onRemove,
  canRemove,
  onFocusBody,
}: {
  step: DraftStep;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<DraftStep>) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** Tells the page which body a picked merge tag should land in. */
  onFocusBody: (el: HTMLTextAreaElement) => void;
}) {
  const isFirst = index === 0;

  return (
    <div className="flex gap-3">
      <div
        aria-hidden
        className="tnum mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--color-border-hairline)] text-[11px] text-ink-60"
      >
        {step.seqNumber}
      </div>

      <div className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow">{isFirst ? 'First touch' : `Follow-up ${index}`}</span>
          {canRemove && (
            <button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              className="text-ui-xs text-ink-40 underline-offset-4 hover:text-danger hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>

        {isFirst ? (
          <Input
            className="mt-3"
            placeholder="Subject"
            value={step.subject}
            disabled={disabled}
            onChange={(e) => onChange({ subject: e.target.value })}
          />
        ) : (
          <p className="text-ui-xs mt-3 text-ink-40">
            No subject — this threads under the first email, so replies stay in one
            conversation.
          </p>
        )}

        <textarea
          rows={9}
          value={step.body}
          disabled={disabled}
          onFocus={(e) => onFocusBody(e.currentTarget)}
          placeholder={
            isFirst
              ? [
                  'Hi {{first_name}},',
                  '',
                  'I had a look at {{company_name}} and {{detail}} stood out.',
                  '',
                  '> What we saw on Google',
                  '> {{hook}}',
                  '',
                  '[See what we would do](https://…)',
                ].join('\n')
              : 'Following up on the note below…'
          }
          onChange={(e) => onChange({ body: e.target.value })}
          className="mono mt-3 w-full resize-y rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-paper p-3 text-[12px] leading-relaxed text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
        />
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Preview
 * ────────────────────────────────────────────────────────────────────────── */

/** The two widths worth checking: the design's own column, and a phone. */
const WIDTHS = [
  { px: 600, label: 'Desktop' },
  { px: 390, label: 'Phone' },
] as const;

type PreviewWidth = (typeof WIDTHS)[number]['px'];

function WidthToggle({
  width,
  onChange,
}: {
  width: PreviewWidth;
  onChange: (w: PreviewWidth) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Preview width"
      className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
    >
      {WIDTHS.map((w) => (
        <button
          key={w.px}
          type="button"
          aria-pressed={width === w.px}
          onClick={() => onChange(w.px)}
          className={cn(
            'press text-ui-xs h-7 px-2.5 transition-colors duration-[var(--duration-quick)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
            width === w.px ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
          )}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One step, rendered as the letter that leaves the building.
 *
 * An iframe rather than dangerouslySetInnerHTML, and not for safety — the app's
 * own stylesheet would otherwise reach into the email and restyle it, which is
 * the one thing a preview must not do. Inside the frame the letter has only the
 * inline styles it will actually be read with.
 *
 * `sandbox` without `allow-scripts`: nothing in an email should run, and
 * `allow-same-origin` is only there so the height can be measured.
 */
function LetterPreview({
  index,
  delayInDays,
  subject,
  html,
  width,
}: {
  index: number;
  delayInDays: number;
  subject: string;
  html: string;
  width: PreviewWidth;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(320);

  // Measured, not fixed: a four-paragraph letter and a one-liner are very
  // different heights, and a scrollbar inside the frame would hide the footer —
  // the part nobody remembers to check.
  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) setHeight(doc.body.scrollHeight);
  };
  useEffect(fit, [html, width]);

  return (
    <article className="mb-6 last:mb-0">
      <div className="eyebrow">
        {index === 0 ? 'First touch' : `Follow-up ${index} · after ${delayInDays} days`}
      </div>
      <div className="text-ui-md mt-1 text-ink-100">
        {index === 0 ? (
          subject || <span className="text-ink-40">No subject</span>
        ) : (
          <span className="text-ink-40">
            No subject — threads under the first email as “Re:”
          </span>
        )}
      </div>
      <div className="mt-2 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)]">
        <iframe
          ref={frame}
          title={index === 0 ? 'First touch preview' : `Follow-up ${index} preview`}
          srcDoc={html}
          onLoad={fit}
          sandbox="allow-same-origin"
          style={{ width, height, maxWidth: '100%' }}
          className="block bg-white"
        />
      </div>
    </article>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * The composer's reference
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What a tag becomes when the prospect has nothing, stated next to the tag.
 *
 * The fallbacks existed before this screen showed them, which meant the only
 * way to find out what `{{website}}` did for a business with no site was to
 * read the pusher. A tag whose empty case is invisible is a tag someone will
 * write a sentence around.
 */
function TagReference({ onInsert }: { onInsert: (tag: string) => void }) {
  return (
    <div>
      <span className="eyebrow">Merge tags</span>
      <ul className="mt-2 space-y-1.5">
        {MERGE_TAGS.map((m) => (
          <li key={m.tag} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <button
              type="button"
              // mousedown, not click: the textarea must still hold the caret
              // when the tag lands in it.
              onMouseDown={(e) => {
                e.preventDefault();
                onInsert(m.tag);
              }}
              title={`Insert ${m.tag}`}
              className="mono press rounded-[var(--radius-sm)] bg-inset px-1.5 py-0.5 text-[11px] text-ink-80 hover:bg-ink-100 hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
            >
              {m.tag}
            </button>
            <span className="text-ui-xs text-ink-40">
              {m.fallback ? (
                <>
                  empty → <span className="text-ink-60">“{m.fallback}”</span>
                </>
              ) : (
                <span className="text-warn">can send blank</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The body markup, listed where it is written rather than in a doc nobody opens. */
function SyntaxReference() {
  return (
    <div>
      <span className="eyebrow">Formatting</span>
      <ul className="mt-2 space-y-1.5">
        {BODY_SYNTAX.map((r) => (
          <li key={r.syntax} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <code className="mono rounded-[var(--radius-sm)] bg-inset px-1.5 py-0.5 text-[11px] whitespace-pre-line text-ink-80">
              {r.syntax}
            </code>
            <span className="text-ui-xs text-ink-40">{r.means}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Page
 * ────────────────────────────────────────────────────────────────────────── */

export function OutreachCampaignsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const reduced = useReducedMotion();

  // One query for the whole screen. It also CREATES the campaign if this
  // environment's name isn't in Smartlead yet — reaching the page is the setup.
  const campaignKey = trpc.outreach.campaign.queryKey();
  const campaignQuery = useQuery(trpc.outreach.campaign.queryOptions());
  const campaign = campaignQuery.data ?? null;

  const previewQuery = useQuery(trpc.outreach.previewProspect.queryOptions());

  const [draft, setDraft] = useState<DraftStep[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<PreviewWidth>(600);

  // The textarea a tag would land in. Held as a ref rather than state because
  // it changes on every focus and nothing renders from it.
  const focused = useRef<{ el: HTMLTextAreaElement; index: number } | null>(null);

  /** Drop a tag at the caret of whichever body was last being written in. */
  const insertTag = (tag: string) => {
    const target = focused.current;
    if (!target) {
      toast('Click into an email first, then pick a tag.');
      return;
    }
    const { el, index } = target;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + tag + el.value.slice(end);
    setDraft((prev) => (prev ?? []).map((x, j) => (j === index ? { ...x, body: next } : x)));
    // After React writes the new value, put the caret past what was inserted so
    // the operator can keep typing the sentence they were in the middle of.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length, start + tag.length);
    });
  };

  // Adopt the saved sequence when it arrives. Editing is local until saved, so
  // this deliberately does not re-run on every refetch — only when the sequence
  // Smartlead reports actually changes.
  useEffect(() => {
    const seq = campaignQuery.data?.sequences;
    if (!seq) return;
    setDraft(
      seq.length
        ? seq.map((s, i) => ({
            id: s.id,
            seqNumber: s.seq_number ?? i + 1,
            subject: s.subject ?? '',
            body: s.email_body ?? '',
            // Resolved server-side (ours, then Smartlead's). The default is
            // only for a step nothing has a delay for at all — reading it off
            // Smartlead's payload here is what used to reset every saved
            // follow-up to 5 days on refresh.
            delayInDays: s.delayInDays ?? (i === 0 ? 0 : 5),
          }))
        : [{ id: null, seqNumber: 1, subject: '', body: '', delayInDays: 0 }],
    );
  }, [campaignQuery.data?.sequences]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: campaignKey });
  };

  const saveSequences = useMutation({
    ...trpc.outreach.saveSequences.mutationOptions(),
    onSuccess: (r) => {
      invalidateAll();
      if (r.resumeError) {
        // The dangerous case: saved, but the campaign is now sitting paused.
        toast.error('Saved, but the campaign did not restart.', {
          description: `${r.resumeError} Start it again from the header.`,
          duration: 12_000,
        });
      } else {
        toast(r.pausedAndResumed ? 'Sequence saved. Campaign resumed.' : 'Sequence saved.');
      }
    },
    onError: (e) => toastError(e),
  });

  const setStatus = useMutation({
    ...trpc.outreach.setCampaignStatus.mutationOptions(),
    onSuccess: (r) => {
      invalidateAll();
      toast(r.status === 'ACTIVE' ? 'Campaign started.' : `Campaign ${r.status.toLowerCase()}.`);
    },
    onError: (e) => toastError(e),
  });

  const busy = saveSequences.isPending || setStatus.isPending;

  const start = async () => {
    if (!campaign) return;
    // Genuinely irreversible: the first emails go out and cannot be recalled.
    const ok = await confirm({
      title: `Start "${campaign.name}"?`,
      description: 'Emails begin sending on the campaign schedule. Sent email cannot be recalled.',
      confirmLabel: 'Start sending',
    });
    if (!ok) return;
    setStatus.mutate({ status: 'ACTIVE' });
  };

  // The SAME resolver the lead upload runs, imported rather than reimplemented.
  // These were two hand-kept lists: the preview invented a first name from the
  // first word of the business name, so the screen read "Hi Sydney," while every
  // recipient got "Hi ,", and it hardcoded {{location}} blank when the real send
  // had an address. Both were invisible from this screen, which is the one
  // screen whose job is to show what gets sent.
  const previewValues = useMemo(
    () => resolveMergeValues(previewQuery.data ?? {}),
    [previewQuery.data],
  );

  const render = (body: string) => renderTemplate(body, previewValues);

  // Everything wrong with the draft, gathered once. Unknown tags block the save
  // server-side; the blankable two are a warning, because they are legitimate —
  // just capable of arriving empty.
  const draftIssues = useMemo(() => {
    const bodies = (draft ?? []).flatMap((s) => [s.subject, s.body]);
    const unknown = new Set<string>();
    const blankable = new Set<string>();
    for (const b of bodies) {
      findUnknownTags(b).forEach((t) => unknown.add(t));
      findBlankableTags(b).forEach((t) => blankable.add(t));
    }
    return { unknown: [...unknown], blankable: [...blankable] };
  }, [draft]);

  // A step whose body came back from Smartlead rather than from us, already
  // rendered. It can only happen if the stored source was lost, and the only
  // safe thing to do is say so — silently letting someone edit rendered markup
  // would re-wrap it in the shell on the next save.
  const rawHtmlSteps = (campaign?.sequences ?? []).some(
    (s) => !s.hasSource && (s.email_body ?? '').includes('<table'),
  );

  const attachedCount = campaign?.emailAccountIds?.length ?? null;

  return (
    <OutreachShell
      title="Sending Email"
      description="The one campaign this environment sends. Sequences, schedules and mailboxes push straight to Smartlead."
    >
      {campaignQuery.isError && (
        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-danger)] bg-card px-5 py-4">
          <p className="text-ui-sm text-danger">There is no campaign to send with.</p>
          <p className="text-ui-xs mt-1 text-ink-60">{getErrorMessage(campaignQuery.error)}</p>
        </div>
      )}

      {campaignQuery.isPending && (
        <p className="text-ui-sm text-ink-40">Opening the campaign…</p>
      )}

      {!campaignQuery.isError && (
        <div className="grid grid-cols-1 items-start gap-5">
          <section>
            {campaign && (
              <>
                <header className="flex flex-wrap items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-5 py-4">
                  <div className="min-w-0">
                    <div className="eyebrow">Campaign</div>
                    <h2 className="text-panel-title mt-1 truncate text-ink-100">{campaign.name}</h2>
                    {/* State and reach, on the line where sending is started and
                        stopped. A campaign attached to no mailboxes sends
                        nothing however healthy the rest of it looks — it should
                        never happen now that they are attached on sight, which
                        is exactly why it has to be visible when it does. */}
                    <div className="text-ui-xs mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusDot status={campaign.status} />
                      <span className={STATUS_TONE[campaign.status] ?? 'text-ink-40'}>
                        {campaign.status.toLowerCase()}
                      </span>
                      {attachedCount !== null && (
                        <>
                          <span aria-hidden className="text-ink-20">
                            ·
                          </span>
                          <span className={attachedCount === 0 ? 'text-warn' : 'text-ink-40'}>
                            {attachedCount === 0
                              ? 'no mailboxes attached'
                              : `sending from all ${attachedCount} mailbox${attachedCount === 1 ? '' : 'es'}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {campaign.status === 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setStatus.mutate({ status: 'PAUSED' })}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy} onClick={start}>
                        Start sending
                      </Button>
                    )}
                  </div>
                </header>

                {campaign.justCreated && (
                  <p className="text-ui-xs mt-3 rounded-[var(--radius-sm)] bg-inset px-3 py-2 text-ink-60">
                    Created just now, because this environment had no campaign by that name. It has
                    the default schedule below and every mailbox attached &mdash; it needs a
                    sequence before it can send.
                  </p>
                )}

                {campaign.status === 'ACTIVE' && (
                  <p className="text-ui-xs mt-3 rounded-[var(--radius-sm)] bg-inset px-3 py-2 text-ink-60">
                    This campaign is running. Saving a sequence pauses it, saves, and starts it
                    again — Smartlead won&rsquo;t accept edits to a live campaign.
                  </p>
                )}

                {/* Sequence */}
                <div className="mt-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-ui-md text-ink-100">Sequence</h3>
                    <div className="flex items-center gap-2">
                      {/* A mode switch, drawn as one — the same segmented
                          control the caps, days and filters use, rather than a
                          text link whose label was the mode you were not in. */}
                      <div
                        role="group"
                        aria-label="Sequence view"
                        className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
                      >
                        {([false, true] as const).map((preview) => (
                          <button
                            key={String(preview)}
                            type="button"
                            aria-pressed={showPreview === preview}
                            onClick={() => setShowPreview(preview)}
                            className={cn(
                              'press h-8 px-3 text-ui-xs transition-colors duration-[var(--duration-quick)]',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                              showPreview === preview
                                ? 'bg-ink-100 text-paper'
                                : 'text-ink-60 hover:bg-inset',
                            )}
                          >
                            {preview ? 'Preview' : 'Edit'}
                          </button>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        // The server rejects an unknown tag too — this is the
                        // same rule stated where it can be fixed, so the save
                        // never has to fail to teach it.
                        disabled={busy || !draft || draftIssues.unknown.length > 0}
                        title={
                          draftIssues.unknown.length > 0
                            ? `Fix ${draftIssues.unknown.join(', ')} first`
                            : undefined
                        }
                        onClick={() =>
                          draft &&
                          saveSequences.mutate({
                            sequences: draft.map((s, i) => ({ ...s, seqNumber: i + 1 })),
                          })
                        }
                      >
                        Save sequence
                      </Button>
                    </div>
                  </div>

                  {showPreview ? (
                    <div>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        {previewQuery.data ? (
                          <p className="text-ui-xs text-ink-40">
                            Against{' '}
                            <span className="mono text-ink-60">{previewQuery.data.email}</span>
                            {!previewQuery.data.detail &&
                              ' — no personalisation detail, so this is the fallback'}
                          </p>
                        ) : (
                          <p className="text-ui-xs text-ink-40">
                            No prospects yet, so every tag shows its fallback. Build a list to
                            preview against a real one.
                          </p>
                        )}
                        <WidthToggle width={previewWidth} onChange={setPreviewWidth} />
                      </div>

                      {(draft ?? []).map((s, i) => (
                        <LetterPreview
                          key={i}
                          index={i}
                          delayInDays={s.delayInDays}
                          subject={render(s.subject)}
                          html={renderEmailDocument(render(s.body))}
                          width={previewWidth}
                        />
                      ))}
                    </div>
                  ) : (
                    <div>
                      {(draft ?? []).map((s, i) => (
                        <div key={i}>
                          {i > 0 && (
                            <DelayGap
                              days={s.delayInDays}
                              disabled={busy}
                              onChange={(d) =>
                                setDraft((prev) =>
                                  (prev ?? []).map((x, j) =>
                                    j === i ? { ...x, delayInDays: d } : x,
                                  ),
                                )
                              }
                            />
                          )}
                          <SequenceStep
                            step={s}
                            index={i}
                            disabled={busy}
                            canRemove={(draft?.length ?? 0) > 1}
                            onFocusBody={(el) => {
                              focused.current = { el, index: i };
                            }}
                            onChange={(patch) =>
                              setDraft((prev) =>
                                (prev ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)),
                              )
                            }
                            onRemove={() =>
                              setDraft((prev) => (prev ?? []).filter((_, j) => j !== i))
                            }
                          />
                        </div>
                      ))}

                      {(draft?.length ?? 0) < 4 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setDraft((prev) => [
                              ...(prev ?? []),
                              {
                                id: null,
                                seqNumber: (prev?.length ?? 0) + 1,
                                subject: '',
                                body: '',
                                delayInDays: 5,
                              },
                            ])
                          }
                          className="text-ui-xs mt-4 ml-[calc(1.5rem+0.75rem)] inline-flex items-center gap-1.5 text-ink-60 underline-offset-4 hover:text-ink-100 hover:underline disabled:opacity-50"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add a follow-up
                        </button>
                      )}

                      {rawHtmlSteps && (
                        <p className="text-ui-xs mt-5 rounded-[var(--radius-sm)] border border-[color:var(--color-warn)]/30 bg-inset px-3 py-2 text-warn">
                          One of these steps is showing the rendered letter, not the note it was
                          written from — its saved copy is missing. Rewrite the body in plain
                          text before saving, or the next save wraps the markup a second time.
                        </p>
                      )}
                      {draftIssues.unknown.length > 0 && (
                        <p className="text-ui-xs mt-5 rounded-[var(--radius-sm)] border border-[color:var(--color-danger)]/30 bg-inset px-3 py-2 text-danger">
                          <span className="mono">{draftIssues.unknown.join(', ')}</span>{' '}
                          {draftIssues.unknown.length === 1 ? 'is not a merge tag' : 'are not merge tags'}.
                          Saving is blocked until it matches one below — Smartlead would send it blank.
                        </p>
                      )}
                      {draftIssues.blankable.length > 0 && (
                        <p className="text-ui-xs mt-3 rounded-[var(--radius-sm)] border border-[color:var(--color-warn)]/30 bg-inset px-3 py-2 text-warn">
                          <span className="mono">{draftIssues.blankable.join(' and ')}</span> can
                          arrive empty — a business with no reviews has neither. Use{' '}
                          <span className="mono">{'{{hook}}'}</span> to put those numbers in a
                          sentence; it is composed per prospect and always reads.
                        </p>
                      )}

                      <div className="mt-6 grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <TagReference onInsert={insertTag} />
                        <SyntaxReference />
                      </div>
                    </div>
                  )}
                </div>

                <SchedulePanel
                  key={campaign.id}
                  saved={campaign.schedule}
                  busy={busy}
                  reduced={reduced}
                />
              </>
            )}
          </section>
        </div>
      )}
    </OutreachShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Schedule
 * ────────────────────────────────────────────────────────────────────────── */

interface SavedSchedule {
  timezone: string;
  days: number[];
  startHour: string;
  endHour: string;
  minTimeBtwEmails: number;
  maxNewLeadsPerDay: number;
}

function SchedulePanel({
  saved,
  busy,
  reduced,
}: {
  saved: SavedSchedule | undefined;
  busy: boolean;
  reduced: boolean;
}) {
  const trpc = useTRPC();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState('09:00');
  const [endHour, setEndHour] = useState('17:00');
  const [gap, setGap] = useState(12);
  const [maxNewLeads, setMaxNewLeads] = useState(400);

  // Adopt the saved schedule once it arrives, and only once — a refetch while
  // the operator is mid-edit must not overwrite what they have typed.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!saved || hydrated) return;
    setDays(saved.days);
    setStartHour(saved.startHour);
    setEndHour(saved.endHour);
    setGap(saved.minTimeBtwEmails);
    setMaxNewLeads(saved.maxNewLeadsPerDay);
    setHydrated(true);
  }, [saved, hydrated]);

  const save = useMutation({
    ...trpc.outreach.saveSchedule.mutationOptions(),
    onSuccess: () => toast('Schedule saved.'),
    onError: (e) => toastError(e),
  });

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  return (
    <section
      className="mt-6 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-5 py-5"
      style={reduced ? undefined : { animation: 'reveal var(--duration-standard) var(--ease-click) both' }}
    >
      <h3 className="text-ui-md text-ink-100">Schedule</h3>
      <p className="text-ui-xs mt-1 text-ink-60">
        When this campaign is allowed to send, in the recipient&rsquo;s timezone.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <div className="eyebrow">Days</div>
          <div className="mt-2 inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
            {DAY_LABELS.map((label, d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                aria-pressed={days.includes(d)}
                aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]}
                onClick={() => toggleDay(d)}
                className={cn(
                  'press h-8 w-8 text-ui-xs transition-colors duration-[var(--duration-quick)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                  days.includes(d) ? 'bg-ink-100 text-paper' : 'text-ink-40 hover:bg-inset',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <div className="eyebrow">From</div>
          <Input
            type="time"
            className="mt-2 w-32"
            value={startHour}
            disabled={busy}
            onChange={(e) => setStartHour(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="eyebrow">To</div>
          <Input
            type="time"
            className="mt-2 w-32"
            value={endHour}
            disabled={busy}
            onChange={(e) => setEndHour(e.target.value)}
          />
        </label>

        <label className="block">
          <div className="eyebrow">Min gap</div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              min={3}
              max={1440}
              className="tnum w-24"
              value={gap}
              disabled={busy}
              // 3 is Smartlead's floor, not ours — anything lower is a 400.
              onChange={(e) => setGap(Math.max(3, Number(e.target.value) || 3))}
            />
            <span className="text-ui-xs text-ink-40">min</span>
          </div>
        </label>

        <label className="block">
          <div className="eyebrow">New leads/day</div>
          <Input
            type="number"
            min={1}
            max={10000}
            className="tnum mt-2 w-24"
            value={maxNewLeads}
            disabled={busy}
            onChange={(e) => setMaxNewLeads(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <Button
          size="sm"
          disabled={busy || save.isPending || days.length === 0}
          onClick={() =>
            save.mutate({
              timezone:
                saved?.timezone ||
                Intl.DateTimeFormat().resolvedOptions().timeZone ||
                'Australia/Sydney',
              days,
              startHour,
              endHour,
              minTimeBtwEmails: gap,
              maxNewLeadsPerDay: maxNewLeads,
            })
          }
        >
          Save schedule
        </Button>
      </div>
    </section>
  );
}
