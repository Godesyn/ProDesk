/**
 * Departments — the active brand's signature designs, and the people they render.
 *
 * This screen was "Brand Manager", which listed every brand the user could reach.
 * The brand is now chosen once, in the side-panel context selector, and this page
 * manages what's INSIDE that brand: its DEPARTMENTS.
 *
 * A department is one complete signature design (Sales, Support, Execs). The
 * brand's members, campaigns and analytics are shared across all of them — a
 * person is one billable seat no matter how many departments render them — and
 * each department has its own share page. Exactly one is the default: the design
 * new work starts from, and the brand kit the rest of the Prodesk suite reads.
 *
 * Hierarchy: Brand → Departments (design) → Members (shared) → Signatures.
 */

import { useEffect, useMemo, useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  Building2, Users, Plus, Trash2, Edit2, ChevronRight, ChevronDown,
  Download, Eye, ArrowLeft, Upload, Palette, Copy, MoreHorizontal,
  CheckCircle2, X, Globe, MapPin, Star, Share2,
  FileSpreadsheet, AlertCircle, CreditCard
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ColorPicker } from '@shared/components/ui/color-picker';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { SignaturePreview } from '@/components/SignaturePreview';
import { SignatureCopyButtons } from '@/components/SignatureCopyButtons';
import { PlacesAddressInput } from '@/components/PlacesAddressInput';
import { VerdiictSyncSection } from '@/components/VerdiictSyncSection';
import { LazyImage } from '@shared/components/ui/lazy-image';
import { buildSignatureData, renderExportHtml } from '@/lib/signatureExport';
import { compressPhoto, compressLogo } from '@/lib/imageCompress';
import { buildShareUrl } from '@/lib/shareUrl';
import {
  FONT_OPTIONS,
  TEMPLATES,
  loadSavedSignatures,
  type SavedSignature,
  type SignatureData,
} from '@/lib/signatureTypes';
import { trpc } from '@/lib/trpc';
import { useSignaturesContext } from '@/app/context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';

// ─── Types ────────────────────────────────────────────────────────────────────
type Brand = {
  id: string; name: string; collectionName?: string | null; website?: string | null; address?: string | null;
  primaryColor?: string | null; secondaryColor?: string | null; fontFamily?: string | null;
  barColor?: string | null; barTextColor?: string | null; barLogoUrl?: string | null; barLogoKey?: string | null; brandDisplayName?: string | null;
  brandTagline?: string | null; logoUrl?: string | null; logoKey?: string | null;
  logoWidth?: number | null; poweredByLogoUrl?: string | null; poweredByLogoKey?: string | null;
  poweredByLabel?: string | null; verdiictUrl?: string | null; verdiictReviewsUrl?: string | null;
  disclaimer?: string | null; defaultTemplate?: string | null;
  logoLinkUrl?: string | null; barLogoLinkUrl?: string | null; poweredByLinkUrl?: string | null;
  cardRadius?: number | null;
};

type Member = {
  id: string; signatureBrandId: string; fullName: string; jobTitle?: string | null;
  department?: string | null; email?: string | null; phone?: string | null;
  mobile?: string | null; photoUrl?: string | null; photoKey?: string | null;
  photoLinkUrl?: string | null;
  linkedin?: string | null; twitter?: string | null; instagram?: string | null;
  facebook?: string | null; youtube?: string | null; github?: string | null;
  spotify?: string | null; pinterest?: string | null; tiktok?: string | null;
  googleMaps?: string | null; googleReviews?: string | null; trustpilot?: string | null;
  tripadvisor?: string | null; uberEats?: string | null; deliveroo?: string | null;
  expedia?: string | null; rss?: string | null; amazon?: string | null;
  websiteLink?: string | null;
  verdiictUrl?: string | null; verdiictReviewsUrl?: string | null;
};

const EMPTY_BRAND_FORM = {
  name: '', collectionName: '', website: '', address: '',
  primaryColor: '#0E0E0C', secondaryColor: '#333333', fontFamily: 'Arial, Helvetica, sans-serif',
  barColor: 'var(--color-primary)', barTextColor: '#0E0E0C',
  barLogoUrl: '', barLogoKey: '', barLogoLinkUrl: '',
  brandDisplayName: '', brandTagline: '',
  logoUrl: '', logoKey: '', logoWidth: 120, logoLinkUrl: '',
  poweredByLogoUrl: '', poweredByLogoKey: '', poweredByLabel: 'POWERED BY', poweredByLinkUrl: '',
  verdiictUrl: '', verdiictReviewsUrl: '',
  disclaimer: '', defaultTemplate: 'imagecard',
  cardRadius: 0,
};

const EMPTY_MEMBER_FORM = {
  fullName: '', jobTitle: '', department: '', email: '', phone: '', mobile: '',
  photoUrl: '', photoKey: '', photoLinkUrl: '', linkedin: '', twitter: '', instagram: '',
  facebook: '', youtube: '', github: '',
  spotify: '', pinterest: '', tiktok: '', googleMaps: '', googleReviews: '',
  trustpilot: '', tripadvisor: '', uberEats: '', deliveroo: '', expedia: '',
  rss: '', amazon: '', websiteLink: '',
  verdiictUrl: '', verdiictReviewsUrl: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
// A representative stand-in member so the brand-design preview shows a realistic
// signature (name, title, contact + a couple of social icons) while the owner
// tweaks colours, logos and template — no real member needed.
const SAMPLE_MEMBER: Member = {
  id: '', signatureBrandId: '', fullName: 'Jordan Michaels', jobTitle: 'Sales Director',
  department: 'Gold Coast', email: 'jordan@yourbrand.com.au', phone: '07 3800 3111',
  mobile: '0407 000 000', linkedin: 'https://linkedin.com/in/jordan',
  instagram: 'https://instagram.com/yourbrand',
  photoUrl: 'https://yzfdyljjiosggtdljmfw.supabase.co/storage/v1/object/public/meta/sampleimage.png',
};

// ─── Live Preview Panel ─────────────────────────────────────────────────────
// A right-hand panel showing the live signature. Hidden below `lg` so the form
// gets the full dialog width on mobile. Sticky so it stays in view while the
// form scrolls.
function LivePreviewPanel({ data, brandId }: { data: SignatureData; brandId: string }) {
  return (
    <div className="hidden lg:block w-[340px] flex-shrink-0">
      <div className="sticky top-0">
        <Label className="text-xs text-muted-foreground mb-2 block">Live preview</Label>
        <div className="border rounded-lg bg-white p-4 overflow-hidden">
          <SignaturePreview data={data} brandId={brandId} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Updates as you edit — this is how the signature looks in an email.</p>
      </div>
    </div>
  );
}

// ─── Brand Form ───────────────────────────────────────────────────────────────
function BrandForm({ initial, onSave, onCancel, isSaving, brandId: managedBrandId }: {
  initial: typeof EMPTY_BRAND_FORM;
  onSave: (f: typeof EMPTY_BRAND_FORM) => void;
  onCancel: () => void;
  isSaving: boolean;
  /** The brand being edited — assets upload/scope here (not the active context). */
  brandId?: string | null;
}) {
  const [form, setForm] = useState(initial);
  // Always the explicit brand being edited — never the active-context brand.
  const brandId = managedBrandId ?? null;
  const logoRef = useRef<HTMLInputElement>(null);
  const poweredByRef = useRef<HTMLInputElement>(null);
  const barLogoRef = useRef<HTMLInputElement>(null);
  const uploadMutation = trpc.signatures.upload.file.useMutation({ onError: e => toast.error(e.message) });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  // Live preview: debounce the form so the iframe rewrites on a pause, not on
  // every keystroke. A stand-in member shows the design against realistic content.
  const [debouncedForm, setDebouncedForm] = useState(form);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedForm(form), 200);
    return () => clearTimeout(t);
  }, [form]);
  const previewData = buildSignatureData(
    { id: brandId ?? '', ...debouncedForm } as Brand,
    SAMPLE_MEMBER,
  );

  const handleImg = async (
    e: React.ChangeEvent<HTMLInputElement>,
    urlField: 'logoUrl' | 'poweredByLogoUrl' | 'barLogoUrl',
    keyField: 'logoKey' | 'poweredByLogoKey' | 'barLogoKey'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // No size gate — logos are downscaled/optimized client-side to a sane size.
    // Logos stay PNG (transparency-safe); only resized if oversized.
    const img = await compressLogo(file);
    const result = await uploadMutation.mutateAsync({ brandId: brandId!, filename: img.filename, contentType: img.contentType, base64: img.base64 });
    setForm(p => ({ ...p, [urlField]: result.url, [keyField]: result.key }));
    e.target.value = '';
  };

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground mb-1 block">Collection Name <span className="text-muted-foreground font-normal">(internal only — not shown in signatures)</span></Label>
          <Input value={form.collectionName} onChange={e => set('collectionName', e.target.value)} placeholder="Avenue Property | Browns Plains" />
          <p className="text-[11px] text-muted-foreground mt-1">Use this to distinguish collections internally, e.g. by office or region.</p>
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground mb-1 block">Brand / Company Name * <span className="text-muted-foreground font-normal">(shown in signatures)</span></Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Avenue Property" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Website</Label>
          <Input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://avenueproperty.com.au" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Default Template</Label>
          <Select value={form.defaultTemplate} onValueChange={v => set('defaultTemplate', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TEMPLATES.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground mb-1 block">Address</Label>
          <PlacesAddressInput
            value={form.address}
            onChange={v => set('address', v)}
            placeholder="6/20-22 Expo Court, Ashmore QLD 4214"
          />
        </div>
      </div>

      <Tabs defaultValue="style">
        <TabsList className="h-8 text-xs w-full">
          <TabsTrigger value="style" className="text-xs flex-1">Style</TabsTrigger>
          <TabsTrigger value="imagecard" className="text-xs flex-1">Image Card</TabsTrigger>
          <TabsTrigger value="brandedcard" className="text-xs flex-1">Branded Card</TabsTrigger>
          <TabsTrigger value="assets" className="text-xs flex-1">Assets</TabsTrigger>
          <TabsTrigger value="verdiict" className="text-xs flex-1">Verdiict</TabsTrigger>
          <TabsTrigger value="legal" className="text-xs flex-1">Legal</TabsTrigger>
        </TabsList>

        <TabsContent value="style" className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Primary Colour</Label>
              <ColorPicker value={form.primaryColor} onChange={v => set('primaryColor', v)} ariaLabel="Primary Colour" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Secondary Colour</Label>
              <ColorPicker value={form.secondaryColor} onChange={v => set('secondaryColor', v)} ariaLabel="Secondary Colour" />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Font</Label>
            <Select value={form.fontFamily} onValueChange={v => set('fontFamily', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FONT_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="imagecard" className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Bar Colour</Label>
              <ColorPicker value={form.barColor} onChange={v => set('barColor', v)} ariaLabel="Bar Colour" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Bar Text Colour</Label>
              <ColorPicker value={form.barTextColor} onChange={v => set('barTextColor', v)} ariaLabel="Bar Text Colour" />
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium mb-2 block">Bar Logo (PNG only)</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Ideal: 400×120px PNG, transparent background, under 200KB. Shown top-left in the colour bar.</p>
            <div className="flex items-center gap-3">
              {form.barLogoUrl && (
                <LazyImage
                  src={form.barLogoUrl}
                  alt="Bar logo"
                  wrapperClassName="h-10 border rounded bg-white p-1 flex-shrink-0"
                  style={{ maxWidth: 100 }}
                  className="object-contain"
                />
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => barLogoRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="w-3.5 h-3.5" />{form.barLogoUrl ? 'Change' : 'Upload Bar Logo'}
              </Button>
              {form.barLogoUrl && <Button variant="outline" size="sm" className="text-xs text-destructive px-2" onClick={() => setForm(p => ({ ...p, barLogoUrl: '', barLogoKey: '' }))}><X className="w-3.5 h-3.5" /></Button>}
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1 block">Bar Logo Click URL (optional)</Label>
              <Input value={form.barLogoLinkUrl} onChange={e => set('barLogoLinkUrl', e.target.value)} placeholder="https://yourcompany.com" className="text-xs h-8" />
              <p className="text-[11px] text-muted-foreground mt-1">When clicked in an email, the bar logo will link to this URL.</p>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Tagline</Label>
            <Input value={form.brandTagline} onChange={e => set('brandTagline', e.target.value)} placeholder="LOCAL MOVES DIFFERENT" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">"Powered By" Label</Label>
            <Input value={form.poweredByLabel} onChange={e => set('poweredByLabel', e.target.value)} placeholder="POWERED BY" />
          </div>
        </TabsContent>

        <TabsContent value="brandedcard" className="space-y-3 mt-3">
          <p className="text-[11px] text-muted-foreground">Settings for the Branded Card template — full-bleed colour card below the white contact body.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Card Background Colour</Label>
              <ColorPicker value={form.barColor} onChange={v => set('barColor', v)} ariaLabel="Card Background Colour" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Card Text &amp; Icon Colour</Label>
              <ColorPicker value={form.barTextColor} onChange={v => set('barTextColor', v)} ariaLabel="Card Text and Icon Colour" />
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium mb-2 block">Top-Left Logo (PNG only)</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Ideal: 400×120px PNG, transparent background, under 200KB. Shown top-left inside the colour card.</p>
            <div className="flex items-center gap-3">
              {form.barLogoUrl && (
                <LazyImage
                  src={form.barLogoUrl}
                  alt="Card logo"
                  wrapperClassName="h-10 border rounded bg-white p-1 flex-shrink-0"
                  style={{ maxWidth: 100 }}
                  className="object-contain"
                />
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => barLogoRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="w-3.5 h-3.5" />{form.barLogoUrl ? 'Change' : 'Upload Logo'}
              </Button>
              {form.barLogoUrl && <Button variant="outline" size="sm" className="text-xs text-destructive px-2" onClick={() => setForm(p => ({ ...p, barLogoUrl: '', barLogoKey: '' }))}><X className="w-3.5 h-3.5" /></Button>}
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1 block">Logo Click URL (optional)</Label>
              <Input value={form.barLogoLinkUrl} onChange={e => set('barLogoLinkUrl', e.target.value)} placeholder="https://yourcompany.com" className="text-xs h-8" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-muted-foreground">Card Corner Radius</Label>
              <span className="text-xs font-mono text-muted-foreground">{form.cardRadius ?? 12}px</span>
            </div>
            <Slider
              min={0} max={24} step={2}
              value={[form.cardRadius ?? 12]}
              onValueChange={([v]) => set('cardRadius', v)}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0 (square)</span><span>24px (round)</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Note: rounded corners are not supported in Windows Outlook desktop.</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">Bottom-Left Tagline</Label>
            <Input value={form.brandTagline} onChange={e => set('brandTagline', e.target.value)} placeholder="read the full story." />
            <p className="text-[11px] text-muted-foreground mt-1">Shown bottom-left when no secondary logo is uploaded.</p>
          </div>
          <div>
            <Label className="text-xs font-medium mb-2 block">Bottom-Left Secondary Logo (PNG only)</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Ideal: 300×80px PNG, transparent background, under 150KB. Replaces tagline text when set.</p>
            <div className="flex items-center gap-3">
              {form.poweredByLogoUrl && (
                <LazyImage
                  src={form.poweredByLogoUrl}
                  alt="Secondary logo"
                  wrapperClassName="h-10 border rounded bg-white p-1 flex-shrink-0"
                  style={{ maxWidth: 80 }}
                  className="object-contain"
                />
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => poweredByRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="w-3.5 h-3.5" />{form.poweredByLogoUrl ? 'Change' : 'Upload Logo'}
              </Button>
              {form.poweredByLogoUrl && <Button variant="outline" size="sm" className="text-xs text-destructive px-2" onClick={() => setForm(p => ({ ...p, poweredByLogoUrl: '', poweredByLogoKey: '' }))}><X className="w-3.5 h-3.5" /></Button>}
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1 block">Secondary Logo Click URL (optional)</Label>
              <Input value={form.poweredByLinkUrl} onChange={e => set('poweredByLinkUrl', e.target.value)} placeholder="https://parentcompany.com" className="text-xs h-8" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="assets" className="space-y-4 mt-3">
          <div>
            <Label className="text-xs font-medium mb-2 block">Company Logo</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Ideal: 300×100px PNG, transparent background, under 200KB</p>
            <div className="flex items-center gap-3">
              {form.logoUrl && (
                <LazyImage
                  src={form.logoUrl}
                  alt="Logo"
                  wrapperClassName="h-10 border rounded bg-white p-1 flex-shrink-0"
                  style={{ maxWidth: 80 }}
                  className="object-contain"
                />
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => logoRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="w-3.5 h-3.5" />{form.logoUrl ? 'Change' : 'Upload Logo'}
              </Button>
              {form.logoUrl && <Button variant="outline" size="sm" className="text-xs text-destructive px-2" onClick={() => setForm(p => ({ ...p, logoUrl: '', logoKey: '' }))}><X className="w-3.5 h-3.5" /></Button>}
            </div>
            {form.logoUrl && (
              <div className="mt-3">
                <div className="flex justify-between mb-1">
                  <Label className="text-xs text-muted-foreground">Logo Width</Label>
                  <span className="text-xs font-mono text-muted-foreground">{form.logoWidth}px</span>
                </div>
                <Slider min={40} max={240} step={4} value={[form.logoWidth]} onValueChange={([v]) => set('logoWidth', v)} />
              </div>
            )}
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1 block">Logo Click URL (optional)</Label>
              <Input value={form.logoLinkUrl} onChange={e => set('logoLinkUrl', e.target.value)} placeholder="https://yourcompany.com" className="text-xs h-8" />
              <p className="text-[11px] text-muted-foreground mt-1">When clicked in an email, the logo will link to this URL.</p>
            </div>
          </div>
          <div>
            <Label className="text-xs font-medium mb-2 block">"Powered By" Logo</Label>
            <p className="text-[11px] text-muted-foreground mb-2">Ideal: 300×80px PNG, transparent background, under 150KB</p>
            <div className="flex items-center gap-3">
              {form.poweredByLogoUrl && (
                <LazyImage
                  src={form.poweredByLogoUrl}
                  alt="Powered by"
                  wrapperClassName="h-10 border rounded bg-white p-1 flex-shrink-0"
                  style={{ maxWidth: 80 }}
                  className="object-contain"
                />
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => poweredByRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="w-3.5 h-3.5" />{form.poweredByLogoUrl ? 'Change' : 'Upload Logo'}
              </Button>
              {form.poweredByLogoUrl && <Button variant="outline" size="sm" className="text-xs text-destructive px-2" onClick={() => setForm(p => ({ ...p, poweredByLogoUrl: '', poweredByLogoKey: '' }))}><X className="w-3.5 h-3.5" /></Button>}
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1 block">Powered By Click URL (optional)</Label>
              <Input value={form.poweredByLinkUrl} onChange={e => set('poweredByLinkUrl', e.target.value)} placeholder="https://parentcompany.com" className="text-xs h-8" />
              <p className="text-[11px] text-muted-foreground mt-1">When clicked in an email, the powered-by logo will link to this URL.</p>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="verdiict" className="space-y-4 mt-3">
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border">
            <div className="w-9 h-9 bg-black rounded-lg flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <rect width="24" height="24" rx="4" fill="black"/>
                <path d="M6 12.5L10 16.5L18 8" stroke="#5B9BD5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">Verdiict Integration</p>
              <p className="text-xs text-muted-foreground">Sync a Verdiict location — the logo and review CTAs appear automatically in all signatures.</p>
            </div>
          </div>
          <VerdiictSyncSection
            verdiictUrl={form.verdiictUrl}
            onSync={(reviewUrl, directoryUrl) => {
              set('verdiictUrl', reviewUrl);
              set('verdiictReviewsUrl', directoryUrl);
            }}
            onClear={() => {
              set('verdiictUrl', '');
              set('verdiictReviewsUrl', '');
            }}
            description="Sync a Verdiict location to show review CTAs across this brand's signatures."
            modal
          />
        </TabsContent>

        <TabsContent value="legal" className="space-y-3 mt-3">
          <Label className="text-xs text-muted-foreground mb-1 block">Default Legal Disclaimer</Label>
          <Textarea value={form.disclaimer} onChange={e => set('disclaimer', e.target.value)}
            placeholder="This email and any attachments are confidential..."
            className="resize-none text-sm" rows={4} />
        </TabsContent>
      </Tabs>

      {/* Always-mounted hidden file inputs so refs work regardless of active tab */}
      <input ref={barLogoRef} type="file" accept="image/png" className="hidden" onChange={e => handleImg(e, 'barLogoUrl', 'barLogoKey')} />
      <input ref={poweredByRef} type="file" accept="image/*" className="hidden" onChange={e => handleImg(e, 'poweredByLogoUrl', 'poweredByLogoKey')} />
      <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => handleImg(e, 'logoUrl', 'logoKey')} />

      <div className="flex gap-2 pt-2">
        <Button onClick={() => onSave(form)} className="flex-1 bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold" disabled={!form.name || isSaving}>
          <CheckCircle2 className="w-4 h-4 mr-1.5" /> {isSaving ? 'Saving...' : 'Save Brand'}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
      </div>
      {brandId && <LivePreviewPanel data={previewData} brandId={brandId} />}
    </div>
  );
}

// ─── Member Form ──────────────────────────────────────────────────────────────
function MemberForm({ initial, onSave, onCancel, isSaving, brand, brandId: managedBrandId }: {
  initial: typeof EMPTY_MEMBER_FORM;
  onSave: (f: typeof EMPTY_MEMBER_FORM) => void;
  onCancel: () => void;
  isSaving: boolean;
  /** The brand this member belongs to — drives the live signature preview. */
  brand?: Brand | null;
  /** The brand being edited — assets upload/scope here (not the active context). */
  brandId?: string | null;
}) {
  const [form, setForm] = useState(initial);
  // Always the explicit brand this member belongs to — never the active context.
  const brandId = managedBrandId ?? null;
  const photoRef = useRef<HTMLInputElement>(null);
  const uploadMutation = trpc.signatures.upload.file.useMutation({ onError: e => toast.error(e.message) });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  // Live preview: debounce the form so the iframe rewrites on a pause, not on
  // every keystroke. The preview reads brand design + the in-progress member.
  const [debouncedForm, setDebouncedForm] = useState(form);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedForm(form), 200);
    return () => clearTimeout(t);
  }, [form]);
  const previewData = brand
    ? buildSignatureData(brand, { id: '', signatureBrandId: brand.id, ...debouncedForm })
    : null;

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // No size gate — headshots are downscaled/compressed client-side to a sane size.
    // Headshots downscale to ~480px + JPEG — huge size win, invisible at
    // signature render size, keeps the email under Gmail's clipping threshold.
    const img = await compressPhoto(file);
    const result = await uploadMutation.mutateAsync({ brandId: brandId!, filename: img.filename, contentType: img.contentType, base64: img.base64 });
    setForm(p => ({ ...p, photoUrl: result.url, photoKey: result.key }));
    e.target.value = '';
  };

  return (
    <div className="flex gap-6">
      <div className="flex-1 min-w-0 space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-4">
          {form.photoUrl ? (
            <LazyImage
              src={form.photoUrl}
              alt="Photo"
              wrapperClassName="w-16 h-16 rounded-full border-2"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center border-2 border-dashed">
              <Upload className="w-6 h-6 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1">
            <div className="flex gap-2 mb-1">
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => photoRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="w-3.5 h-3.5" />{form.photoUrl ? 'Change Photo' : 'Upload Photo'}
              </Button>
              {form.photoUrl && <Button variant="outline" size="sm" className="text-xs text-destructive px-2" onClick={() => setForm(p => ({ ...p, photoUrl: '', photoKey: '' }))}><X className="w-3.5 h-3.5" /></Button>}
              <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </div>
            <p className="text-[11px] text-muted-foreground">Any size — we'll resize &amp; optimize it automatically. Square headshots look best.</p>
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Headshot Click URL (optional)</Label>
          <Input value={form.photoLinkUrl} onChange={e => set('photoLinkUrl', e.target.value)} placeholder="https://yourcompany.com/team/name" className="text-xs h-8" />
          <p className="text-[11px] text-muted-foreground mt-1">When clicked in an email, the headshot will link to this URL (e.g. agent profile page).</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground mb-1 block">Full Name *</Label>
          <Input value={form.fullName} onChange={e => set('fullName', e.target.value)} placeholder="Nathan Simon" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Job Title</Label>
          <Input value={form.jobTitle} onChange={e => set('jobTitle', e.target.value)} placeholder="Selling Principal" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Department</Label>
          <Input value={form.department} onChange={e => set('department', e.target.value)} placeholder="Gold Coast" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground mb-1 block">Email</Label>
          <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="nathan@avenueproperty.com.au" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Mobile</Label>
          <Input value={form.mobile} onChange={e => set('mobile', e.target.value)} placeholder="0407 760 435" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">Phone</Label>
          <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="07 3800 3111" />
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium mb-2 block">Social Links</Label>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {([
            { key: 'linkedin', label: 'LinkedIn', ph: 'https://linkedin.com/in/...' },
            { key: 'instagram', label: 'Instagram', ph: 'https://instagram.com/...' },
            { key: 'facebook', label: 'Facebook', ph: 'https://facebook.com/...' },
            { key: 'twitter', label: 'X / Twitter', ph: 'https://twitter.com/...' },
            { key: 'youtube', label: 'YouTube', ph: 'https://youtube.com/@...' },
            { key: 'github', label: 'GitHub', ph: 'https://github.com/...' },
            { key: 'spotify', label: 'Spotify', ph: 'https://open.spotify.com/...' },
            { key: 'pinterest', label: 'Pinterest', ph: 'https://pinterest.com/...' },
            { key: 'tiktok', label: 'TikTok', ph: 'https://tiktok.com/@...' },
            { key: 'googleMaps', label: 'Google Maps', ph: 'https://maps.google.com/...' },
            { key: 'googleReviews', label: 'Google Reviews', ph: 'https://g.page/r/...' },
            { key: 'trustpilot', label: 'Trustpilot', ph: 'https://trustpilot.com/review/...' },
            { key: 'tripadvisor', label: 'TripAdvisor', ph: 'https://tripadvisor.com/...' },
            { key: 'uberEats', label: 'Uber Eats', ph: 'https://ubereats.com/store/...' },
            { key: 'deliveroo', label: 'Deliveroo', ph: 'https://deliveroo.com.au/...' },
            { key: 'expedia', label: 'Expedia', ph: 'https://expedia.com/...' },
            { key: 'rss', label: 'RSS Feed', ph: 'https://yourblog.com/feed.xml' },
            { key: 'amazon', label: 'Amazon', ph: 'https://amazon.com/stores/...' },
            { key: 'websiteLink', label: 'Website Link', ph: 'https://yourwebsite.com' },
          ] as const).map(({ key, label, ph }) => (
            <div key={key}>
              <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
              <Input value={form[key]} onChange={e => set(key, e.target.value)} placeholder={ph} className="text-xs h-8" />
            </div>
          ))}
        </div>
      </div>
      {/* Verdiict per-member override */}
      <div>
        <Label className="text-xs font-medium mb-2 block">Verdiict (optional — overrides brand setting)</Label>
        <VerdiictSyncSection
          verdiictUrl={form.verdiictUrl}
          onSync={(reviewUrl, directoryUrl) => {
            set('verdiictUrl', reviewUrl);
            set('verdiictReviewsUrl', directoryUrl);
          }}
          onClear={() => {
            set('verdiictUrl', '');
            set('verdiictReviewsUrl', '');
          }}
          description="Sync a Verdiict location for this member, or leave unsynced to use the brand's."
          modal
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button onClick={() => onSave(form)} className="flex-1" disabled={!form.fullName || isSaving}>
          <CheckCircle2 className="w-4 h-4 mr-1.5" />{isSaving ? 'Saving...' : 'Save Member'}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
      </div>
      {previewData && brandId && <LivePreviewPanel data={previewData} brandId={brandId} />}
    </div>
  );
}

// ─── Signature Preview Dialog ─────────────────────────────────────────────────
function SignatureDialog({ brand, member, onClose, brandId: managedBrandId }: { brand: Brand; member: Member; onClose: () => void; brandId?: string | null }) {
  // Always the explicit brand being previewed — never the active context.
  const brandId = managedBrandId ?? null;
  const utils = trpc.useUtils();
  const sigData = useMemo(() => buildSignatureData(brand, member), [brand, member]);
  // Final email-ready HTML (tracked links + hosted PNG icons) — built async,
  // so copy/download/code are disabled until it resolves.
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    renderExportHtml({
      utils,
      data: sigData,
      brandId,
      signatureBrandId: brand.id,
      memberId: member.id,
    }).then((h) => { if (!cancelled) setHtml(h); });
    return () => { cancelled = true; };
  }, [utils, sigData, brandId, brand.id, member.id]);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');

  const handleDownload = () => {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${member.fullName.replace(/\s+/g, '-').toLowerCase()}-signature.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Signature downloaded');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-4 h-4" />
            {member.fullName} — {brand.name}
          </DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={v => setTab(v as 'preview' | 'code')} className="min-w-0">
          <div className="flex items-center justify-between mb-3">
            <TabsList className="h-8">
              <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
              <TabsTrigger value="code" className="text-xs">HTML Code</TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              {html && <SignatureCopyButtons html={html} />}
              <Button size="sm" variant="outline" className="text-xs gap-1.5 h-8" onClick={handleDownload} disabled={!html}>
                <Download className="w-3.5 h-3.5" /> Download
              </Button>
            </div>
          </div>
          <TabsContent value="preview" className="min-w-0">
            <div className="border rounded-lg bg-white p-4 overflow-hidden min-w-0">
              <SignaturePreview data={sigData} brandId={brandId!} />
            </div>
          </TabsContent>
          <TabsContent value="code" className="min-w-0">
            <pre className="text-xs bg-[#0E0E0C] text-primary/90 p-4 rounded-lg overflow-auto max-h-96 leading-relaxed whitespace-pre-wrap break-all">
              {html ?? 'Preparing export HTML…'}
            </pre>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Import Dialog ─────────────────────────────────────────────────────
type ParsedRow = {
  fullName: string;
  jobTitle: string;
  department: string;
  email: string;
  mobile: string;
  phone: string;
  linkedin: string;
  instagram: string;
  facebook: string;
  twitter: string;
  youtube: string;
  github: string;
  spotify: string;
  pinterest: string;
  tiktok: string;
  googleMaps: string;
  googleReviews: string;
  trustpilot: string;
  tripadvisor: string;
  uberEats: string;
  deliveroo: string;
  expedia: string;
  rss: string;
  amazon: string;
  websiteLink: string;
  photoLinkUrl: string;
  verdiictUrl: string;
  verdiictReviewsUrl: string;
  error?: string;
};

const CSV_COLUMNS = ['fullName','jobTitle','department','email','mobile','phone','linkedin','instagram','facebook','twitter','youtube','github','spotify','pinterest','tiktok','googleMaps','googleReviews','trustpilot','tripadvisor','uberEats','deliveroo','expedia','rss','amazon','websiteLink','photoLinkUrl','verdiictUrl','verdiictReviewsUrl'] as const;

function downloadCsvTemplate() {
  const header = CSV_COLUMNS.join(',');
  const example = 'John Smith,Sales Manager,Sales,john@company.com,+61 400 000 001,+61 2 0000 0001,https://linkedin.com/in/john,,,,,,,,,,,,,,,,,,,,https://yoursite.com/john\nJane Doe,Marketing Director,Marketing,jane@company.com,+61 400 000 002,,https://linkedin.com/in/jane,,,,,,,,,,,,,,,,,,,,';
  // Note: photoUrl cannot be imported via spreadsheet — upload photos individually from the member editor.
  const csv = `${header}\n${example}`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'members-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsvText(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line, idx) => {
    // Handle quoted fields with commas
    const values: string[] = [];
    let inQuote = false;
    let cur = '';
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    const row: Partial<ParsedRow> = {};
    CSV_COLUMNS.forEach(col => {
      const i = headers.indexOf(col);
      row[col] = i >= 0 ? (values[i] ?? '').replace(/^"|"$/g, '') : '';
    });
    if (!row.fullName) row.error = `Row ${idx + 2}: fullName is required`;
    return row as ParsedRow;
  });
}

/** "$1.00" — per-seat price formatting for billing disclosures. */
function fmtMoney(amount: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
}

/** The billing fields of signatures.entitlement the seat-price disclosures need. */
type SeatBilling = {
  ownerSubscribed: boolean;
  betaExempt: boolean;
  ownerSeatCount: number;
  freeAllowance: number;
  unitAmount: number | null;
  currency: string;
} | undefined;

/** How many of `adding` new seats will be billable, given the owner-wide count.
 *  Beta-exempt owners are never billed, so every seat reads as free. */
function billableSeatsAdded(ent: SeatBilling, adding: number): number {
  if (!ent || ent.betaExempt) return 0;
  const seats = ent.ownerSeatCount;
  const free = ent.freeAllowance;
  return Math.max(0, seats + adding - free) - Math.max(0, seats - free);
}

function BulkImportDialog({
  open, signatureBrandId, ownerSubscribed, entitlement, onClose, onImported
}: {
  open: boolean;
  /** A DEPARTMENT id — the seats it creates are brand-level all the same. */
  signatureBrandId: string;
  ownerSubscribed: boolean;
  entitlement: SeatBilling;
  onClose: () => void;
  onImported: () => void;
}) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const createMember = trpc.signatures.members.create.useMutation();

  const handleFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      const text = await file.text();
      setRows(parseCsvText(text));
    } else if (ext === 'xlsx' || ext === 'xls') {
      try {
        const xlsx = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const wb = xlsx.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = xlsx.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        const parsed: ParsedRow[] = json.map((rowObj, idx) => {
          const row: Partial<ParsedRow> = {};
          CSV_COLUMNS.forEach(col => { row[col] = String(rowObj[col] ?? ''); });
          if (!row.fullName) row.error = `Row ${idx + 2}: fullName is required`;
          return row as ParsedRow;
        });
        setRows(parsed);
      } catch {
        toast.error('Failed to parse Excel file. Please use CSV format.');
      }
    } else {
      toast.error('Please upload a CSV or Excel (.xlsx) file.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    const valid = rows.filter(r => !r.error);
    if (!valid.length) { toast.error('No valid rows to import'); return; }
    // Bulk import adds multiple seats — each beyond the first is billable. Require a
    // subscription first so we never create a partial/unpaid import; the owner starts
    // one by adding a single seat via "Add Member" (which runs checkout).
    if (!ownerSubscribed) {
      toast.error('Subscribe to import your team — add your first signature with “Add Member” to start, then bulk import the rest.');
      return;
    }
    setImporting(true);
    setProgress({ done: 0, total: valid.length });
    const errs: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      try {
        const res = await createMember.mutateAsync({ ...valid[i], signatureBrandId });
        if (res.status !== 'created') {
          errs.push(`${valid[i].fullName}: subscription required`);
        }
      } catch (e: unknown) {
        errs.push(`${valid[i].fullName}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
      setProgress({ done: i + 1, total: valid.length });
    }
    setImporting(false);
    setErrors(errs);
    if (errs.length === 0) {
      toast.success(`Imported ${valid.length} member${valid.length !== 1 ? 's' : ''} successfully!`);
      onImported();
    } else {
      toast.error(`Imported with ${errs.length} error${errs.length !== 1 ? 's' : ''}`);
    }
  };

  const validRows = rows.filter(r => !r.error);
  const errorRows = rows.filter(r => r.error);

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            Bulk Import Members
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Instructions & Template */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg text-sm">
            <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-muted-foreground">Upload a CSV or Excel file with member data. Required column: <code className="text-xs bg-background px-1 py-0.5 rounded">fullName</code>. All other columns are optional.</p>
              <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-xs" onClick={downloadCsvTemplate}>
                Download CSV template
              </Button>
            </div>
          </div>

          {/* Drop Zone */}
          <div
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">Drop CSV or Excel file here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />
          </div>

          {/* Preview Table */}
          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {validRows.length} valid row{validRows.length !== 1 ? 's' : ''}
                  {errorRows.length > 0 && <span className="text-destructive ml-2">({errorRows.length} with errors)</span>}
                </p>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setRows([])}>
                  <X className="w-3 h-3 mr-1" /> Clear
                </Button>
              </div>
              <div className="border rounded-lg overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-left px-3 py-2 font-medium">Title</th>
                      <th className="text-left px-3 py-2 font-medium">Email</th>
                      <th className="text-left px-3 py-2 font-medium">Mobile</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} className={`border-t ${row.error ? 'bg-destructive/5' : ''}`}>
                        <td className="px-3 py-2">{row.fullName || <span className="text-muted-foreground italic">—</span>}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.jobTitle}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.email}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.mobile}</td>
                        <td className="px-3 py-2">
                          {row.error
                            ? <span className="text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" />{row.error}</span>
                            : <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />OK</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Billing disclosure — imports add billable seats, say exactly what they cost. */}
          {validRows.length > 0 && entitlement?.unitAmount != null && (() => {
            const billable = billableSeatsAdded(entitlement, validRows.length);
            const unit = entitlement.unitAmount;
            const cur = entitlement.currency ?? 'AUD';
            return (
              <div className="flex items-start gap-2 p-3 rounded-lg border text-sm bg-muted/50">
                <CreditCard className="w-4 h-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                {billable > 0 ? (
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {billable} of these {validRows.length} member{validRows.length !== 1 ? 's' : ''} {billable === 1 ? 'is a billable seat' : 'are billable seats'} at {fmtMoney(unit, cur)}/seat per month
                    </span>{' '}
                    — importing adds {fmtMoney(unit * billable, cur)}/month to the brand owner's Signatures subscription, charged to the saved card. Removing members later reduces the bill.
                  </p>
                ) : (
                  <p className="text-muted-foreground">Beta access active — no charge.</p>
                )}
              </div>
            );
          })()}

          {/* Progress */}
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Importing...</span>
                <span>{progress.done} / {progress.total}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Import errors */}
          {errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-destructive">Import errors:</p>
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-destructive bg-destructive/5 px-3 py-1.5 rounded">{e}</p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={importing}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={importing || validRows.length === 0}
            className="gap-1.5"
          >
            {importing ? 'Importing...' : `Import ${validRows.length} Member${validRows.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


/* ── Departments ──────────────────────────────────────────────────────────────
 *
 * A DEPARTMENT is one complete signature design for the active brand: Sales,
 * Support, Execs. The brand's people, campaigns and analytics are shared across
 * all of them — only the design differs — and each department gets its own share
 * page. Exactly one is the DEFAULT: the design new work starts from, and the one
 * the rest of the Prodesk suite reads as the brand kit.
 *
 * The landing screen is a wall of LIVE previews rather than a list of names,
 * because a signature is a visual object — you recognise the Sales layout on
 * sight, long before you read the label under it.
 * ─────────────────────────────────────────────────────────────────────────── */

/** A department as returned by `signatures.departments.list` (combined view). */
type Department = Brand & {
  departmentName?: string | null;
  isDefault: boolean;
  memberCount: number;
  /** URL segment 1 — the brand, shared by every department. */
  brandSlug: string;
  /** URL segment 2 — persisted, so a rename never moves the link. */
  departmentSlug: string;
};

/** The department label shown everywhere — falls back for pre-departments rows. */
const deptLabel = (d: { departmentName?: string | null; isDefault: boolean }) =>
  d.departmentName?.trim() || (d.isDefault ? 'Main' : 'Untitled department');

/**
 * One department, previewed as the signature it actually produces.
 *
 * The preview renders the brand's FIRST member so the card shows a real person's
 * signature; brands with no members yet fall back to the sample so the card is
 * never an empty box. The preview is clipped to a fixed band with a fade at the
 * bottom edge — signatures vary wildly in height and a ragged grid would read as
 * broken rather than as varied.
 */
function DepartmentCard({
  department,
  brandId,
  previewMember,
  onOpen,
  onEditDesign,
  onShare,
  onDuplicate,
  onMakeDefault,
  onRename,
  onDelete,
}: {
  department: Department;
  brandId: string;
  previewMember: Member;
  onOpen: () => void;
  onEditDesign: () => void;
  onShare: () => void;
  onDuplicate: () => void;
  onMakeDefault: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const data = useMemo(
    () => buildSignatureData(department, previewMember),
    [department, previewMember],
  );
  const templateName =
    TEMPLATES.find(t => t.id === department.defaultTemplate)?.name ?? 'Image Card';

  // The menu's content is portalled outside the card, so clicking an ITEM never
  // reaches the card. Clicking the card to DISMISS an open menu does, though —
  // and would navigate as a side effect of closing. Radix closes on pointerdown
  // and React fires onClick after pointerup, by which point the menu already
  // reads as closed, so the state has to be sampled at press time.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenAtPress = useRef(false);

  return (
    // The WHOLE card opens the department; only the action controls opt out, by
    // stopping propagation on their own wrapper. One click target beats hunting
    // for the live region of a card.
    <div
      onPointerDownCapture={() => {
        menuOpenAtPress.current = menuOpen;
      }}
      onClick={() => {
        if (!menuOpenAtPress.current) onOpen();
      }}
      className="group flex cursor-pointer flex-col rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0E0E0C]"
    >
      <div className="relative h-[168px] overflow-hidden rounded-t-xl border-b bg-white p-4">
        <SignaturePreview data={data} brandId={brandId} />
        {/* Fades the clip line so a tall signature ends softly instead of being cut. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        {/* The preview renders in an IFRAME, which swallows clicks rather than
            bubbling them — without this transparent layer sitting OVER it, the
            card's whole hero area is dead to the container's onClick. */}
        <div className="absolute inset-0 z-10 flex items-end justify-center pb-3">
          <span className="rounded-full bg-[#0E0E0C] px-3 py-1 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
            View members
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* The card's keyboard entry point — a div with onClick is
                  unreachable by keyboard, so the name stays a real button. */}
              <button
                type="button"
                onClick={onOpen}
                className="truncate rounded text-left font-semibold group-hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0E0E0C]"
              >
                {deptLabel(department)}
              </button>
              {department.isDefault && (
                <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0E0E0C]">
                  Default
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {templateName} · {department.memberCount} member
              {department.memberCount === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-1">
            <span
              className="inline-block h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: department.primaryColor ?? '#0E0E0C' }}
              title="Primary colour"
            />
            <span
              className="inline-block h-3 w-3 rounded-full border border-border"
              style={{ backgroundColor: department.barColor ?? 'var(--color-primary)' }}
              title="Bar colour"
            />
          </div>
        </div>

        {/* The one region that does NOT open the department. Stopping here
            covers the menu's portalled content too, which renders outside the
            card but bubbles React events back through this subtree. */}
        <div
          className="mt-auto flex items-center gap-2"
          onClick={e => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="outline"
            className="h-8 flex-1 gap-1.5 text-xs"
            onClick={onEditDesign}
          >
            <Edit2 className="h-3.5 w-3.5" /> Edit design
          </Button>
          {/* modal={false} is deliberate, and mirrors main-layout's account menu.
              A modal Radix menu sets `pointer-events: none` on <body> while open
              and restores it on a DEFERRED tick. Every item here (open, rename,
              duplicate, make default, delete) re-renders this grid away before
              that cleanup runs, which leaves <body> locked and the whole page
              unclickable — text still selectable, the tell-tale sign. Non-modal
              never locks. */}
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                aria-label={`More actions for ${deptLabel(department)}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onOpen}>
                <Users className="h-4 w-4" /> Open members
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onShare}>
                <Share2 className="h-4 w-4" /> Copy share link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy className="h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onRename}>
                <Edit2 className="h-4 w-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onMakeDefault} disabled={department.isDefault}>
                <Star className="h-4 w-4" /> Make default
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={onDelete}
                disabled={department.isDefault}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

/** A brand and its departments, as returned by `departments.copySources`. */
type CopySourceGroup = {
  brandId: string;
  brandName: string;
  isCurrentBrand: boolean;
  departments: Array<{
    id: string;
    departmentName: string | null;
    isDefault: boolean;
    primaryColor: string | null;
  }>;
};

/** What a new department can be cloned from. */
type CopySource =
  | { kind: 'blank' }
  | { kind: 'saved'; id: string; label: string; data: SignatureData }
  | {
      kind: 'department';
      id: string;
      label: string;
      brandName: string;
      sameBrand: boolean;
    };

const sourceLabel = (s: CopySource) =>
  s.kind === 'blank'
    ? 'Start blank'
    : s.kind === 'saved' || s.sameBrand
      ? s.label
      : `${s.brandName} · ${s.label}`;

function PickerHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function PickerRow({
  label,
  hint,
  swatch,
  onClick,
  trailingChevron,
}: {
  label: string;
  hint?: string;
  swatch?: string | null;
  onClick: () => void;
  trailingChevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted"
    >
      {swatch !== undefined && (
        <span
          className="h-3 w-3 shrink-0 rounded-full border border-border"
          style={{ backgroundColor: swatch ?? '#0E0E0C' }}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {hint}
        </span>
      )}
      {trailingChevron && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />}
    </button>
  );
}

/**
 * "Copy from" picker.
 *
 * The signature form is long, so almost nobody wants to fill one in from
 * scratch. The picker opens on what is closest to hand — this brand's saved
 * signatures and its other departments — and keeps everything else one step
 * behind "Other brands", because reaching for another brand's design is the
 * rarer, more deliberate move and should not crowd the common case.
 */
function CopyFromPicker({
  value,
  onChange,
  savedSignatures,
  sources,
  currentBrandId,
}: {
  value: CopySource;
  onChange: (next: CopySource) => void;
  savedSignatures: SavedSignature[];
  sources: CopySourceGroup[];
  currentBrandId: string;
}) {
  const [open, setOpen] = useState(false);
  // null = the default view; 'list' = choose a brand; otherwise a brand id.
  const [otherView, setOtherView] = useState<string | null>(null);

  const thisBrand = sources.find(g => g.brandId === currentBrandId);
  const otherBrands = sources.filter(g => g.brandId !== currentBrandId);
  const drilled =
    otherView && otherView !== 'list'
      ? sources.find(g => g.brandId === otherView)
      : null;

  const pick = (next: CopySource) => {
    onChange(next);
    setOpen(false);
    setOtherView(null);
  };

  return (
    // Deliberately NOT a Popover.
    //
    // This list lives inside a modal Dialog, and a portalled overlay nested in a
    // modal Dialog is a running battle: non-modal renders but ignores clicks
    // (the Dialog sets `pointer-events: none` on <body> and the portal is
    // outside it), while modal fights the Dialog over the dismissable-layer
    // stack. An inline panel has no portal, no layer stack and no pointer-events
    // negotiation, so none of that can happen. It also suits the content — the
    // picker IS this dialog's main job, so showing the options beats hiding them
    // behind a click.
    <div className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(o => !o);
          setOtherView(null);
        }}
        className="flex h-9 w-full items-center justify-between rounded-t-lg px-3 text-sm hover:bg-muted"
      >
        <span className="truncate">{sourceLabel(value)}</span>
        <ChevronDown
          className={`ml-2 h-4 w-4 shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="max-h-[260px] overflow-y-auto border-t py-1">
          {drilled ? (
            <>
              <button
                type="button"
                onClick={() => setOtherView(otherBrands.length > 1 ? 'list' : null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <PickerHeading>{drilled.brandName}</PickerHeading>
              {drilled.departments.map(d => (
                <PickerRow
                  key={d.id}
                  label={deptLabel(d)}
                  hint={d.isDefault ? 'Default' : undefined}
                  swatch={d.primaryColor}
                  onClick={() =>
                    pick({
                      kind: 'department',
                      id: d.id,
                      label: deptLabel(d),
                      brandName: drilled.brandName,
                      sameBrand: false,
                    })
                  }
                />
              ))}
            </>
          ) : otherView === 'list' ? (
            <>
              <button
                type="button"
                onClick={() => setOtherView(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <PickerHeading>Other brands</PickerHeading>
              {otherBrands.map(g => (
                <PickerRow
                  key={g.brandId}
                  label={g.brandName}
                  hint={String(g.departments.length)}
                  onClick={() => setOtherView(g.brandId)}
                  trailingChevron
                />
              ))}
            </>
          ) : (
            <>
              {/* Honest about what it does. This USED to read "start from the
                  brand default", which sounds like a copy of the default
                  department but actually falls back to the table's column
                  defaults — a 'classic' template with an orange bar. */}
              <PickerRow
                label="Start blank"
                hint="No design"
                onClick={() => pick({ kind: 'blank' })}
              />

              {savedSignatures.length > 0 && (
                <>
                  <PickerHeading>Saved signatures</PickerHeading>
                  {savedSignatures.map(s => (
                    <PickerRow
                      key={s.id}
                      label={s.name}
                      swatch={s.data?.primaryColor}
                      onClick={() =>
                        pick({ kind: 'saved', id: s.id, label: s.name, data: s.data })
                      }
                    />
                  ))}
                </>
              )}

              {thisBrand && thisBrand.departments.length > 0 && (
                <>
                  <PickerHeading>This brand</PickerHeading>
                  {thisBrand.departments.map(d => (
                    <PickerRow
                      key={d.id}
                      label={deptLabel(d)}
                      hint={d.isDefault ? 'Default' : undefined}
                      swatch={d.primaryColor}
                      onClick={() =>
                        pick({
                          kind: 'department',
                          id: d.id,
                          label: deptLabel(d),
                          brandName: thisBrand.brandName,
                          sameBrand: true,
                        })
                      }
                    />
                  ))}
                </>
              )}

              {otherBrands.length > 0 && (
                <>
                  <div className="my-1 border-t" />
                  <PickerRow
                    label={
                      otherBrands.length === 1
                        ? otherBrands[0].brandName
                        : 'Other brands'
                    }
                    hint={String(otherBrands.length)}
                    onClick={() =>
                      setOtherView(
                        otherBrands.length === 1 ? otherBrands[0].brandId : 'list',
                      )
                    }
                    trailingChevron
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Map a locally saved signature back onto the department design fields.
 * A saved signature is one person's rendered signature, so only the brand-wide
 * design half of it transfers — the person's own details belong to a member.
 */
function signatureDataToBrandPatch(data: SignatureData) {
  return {
    website: data.website || undefined,
    address: data.address || undefined,
    logoUrl: data.logoUrl || undefined,
    logoWidth: data.logoWidth ?? undefined,
    primaryColor: data.primaryColor || undefined,
    secondaryColor: data.secondaryColor || undefined,
    fontFamily: data.fontFamily || undefined,
    disclaimer: data.disclaimer || undefined,
    defaultTemplate: data.template || undefined,
    brandDisplayName: data.company || undefined,
  };
}

/** Create a department — name it, and choose what it starts out looking like. */
function NewDepartmentDialog({
  open,
  onOpenChange,
  brandId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<CopySource>({ kind: 'blank' });

  useEffect(() => {
    if (open) {
      setName('');
      setSource({ kind: 'blank' });
    }
  }, [open]);

  const { data: sources = [] } = trpc.signatures.departments.copySources.useQuery(
    { brandId },
    { enabled: open && !!brandId },
  );
  // Saved signatures live in this browser, scoped to the brand (see signatureTypes).
  const savedSignatures = useMemo(() => (open ? loadSavedSignatures() : []), [open]);

  // Preselect the brand's DEFAULT department. Nobody opening this dialog wants a
  // signature with none of their brand's design on it, and a blank start is the
  // one option that produces exactly that — so it has to be chosen, not defaulted
  // into. Only overrides the untouched initial value, never the user's pick.
  useEffect(() => {
    if (!open) return;
    setSource(current => {
      if (current.kind !== 'blank') return current;
      const thisBrand = (sources as CopySourceGroup[]).find(
        g => g.brandId === brandId,
      );
      const fallback =
        thisBrand?.departments.find(d => d.isDefault) ?? thisBrand?.departments[0];
      return fallback
        ? {
            kind: 'department',
            id: fallback.id,
            label: deptLabel(fallback),
            brandName: thisBrand!.brandName,
            sameBrand: true,
          }
        : current;
    });
  }, [open, sources, brandId]);

  const create = trpc.signatures.departments.create.useMutation();

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Give the department a name');
      return;
    }
    try {
      const res = await create.mutateAsync({
        brandId,
        departmentName: trimmed,
        copyFromSignatureBrandId:
          source.kind === 'department' ? source.id : undefined,
        data:
          source.kind === 'saved'
            ? signatureDataToBrandPatch(source.data)
            : undefined,
      });
      onCreated(res.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the department');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A department is its own signature design for this brand. Everyone on
            the team is available in every department — only the design changes.
          </p>
          <div>
            <Label htmlFor="new-dept-name" className="mb-1.5 block">
              Department name
            </Label>
            <Input
              id="new-dept-name"
              value={name}
              autoFocus
              placeholder="e.g. Sales"
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void submit()}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Copy from</Label>
            <CopyFromPicker
              value={source}
              onChange={setSource}
              savedSignatures={savedSignatures}
              sources={sources as CopySourceGroup[]}
              currentBrandId={brandId}
            />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Copies the whole design — logos, colours, type, links and
              disclaimer. Members, campaigns and analytics stay shared across the
              brand.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            className="bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold"
            onClick={() => void submit()}
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? 'Creating…' : 'Create department'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Rename a department in place. */
function RenameDepartmentDialog({
  target,
  onClose,
}: {
  target: Department | null;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  useEffect(() => {
    if (target) setName(deptLabel(target));
  }, [target]);

  const rename = trpc.signatures.departments.rename.useMutation({
    onSuccess: async () => {
      await utils.signatures.departments.list.invalidate();
      toast.success('Department renamed');
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open={!!target} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename department</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor="rename-dept" className="mb-1.5 block">
            Department name
          </Label>
          <Input
            id="rename-dept"
            value={name}
            autoFocus
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && target && name.trim())
                rename.mutate({
                  signatureBrandId: target.id,
                  departmentName: name.trim(),
                });
            }}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            The name appears on the department card and in its share link.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </Button>
          <Button
            className="bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold"
            disabled={!name.trim() || rename.isPending}
            onClick={() =>
              target &&
              rename.mutate({
                signatureBrandId: target.id,
                departmentName: name.trim(),
              })
            }
          >
            {rename.isPending ? 'Saving…' : 'Save name'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────────
 *
 * Two screens, one route:
 *   1. the department wall — every design this brand runs, previewed live;
 *   2. one department — its roster, with the design behind an "Edit design".
 *
 * The brand itself is chosen in the side-panel context selector, never here.
 * ─────────────────────────────────────────────────────────────────────────── */
export default function DepartmentsPage() {
  const utils = trpc.useUtils();
  const confirm = useConfirm();

  const { brandId, activeBrand } = useSignaturesContext();

  // The department being managed. `null` = the department wall.
  const [openDepartmentId, setOpenDepartmentId] = useState<string | null>(null);
  const [brandDialog, setBrandDialog] = useState<{ open: boolean; editing?: Brand }>({ open: false });
  const [memberDialog, setMemberDialog] = useState<{ open: boolean; editing?: Member }>({ open: false });
  const [previewTarget, setPreviewTarget] = useState<{ brand: Brand; member: Member } | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [newDepartmentOpen, setNewDepartmentOpen] = useState(false);
  const [renaming, setRenaming] = useState<Department | null>(null);

  // `error` is destructured deliberately. A brand ALWAYS has at least its default
  // department (the server provisions one on read), so an empty wall can only mean
  // the query failed — and rendering that as "no departments yet" is a convincing
  // lie that hides the real fault. Surface it instead.
  const {
    data: departments = [],
    isLoading: departmentsLoading,
    error: departmentsError,
  } = trpc.signatures.departments.list.useQuery(
    { brandId: brandId! },
    { enabled: !!brandId },
  ) as {
    data: Department[];
    isLoading: boolean;
    error: { message: string } | null;
  };

  // Switching brands in the side panel drops you back to that brand's wall —
  // a department id from the previous brand means nothing here.
  useEffect(() => {
    setOpenDepartmentId(null);
  }, [brandId]);

  const openDepartment =
    departments.find(d => d.id === openDepartmentId) ?? null;
  // Editing always targets a real department: the open one, or the default.
  const editingDepartment =
    openDepartment ?? departments.find(d => d.isDefault) ?? departments[0] ?? null;

  // Members are BRAND-level — one roster, rendered by every department.
  const { data: members = [], isLoading: membersLoading } =
    trpc.signatures.members.list.useQuery(
      { brandId: brandId! },
      { enabled: !!brandId },
    ) as { data: Member[]; isLoading: boolean };

  // The card previews render a real teammate when there is one, so the wall
  // shows the signatures this brand actually sends.
  const previewMember = (members[0] ?? SAMPLE_MEMBER) as Member;

  // Owner's signatures subscription status (drives the bulk-import gate + copy).
  const { data: entitlement } = trpc.signatures.entitlement.useQuery(
    { brandId: brandId ?? '' },
    { enabled: !!brandId },
  );
  const ownerSubscribed = !!entitlement?.ownerSubscribed;

  // Per-seat billing: adding a seat (member) beyond the free allowance runs checkout.
  const checkout = trpc.featureSubscriptions.checkout.useMutation();

  const invalidateDepartments = () =>
    Promise.all([
      utils.signatures.departments.list.invalidate(),
      utils.signatures.brands.get.invalidate(),
      utils.signatures.brands.list.invalidate(),
    ]);

  const updateDepartment = trpc.signatures.departments.update.useMutation({
    onSuccess: async () => {
      await invalidateDepartments();
      setBrandDialog({ open: false });
      toast.success('Design saved');
    },
    onError: e => toast.error(e.message),
  });

  const setDefaultDepartment = trpc.signatures.departments.setDefault.useMutation({
    onSuccess: async () => {
      await invalidateDepartments();
      toast.success('Default department updated');
    },
    onError: e => toast.error(e.message),
  });

  const deleteDepartment = trpc.signatures.departments.delete.useMutation({
    onSuccess: async () => {
      await invalidateDepartments();
      setOpenDepartmentId(null);
      toast.success('Department deleted');
    },
    onError: e => toast.error(e.message),
  });

  const duplicateDepartment = trpc.signatures.departments.create.useMutation({
    onSuccess: async () => {
      await invalidateDepartments();
      toast.success('Department duplicated');
    },
    onError: e => toast.error(e.message),
  });

  // Result handled per-call in submitNewMember (it may return needs_checkout), so no
  // blanket onSuccess here.
  const createMember = trpc.signatures.members.create.useMutation();
  const updateMember = trpc.signatures.members.update.useMutation({
    onSuccess: () => { utils.signatures.members.list.invalidate(); setMemberDialog({ open: false }); toast.success('Member updated'); },
    onError: e => toast.error(e.message),
  });
  const deleteMember = trpc.signatures.members.delete.useMutation({
    onSuccess: () => { utils.signatures.members.list.invalidate(); toast.success('Member removed'); },
    onError: e => toast.error(e.message),
  });

  const handleSaveDesign = (form: typeof EMPTY_BRAND_FORM) => {
    if (!editingDepartment) return;
    updateDepartment.mutate({
      signatureBrandId: editingDepartment.id,
      data: form,
    });
  };

  const shareDepartment = (department: Department) => {
    const url = buildShareUrl(
      department.id,
      department.brandSlug,
      department.departmentSlug,
    );
    window.open(url, '_blank');
    navigator.clipboard.writeText(url).then(
      () => toast.success('Share link copied. Page opened in a new tab.'),
      () => toast.success('Opened the share page in a new tab.'),
    );
  };

  const confirmDeleteDepartment = async (department: Department) => {
    const ok = await confirm({
      title: `Delete ${deptLabel(department)}?`,
      description:
        'The design and its share link go away. Your team, campaigns and analytics are shared across the brand and stay exactly as they are.',
      confirmLabel: 'Delete department',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (ok) deleteDepartment.mutate({ signatureBrandId: department.id });
  };

  // Create a seat (member). The seat row is written server-side immediately (active
  // if free/subscribed; otherwise parked INACTIVE), so beyond the free allowance an
  // unsubscribed owner is sent to Stripe Checkout and the webhook / on-file charge
  // flips the seat active — no client-side persistence needed.
  const submitNewMember = async (signatureBrandId: string, form: typeof EMPTY_MEMBER_FORM) => {
    // Billing disclosure BEFORE anything is written or charged: seats beyond the
    // free allowance cost money — say exactly how much and where it's billed.
    if (entitlement && billableSeatsAdded(entitlement, 1) > 0 && entitlement.unitAmount != null) {
      const rate = fmtMoney(entitlement.unitAmount, entitlement.currency ?? 'AUD');
      const ok = await confirm({
        title: 'Add a billable member seat?',
        description: ownerSubscribed
          ? `This member is a paid seat: adding them adds ${rate}/month to the brand owner's Signatures subscription, charged to the saved card. Removing the member later removes the charge. One seat covers them in every department.`
          : `This member is a paid seat at ${rate}/month. You'll be taken to secure checkout to start the Signatures subscription — the signature goes live once payment completes. One seat covers them in every department.`,
        confirmLabel: `Add member · ${rate}/mo`,
      });
      if (!ok) return;
    }
    try {
      const res = await createMember.mutateAsync({ ...form, signatureBrandId });
      if (res.status === 'created') {
        await utils.signatures.members.list.invalidate();
        await utils.signatures.entitlement.invalidate();
        setMemberDialog({ open: false });
        toast.success('Member added');
        return;
      }
      // needs_checkout — the seat is parked inactive server-side; subscribe to activate
      // it (webhook / on-file charge sets it active via pendingEnableMemberId).
      const base = window.location.origin + window.location.pathname;
      const chk = await checkout.mutateAsync({
        brandId: brandId!,
        priceId: res.priceId,
        pendingEnableMemberId: res.memberId,
        successUrl: `${base}?sub=success`,
        cancelUrl: `${base}?sub=cancel`,
      });
      if (chk.url) { window.location.href = chk.url; return; }
      // Card on file charged (no redirect) → the seat is already active; refresh.
      await utils.signatures.members.list.invalidate();
      await utils.signatures.entitlement.invalidate();
      setMemberDialog({ open: false });
      toast.success('Member added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add member');
    }
  };

  const handleSaveMember = (form: typeof EMPTY_MEMBER_FORM) => {
    if (!editingDepartment) return;
    if (memberDialog.editing) {
      updateMember.mutate({ id: memberDialog.editing.id, data: form });
    } else {
      void submitNewMember(editingDepartment.id, form);
    }
  };

  const downloadAll = async () => {
    if (!openDepartment || !members.length) { toast.error('No members to export'); return; }
    // One .html file per member. Browsers throttle/drop rapid successive
    // programmatic downloads, so stagger them with a short gap to ensure every
    // signature actually reaches the disk.
    for (const member of members) {
      const html = await renderExportHtml({
        utils,
        data: buildSignatureData(openDepartment, member),
        brandId,
        signatureBrandId: openDepartment.id,
        memberId: member.id,
      });
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${member.fullName.replace(/\s+/g, '-').toLowerCase()}-signature.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    toast.success(`Downloaded ${members.length} signature${members.length !== 1 ? 's' : ''}`);
  };

  const getBrandFormValues = (brand?: Brand): typeof EMPTY_BRAND_FORM => ({
    name: brand?.name ?? '',
    collectionName: brand?.collectionName ?? '',
    website: brand?.website ?? '',
    address: brand?.address ?? '',
    primaryColor: brand?.primaryColor ?? '#0E0E0C',
    secondaryColor: brand?.secondaryColor ?? '#333333',
    fontFamily: brand?.fontFamily ?? 'Arial, Helvetica, sans-serif',
    barColor: brand?.barColor ?? 'var(--color-primary)',
    barTextColor: brand?.barTextColor ?? '#0E0E0C',
    barLogoUrl: brand?.barLogoUrl ?? '',
    barLogoKey: brand?.barLogoKey ?? '',
    barLogoLinkUrl: brand?.barLogoLinkUrl ?? '',
    brandDisplayName: brand?.brandDisplayName ?? '',
    brandTagline: brand?.brandTagline ?? '',
    logoUrl: brand?.logoUrl ?? '',
    logoKey: brand?.logoKey ?? '',
    logoWidth: brand?.logoWidth ?? 120,
    logoLinkUrl: brand?.logoLinkUrl ?? '',
    poweredByLogoUrl: brand?.poweredByLogoUrl ?? '',
    poweredByLogoKey: brand?.poweredByLogoKey ?? '',
    poweredByLabel: brand?.poweredByLabel ?? 'POWERED BY',
    poweredByLinkUrl: brand?.poweredByLinkUrl ?? '',
    verdiictUrl: brand?.verdiictUrl ?? '',
    verdiictReviewsUrl: brand?.verdiictReviewsUrl ?? '',
    disclaimer: brand?.disclaimer ?? '',
    defaultTemplate: brand?.defaultTemplate ?? 'imagecard',
    cardRadius: brand?.cardRadius ?? 0,
  });

  const getMemberFormValues = (member?: Member): typeof EMPTY_MEMBER_FORM => ({
    fullName: member?.fullName ?? '',
    jobTitle: member?.jobTitle ?? '',
    department: member?.department ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    mobile: member?.mobile ?? '',
    photoUrl: member?.photoUrl ?? '',
    photoKey: member?.photoKey ?? '',
    photoLinkUrl: member?.photoLinkUrl ?? '',
    linkedin: member?.linkedin ?? '',
    twitter: member?.twitter ?? '',
    instagram: member?.instagram ?? '',
    facebook: member?.facebook ?? '',
    youtube: member?.youtube ?? '',
    github: member?.github ?? '',
    spotify: member?.spotify ?? '',
    pinterest: member?.pinterest ?? '',
    tiktok: member?.tiktok ?? '',
    googleMaps: member?.googleMaps ?? '',
    googleReviews: member?.googleReviews ?? '',
    trustpilot: member?.trustpilot ?? '',
    tripadvisor: member?.tripadvisor ?? '',
    uberEats: member?.uberEats ?? '',
    deliveroo: member?.deliveroo ?? '',
    expedia: member?.expedia ?? '',
    rss: member?.rss ?? '',
    amazon: member?.amazon ?? '',
    websiteLink: member?.websiteLink ?? '',
    verdiictUrl: member?.verdiictUrl ?? '',
    verdiictReviewsUrl: member?.verdiictReviewsUrl ?? '',
  });

  if (!brandId) {
    return (
      <div className="rounded-xl border-2 border-dashed p-12 text-center">
        <Building2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="mb-1 font-medium">No brand selected</p>
        <p className="text-sm text-muted-foreground">
          Pick a brand from the switcher in the side panel to manage its
          departments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {openDepartment ? (
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setOpenDepartmentId(null)}>
              <ArrowLeft className="h-4 w-4" /> Departments
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="truncate font-semibold">{deptLabel(openDepartment)}</span>
            {openDepartment.isDefault && (
              <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0E0E0C]">
                Default
              </span>
            )}
          </div>
        ) : (
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Building2 className="h-6 w-6 text-primary" /> Departments
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every signature design {activeBrand?.businessName ?? 'this brand'} runs.
              One team, one set of campaigns — as many looks as you need.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {openDepartment ? (
            <>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBrandDialog({ open: true, editing: openDepartment })}>
                <Edit2 className="h-3.5 w-3.5" /> Edit design
              </Button>
              {members.length > 0 && (
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => shareDepartment(openDepartment)}>
                  <Share2 className="h-3.5 w-3.5" /> Share
                </Button>
              )}
              {members.length > 0 && (
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={downloadAll}>
                  <Download className="h-3.5 w-3.5" /> Export all
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBulkImportOpen(true)}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> Bulk import
              </Button>
              <Button size="sm" className="h-8 gap-1.5 border border-[#0E0E0C] bg-primary text-xs font-semibold text-[#0E0E0C] hover:bg-primary/85" onClick={() => setMemberDialog({ open: true })}>
                <Plus className="h-3.5 w-3.5" /> Add member
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-8 gap-1.5 border border-[#0E0E0C] bg-primary text-xs font-semibold text-[#0E0E0C] hover:bg-primary/85" onClick={() => setNewDepartmentOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> New department
            </Button>
          )}
        </div>
      </div>

      {/* ── Screen 1: the department wall ─────────────────────────────────── */}
      {!openDepartment && (
        // Wait for the roster too: the cards preview a real teammate, and
        // rendering the sample first would re-mount every preview iframe a
        // moment later just to swap the person inside it.
        departmentsLoading || membersLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(i => <div key={i} className="h-72 animate-pulse rounded-xl bg-muted" />)}
          </div>
        ) : departmentsError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <p className="mb-1 font-medium">Couldn&rsquo;t load this brand&rsquo;s departments</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              {departmentsError.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => utils.signatures.departments.list.invalidate()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {departments.map(department => (
              <DepartmentCard
                key={department.id}
                department={department}
                brandId={brandId}
                previewMember={previewMember}
                onOpen={() => setOpenDepartmentId(department.id)}
                onEditDesign={() => {
                  setOpenDepartmentId(department.id);
                  setBrandDialog({ open: true, editing: department });
                }}
                onShare={() => shareDepartment(department)}
                onDuplicate={() =>
                  duplicateDepartment.mutate({
                    brandId,
                    departmentName: `${deptLabel(department)} copy`,
                    copyFromSignatureBrandId: department.id,
                  })
                }
                onMakeDefault={() => setDefaultDepartment.mutate({ signatureBrandId: department.id })}
                onRename={() => setRenaming(department)}
                onDelete={() => void confirmDeleteDepartment(department)}
              />
            ))}

            {/* The add tile keeps the grid's rhythm rather than hiding the action
                in the header once the wall gets long. */}
            <button
              type="button"
              onClick={() => setNewDepartmentOpen(true)}
              className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-muted-foreground transition-colors hover:border-[#0E0E0C]/40 hover:text-foreground"
            >
              <Plus className="h-8 w-8" />
              <span className="font-medium">New department</span>
              <span className="max-w-[220px] text-center text-xs">
                Start from a saved signature or copy another department&rsquo;s design.
              </span>
            </button>
          </div>
        )
      )}

      {/* ── Screen 2: one department's roster ─────────────────────────────── */}
      {openDepartment && (
        <div className="space-y-4">
          {/* Department summary */}
          <div className="flex items-center gap-5 rounded-xl border bg-card p-5">
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl text-lg font-bold"
              style={{ backgroundColor: openDepartment.logoUrl ? '#fff' : (openDepartment.primaryColor ?? '#0E0E0C'), color: '#fff' }}
            >
              {openDepartment.logoUrl ? (
                <LazyImage
                  src={openDepartment.logoUrl}
                  alt={openDepartment.name}
                  wrapperClassName="w-full h-full"
                  className="object-cover"
                />
              ) : (
                deptLabel(openDepartment).charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">{openDepartment.name}</h2>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {openDepartment.website && <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{openDepartment.website.replace(/^https?:\/\//, '')}</span>}
                {openDepartment.address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{openDepartment.address}</span>}
                {openDepartment.verdiictUrl && <span className="flex items-center gap-1 font-medium text-foreground"><Star className="h-3 w-3" />Verdiict enabled</span>}
                <span className="flex items-center gap-1">
                  <Palette className="h-3 w-3" />
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full border border-border" style={{ backgroundColor: openDepartment.primaryColor ?? '#0E0E0C' }} />
                    <span className="inline-block h-2.5 w-2.5 rounded-full border border-border" style={{ backgroundColor: openDepartment.barColor ?? 'var(--color-primary)' }} />
                    {TEMPLATES.find(t => t.id === openDepartment.defaultTemplate)?.name ?? 'Image Card'} template
                  </span>
                </span>
              </div>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-2xl font-bold">{membersLoading ? '—' : members.length}</div>
              <div className="text-xs text-muted-foreground">member{!membersLoading && members.length === 1 ? '' : 's'}</div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            These are the brand&rsquo;s people — every department renders the same
            roster in its own design.
          </p>

          {membersLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => <div key={i} className="h-48 animate-pulse rounded-xl bg-muted" />)}
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed p-12 text-center">
              <Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="mb-1 font-medium">No members yet</p>
              <p className="mb-4 text-sm text-muted-foreground">Add members to generate their signatures</p>
              <Button onClick={() => setMemberDialog({ open: true })}><Plus className="mr-1.5 h-4 w-4" /> Add first member</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map(member => (
                <div key={member.id} className="group overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
                  <div className="p-5">
                    <div className="mb-4 flex items-start gap-3">
                      {member.photoUrl ? (
                        <LazyImage
                          src={member.photoUrl}
                          alt={member.fullName}
                          wrapperClassName="w-12 h-12 rounded-full border-2 flex-shrink-0"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full font-bold"
                          style={{ backgroundColor: openDepartment.primaryColor ?? '#0E0E0C', color: '#fff' }}>
                          {member.fullName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-semibold">{member.fullName}</h3>
                        <p className="truncate text-xs text-muted-foreground">{member.jobTitle}</p>
                        <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-8 flex-1 gap-1 text-xs"
                        onClick={() => setPreviewTarget({ brand: openDepartment, member })}>
                        <Eye className="h-3.5 w-3.5" /> Preview
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs"
                        onClick={() => setMemberDialog({ open: true, editing: member })}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs text-destructive"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove ${member.fullName}?`,
                            description: `This permanently deletes ${member.fullName}'s signature in every department and frees up their seat. This can't be undone.`,
                            confirmLabel: 'Remove member',
                            cancelLabel: 'Cancel',
                            destructive: true,
                          });
                          if (ok) deleteMember.mutate({ id: member.id });
                        }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Design dialog — edits ONE department's signature design. */}
      <Dialog open={brandDialog.open} onOpenChange={open => !open && setBrandDialog({ open: false })}>
        <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto overflow-x-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              Edit signature design
              {editingDepartment ? ` · ${deptLabel(editingDepartment)}` : ''}
            </DialogTitle>
          </DialogHeader>
          {editingDepartment && !editingDepartment.isDefault && (
            <p className="text-xs text-muted-foreground">
              Changes here apply to this department only. The brand&rsquo;s own
              identity stays on its default department.
            </p>
          )}
          <BrandForm
            initial={getBrandFormValues(brandDialog.editing)}
            onSave={handleSaveDesign}
            onCancel={() => setBrandDialog({ open: false })}
            isSaving={updateDepartment.isPending}
            brandId={brandId}
          />
        </DialogContent>
      </Dialog>

      <NewDepartmentDialog
        open={newDepartmentOpen}
        onOpenChange={setNewDepartmentOpen}
        brandId={brandId}
        onCreated={async id => {
          await invalidateDepartments();
          setNewDepartmentOpen(false);
          setOpenDepartmentId(id);
          toast.success('Department created');
        }}
      />

      <RenameDepartmentDialog target={renaming} onClose={() => setRenaming(null)} />

      {/* Member Dialog */}
      <Dialog open={memberDialog.open} onOpenChange={open => !open && setMemberDialog({ open: false })}>
        <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto overflow-x-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{memberDialog.editing ? 'Edit member' : 'Add member'}</DialogTitle>
          </DialogHeader>
          <MemberForm
            initial={getMemberFormValues(memberDialog.editing)}
            onSave={handleSaveMember}
            onCancel={() => setMemberDialog({ open: false })}
            isSaving={createMember.isPending || updateMember.isPending}
            brand={editingDepartment}
            brandId={brandId}
          />
        </DialogContent>
      </Dialog>

      {/* Signature Preview Dialog */}
      {previewTarget && (
        <SignatureDialog
          brand={previewTarget.brand}
          member={previewTarget.member}
          onClose={() => setPreviewTarget(null)}
          brandId={brandId}
        />
      )}

      {/* Bulk Import Dialog */}
      {editingDepartment && (
        <BulkImportDialog
          open={bulkImportOpen}
          signatureBrandId={editingDepartment.id}
          ownerSubscribed={ownerSubscribed}
          entitlement={entitlement}
          onClose={() => setBulkImportOpen(false)}
          onImported={() => { utils.signatures.members.list.invalidate(); utils.signatures.entitlement.invalidate(); setBulkImportOpen(false); }}
        />
      )}
    </div>
  );
}
