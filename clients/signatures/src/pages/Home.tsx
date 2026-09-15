/**
 * SIGKITT — Main Page
 * Design: Warm Craft Studio
 * New in v2:
 *   - Save/load signatures (localStorage)
 *   - Brand templates panel
 *   - Logo size slider (fixes broken layout)
 *   - Banner image with URL link
 *   - Inline SVG social icons
 *   - YouTube + Facebook social fields
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useSignaturesContext } from '@/app/context';
import { toast } from 'sonner';
import {
  User, Briefcase, Phone, Link2, Palette, Image as ImageIcon,
  FileText, Download, Eye, Code2, PenLine, Sparkles, ImagePlus, LayoutTemplate, Star, Clipboard, Check, Loader2,
  Undo2, Redo2, ExternalLink, Mail
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ColorPicker } from '@shared/components/ui/color-picker';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { SignaturePreview } from '@/components/SignaturePreview';
import { TemplateSelector } from '@/components/TemplateSelector';
import { FormSection } from '@/components/FormSection';
import { CopyButton } from '@/components/CopyButton';
import { SavedSignaturesPanel } from '@/components/SavedSignaturesPanel';
import { BrandTemplatesPanel } from '@/components/BrandTemplatesPanel';
import { VerdiictSyncSection } from '@/components/VerdiictSyncSection';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { PRODESK_ORIGINS } from '@shared/lib/origins';
import { useCrossAppOpen } from '@shared/auth/use-cross-app';
import { useUndoRedoState } from '@/hooks/useUndoRedoState';
import { generateSignatureHtml, wrapTrackingUrl, type IconUrlMap, type TrackingContext } from '@/lib/signatureGenerator';
import { activeIconKeys, exportIconColor, renderExportHtml } from '@/lib/signatureExport';
import { LazyImage } from '@shared/components/ui/lazy-image';
import {
  DEFAULT_SIGNATURE, FONT_OPTIONS, FONT_SIZE_OPTIONS,
  type SignatureData, type TemplateId,
  loadSavedSignatures, saveSignature,
  updateSavedSignatureEnvelope, getActiveWorkspaceId, setActiveWorkspaceId,
} from '@/lib/signatureTypes';

const PREVIEW_BG = 'https://d2xsxph8kpxj0f.cloudfront.net/310519663481494050/nfsfRReuXmSfcBdNitFvpt/signature-preview-bg-Adbk9VsoSUf38a8Fqfrsu4.webp';

// Helper to obfuscate/abstract HTML code view so that users see variables instead of actual values
function replaceValuesWithVariables(html: string, data: SignatureData): string {
  let result = html;
  const replacements: Array<{ value: string | undefined | null; placeholder: string }> = [
    { value: data.fullName, placeholder: '{{FULL_NAME}}' },
    { value: data.jobTitle, placeholder: '{{JOB_TITLE}}' },
    { value: data.department, placeholder: '{{DEPARTMENT}}' },
    { value: data.company, placeholder: '{{COMPANY}}' },
    { value: data.email, placeholder: '{{EMAIL}}' },
    { value: data.phone, placeholder: '{{PHONE}}' },
    { value: data.mobile, placeholder: '{{MOBILE}}' },
    { value: data.website, placeholder: '{{WEBSITE}}' },
    { value: data.address, placeholder: '{{ADDRESS}}' },
    { value: data.customCta, placeholder: '{{CUSTOM_CTA}}' },
    { value: data.disclaimer, placeholder: '{{LEGAL_DISCLAIMER}}' },
    { value: data.photoUrl, placeholder: '{{PHOTO_URL}}' },
    { value: data.logoUrl, placeholder: '{{LOGO_URL}}' },
    { value: data.bannerUrl, placeholder: '{{BANNER_URL}}' },
    { value: data.barLogoUrl, placeholder: '{{BAR_LOGO_URL}}' },
    { value: data.poweredByLogoUrl, placeholder: '{{POWERED_BY_LOGO_URL}}' },
    { value: data.linkedin, placeholder: '{{LINKEDIN_URL}}' },
    { value: data.twitter, placeholder: '{{TWITTER_URL}}' },
    { value: data.instagram, placeholder: '{{INSTAGRAM_URL}}' },
    { value: data.facebook, placeholder: '{{FACEBOOK_URL}}' },
    { value: data.youtube, placeholder: '{{YOUTUBE_URL}}' },
    { value: data.github, placeholder: '{{GITHUB_URL}}' },
    { value: data.spotify, placeholder: '{{SPOTIFY_URL}}' },
    { value: data.pinterest, placeholder: '{{PINTEREST_URL}}' },
    { value: data.tiktok, placeholder: '{{TIKTOK_URL}}' },
    { value: data.googleMaps, placeholder: '{{GOOGLE_MAPS_URL}}' },
    { value: data.googleReviews, placeholder: '{{GOOGLE_REVIEWS_URL}}' },
    { value: data.trustpilot, placeholder: '{{TRUSTPILOT_URL}}' },
    { value: data.tripadvisor, placeholder: '{{TRIPADVISOR_URL}}' },
    { value: data.uberEats, placeholder: '{{UBER_EATS_URL}}' },
    { value: data.deliveroo, placeholder: '{{DELIVEROO_URL}}' },
    { value: data.expedia, placeholder: '{{EXPEDIA_URL}}' },
    { value: data.amazon, placeholder: '{{AMAZON_URL}}' },
    { value: data.websiteLink, placeholder: '{{WEBSITE_LINK_URL}}' },
  ];

  // Filter out empty/short values and sort by length descending to prevent partial matches
  const activeReplacements = replacements
    .filter(r => r.value && r.value.trim().length > 0)
    .sort((a, b) => b.value!.length - a.value!.length);

  for (const r of activeReplacements) {
    // Escape regex characters
    const escaped = r.value!.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    result = result.replace(regex, r.placeholder);
  }

  return result;
}

export default function Home() {
  // The studio works on ONE brand — the one in the side-panel context selector.
  // Saved signatures and the editor's working state are brand-level (localStorage
  // is scoped in SignaturesApp, the DB prefs blob by this id), so switching brands
  // switches the whole studio rather than carrying work across.
  const { brandId: activeBrandId, brands } = useSignaturesContext();
  const prefsBrandId = activeBrandId ?? brands[0]?.id ?? null;
  const confirm = useConfirm();
  const openCrossApp = useCrossAppOpen();
  const [data, setData, { undo, redo, canUndo, canRedo, undoDepth, redoDepth, resetState, loadHistoryState, getEnvelope }] = useUndoRedoState<SignatureData>(
    DEFAULT_SIGNATURE,
    'sigkitt_editor_state'
  );
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [savedPanelOpen, setSavedPanelOpen] = useState(false);
  const [lastLoadedPresetId, setLastLoadedPresetId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');

  // Campaign preview is now a yes/no for the ACTIVE brand — it used to be a brand
  // picker, which quietly competed with the context selector. `selectedBrandId`
  // still stores the brand id (that's what the prefs blob persists), so it's
  // pinned to the active brand and validated against the accessible list: a
  // stale id from a brand you've since lost degrades to "no preview".
  const previewBrandId =
    selectedBrandId &&
    selectedBrandId === activeBrandId &&
    brands.some((b) => b.id === selectedBrandId)
      ? selectedBrandId
      : null;
  const workingBrandId = previewBrandId ?? prefsBrandId;

  // ── DB: lightweight user-level preferences (activeWorkspaceId + selectedBrandId) ──
  const { data: dbActiveState, isLoading: dbLoading } = trpc.signatures.saved.getActiveState.useQuery(
    { brandId: prefsBrandId! },
    { enabled: !!prefsBrandId, refetchOnWindowFocus: false }
  );

  const saveActiveStateMutation = trpc.signatures.saved.setActiveState.useMutation();
  const saveActiveStateRef = useRef(saveActiveStateMutation.mutate);
  saveActiveStateRef.current = saveActiveStateMutation.mutate;

  const hasInitializedFromDb = useRef(false);

  // ── Workspace initialization ──────────────────────────────────────────────
  // 1. Wait for DB prefs, resolve active workspace from localStorage
  // 2. If no workspace exists, auto-create "Default"
  useEffect(() => {
    if (!dbLoading && !hasInitializedFromDb.current) {
      // Resolve the active workspace ID: localStorage first, then DB fallback
      let wsId = getActiveWorkspaceId();
      if (!wsId && dbActiveState && typeof dbActiveState === 'object' && 'activeWorkspaceId' in dbActiveState) {
        wsId = dbActiveState.activeWorkspaceId as string;
      }

      // Restore selectedBrandId from DB
      if (dbActiveState && typeof dbActiveState === 'object' && 'selectedBrandId' in dbActiveState) {
        setSelectedBrandId(dbActiveState.selectedBrandId as string | null);
      }

      const workspaces = loadSavedSignatures();

      if (wsId) {
        const ws = workspaces.find(s => s.id === wsId);
        if (ws) {
          // Load existing workspace with its undo/redo envelope
          if (ws.envelope) {
            loadHistoryState(ws.envelope);
          } else {
            // Legacy workspace without envelope — load flat data
            loadHistoryState(ws.data);
          }
          setLastLoadedPresetId(ws.id);
          setActiveWorkspaceId(ws.id);
        } else {
          // Workspace ID referenced but not found — create a new Default
          const entry = saveSignature('Default', DEFAULT_SIGNATURE);
          setLastLoadedPresetId(entry.id);
          setActiveWorkspaceId(entry.id);
          resetState(DEFAULT_SIGNATURE);
        }
      } else if (workspaces.length > 0) {
        // No active ID but workspaces exist — load the first one
        const ws = workspaces[0];
        if (ws.envelope) {
          loadHistoryState(ws.envelope);
        } else {
          loadHistoryState(ws.data);
        }
        setLastLoadedPresetId(ws.id);
        setActiveWorkspaceId(ws.id);
      } else {
        // No workspaces at all — create "Default"
        const entry = saveSignature('Default', DEFAULT_SIGNATURE);
        setLastLoadedPresetId(entry.id);
        setActiveWorkspaceId(entry.id);
        resetState(DEFAULT_SIGNATURE);
      }

      hasInitializedFromDb.current = true;
    }
  }, [dbActiveState, dbLoading, loadHistoryState, resetState]);

  // ── Auto-save active workspace to localStorage (debounced) ────────────────
  useEffect(() => {
    if (!hasInitializedFromDb.current || !lastLoadedPresetId) return;

    setSaveStatus('saving');
    const timer = setTimeout(() => {
      updateSavedSignatureEnvelope(lastLoadedPresetId, getEnvelope());
      setSaveStatus('saved');
    }, 800);

    return () => clearTimeout(timer);
  }, [data, lastLoadedPresetId, getEnvelope]);

  // ── Sync lightweight prefs to DB (debounced) ─────────────────────────────
  useEffect(() => {
    if (!hasInitializedFromDb.current || !prefsBrandId) return;

    const timer = setTimeout(() => {
      saveActiveStateRef.current({
        brandId: prefsBrandId,
        data: JSON.stringify({
          activeWorkspaceId: lastLoadedPresetId,
          selectedBrandId: previewBrandId,
        }),
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, [lastLoadedPresetId, previewBrandId, prefsBrandId]);

  const isInitializing = dbLoading && !hasInitializedFromDb.current;

  // Track saved preset name for tooltip lookup
  const lastLoadedPresetName = useMemo(() => {
    if (!lastLoadedPresetId) return null;
    try {
      const savedList = loadSavedSignatures();
      return savedList.find(s => s.id === lastLoadedPresetId)?.name ?? null;
    } catch {
      return null;
    }
  }, [lastLoadedPresetId, savedPanelOpen]);

  const handleQuickSave = useCallback(() => {
    if (lastLoadedPresetId) {
      try {
        const savedList = loadSavedSignatures();
        const existing = savedList.find(s => s.id === lastLoadedPresetId);
        if (existing) {
          updateSavedSignatureEnvelope(lastLoadedPresetId, getEnvelope());
          toast.success(`Updated "${existing.name}"`);
          return;
        }
      } catch {
        // Fall back to opening preset modal on error
      }
    }
    setSavedPanelOpen(true);
  }, [lastLoadedPresetId, getEnvelope]);

  // Keyboard shortcuts for Undo (Ctrl+Z), Redo (Ctrl+Y), and Save (Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts if typing in text inputs or textareas
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
      ) {
        return;
      }

      const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && !e.altKey) {
        if (e.key.toLowerCase() === 's') {
          e.preventDefault();
          handleQuickSave();
        } else if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, handleQuickSave]);

  // Resolve the previewed Prodesk brand → its 1:1 signature-brand satellite, whose
  // id campaigns and click-tracking are keyed by.
  const { data: previewSignatureBrand } = trpc.signatures.brands.get.useQuery(
    { brandId: previewBrandId! },
    { enabled: !!previewBrandId, retry: 1 }
  );
  const previewSignatureBrandId = previewSignatureBrand?.id ?? null;

  // Fetch active campaigns for the previewed brand
  const {
    data: activeCampaigns,
    isLoading: campaignsLoading,
    isError: campaignsError,
  } = trpc.signatures.campaigns.getActive.useQuery(
    { signatureBrandId: previewSignatureBrandId! },
    { enabled: !!previewSignatureBrandId, retry: 1 }
  );

  // Pick the first active campaign banner for preview
  const activeCampaignBanner = activeCampaigns && activeCampaigns.length > 0
    ? activeCampaigns[0]
    : null;
  const photoInputRef = useRef<HTMLInputElement>(null);
  const imageCardPhotoInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const poweredByLogoInputRef = useRef<HTMLInputElement>(null);
  const barLogoInputRef = useRef<HTMLInputElement>(null);

  const update = useCallback(<K extends keyof SignatureData>(key: K, value: SignatureData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  const applyPartial = useCallback((partial: Partial<SignatureData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  const compressImage = (
    file: File,
    maxDimension = 1200,
    quality = 0.8,
    callback: (dataUrl: string) => void
  ) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          callback(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const format = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const compressedDataUrl = canvas.toDataURL(format, format === 'image/jpeg' ? quality : undefined);
        callback(compressedDataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'photoUrl' | 'logoUrl' | 'bannerUrl' | 'poweredByLogoUrl' | 'brandDisplayName' | 'barLogoUrl'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (field === 'brandDisplayName' && file.type !== 'image/png') {
      toast.error('Bar logo must be a PNG file.');
      e.target.value = '';
      return;
    }
    if (file.size > 1024 * 1024) {
      const toastId = toast.loading('Compressing large image...');
      compressImage(file, 1200, 0.8, (compressedDataUrl) => {
        update(field, compressedDataUrl);
        toast.dismiss(toastId);
        toast.success('Image compressed and uploaded successfully!');
      });
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => update(field, ev.target?.result as string);
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  // Build campaign banner HTML to append to signature
  const buildCampaignBannerHtml = (tracking?: TrackingContext) => {
    if (!activeCampaignBanner?.banner) return '';
    const rawUrl = activeCampaignBanner.campaign.linkUrl;
    // A campaign banner click is recorded as a banner_click (the analytics enum
    // has no separate campaign type); the campaign id rides along so the event
    // is attributed to this campaign.
    const campaignTracking: TrackingContext | undefined = tracking
      ? { ...tracking, campaignId: activeCampaignBanner.campaign.id }
      : undefined;
    const finalUrl = rawUrl ? wrapTrackingUrl(rawUrl, 'banner_click', campaignTracking) : '';
    return `<div style="margin-top:12px;">${
        finalUrl
          ? `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer" style="display:block;"><img src="${activeCampaignBanner.banner.imageUrl}" alt="${activeCampaignBanner.campaign.name}" style="max-width:100%;height:auto;display:block;border:0;" /></a>`
          : `<img src="${activeCampaignBanner.banner.imageUrl}" alt="${activeCampaignBanner.campaign.name}" style="max-width:100%;height:auto;display:block;border:0;" />`
      }</div>`;
  };

  const iconColor = useMemo(() => exportIconColor(data), [data]);

  const iconRequests = useMemo(() => {
    return activeIconKeys(data).map(key => ({ key, color: iconColor }));
  }, [data, iconColor]);

  const utils = trpc.useUtils();
  const colorizeQuery = trpc.signatures.icons.batchColorize.useQuery(
    { brandId: workingBrandId!, requests: iconRequests },
    { enabled: iconRequests.length > 0 && !!workingBrandId, retry: 1 }
  );

  const iconUrlMap = colorizeQuery.data as IconUrlMap | undefined;

  const signatureHtml = generateSignatureHtml(data, iconUrlMap) + buildCampaignBannerHtml();

  const previewSignatureHtml = useMemo(() => {
    return replaceValuesWithVariables(signatureHtml, data);
  }, [signatureHtml, data]);

  const [, setIsExporting] = useState(false);

  /** Final email-ready HTML: tracked links + hosted PNG icons + campaign banner. */
  const buildExportHtml = (): Promise<string> =>
    renderExportHtml({
      utils,
      data,
      brandId: workingBrandId,
      signatureBrandId: previewSignatureBrandId,
      fallbackIconMap: iconUrlMap,
      buildSuffix: buildCampaignBannerHtml,
    });

  const handleDownload = async () => {
    setIsExporting(true);
    try {
      const finalHtml = await buildExportHtml();
      const blob = new Blob([finalHtml], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.fullName.replace(/\s+/g, '-').toLowerCase() || 'email'}-signature.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Signature downloaded as HTML file');
    } catch {
      toast.error('Download failed, please try again.');
    } finally {
      setIsExporting(false);
    }
  };;

  // Gmail and Outlook share the rich-clipboard copy path (the markup is already
  // email-safe table HTML); only the guidance in the success toast differs.
  type RichCopyClient = 'gmail' | 'outlook';
  const [copyingClient, setCopyingClient] = useState<RichCopyClient | null>(null);
  const [copiedClient, setCopiedClient] = useState<RichCopyClient | null>(null);

  /** Copy signature as rich text so it pastes rendered into the client's signature editor */
  const handleCopyRich = async (client: RichCopyClient) => {
    setCopyingClient(client);
    try {
      const finalHtml = await buildExportHtml();

      // Create an off-screen container, inject the HTML, select it, and copy as rich text
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
      container.innerHTML = finalHtml;
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      let success = false;
      try {
        // Modern Clipboard API with HTML support
        const htmlBlob = new Blob([finalHtml], { type: 'text/html' });
        const textBlob = new Blob([container.innerText || ''], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
        ]);
        success = true;
      } catch {
        // Fallback: execCommand copies the selection as rich text
        success = document.execCommand('copy');
      }

      selection?.removeAllRanges();
      document.body.removeChild(container);

      if (success) {
        setCopiedClient(client);
        toast.success(
          client === 'gmail'
            ? 'Copied! In Gmail: ⚙️ → See all settings → Signature → Create new, then paste (Ctrl+V / Cmd+V).'
            : 'Copied! Open Outlook → Signatures → New, then paste (Ctrl+V / Cmd+V).',
        );
        setTimeout(() => setCopiedClient(null), 3000);
      } else {
        toast.error('Copy failed. Try the Download button and open the file in a browser, then copy.');
      }
    } catch {
      toast.error('Copy failed. Try the Download button and open the file in a browser, then copy.');
    } finally {
      setCopyingClient(null);
    }
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Reset Signature',
      description: 'This will create a new signature workspace with default settings. Your current workspace will be kept in the saved list.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!ok) return;

    const now = new Date();
    const name = `Default ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    resetState(DEFAULT_SIGNATURE);
    const entry = saveSignature(name, DEFAULT_SIGNATURE);
    setLastLoadedPresetId(entry.id);
    setActiveWorkspaceId(entry.id);
    setSelectedBrandId(null);
    toast.info(`New workspace "${name}" created`);
  };

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-border flex-shrink-0 bg-background">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <PenLine className="w-4 h-4 text-foreground/40 hidden sm:block" />
            <h1 className="text-sm font-bold tracking-tight text-foreground">
              SIGKITT
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 text-foreground/75"
              onClick={undo}
              disabled={!canUndo}
              title={`Undo (Ctrl+Z)${undoDepth > 0 ? ` · ${undoDepth} step${undoDepth > 1 ? 's' : ''} back` : ''}`}
            >
              <Undo2 className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 text-foreground/75"
              onClick={redo}
              disabled={!canRedo}
              title={`Redo (Ctrl+Y)${redoDepth > 0 ? ` · ${redoDepth} step${redoDepth > 1 ? 's' : ''} forward` : ''}`}
            >
              <Redo2 className="w-4 h-4" />
            </Button>
            {lastLoadedPresetId && lastLoadedPresetName && (
              <div
                className="flex items-center gap-1.5 px-2 h-8 text-xs text-foreground/50 animate-in fade-in duration-200 hidden sm:flex"
                title={
                  saveStatus === 'saving'
                    ? `Saving to "${lastLoadedPresetName}"…`
                    : `Saved to "${lastLoadedPresetName}"`
                }
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving…</span>
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 text-green-500" />
                    <span>Saved</span>
                  </>
                )}
              </div>
            )}
            <div className="w-[1px] h-4 bg-border mx-1 hidden sm:block" />
            <SavedSignaturesPanel
              current={data}
              onLoad={(loadedData, envelope) => {
                if (envelope) {
                  loadHistoryState(envelope);
                } else {
                  resetState(loadedData);
                }
              }}
              open={savedPanelOpen}
              onOpenChange={setSavedPanelOpen}
              onLoadPresetId={(id) => {
                setLastLoadedPresetId(id);
                setActiveWorkspaceId(id);
              }}
              lastLoadedPresetId={lastLoadedPresetId}
              getEnvelope={getEnvelope}
            />
            <BrandTemplatesPanel current={data} onApply={applyPartial} />
            <Button variant="outline" size="sm" onClick={handleReset} className="text-xs hidden sm:flex h-8">
              Reset
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main Layout ── */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row relative">
        {isInitializing && (
          <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm font-medium text-muted-foreground animate-pulse">Loading workspace...</p>
          </div>
        )}

        {/* ── Left Panel: Form ── */}
        <aside
          className="w-full md:w-[390px] flex-shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-border overflow-y-auto custom-scrollbar bg-background"
          style={{ height: '100%' }}
        >
          <div className="p-4 space-y-3">

            {/* Template Selection */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Template
              </Label>
              <TemplateSelector
                selected={data.template}
                onChange={(id: TemplateId) => update('template', id)}
              />
            </div>

            {/* Campaign Preview Selector */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Active Campaign
              </Label>
              <label className="flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2">
                <span className="text-sm">
                  Include the active campaign banner
                </span>
                <Switch
                  checked={previewBrandId !== null}
                  disabled={!activeBrandId}
                  onCheckedChange={on => setSelectedBrandId(on ? activeBrandId : null)}
                />
              </label>
              {campaignsLoading && previewBrandId !== null && (
                <p className="text-xs text-muted-foreground animate-pulse">Loading campaigns...</p>
              )}
              {campaignsError && (
                <p className="text-xs text-destructive">Could not load campaigns. The signature HTML will not include a campaign banner.</p>
              )}
              {!campaignsLoading && !campaignsError && activeCampaignBanner && (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-800">
                  <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="font-medium">{activeCampaignBanner.campaign.name}</span>
                  <span className="text-green-600 ml-auto">active</span>
                </div>
              )}
              {!campaignsLoading && !campaignsError && previewBrandId !== null && activeCampaigns !== undefined && activeCampaigns.length === 0 && (
                <p className="text-xs text-muted-foreground">No active campaigns for this brand right now.</p>
              )}
            </div>

            <div className="border-t border-border/60 pt-3 space-y-3">
              {/* Personal Info */}
              <FormSection title="Personal Info" icon={<User className="w-4 h-4" />} defaultOpen={true}>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Full Name *</Label>
                    <Input value={data.fullName} onChange={e => update('fullName', e.target.value)}
                      placeholder="Alex Johnson" className="h-8 text-sm bg-white" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Job Title</Label>
                    <Input value={data.jobTitle} onChange={e => update('jobTitle', e.target.value)}
                      placeholder="Senior Product Designer" className="h-8 text-sm bg-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Department</Label>
                      <Input value={data.department} onChange={e => update('department', e.target.value)}
                        placeholder="Product & Design" className="h-8 text-sm bg-white" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Company</Label>
                      <Input value={data.company} onChange={e => update('company', e.target.value)}
                        placeholder="Acme Corp" className="h-8 text-sm bg-white" />
                    </div>
                  </div>
                </div>
              </FormSection>

              {/* Contact Details */}
              <FormSection title="Contact Details" icon={<Phone className="w-4 h-4" />} defaultOpen={true}>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Email Address</Label>
                    <Input type="email" value={data.email} onChange={e => update('email', e.target.value)}
                      placeholder="alex@company.com" className="h-8 text-sm bg-white" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Phone</Label>
                      <Input value={data.phone} onChange={e => update('phone', e.target.value)}
                        placeholder="+1 (555) 000-0000" className="h-8 text-sm bg-white" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Mobile</Label>
                      <Input value={data.mobile} onChange={e => update('mobile', e.target.value)}
                        placeholder="+1 (555) 000-0001" className="h-8 text-sm bg-white" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Website</Label>
                    <Input value={data.website} onChange={e => update('website', e.target.value)}
                      placeholder="https://yourcompany.com" className="h-8 text-sm bg-white" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Address</Label>
                    <Input value={data.address} onChange={e => update('address', e.target.value)}
                      placeholder="123 Business Ave, City, State" className="h-8 text-sm bg-white" />
                  </div>
                </div>
              </FormSection>

              {/* Social Links */}
              <FormSection title="Social Links" icon={<Link2 className="w-4 h-4" />} defaultOpen={false}>
                <div className="space-y-3">
                  {[
                    { key: 'linkedin' as const, label: 'LinkedIn', placeholder: 'https://linkedin.com/in/yourname' },
                    { key: 'twitter' as const, label: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
                    { key: 'instagram' as const, label: 'Instagram', placeholder: 'https://instagram.com/yourhandle' },
                    { key: 'github' as const, label: 'GitHub', placeholder: 'https://github.com/yourusername' },
                    { key: 'youtube' as const, label: 'YouTube', placeholder: 'https://youtube.com/@yourchannel' },
                    { key: 'facebook' as const, label: 'Facebook', placeholder: 'https://facebook.com/yourpage' },
                    { key: 'spotify' as const, label: 'Spotify', placeholder: 'https://open.spotify.com/artist/...' },
                    { key: 'pinterest' as const, label: 'Pinterest', placeholder: 'https://pinterest.com/yourprofile' },
                    { key: 'tiktok' as const, label: 'TikTok', placeholder: 'https://tiktok.com/@yourhandle' },
                    { key: 'googleMaps' as const, label: 'Google Maps', placeholder: 'https://maps.google.com/?cid=...' },
                    { key: 'googleReviews' as const, label: 'Google Reviews', placeholder: 'https://g.page/r/your-review-link' },
                    { key: 'trustpilot' as const, label: 'Trustpilot', placeholder: 'https://trustpilot.com/review/yourcompany' },
                    { key: 'tripadvisor' as const, label: 'TripAdvisor', placeholder: 'https://tripadvisor.com/...' },
                    { key: 'uberEats' as const, label: 'Uber Eats', placeholder: 'https://ubereats.com/store/...' },
                    { key: 'deliveroo' as const, label: 'Deliveroo', placeholder: 'https://deliveroo.com.au/menu/...' },
                    { key: 'expedia' as const, label: 'Expedia', placeholder: 'https://expedia.com/...' },
                    { key: 'rss' as const, label: 'RSS Feed', placeholder: 'https://yourblog.com/feed.xml' },
                    { key: 'amazon' as const, label: 'Amazon', placeholder: 'https://amazon.com/stores/...' },
                    { key: 'websiteLink' as const, label: 'Website Link', placeholder: 'https://yourwebsite.com' },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <Label className="text-xs text-muted-foreground mb-1 block">{label}</Label>
                      <Input value={data[key]} onChange={e => update(key, e.target.value)}
                        placeholder={placeholder} className="h-8 text-sm bg-white" />
                    </div>
                  ))}
                </div>
              </FormSection>

              {/* Appearance */}
              <FormSection title="Appearance" icon={<Palette className="w-4 h-4" />} defaultOpen={false}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Primary Color</Label>
                      <ColorPicker value={data.primaryColor} onChange={v => update('primaryColor', v)} ariaLabel="Primary Color" />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Secondary Color</Label>
                      <ColorPicker value={data.secondaryColor} onChange={v => update('secondaryColor', v)} ariaLabel="Secondary Color" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Font Family</Label>
                    <Select value={data.fontFamily} onValueChange={v => update('fontFamily', v)}>
                      <SelectTrigger className="h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FONT_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Font Size</Label>
                    <Select value={data.fontSize} onValueChange={v => update('fontSize', v)}>
                      <SelectTrigger className="h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FONT_SIZE_OPTIONS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </FormSection>

              {/* Photo & Logo */}
              <FormSection title="Photo & Logo" icon={<ImageIcon className="w-4 h-4" />} defaultOpen={false}>
                <div className="space-y-4">
                  {/* Profile Photo */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Profile Photo</Label>
                      <Switch checked={data.showPhoto} onCheckedChange={v => update('showPhoto', v)} />
                    </div>
                    {data.showPhoto && (
                      <div className="space-y-2">
                        <p className="text-[11px] text-muted-foreground">Ideal: 400×400px JPEG/PNG, square crop, under 300KB</p>
                        <div className="flex items-center gap-2">
                          {data.photoUrl && (
                            <LazyImage src={data.photoUrl} alt="Preview"
                              wrapperClassName="w-10 h-10 rounded-full border border-border"
                              className="w-full h-full object-cover" />
                          )}
                          <Button variant="outline" size="sm" className="text-xs flex-1"
                            onClick={() => photoInputRef.current?.click()}>
                            {data.photoUrl ? 'Change Photo' : 'Upload Photo'}
                          </Button>
                          <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
                            onChange={e => handleImageUpload(e, 'photoUrl')} />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Photo Shape</Label>
                          <Select value={data.photoShape} onValueChange={v => update('photoShape', v as 'circle' | 'square' | 'rounded')}>
                            <SelectTrigger className="h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="circle">Circle</SelectItem>
                              <SelectItem value="rounded">Rounded</SelectItem>
                              <SelectItem value="square">Square</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Link2 className="w-3 h-3" /> Photo Link URL</Label>
                          <Input value={data.photoLinkUrl ?? ''} onChange={e => update('photoLinkUrl', e.target.value)}
                            placeholder="https://yoursite.com/about" className="h-8 text-sm bg-white" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Company Logo */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Company Logo</Label>
                      <Switch checked={data.showLogo} onCheckedChange={v => update('showLogo', v)} />
                    </div>
                    {data.showLogo && (
                      <div className="space-y-3">
                        <p className="text-[11px] text-muted-foreground">Ideal: 300×100px PNG with transparent background, under 200KB</p>
                        <div className="flex items-center gap-2">
                          {data.logoUrl && (
                            <LazyImage src={data.logoUrl} alt="Logo Preview"
                              wrapperClassName="h-8 border border-border rounded bg-white p-1 flex-shrink-0"
                              style={{ maxWidth: '80px' }}
                              className="object-contain" />
                          )}
                          <Button variant="outline" size="sm" className="text-xs flex-1"
                            onClick={() => logoInputRef.current?.click()}>
                            {data.logoUrl ? 'Change Logo' : 'Upload Logo'}
                          </Button>
                          <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                            onChange={e => handleImageUpload(e, 'logoUrl')} />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Link2 className="w-3 h-3" /> Logo Link URL</Label>
                          <Input value={data.logoLinkUrl ?? ''} onChange={e => update('logoLinkUrl', e.target.value)}
                            placeholder="https://yourcompany.com" className="h-8 text-sm bg-white" />
                        </div>
                        {/* Logo size slider */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <Label className="text-xs text-muted-foreground">Logo Width</Label>
                            <span className="text-xs font-mono text-muted-foreground">{data.logoWidth}px</span>
                          </div>
                          <Slider
                            min={40} max={240} step={4}
                            value={[data.logoWidth]}
                            onValueChange={([v]) => update('logoWidth', v)}
                            className="w-full"
                          />
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                            <span>40px</span><span>240px</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </FormSection>

              {/* Banner Image */}
              <FormSection title="Banner Image" icon={<ImagePlus className="w-4 h-4" />} defaultOpen={false} badge="New">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">Show Banner</Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">PNG/JPG image below signature, links to a URL</p>
                    </div>
                    <Switch checked={data.showBanner} onCheckedChange={v => update('showBanner', v)} />
                  </div>
                  {data.showBanner && (
                    <>
                      <div className="space-y-2">
                        <p className="text-[11px] text-muted-foreground">Ideal: 600×150px JPEG/PNG, under 300KB</p>
                        {data.bannerUrl && (
                          <LazyImage src={data.bannerUrl} alt="Banner Preview"
                            wrapperClassName="w-full border border-border rounded bg-white p-1 max-h-20"
                            className="object-contain" />
                        )}
                        <Button variant="outline" size="sm" className="text-xs w-full"
                          onClick={() => bannerInputRef.current?.click()}>
                          {data.bannerUrl ? 'Change Banner Image' : 'Upload Banner Image'}
                        </Button>
                        <input ref={bannerInputRef} type="file" accept="image/*" className="hidden"
                          onChange={e => handleImageUpload(e, 'bannerUrl')} />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Banner Link URL</Label>
                        <Input value={data.bannerLinkUrl} onChange={e => update('bannerLinkUrl', e.target.value)}
                          placeholder="https://yoursite.com/campaign" className="h-8 text-sm bg-white" />
                      </div>
                      {/* Banner width slider */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <Label className="text-xs text-muted-foreground">Banner Width</Label>
                          <span className="text-xs font-mono text-muted-foreground">{data.bannerWidth}px</span>
                        </div>
                        <Slider
                          min={200} max={600} step={10}
                          value={[data.bannerWidth]}
                          onValueChange={([v]) => update('bannerWidth', v)}
                          className="w-full"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                          <span>200px</span><span>600px</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </FormSection>

              {/* Image Card Settings — only shown when imagecard template is active */}
              {data.template === 'imagecard' && (
                <FormSection title="Image Card Settings" icon={<LayoutTemplate className="w-4 h-4" />} defaultOpen={true} badge="New">
                  <div className="space-y-3">
                    {/* Profile Photo for Image Card */}
                    <div className="border border-border/60 rounded-lg p-3 space-y-2 bg-white/50">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Profile Photo</Label>
                        <Switch checked={data.showPhoto} onCheckedChange={v => update('showPhoto', v)} />
                      </div>
                      {data.showPhoto && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            {data.photoUrl && (
                              <LazyImage src={data.photoUrl} alt="Preview"
                                wrapperClassName="w-10 h-10 rounded-full border border-border"
                                className="w-full h-full object-cover" />
                            )}
                            <Button variant="outline" size="sm" className="text-xs flex-1"
                              onClick={() => imageCardPhotoInputRef.current?.click()}>
                              {data.photoUrl ? 'Change Photo' : 'Upload Photo'}
                            </Button>
                            {data.photoUrl && (
                              <Button variant="outline" size="sm" className="text-xs px-2 text-destructive"
                                onClick={() => update('photoUrl', '')}>
                                Remove
                              </Button>
                            )}
                            <input ref={imageCardPhotoInputRef} type="file" accept="image/*" className="hidden"
                              onChange={e => handleImageUpload(e, 'photoUrl')} />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Photo Shape</Label>
                            <Select value={data.photoShape} onValueChange={v => update('photoShape', v as 'circle' | 'square' | 'rounded')}>
                              <SelectTrigger className="h-8 text-sm bg-white"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="circle">Circle</SelectItem>
                                <SelectItem value="rounded">Rounded</SelectItem>
                                <SelectItem value="square">Square</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                      {!data.showPhoto && (
                        <p className="text-[11px] text-muted-foreground">Enable to show your portrait photo overlapping the colour bar.</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Bar Colour</Label>
                        <ColorPicker value={data.barColor} onChange={v => update('barColor', v)} ariaLabel="Bar Colour" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Bar Text Colour</Label>
                        <ColorPicker value={data.barTextColor} onChange={v => update('barTextColor', v)} ariaLabel="Bar Text Colour" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Bar Logo (PNG only)</Label>
                      <p className="text-[11px] text-muted-foreground mb-1.5">Ideal: 400×120px PNG with transparent background, under 200KB</p>
                      <div className="flex items-center gap-2">
                        {data.barLogoUrl && (
                          <LazyImage src={data.barLogoUrl} alt="Bar logo"
                            wrapperClassName="h-10 border border-border rounded bg-white p-1 flex-shrink-0"
                            style={{ maxWidth: '100px' }}
                            className="object-contain" />
                        )}
                        <Button variant="outline" size="sm" className="text-xs flex-1"
                          onClick={() => barLogoInputRef.current?.click()}>
                          {data.barLogoUrl ? 'Change Logo' : 'Upload PNG Logo'}
                        </Button>
                        {data.barLogoUrl && (
                          <Button variant="outline" size="sm" className="text-xs px-2 text-destructive"
                            onClick={() => update('barLogoUrl', '')}>
                            Remove
                          </Button>
                        )}
                        <input ref={barLogoInputRef} type="file" accept="image/png" className="hidden"
                          onChange={e => handleImageUpload(e, 'barLogoUrl')} />
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">PNG logo shown top-left in the colour bar.</p>
                      <div className="mt-2">
                        <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Link2 className="w-3 h-3" /> Bar Logo Link URL</Label>
                        <Input value={data.barLogoLinkUrl ?? ''} onChange={e => update('barLogoLinkUrl', e.target.value)}
                          placeholder="https://yourcompany.com" className="h-8 text-sm bg-white" />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-xs text-muted-foreground">Card Width</Label>
                        <span className="text-xs font-mono text-muted-foreground">{data.imageCardWidth}px</span>
                      </div>
                      <Slider
                        min={400} max={700} step={10}
                        value={[data.imageCardWidth]}
                        onValueChange={([v]) => update('imageCardWidth', v)}
                        className="w-full"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>400px</span><span>700px</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-xs text-muted-foreground">Card Corner Radius</Label>
                        <span className="text-xs font-mono text-muted-foreground">{data.cardRadius ?? 12}px</span>
                      </div>
                      <Slider
                        min={0} max={24} step={2}
                        value={[data.cardRadius ?? 12]}
                        onValueChange={([v]) => update('cardRadius', v)}
                        className="w-full"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>0 (square)</span><span>24px (round)</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Note: rounded corners are not supported in Windows Outlook desktop.</p>
                    </div>
                    <div className="border-t border-border/60 pt-3">
                      <Label className="text-xs font-medium mb-2 block">"Powered By" Footer</Label>
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Label text</Label>
                          <Input value={data.poweredByLabel} onChange={e => update('poweredByLabel', e.target.value)}
                            placeholder="POWERED BY" className="h-8 text-sm bg-white" />
                        </div>
                        <p className="text-[11px] text-muted-foreground">Ideal: 300×80px PNG with transparent background, under 150KB</p>
                        <div className="flex items-center gap-2">
                          {data.poweredByLogoUrl && (
                            <LazyImage src={data.poweredByLogoUrl} alt="Powered by logo"
                              wrapperClassName="h-8 border border-border rounded bg-white p-1 flex-shrink-0"
                              style={{ maxWidth: '80px' }}
                              className="object-contain" />
                          )}
                          <Button variant="outline" size="sm" className="text-xs flex-1"
                            onClick={() => poweredByLogoInputRef.current?.click()}>
                            {data.poweredByLogoUrl ? 'Change Logo' : 'Upload Logo'}
                          </Button>
                          {data.poweredByLogoUrl && (
                            <Button variant="outline" size="sm" className="text-xs px-2 text-destructive"
                              onClick={() => update('poweredByLogoUrl', '')}>
                              Remove
                            </Button>
                          )}
                          <input ref={poweredByLogoInputRef} type="file" accept="image/*" className="hidden"
                            onChange={e => handleImageUpload(e, 'poweredByLogoUrl')} />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Link2 className="w-3 h-3" /> Powered By Link URL</Label>
                          <Input value={data.poweredByLinkUrl ?? ''} onChange={e => update('poweredByLinkUrl', e.target.value)}
                            placeholder="https://yourcompany.com" className="h-8 text-sm bg-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </FormSection>
              )}

              {/* Branded Card Settings — only shown when brandedcard template is active */}
              {data.template === 'brandedcard' && (
                <FormSection title="Branded Card Settings" icon={<LayoutTemplate className="w-4 h-4" />} defaultOpen={true} badge="New">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Card Background</Label>
                        <ColorPicker value={data.barColor} onChange={v => update('barColor', v)} ariaLabel="Card Background" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground mb-1 block">Text &amp; Icon Colour</Label>
                        <ColorPicker value={data.barTextColor} onChange={v => update('barTextColor', v)} ariaLabel="Text and Icon Colour" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1 block">Top-Left Logo (PNG)</Label>
                      <p className="text-[11px] text-muted-foreground mb-1.5">Ideal: transparent background PNG, under 200KB</p>
                      <div className="flex items-center gap-2">
                        {data.barLogoUrl && (
                          <LazyImage src={data.barLogoUrl} alt="Top logo"
                            wrapperClassName="h-10 border border-border rounded bg-white p-1 flex-shrink-0"
                            style={{ maxWidth: '100px' }}
                            className="object-contain" />
                        )}
                        <Button variant="outline" size="sm" className="text-xs flex-1"
                          onClick={() => barLogoInputRef.current?.click()}>
                          {data.barLogoUrl ? 'Change Logo' : 'Upload Logo'}
                        </Button>
                        {data.barLogoUrl && (
                          <Button variant="outline" size="sm" className="text-xs px-2 text-destructive"
                            onClick={() => update('barLogoUrl', '')}>
                            Remove
                          </Button>
                        )}
                        <input ref={barLogoInputRef} type="file" accept="image/png" className="hidden"
                          onChange={e => handleImageUpload(e, 'barLogoUrl')} />
                      </div>
                      <div className="mt-2">
                        <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Link2 className="w-3 h-3" /> Logo Link URL</Label>
                        <Input value={data.barLogoLinkUrl ?? ''} onChange={e => update('barLogoLinkUrl', e.target.value)}
                          placeholder="https://yourcompany.com" className="h-8 text-sm bg-white" />
                      </div>
                    </div>
                    <div className="border-t border-border/60 pt-3">
                      <Label className="text-xs font-medium mb-2 block">Bottom-Left Logo</Label>
                      <p className="text-[11px] text-muted-foreground mb-1.5">Secondary logo shown bottom-left (e.g. franchise mark, partner brand). Ideal: transparent PNG under 150KB</p>
                      <div className="flex items-center gap-2">
                        {data.poweredByLogoUrl && (
                          <LazyImage src={data.poweredByLogoUrl} alt="Bottom logo"
                            wrapperClassName="h-8 border border-border rounded bg-white p-1 flex-shrink-0"
                            style={{ maxWidth: '80px' }}
                            className="object-contain" />
                        )}
                        <Button variant="outline" size="sm" className="text-xs flex-1"
                          onClick={() => poweredByLogoInputRef.current?.click()}>
                          {data.poweredByLogoUrl ? 'Change Logo' : 'Upload Logo'}
                        </Button>
                        {data.poweredByLogoUrl && (
                          <Button variant="outline" size="sm" className="text-xs px-2 text-destructive"
                            onClick={() => update('poweredByLogoUrl', '')}>
                            Remove
                          </Button>
                        )}
                        <input ref={poweredByLogoInputRef} type="file" accept="image/*" className="hidden"
                          onChange={e => handleImageUpload(e, 'poweredByLogoUrl')} />
                      </div>
                      <div className="mt-2">
                        <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Link2 className="w-3 h-3" /> Bottom Logo Link URL</Label>
                        <Input value={data.poweredByLinkUrl ?? ''} onChange={e => update('poweredByLinkUrl', e.target.value)}
                          placeholder="https://yourcompany.com" className="h-8 text-sm bg-white" />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-xs text-muted-foreground">Card Width</Label>
                        <span className="text-xs font-mono text-muted-foreground">{data.imageCardWidth}px</span>
                      </div>
                      <Slider
                        min={400} max={700} step={10}
                        value={[data.imageCardWidth]}
                        onValueChange={([v]) => update('imageCardWidth', v)}
                        className="w-full"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>400px</span><span>700px</span>
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-xs text-muted-foreground">Card Corner Radius</Label>
                        <span className="text-xs font-mono text-muted-foreground">{data.cardRadius ?? 12}px</span>
                      </div>
                      <Slider
                        min={0} max={24} step={2}
                        value={[data.cardRadius ?? 12]}
                        onValueChange={([v]) => update('cardRadius', v)}
                        className="w-full"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                        <span>0 (square)</span><span>24px (round)</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Note: rounded corners are not supported in Windows Outlook desktop.</p>
                    </div>
                  </div>
                </FormSection>
              )}

              {/* Verdiict Integration */}
              <FormSection
                title="Verdiict"
                icon={<Star className="w-4 h-4" />}
                defaultOpen={false}
                headerActions={
                  <button
                    onClick={() => openCrossApp(PRODESK_ORIGINS.reviews, '/', { newWindow: true })}
                    title="Manage your Verdiict locations"
                    className="p-1 rounded hover:bg-secondary/80 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                }
              >
                <VerdiictSyncSection
                  verdiictUrl={data.verdiictUrl}
                  onSync={(reviewUrl, directoryUrl) => {
                    applyPartial({ verdiictUrl: reviewUrl, verdiictReviewsUrl: directoryUrl });
                  }}
                  onClear={() => {
                    applyPartial({ verdiictUrl: '', verdiictReviewsUrl: '' });
                  }}
                />
              </FormSection>

              {/* Call to Action & Disclaimer */}
              <FormSection title="Call to Action & Disclaimer" icon={<FileText className="w-4 h-4" />} defaultOpen={false}>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">CTA Button Text</Label>
                    <Input value={data.customCta} onChange={e => update('customCta', e.target.value)}
                      placeholder="Book a Meeting" className="h-8 text-sm bg-white" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">CTA URL</Label>
                    <Input value={data.customCtaUrl} onChange={e => update('customCtaUrl', e.target.value)}
                      placeholder="https://calendly.com/yourname" className="h-8 text-sm bg-white" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">Legal Disclaimer</Label>
                    <Textarea value={data.disclaimer} onChange={e => update('disclaimer', e.target.value)}
                      placeholder="This email and any attachments are confidential..."
                      className="text-sm bg-white resize-none" rows={3} />
                  </div>
                </div>
              </FormSection>

            </div>
          </div>
        </aside>

        {/* ── Right Panel: Preview & Export ── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-muted/30">

          {/* Preview Toolbar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-background/80 backdrop-blur-sm flex-shrink-0">
            <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'preview' | 'code')}>
              <TabsList className="h-8">
                <TabsTrigger value="preview" className="text-xs h-7" title="Preview">
                  <Eye className="w-3.5 h-3.5" />
                </TabsTrigger>
                <TabsTrigger value="code" className="text-xs h-7" title="HTML Code">
                  <Code2 className="w-3.5 h-3.5" />
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex items-center gap-2">
              <CopyButton
                getText={buildExportHtml}
                label="Copy HTML"
                className="h-8 text-xs"
                onCopy={() => toast.success('HTML copied! Paste it into your email client.')}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => handleCopyRich('gmail')}
                disabled={copyingClient !== null}
                title="Copy as rich text — paste directly into Gmail's signature box"
              >
                {copyingClient === 'gmail' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : copiedClient === 'gmail' ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Mail className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">{copiedClient === 'gmail' ? 'Copied!' : 'Copy for Gmail'}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => handleCopyRich('outlook')}
                disabled={copyingClient !== null}
                title="Copy as rich text — paste directly into Outlook's signature editor"
              >
                {copyingClient === 'outlook' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : copiedClient === 'outlook' ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Clipboard className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">{copiedClient === 'outlook' ? 'Copied!' : 'Copy for Outlook'}</span>
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleDownload}>
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Download</span>
              </Button>
            </div>
          </div>

          {/* Preview / Code Area */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            {activeTab === 'preview' ? (
              <div className="max-w-2xl mx-auto space-y-6">
                {/* Preview Card */}
                <div>
                  <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5" />
                    Live preview — updates as you type
                  </p>
                  <div
                    className="rounded-xl overflow-hidden shadow-lg border border-border/50"
                    style={{
                      backgroundImage: `url(${PREVIEW_BG})`,
                      backgroundSize: 'cover',
                    }}
                  >
                    {/* Simulated email chrome */}
                    <div className="bg-white/95 border-b border-border/30 px-4 py-2.5">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">From:</span>
                        <span>{data.fullName || 'Your Name'} &lt;{data.email || 'you@company.com'}&gt;</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground">Subject:</span>
                        <span>Re: Project Update — Q2 Review</span>
                      </div>
                    </div>
                    <div className="bg-white/95 py-3">
                      <p className="text-sm text-gray-600 mb-4 leading-relaxed px-4">
                        Hi Sarah,<br /><br />
                        Thanks for the update. I've reviewed the proposal and I think we're aligned on the key points. Let's connect this week to finalize the details.<br /><br />
                        Best regards,
                      </p>
                       <div className="border-t border-gray-100 pt-3 px-4">
                        <SignaturePreview data={data} brandId={workingBrandId!} preloadedIconUrlMap={iconUrlMap} />
                        {/* Campaign Banner Preview */}
                        {activeCampaignBanner?.banner && (
                          <div className="mt-3">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                              <span className="text-[10px] font-medium text-green-700 uppercase tracking-wide">
                                Campaign: {activeCampaignBanner.campaign.name}
                              </span>
                            </div>
                            {activeCampaignBanner.campaign.linkUrl ? (
                              <a
                                href={activeCampaignBanner.campaign.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'block' }}
                              >
                                <LazyImage
                                  src={activeCampaignBanner.banner.imageUrl}
                                  alt={activeCampaignBanner.campaign.name}
                                  style={{ maxWidth: '100%', height: 'auto', display: 'block', border: 0 }}
                                  className="w-full h-auto"
                                />
                              </a>
                            ) : (
                              <LazyImage
                                src={activeCampaignBanner.banner.imageUrl}
                                alt={activeCampaignBanner.campaign.name}
                                style={{ maxWidth: '100%', height: 'auto', display: 'block', border: 0 }}
                                className="w-full h-auto"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Installation Guide */}
                <div className="bg-card rounded-xl border border-border p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Briefcase className="w-4 h-4 text-primary" />
                    How to Install Your Signature
                  </h3>
                  <div className="space-y-3">
                    {[
                      { client: 'Gmail', steps: 'Click "Copy for Gmail" above, then in Gmail: ⚙️ → See all settings → General → Signature → Create new → paste (Ctrl+V / Cmd+V)' },
                      { client: 'Outlook', steps: 'Click "Copy for Outlook" above, then in Outlook: File → Options → Mail → Signatures → New → paste into the editor' },
                      { client: 'Apple Mail', steps: 'Click "Copy for Gmail" above (rich copy works here too), then Mail → Settings → Signatures → "+" → uncheck "Always match my default message font" → paste' },
                    ].map(({ client, steps }) => (
                      <div key={client} className="flex gap-3">
                        <span className="text-xs font-semibold text-primary w-20 flex-shrink-0 pt-0.5">{client}</span>
                        <span className="text-xs text-muted-foreground leading-relaxed">{steps}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-4">
                <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
                    <span className="text-xs font-medium text-muted-foreground font-mono">email-signature.html</span>
                    <CopyButton getText={buildExportHtml} label="Copy" variant="outline" className="h-7 text-xs"
                      onCopy={() => toast.success('HTML copied!')} />
                  </div>
                  <pre className="p-4 text-xs font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap leading-relaxed bg-muted/10 custom-scrollbar">
                    {previewSignatureHtml}
                  </pre>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  This HTML uses inline styles for maximum email client compatibility.
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
