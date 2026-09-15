import { Plus, Trash2, X, GripVertical, FileText, ExternalLink } from 'lucide-react';
import type { RouterOutputs } from '@server/trpc/router';
import { formatDate } from '../../lib/utils';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { SortableList } from '../../components/ui/sortable-list';
import { UploadButton } from '../../components/upload-button';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { StorageBucket } from '../../lib/storage-buckets';
import { Field, Select } from '../agency/form-bits';

export type SpotForm = RouterOutputs['spot']['listFormsForBrand'][number];
export type SpotComponent = RouterOutputs['spot']['listComponents'][number];

export interface SpotQuestion {
  id: string;
  text: string;
  type: string;
  options: string[];
  isRequired: boolean;
}

/** Minimal shape SpotComponentView needs — works for both builder rows and public sections. */
type ComponentLike = { id: string; templateName: string; answers: unknown; questionOrder?: string[] | null };

/** Order `questions` by an explicit id list (unknown ids sink to the end), matching
 *  the Flutter SpotFormFullView questionOrder sort. */
function orderQuestions(questions: SpotQuestion[], order: string[] | null | undefined): SpotQuestion[] {
  if (!order || order.length === 0) return questions;
  const rank = (id: string) => { const i = order.indexOf(id); return i === -1 ? 9999 : i; };
  return [...questions].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Read the questions array off a template row (jsonb). */
export function questionsOf(form: Pick<SpotForm, 'questions'> | undefined | null): SpotQuestion[] {
  if (!form?.questions) return [];
  return (form.questions as unknown[]).map((q) => q as SpotQuestion);
}

/* ── value coercion ───────────────────────────────────────────────────────── */

function asString(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as string[];
  if (typeof v === 'string' && v) return [v];
  return [];
}

interface Address { line1?: string; line2?: string; city?: string; state?: string; postcode?: string; country?: string }
function asAddress(v: unknown): Address {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Address;
  if (typeof v === 'string' && v) { try { return JSON.parse(v) as Address; } catch { return { line1: v }; } }
  return {};
}

type MediaKind = 'image' | 'video' | 'audio' | 'file';
function mediaKind(url: string): MediaKind {
  const u = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/.test(u)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv)$/.test(u)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/.test(u)) return 'audio';
  return 'file';
}

/* ── public-facing component renderer ─────────────────────────────────────── */

/**
 * Renders a SPOT component as a card. In edit mode it surfaces inputs bound to
 * `answers`; otherwise it renders the answers read-only (used on the public
 * profile). Full parity with spot_form_full_view.dart including structured
 * address, image carousels, colour palettes, cover photo/video and audio.
 */
export function SpotComponentView({
  component,
  questions,
  editable,
  answers,
  onChange,
  order,
  onReorder,
  hideTitle,
}: {
  component: ComponentLike;
  questions: SpotQuestion[];
  editable?: boolean;
  answers?: Record<string, unknown>;
  onChange?: (questionId: string, value: unknown) => void;
  /** Current question ordering (controlled). Falls back to component.questionOrder. */
  order?: string[];
  /** When provided in edit mode, renders per-question up/down reorder controls. */
  onReorder?: (orderedIds: string[]) => void;
  hideTitle?: boolean;
}) {
  const data = answers ?? (component.answers as Record<string, unknown>) ?? {};
  const ordered = orderQuestions(questions, order ?? component.questionOrder);
  const visible = editable ? ordered : ordered.filter((q) => !isEmpty(data[q.id]));

  const renderField = (q: SpotQuestion) => (
    <Field label={q.text + (q.isRequired && editable ? ' *' : '')} htmlFor={`q-${component.id}-${q.id}`}>
      {editable ? (
        <SpotInput q={q} value={data[q.id]} id={`q-${component.id}-${q.id}`} onChange={(v) => onChange?.(q.id, v)} />
      ) : (
        <SpotAnswer q={q} value={data[q.id]} />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      {!hideTitle && <div className="text-base font-semibold text-ink-100">{component.templateName}</div>}
      {visible.length === 0 ? (
        <p className="text-sm text-ink-40">{editable ? 'This section has no fields.' : '—'}</p>
      ) : editable && onReorder ? (
        // In edit mode `visible === ordered`, so the rendered list covers every
        // question; drag-to-reorder commits the full id list via onReorder.
        <SortableList items={visible} getId={(q) => q.id} onReorder={onReorder} className="flex flex-col gap-4">
          {({ item: q, handleProps }) => (
            <div className="flex items-start gap-2">
              <button type="button" {...handleProps} className="cursor-grab touch-none pt-7 text-ink-40 hover:text-ink-100 active:cursor-grabbing" aria-label="Drag to reorder"><GripVertical className="h-4 w-4" /></button>
              <div className="min-w-0 flex-1">{renderField(q)}</div>
            </div>
          )}
        </SortableList>
      ) : (
        visible.map((q) => <div key={q.id}>{renderField(q)}</div>)
      )}
    </div>
  );
}

function isEmpty(v: unknown): boolean {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v as object).every((x) => x == null || x === '');
  return false;
}

/* ── editable inputs ──────────────────────────────────────────────────────── */

function SpotInput({ q, value, id, onChange }: { q: SpotQuestion; value: unknown; id: string; onChange: (v: unknown) => void }) {
  switch (q.type) {
    case 'single_select':
      return (
        <Select id={id} value={asString(value)} onChange={onChange}>
          <option value="">Select…</option>
          {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    case 'multi_select': {
      const selected = asStringArray(value);
      return (
        <div className="flex flex-wrap gap-2">
          {q.options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
                className={`rounded-[var(--radius-pill)] border px-3 py-1 text-xs transition-colors ${on ? 'border-transparent bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset'}`}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'date':
      return <Input id={id} type="date" value={asString(value)} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <NumberInput id={id} value={value} onChange={onChange} allowNegative />;
    case 'price':
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-40">$</span>
          <NumberInput id={id} className="pl-7" value={value} onChange={onChange} decimals={2} />
        </div>
      );
    case 'email':
      return <Input id={id} type="email" value={asString(value)} onChange={(e) => onChange(e.target.value)} placeholder="name@company.com" />;
    case 'url':
      return <Input id={id} type="url" value={asString(value)} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />;
    case 'phone':
      return <Input id={id} type="tel" value={asString(value)} onChange={(e) => onChange(e.target.value)} placeholder="+61 …" />;
    case 'address':
      return <AddressEditor value={asAddress(value)} onChange={onChange} />;
    case 'carousel':
      return <CarouselEditor id={id} value={asStringArray(value)} onChange={onChange} />;
    case 'color_palette':
      return <ColorPaletteEditor value={asStringArray(value)} onChange={onChange} />;
    case 'cover_photo':
      return <MediaEditor id={id} value={asString(value)} accept="image/*,video/*" kindHint="cover" onChange={onChange} />;
    case 'audio_upload':
      return <MediaEditor id={id} value={asString(value)} accept="audio/*" kindHint="audio" onChange={onChange} />;
    case 'file_upload':
      return <MediaEditor id={id} value={asString(value)} kindHint="file" onChange={onChange} />;
    case 'text':
    default:
      return (
        <textarea
          id={id}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-20 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
        />
      );
  }
}

/**
 * Numeric input for the `number` / `price` question types. Filters keystrokes
 * and pastes so only a valid number can be entered (the old `type="number"`
 * field still accepted `e`, signs and pasted text). `decimals` caps the
 * fractional digits (price → 2); `allowNegative` permits a leading minus.
 */
function NumberInput({
  id,
  value,
  onChange,
  decimals,
  allowNegative,
  className,
}: {
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
  decimals?: number;
  allowNegative?: boolean;
  className?: string;
}) {
  const sign = allowNegative ? '-?' : '';
  const frac = decimals === undefined ? '(\\.\\d*)?' : decimals === 0 ? '' : `(\\.\\d{0,${decimals}})?`;
  const pattern = new RegExp(`^${sign}\\d*${frac}$`);
  return (
    <Input
      id={id}
      type="text"
      inputMode="decimal"
      className={className}
      value={asString(value)}
      // Only commit the change when the result is still a valid (partial) number;
      // otherwise the keystroke/paste is rejected and the field keeps its value.
      onChange={(e) => { const raw = e.target.value; if (raw === '' || pattern.test(raw)) onChange(raw); }}
      placeholder={decimals === 2 ? '0.00' : '0'}
    />
  );
}

/* ── read-only answers ────────────────────────────────────────────────────── */

function SpotAnswer({ q, value }: { q: SpotQuestion; value: unknown }) {
  if (isEmpty(value)) return <span className="text-sm text-ink-40">—</span>;
  switch (q.type) {
    case 'url':
      return <a href={String(value)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent underline">{String(value)} <ExternalLink className="h-3 w-3" /></a>;
    case 'date':
      return <span className="text-sm text-ink-80">{formatDate(String(value))}</span>;
    case 'price':
      return <span className="text-sm text-ink-80">${asString(value)}</span>;
    case 'multi_select':
      return (
        <div className="flex flex-wrap gap-1.5">
          {asStringArray(value).map((o) => <span key={o} className="rounded-[var(--radius-pill)] bg-inset px-2.5 py-0.5 text-xs text-ink-80">{o}</span>)}
        </div>
      );
    case 'address':
      return <AddressView value={asAddress(value)} />;
    case 'carousel':
      return <CarouselView urls={asStringArray(value)} />;
    case 'color_palette':
      return <ColorPaletteView colors={asStringArray(value)} />;
    case 'cover_photo':
    case 'audio_upload':
    case 'file_upload':
      return <MediaView url={String(value)} />;
    default:
      return <span className="whitespace-pre-wrap text-sm text-ink-80">{asString(value)}</span>;
  }
}

/* ── address ──────────────────────────────────────────────────────────────── */

function AddressEditor({ value, onChange }: { value: Address; onChange: (v: Address) => void }) {
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input className="col-span-2" placeholder="Address line 1" value={value.line1 ?? ''} onChange={(e) => set({ line1: e.target.value })} />
      <Input className="col-span-2" placeholder="Address line 2" value={value.line2 ?? ''} onChange={(e) => set({ line2: e.target.value })} />
      <Input placeholder="City" value={value.city ?? ''} onChange={(e) => set({ city: e.target.value })} />
      <Input placeholder="State / Region" value={value.state ?? ''} onChange={(e) => set({ state: e.target.value })} />
      <Input placeholder="Postcode" value={value.postcode ?? ''} onChange={(e) => set({ postcode: e.target.value })} />
      <Input placeholder="Country" value={value.country ?? ''} onChange={(e) => set({ country: e.target.value })} />
    </div>
  );
}

function AddressView({ value }: { value: Address }) {
  const parts = [value.line1, value.line2, [value.city, value.state, value.postcode].filter(Boolean).join(' '), value.country].filter(Boolean);
  return <div className="text-sm text-ink-80">{parts.map((p, i) => <div key={i}>{p}</div>)}</div>;
}

/* ── carousel (scrollable strip of images / videos) ───────────────────────── */

/** A single carousel item rendered at full container height with natural width
 *  (object-contain) so it is never cropped. */
function CarouselMedia({ url, controls }: { url: string; controls?: boolean }) {
  if (mediaKind(url) === 'video') return <video src={url} controls={controls} muted={!controls} className="h-full w-auto object-contain" />;
  return <img src={url} alt="" className="h-full w-auto object-contain" />;
}

function CarouselEditor({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const remove = (url: string) => onChange(value.filter((u) => u !== url));
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        // Drag tiles horizontally to reorder; the new url order is the new value.
        <SortableList
          items={value}
          getId={(url) => url}
          onReorder={onChange}
          orientation="horizontal"
          className="flex gap-2 overflow-x-auto pb-1"
          itemClassName="shrink-0"
        >
          {({ item: url, handleProps }) => (
            <div className="group relative h-28 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset">
              <div {...handleProps} className="h-full cursor-grab touch-none active:cursor-grabbing"><CarouselMedia url={url} /></div>
              <button type="button" onClick={() => remove(url)} className="absolute right-1 top-1 rounded-full bg-black/55 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-label="Remove"><X className="h-4 w-4" /></button>
            </div>
          )}
        </SortableList>
      )}
      <UploadButton bucket={StorageBucket.Brands} pathPrefix={`spot/${id}`} accept="image/*,video/*" size="sm" label="Add image or video" onUploaded={(url) => onChange([...value, url])} />
    </div>
  );
}

function CarouselView({ urls }: { urls: string[] }) {
  if (urls.length === 0) return <span className="text-sm text-ink-40">—</span>;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {urls.map((url, i) => (
        <div key={url + i} className="h-72 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset">
          <CarouselMedia url={url} controls />
        </div>
      ))}
    </div>
  );
}

/* ── colour palette ───────────────────────────────────────────────────────── */

function ColorPaletteEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.map((c, i) => (
        <div key={i} className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-1 pr-2">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#000000'} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0" />
          <input value={c} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} className="w-20 bg-transparent text-xs text-ink-80 focus:outline-none" />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-ink-40 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, '#3366ff'])}><Plus className="h-4 w-4" /> Add colour</Button>
    </div>
  );
}

function ColorPaletteView({ colors }: { colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c, i) => (
        <div key={i} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] py-1 pl-1 pr-2.5">
          <span className="h-6 w-6 rounded" style={{ background: c }} />
          <span className="text-xs text-ink-60">{c}</span>
        </div>
      ))}
    </div>
  );
}

/* ── media (cover photo / video, audio, generic file) ─────────────────────── */

function MediaEditor({ id, value, accept, kindHint, onChange }: { id: string; value: string; accept?: string; kindHint: 'cover' | 'audio' | 'file'; onChange: (v: string) => void }) {
  const label = kindHint === 'cover' ? 'Upload photo or video' : kindHint === 'audio' ? 'Upload audio' : 'Upload file';
  return (
    <div className="flex flex-col gap-2">
      {value ? <MediaView url={value} /> : null}
      <div className="flex items-center gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Paste a URL or upload" />
        <UploadButton bucket={StorageBucket.Brands} pathPrefix={`spot/${id}`} accept={accept} size="sm" label={value ? 'Replace' : label} onUploaded={(url) => onChange(url)} />
        {value && <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}><X className="h-4 w-4" /></Button>}
      </div>
    </div>
  );
}

function MediaView({ url }: { url: string }) {
  const { openFile } = useFileViewer();
  const kind = mediaKind(url);
  const name = url.split('/').pop()?.split('?')[0] ?? 'View file';
  // Cover photo/video: full width, natural (dynamic) height — never cropped.
  if (kind === 'image')
    return (
      <button type="button" onClick={() => openFile({ url, title: name, fileType: 'image' })} className="block w-full">
        <img src={url} alt="" className="h-auto w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)]" />
      </button>
    );
  if (kind === 'video') return <video src={url} controls className="h-auto w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)]" />;
  if (kind === 'audio') return <audio src={url} controls className="w-full" />;
  return (
    <button type="button" onClick={() => openFile({ url, title: name })} className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-3 py-2 text-sm text-ink-80 hover:bg-inset">
      <FileText className="h-4 w-4 text-ink-40" /> <span className="max-w-[18rem] truncate">{name}</span> <ExternalLink className="h-3.5 w-3.5 text-ink-40" />
    </button>
  );
}

/** Exported for the public landing page's empty-section guard. */
export { isEmpty as spotAnswerIsEmpty };
