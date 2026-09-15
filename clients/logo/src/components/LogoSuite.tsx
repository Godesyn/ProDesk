import { useState } from 'react';
import { Download, FileCode2, ImageDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SuiteAsset } from '@server/modules/logo/suite';
import { SvgMark } from './SvgMark';
import { downloadPng, downloadSuiteZip, downloadSvg, type DownloadFormat } from '../lib/download-mark';

/**
 * THE LOGO SUITE — the twelve files a brand is handed, shown as the matrix they
 * are: six forms down, two colourways across.
 *
 * One component, two homes (the owner's Assets screen and the public share page),
 * because the whole promise of the suite is that what a supplier downloads from a
 * shared link is the same set the owner exports. Two implementations of that grid
 * would eventually be two different logos.
 *
 * The composition is server-side (modules/logo/suite.ts — setting the wordmark
 * needs the font binaries); everything here is presentation plus the download,
 * which is made in the browser from markup the page already holds.
 */

/** Two icon buttons per tile — raster and vector, side by side. */
function TileDownloads({ svg, name, what }: { svg: string; name: string; what: string }) {
  const [busy, setBusy] = useState(false);

  // Rasterising is async (the SVG has to decode through an <img> first), so this
  // one reports progress; the SVG is a synchronous blob and never needs to.
  const onPng = async () => {
    setBusy(true);
    try {
      await downloadPng(svg, `${name}.png`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build that PNG.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton label={`Download the ${what} as a PNG`} onClick={() => void onPng()} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}
      </IconButton>
      <IconButton label={`Download the ${what} as an SVG`} onClick={() => downloadSvg(svg, `${name}.svg`)}>
        <FileCode2 className="h-3.5 w-3.5" />
      </IconButton>
    </div>
  );
}

/**
 * Icon-only, so the format lives in the accessible name and the tooltip rather
 * than in visible text: `ImageDown` is the flattened picture, `FileCode2` the
 * editable file an SVG literally is.
 */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="press grid h-7 w-7 place-items-center rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-[var(--stage)] text-[var(--ink-2)] transition hover:border-[var(--pigment)] hover:text-[var(--pigment)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function SuiteTile({ asset, stem }: { asset: SuiteAsset; stem: string }) {
  // A plated form (reversed / knockout) carries its ground INSIDE the artwork, so
  // the tile is painted the same colour — otherwise the plate reads as a band
  // floating on the transparency chequerboard instead of as the surface it is.
  const plated = !!asset.plate;
  return (
    <div className="group overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)] transition hover:border-[var(--ink-3)]">
      <div
        className={`grid h-28 place-items-center px-5 sm:h-32 ${plated ? '' : 'stage-grid'}`}
        style={plated ? { background: asset.plate! } : undefined}
      >
        <SvgMark svg={asset.svg} className="h-14 w-full sm:h-16" title={asset.label} />
      </div>
      <div className="flex items-center justify-between gap-2 bg-[var(--card)] py-2 pl-4 pr-2">
        <span className="min-w-0 truncate text-xs font-semibold text-[var(--ink)]">
          {asset.label}
        </span>
        <TileDownloads
          svg={asset.svg}
          name={`${stem}-${asset.key}`}
          what={asset.label.toLowerCase()}
        />
      </div>
    </div>
  );
}

/** A colourway band: label, hairline rule, count — then its six forms. */
function SuiteGroup({
  label,
  hint,
  swatch,
  assets,
  stem,
}: {
  label: string;
  hint?: string;
  swatch: string;
  assets: SuiteAsset[];
  stem: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          style={{ background: swatch }}
        />
        <span className="spec shrink-0">{label}</span>
        {hint && (
          <span className="spec tnum shrink-0" style={{ fontSize: 10 }}>
            {hint}
          </span>
        )}
        <span className="h-px min-w-4 flex-1 bg-[var(--hair-2)]" />
        <span className="spec shrink-0 tnum" style={{ fontSize: 10 }}>
          {assets.length} files
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {assets.map((a) => (
          <SuiteTile key={a.key} asset={a} stem={stem} />
        ))}
      </div>
    </div>
  );
}

export function LogoSuite({
  suite,
  stem,
  primaryHex,
  onBeforeDownload,
  className = '',
}: {
  suite: SuiteAsset[];
  /** Filename stem, server-supplied so downloads match server-side exports. */
  stem: string;
  /** The brand colour, stated on the coloured band. */
  primaryHex?: string;
  /**
   * Run before a whole-suite download starts and let it reject to cancel — the
   * owner's screen puts the subscription gate and the rights stamp here
   * (`logo.assets.claim`). The public share page passes nothing.
   */
  onBeforeDownload?: () => Promise<void>;
  className?: string;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const ink = suite.filter((a) => a.colourway === 'ink');
  const colour = suite.filter((a) => a.colourway === 'colour');

  const downloadAll = async (formats: DownloadFormat[]) => {
    if (progress) return;
    setProgress({ done: 0, total: suite.length * formats.length });
    try {
      await onBeforeDownload?.();
      await downloadSuiteZip({
        files: suite.map((a) => ({ name: `${stem}-${a.key}`, svg: a.svg })),
        formats,
        archive: `${stem}-logo-suite`,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      toast.success(`${suite.length * formats.length} files zipped and downloading.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build that download.');
    } finally {
      setProgress(null);
    }
  };

  if (!suite.length) return null;

  return (
    <section className={className}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="spec">The logo suite</p>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--ink-2)]">
            Six forms, each delivered in the brand colour and in monochrome. Take one
            file, or the whole set.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void downloadAll(['svg', 'png'])}
          disabled={!!progress}
          className="press inline-flex h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-pill)] px-5 text-sm font-semibold text-white transition-[filter] hover:brightness-105 disabled:opacity-70"
          style={{ background: 'var(--pigment)' }}
        >
          {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {progress ? 'Building the zip' : 'Download all'}
          <span className="tnum text-xs font-medium text-white/70">
            {progress ? `${progress.done}/${progress.total}` : `${suite.length * 2} files`}
          </span>
        </button>
      </div>

      <div className="mt-6 space-y-7">
        <SuiteGroup label="Monochrome" swatch="var(--ink)" assets={ink} stem={stem} />
        <SuiteGroup
          label="In colour"
          hint={primaryHex?.toUpperCase()}
          swatch={primaryHex ?? 'var(--pigment)'}
          assets={colour}
          stem={stem}
        />
      </div>

      <p className="spec mt-4" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
        SVG for print and anything that has to scale; PNG at 2048px on the long edge,
        transparent. Reversed forms carry their own plate.
      </p>
    </section>
  );
}
