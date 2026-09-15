import { useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, Download, Link2, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '@shared/lib/trpc';
import { shareLinkPath } from '@server/modules/logo/share-link';
import { PageHeader, Eyebrow, InkButton, PigmentButton } from '../components/primitives';
import { SvgMark } from '../components/SvgMark';
import { useStudio } from '../app/studio-context';

/**
 * The public URL for a shared rulebook. `shareLinkPath` owns which path a token
 * shape is served from — a readable `acme-coffee/v2` under `/share/`, a legacy
 * hex token under `/g/` — and App.tsx matches the same two.
 */
const shareUrl = (token: string) => `${window.location.origin}${shareLinkPath(token)}`;

export function Guidelines() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { overview, projectId } = useStudio();
  const chosen = overview.data?.chosen ?? null;
  const [copied, setCopied] = useState(false);

  const guide = useQuery(
    trpc.logo.guidelines.get.queryOptions(
      { generationId: chosen?.id ?? '' },
      { enabled: !!chosen },
    ),
  );
  const share = useMutation(trpc.logo.guidelines.share.mutationOptions());
  const exportMut = useMutation(trpc.logo.assets.export.mutationOptions());

  if (!chosen) {
    return (
      <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
        <PageHeader
          index="05"
          eyebrow="Guidelines"
          title="No mark yet."
          lede="Choose a concept and we'll write its rulebook."
        />
        <PigmentButton className="mt-8" onClick={() => navigate('/concepts')}>
          See concepts <ArrowUpRight className="h-4 w-4" />
        </PigmentButton>
      </div>
    );
  }

  const rules = guide.data?.rules ?? [];
  const sizes = guide.data?.minSizes ?? [];
  // Clearspace and the size ladder are statements about the MARK in a square, so
  // they show the ink-centred square lockup. The raw mark carries whatever offset
  // the artwork has inside its own viewBox, which at 16–24px reads as off-centre.
  const squareMark = guide.data?.lockups.mark || chosen.svg;
  const token = guide.data?.shareToken ?? null;
  const dos = rules.filter((r) => r.do);
  const donts = rules.filter((r) => !r.do);
  const clearspace = guide.data?.clearspace ?? '1.0x';

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: trpc.logo.guidelines.get.queryKey({ generationId: chosen.id }),
    });

  const onExport = () => {
    exportMut.mutate(
      { generationId: chosen.id, format: 'guidelines' },
      {
        onSuccess: (res) => {
          const file = res.files[0];
          if (file) window.open(file.url, '_blank', 'noopener');
          toast.success('Guidelines PDF ready.');
          void qc.invalidateQueries({ queryKey: trpc.logo.overview.queryKey() });
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  /**
   * Put the link on the clipboard. Returns whether it landed, so the caller can
   * say "copied" only when it actually was — `navigator.clipboard` rejects
   * outright on an insecure origin or a denied permission.
   */
  const copyLink = async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Publish the link. Creating and copying are ONE action: the only reason to
   * press this is to send the link to someone, so making them find a second
   * button first is a step with no decision in it.
   *
   * Idempotent server-side, and there is no revoke — see the `share` procedure.
   */
  const onShare = () => {
    if (!projectId || token) return;
    share.mutate(
      { projectId },
      {
        onSuccess: async (res) => {
          void invalidate();
          const copiedNow = res.shareToken ? await copyLink(shareUrl(res.shareToken)) : false;
          toast.success(
            copiedNow ? 'Share link copied to your clipboard.' : 'Share link is live.',
          );
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const onCopy = async () => {
    if (!token) return;
    if (!(await copyLink(shareUrl(token))))
      toast.error('Could not copy — select the link and copy it manually.');
  };

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <PageHeader
        index="05"
        eyebrow="Guidelines"
        title="How to use the mark."
        lede="A living rulebook that travels with the brand — share it as a link, or export the full PDF."
        action={
          <InkButton onClick={onExport}>
            {exportMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export PDF
          </InkButton>
        }
      />

      {guide.isLoading ? (
        <div className="mt-16 grid place-items-center">
          <Loader2 className="h-7 w-7 animate-spin text-[var(--ink-3)]" />
        </div>
      ) : (
        <>
          {/* Share link */}
          <section className="mt-8 rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <Eyebrow>Share</Eyebrow>
                <p className="mt-1.5 text-sm text-[var(--ink-2)]">
                  {token
                    ? 'Anyone with this link can read the rulebook — no account needed.'
                    : 'Publish a read-only link so a printer, developer, or teammate can follow the rules.'}
                </p>
              </div>
              {!token && (
                <button
                  onClick={onShare}
                  disabled={share.isPending || !projectId}
                  className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-semibold text-white transition disabled:opacity-60"
                  style={{ borderColor: 'var(--pigment)', background: 'var(--pigment)' }}
                >
                  {share.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                  Create share link
                </button>
              )}
            </div>
            {token && (
              <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)] py-2 pl-3 pr-2">
                <span className="spec min-w-0 flex-1 truncate" style={{ textTransform: 'none' }}>
                  {shareUrl(token)}
                </span>
                <button
                  onClick={() => void onCopy()}
                  className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--card)] px-3 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--stage-2)]"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" style={{ color: 'var(--pigment)' }} />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
              <Eyebrow>Clearspace</Eyebrow>
              <p className="mt-2 text-sm text-[var(--ink-2)]">
                Keep {clearspace} of cap-height breathing room on every side.
              </p>
              <div className="stage-grid mt-5 grid place-items-center rounded-[var(--radius-md)] border border-[var(--hair-2)] py-10">
                <div className="relative grid place-items-center p-12">
                  <div className="pointer-events-none absolute inset-3 rounded-sm border border-dashed border-[var(--hair-2)]" />
                  <span className="spec absolute -top-1 left-1/2 -translate-x-1/2" style={{ fontSize: 9 }}>
                    {clearspace}
                  </span>
                  <span
                    className="spec absolute -left-3 top-1/2 -translate-y-1/2 -rotate-90"
                    style={{ fontSize: 9 }}
                  >
                    {clearspace}
                  </span>
                  <SvgMark svg={squareMark} className="h-20 w-20" />
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
              <Eyebrow>Minimum sizes</Eyebrow>
              <p className="mt-2 text-sm text-[var(--ink-2)]">
                The mark stays legible down to 24px. Below that, use the favicon.
              </p>
              {/* Rendered at true pixel sizes — the point is to see the limit. */}
              <div className="mt-6 flex flex-wrap items-end justify-around gap-6">
                {sizes.map((s) => (
                  <div key={s.px} className="flex flex-col items-center gap-3">
                    <SvgMark
                      svg={squareMark}
                      className="shrink-0"
                      style={{ width: s.px, height: s.px }}
                      title={`${s.px}px`}
                    />
                    <div className="text-center" style={{ width: Math.max(s.px, 44) }}>
                      <div className="spec tnum">{s.px}px</div>
                      <div className="spec" style={{ fontSize: 9 }}>
                        {s.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-6 md:grid-cols-2">
            <RuleColumn tone="do" title="Do" rules={dos.map((r) => r.text)} />
            <RuleColumn tone="dont" title="Don’t" rules={donts.map((r) => r.text)} />
          </section>
        </>
      )}
    </div>
  );
}

function RuleColumn({ tone, title, rules }: { tone: 'do' | 'dont'; title: string; rules: string[] }) {
  const ok = tone === 'do';
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-white"
          style={{ background: ok ? 'var(--pigment)' : 'var(--color-danger)' }}
        >
          {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </span>
        <h3 className="text-base font-bold text-[var(--ink)]">{title}</h3>
      </div>
      <ul className="mt-4 space-y-3">
        {rules.map((r) => (
          <li key={r} className="flex gap-3 text-sm text-[var(--ink-2)]">
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: ok ? 'var(--pigment)' : 'var(--color-danger)' }}
            />
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
