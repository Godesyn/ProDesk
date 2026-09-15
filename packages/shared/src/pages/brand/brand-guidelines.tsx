import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Palette, Image as ImageIcon, Type, MessageCircle, MessageSquare, Plus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Field } from '../agency/form-bits';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { uploadBrandFile } from './storage';

// Colors persist as "Name|#HEX"; typography as "Nickname|FontFamily" (Flutter parity).
function parseEntry(s: string): { name: string; value: string } {
  const i = s.indexOf('|');
  return i >= 0 ? { name: s.slice(0, i), value: s.slice(i + 1) } : { name: s, value: s };
}

const PRESET_COLORS = ['#111111', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#64748B'];

/** Brand Guidelines editor — colors, logos, typography, tone of voice, key messaging. Ports brand_guidelines_screen.dart. */
export function BrandGuidelinesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { brandId, activeBrand, loading } = useActiveContext();
  const { openFile } = useFileViewer();

  const [colors, setColors] = useState<string[]>([]);
  const [logoUrls, setLogoUrls] = useState<string[]>([]);
  const [typography, setTypography] = useState<string[]>([]);
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [keyMessaging, setKeyMessaging] = useState('');
  const [uploading, setUploading] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [fontOpen, setFontOpen] = useState(false);
  const initFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeBrand && initFor.current !== activeBrand.id) {
      setColors(activeBrand.colors ?? []);
      setLogoUrls(activeBrand.logoUrls ?? []);
      setTypography(activeBrand.typography ?? []);
      setToneOfVoice(activeBrand.toneOfVoice ?? '');
      setKeyMessaging(activeBrand.keyMessaging ?? '');
      initFor.current = activeBrand.id;
    }
  }, [activeBrand]);

  const save = useMutation({
    ...trpc.brands.update.mutationOptions(),
    onSuccess: () => { toast.success('Brand Guidelines Updated!'); qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() }); },
    onError: (e) => toast.error(`Update failed: ${e.message}`),
  });

  const onPickLogo = async (file: File) => {
    if (!brandId) return;
    setUploading(true);
    try {
      const url = await uploadBrandFile(brandId, 'logos', file);
      setLogoUrls((u) => [...u, url]);
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="space-y-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (!brandId) return <EmptyState icon={Palette} title="No Brand Selected" description="Create a brand profile to set guidelines." />;

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Brand Guidelines"
        description="Colors, logos, typography and voice that define your brand."
        action={
          <Button variant="accent" disabled={save.isPending} onClick={() => save.mutate({ brandId, colors, logoUrls, typography, toneOfVoice, keyMessaging })}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        }
      />
      <Card className="flex flex-col gap-5 p-4 md:gap-8 md:p-8">
        {/* Colors */}
        <Section icon={Palette} title="Brand Colors">
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => {
              const { name, value } = parseEntry(c);
              return (
                <div key={c} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] py-1 pl-1.5 pr-2">
                  <span className="h-6 w-6 rounded" style={{ backgroundColor: value }} />
                  <span className="text-sm text-ink-80">{name}</span>
                  <button onClick={() => setColors((x) => x.filter((v) => v !== c))} className="text-ink-40 hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={() => setColorOpen(true)}><Plus className="h-4 w-4" /> Add color</Button>
          </div>
        </Section>

        {/* Logos */}
        <Section icon={ImageIcon} title="Logos">
          <div className="flex flex-wrap gap-3">
            {logoUrls.map((url) => (
              <div key={url} className="relative h-24 w-24 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset">
                <img src={url} alt="logo" className="h-full w-full cursor-zoom-in object-contain" onClick={() => openFile({ url, title: 'Logo', fileType: 'image' })} />
                <button onClick={() => setLogoUrls((x) => x.filter((v) => v !== url))} className="absolute right-1 top-1 rounded-full bg-ink/60 p-0.5 text-white"><X className="h-3 w-3" /></button>
              </div>
            ))}
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="grid h-24 w-24 place-items-center rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border-default)] text-ink-40 hover:bg-inset"
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            </button>
            <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickLogo(f); e.target.value = ''; }} />
          </div>
        </Section>

        {/* Typography */}
        <Section icon={Type} title="Typography">
          <div className="flex flex-wrap gap-2">
            {typography.map((t) => {
              const { name, value } = parseEntry(t);
              return (
                <div key={t} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-3 py-1.5">
                  <span className="text-sm text-ink-100">{name}</span>
                  <span className="text-xs text-ink-40">{value}</span>
                  <button onClick={() => setTypography((x) => x.filter((v) => v !== t))} className="text-ink-40 hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={() => setFontOpen(true)}><Plus className="h-4 w-4" /> Add font</Button>
          </div>
        </Section>

        {/* Tone of voice */}
        <Section icon={MessageCircle} title="Tone of Voice">
          <textarea
            value={toneOfVoice}
            onChange={(e) => setToneOfVoice(e.target.value)}
            placeholder="Describe how your brand speaks…"
            className="min-h-28 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          />
        </Section>

        {/* Key messaging */}
        <Section icon={MessageSquare} title="Key Messaging">
          <textarea
            value={keyMessaging}
            onChange={(e) => setKeyMessaging(e.target.value)}
            placeholder="Important slogans or messages…"
            className="min-h-28 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          />
        </Section>
      </Card>

      <Dialog open={colorOpen} onOpenChange={setColorOpen}>
        {colorOpen && <AddColorDialog onAdd={(entry) => { setColors((x) => [...x, entry]); setColorOpen(false); }} />}
      </Dialog>
      <Dialog open={fontOpen} onOpenChange={setFontOpen}>
        {fontOpen && <AddFontDialog onAdd={(entry) => { setTypography((x) => [...x, entry]); setFontOpen(false); }} />}
      </Dialog>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Palette; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[color:var(--color-border-default)] pt-6 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function AddColorDialog({ onAdd }: { onAdd: (entry: string) => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#111111');
  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Add Brand Color</DialogTitle></DialogHeader>
      <div className="flex flex-col items-center gap-2">
        <span className="h-20 w-20 rounded-2xl shadow" style={{ backgroundColor: color }} />
        <span className="font-mono text-sm uppercase">{color}</span>
      </div>
      <Field label="Color name" htmlFor="cn"><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brand Primary" /></Field>
      <div>
        <span className="mb-2 block text-xs font-semibold text-ink-60">Presets</span>
        <div className="flex flex-wrap gap-2">
          {PRESET_COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} className="h-9 w-9 rounded-lg border-2" style={{ backgroundColor: c, borderColor: color === c ? 'var(--color-ink-100)' : 'transparent' }} />
          ))}
        </div>
      </div>
      <Field label="Custom" htmlFor="cc"><input id="cc" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)]" /></Field>
      <DialogFooter>
        <Button variant="accent" onClick={() => onAdd(`${name.trim() || 'Primary'}|${color.toUpperCase()}`)}>Add Color</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// A curated subset of common families (Flutter offers the full GoogleFonts list).
const FONTS = ['Inter', 'Outfit', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Playfair Display', 'Merriweather', 'Source Sans Pro', 'Nunito', 'Raleway', 'Work Sans', 'DM Sans', 'JetBrains Mono'];

function AddFontDialog({ onAdd }: { onAdd: (entry: string) => void }) {
  const [nickname, setNickname] = useState('');
  const [search, setSearch] = useState('');
  const [font, setFont] = useState('Inter');
  const filtered = FONTS.filter((f) => f.toLowerCase().includes(search.toLowerCase()));
  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Add Typography</DialogTitle></DialogHeader>
      <Field label="Nickname" htmlFor="fn"><Input id="fn" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Headings" /></Field>
      <Field label="Search fonts" htmlFor="fs"><Input id="fs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" /></Field>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-1">
        {filtered.map((f) => (
          <button key={f} onClick={() => setFont(f)} className={`block w-full rounded px-3 py-1.5 text-left text-sm ${font === f ? 'bg-accent/12 text-accent' : 'hover:bg-inset'}`}>{f}</button>
        ))}
      </div>
      <DialogFooter>
        <Button variant="accent" onClick={() => onAdd(`${nickname.trim() || font}|${font}`)}>Add Font</Button>
      </DialogFooter>
    </DialogContent>
  );
}
