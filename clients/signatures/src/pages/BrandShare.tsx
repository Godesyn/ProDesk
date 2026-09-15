/**
 * BrandSharePage — Public page showing all signatures for a brand.
 * URLs: /team/:slug (current, resolves by brand-kit name) and the legacy
 * /share/:brandId (resolves by brand-kit id). No auth required — both hit
 * publicProcedures on the backend (signatures.share.getBrandBySlug / getBrand).
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useParams } from 'wouter';
import { toast } from 'sonner';
import {
  Check,
  Copy,
  Download,
  ChevronDown,
  ChevronUp,
  Mail,
  Clipboard,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SignaturePreview,
  type SignaturePreviewHandle,
} from '@/components/SignaturePreview';
import { type IconUrlMap } from '@/lib/signatureGenerator';
import { buildSignatureData, renderExportHtml } from '@/lib/signatureExport';
import { trpc } from '@/lib/trpc';

// ─── Types ────────────────────────────────────────────────────────────────────
type Brand = {
  id: string;
  brandId: string;
  name: string;
  website?: string | null;
  address?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  fontFamily?: string | null;
  barColor?: string | null;
  barTextColor?: string | null;
  brandDisplayName?: string | null;
  brandTagline?: string | null;
  logoUrl?: string | null;
  logoKey?: string | null;
  logoWidth?: number | null;
  poweredByLogoUrl?: string | null;
  poweredByLogoKey?: string | null;
  poweredByLabel?: string | null;
  verdiictUrl?: string | null;
  verdiictReviewsUrl?: string | null;
  disclaimer?: string | null;
  defaultTemplate?: string | null;
  barLogoUrl?: string | null;
  barLogoKey?: string | null;
  imageCardWidth?: number | null;
  logoLinkUrl?: string | null;
  barLogoLinkUrl?: string | null;
  poweredByLinkUrl?: string | null;
};

type Member = {
  id: string;
  signatureBrandId: string;
  brandId: string;
  fullName: string;
  jobTitle?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  photoUrl?: string | null;
  photoKey?: string | null;
  photoLinkUrl?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  github?: string | null;
  verdiictUrl?: string | null;
  verdiictReviewsUrl?: string | null;
  renderedIconUrls?: string | null; // JSON: pre-rendered icon PNG URLs from server
};

// ─── Platform Instructions ────────────────────────────────────────────────────
const GMAIL_STEPS = [
  'Click the “Copy for Gmail” button above — your signature is now on your clipboard.',
  'Open Gmail and click the gear icon (⚙️) → “See all settings”.',
  'Go to the “General” tab and scroll down to “Signature”.',
  'Click “Create new”, give your signature a name, then click inside the text editor.',
  'Paste with Ctrl+V (Windows) or Cmd+V (Mac) — your signature will appear with icons and photo.',
  'Select the created signature in the dropdown “FOR NEW EMAILS USE” in “Signature defaults” section',
  'Scroll to the bottom and click “Save Changes”.',
];

const PLATFORMS = [
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '✉',
    steps: GMAIL_STEPS,
  },
  {
    id: 'outlook',
    name: 'Outlook',
    icon: '📧',
    steps: [
      'Open Outlook and go to File → Options → Mail',
      'Click "Signatures…" then "New" to create a signature',
      'In the editor, click the HTML source button (</>)',
      'Paste the HTML code below and click OK',
      'Set as default for new messages and/or replies',
    ],
  },
  {
    id: 'apple',
    name: 'Apple Mail',
    icon: '🍎',
    steps: [
      'Open Mail → Preferences → Signatures',
      'Select your account and click "+" to add a new signature',
      'Uncheck "Always match my default message font"',
      'Open TextEdit, paste the HTML, save as .html, then drag into the signature editor',
      'Or use a third-party tool like "Mail Signatures" from the App Store',
    ],
  },
  {
    id: 'superhuman',
    name: 'Superhuman',
    icon: '⚡',
    steps: [
      'Open Superhuman and press Cmd+K → "Signature"',
      'Click "Edit in HTML" in the signature editor',
      'Paste the HTML code below',
      'Click "Save" — your signature is live immediately',
    ],
  },
];

// ─── Copy Button ──────────────────────────────────────────────────────────────
function CopyBtn({
  getText,
  label = 'Copy HTML',
}: {
  getText: () => Promise<string>;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const copy = async () => {
    setLoading(true);
    try {
      const text = await getText();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success('Signature HTML copied!', {
        description: 'Paste it into your email client signature settings.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed', {
        description: 'Please select and copy the HTML manually.',
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button
      size="sm"
      onClick={copy}
      disabled={loading}
      className="gap-1.5 h-8 text-xs bg-[#0E0E0C] text-white hover:bg-[#1a1a18]"
    >
      {loading ? (
        <span className="w-3.5 h-3.5 inline-block border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : copied ? (
        <Check className="w-3.5 h-3.5" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {loading ? 'Preparing…' : copied ? 'Copied!' : label}
    </Button>
  );
}

// ─── // ─── Copy for Gmail Button ───────────────────────────────────────
/**
 * A prominent Gmail-specific copy button.
 * Copies the RENDERED visual content from the signature preview iframe
 * (rich HTML copy — same as manually selecting and copying the preview).
 * After copying, shows a step-by-step panel guiding the user to paste into Gmail.
 */
function CopyForGmailBtn({ getText }: { getText: () => Promise<string> }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [showSteps, setShowSteps] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close steps panel when clicking outside
  useEffect(() => {
    if (!showSteps) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowSteps(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSteps]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState('loading');
    try {
      const htmlContent = await getText();
      let success = false;
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blob }),
          ]);
          success = true;
        } catch {}
      }

      if (!success) {
        const div = document.createElement('div');
        div.innerHTML = htmlContent;
        div.style.position = 'absolute';
        div.style.left = '-9999px';
        document.body.appendChild(div);
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(div);
          selection.removeAllRanges();
          selection.addRange(range);
          success = document.execCommand('copy');
          selection.removeAllRanges();
        }
        document.body.removeChild(div);
      }

      if (!success) {
        toast.error('Copy failed', {
          description:
            'Please manually select the signature preview and copy it.',
        });
        setState('idle');
        return;
      }
      setState('copied');
      setShowSteps(true);
      setTimeout(() => setState('idle'), 5000);
    } catch {
      toast.error('Copy failed', {
        description:
          'Please manually select the signature preview and copy it.',
      });
      setState('idle');
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        size="sm"
        onClick={handleCopy}
        disabled={state === 'loading'}
        className="gap-1.5 h-8 text-xs font-semibold"
        style={{
          background: state === 'copied' ? '#16a34a' : '#EA4335',
          color: '#fff',
          border: 'none',
        }}
      >
        {state === 'loading' ? (
          <span className="w-3.5 h-3.5 inline-block border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : state === 'copied' ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Mail className="w-3.5 h-3.5" />
        )}
        {state === 'loading'
          ? 'Preparing…'
          : state === 'copied'
            ? 'Copied!'
            : 'Copy for Gmail'}
      </Button>

      {/* Step-by-step panel shown after copy */}
      {showSteps && (
        <div
          className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-[#E8E5DC] bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[#E8E5DC] rounded-t-xl"
            style={{ background: '#EA4335' }}
          >
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white">
                Paste into Gmail
              </span>
            </div>
            <button
              onClick={() => setShowSteps(false)}
              className="text-white/70 hover:text-white text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          {/* Steps */}
          <div className="p-4 space-y-3">
            {GMAIL_STEPS.map((step, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center mt-0.5"
                  style={{
                    background: i === 0 ? '#16a34a' : '#F4F1E8',
                    color: i === 0 ? '#fff' : '#0E0E0C',
                  }}
                >
                  {i === 0 ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="text-xs text-[#444] leading-relaxed">
                  {step}
                </span>
              </div>
            ))}
          </div>
          {/* Footer CTA */}
          <div className="px-4 pb-4">
            <a
              href="https://mail.google.com/mail/u/0/#settings/general"
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center text-xs font-semibold py-2 rounded-lg text-white transition-colors"
              style={{ background: '#EA4335' }}
            >
              Open Gmail Settings →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Copy for Outlook Button ─────────────────────────────────────────────────
const OUTLOOK_STEPS = [
  '✅ Copied! Your signature is on your clipboard.',
  'Open Outlook → File → Options → Mail → Signatures → New',
  'Give your signature a name, then paste (Ctrl+V / Cmd+V)',
  'Click OK to save',
];

function CopyForOutlookBtn({ getText }: { getText: () => Promise<string> }) {
  const [state, setState] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [showSteps, setShowSteps] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSteps) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setShowSteps(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSteps]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState('loading');
    try {
      const finalHtml = await getText();
      const container = document.createElement('div');
      container.style.cssText =
        'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
      container.innerHTML = finalHtml;
      document.body.appendChild(container);
      const range = document.createRange();
      range.selectNodeContents(container);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      let success = false;
      try {
        const htmlBlob = new Blob([finalHtml], { type: 'text/html' });
        const textBlob = new Blob([container.innerText || ''], {
          type: 'text/plain',
        });
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
        ]);
        success = true;
      } catch {
        success = document.execCommand('copy');
      }
      selection?.removeAllRanges();
      document.body.removeChild(container);
      if (success) {
        setState('copied');
        setShowSteps(true);
        setTimeout(() => setState('idle'), 5000);
      } else {
        toast.error('Copy failed', {
          description:
            'Try the Download button, open in browser, select all and copy.',
        });
        setState('idle');
      }
    } catch {
      toast.error('Copy failed', {
        description:
          'Try the Download button, open in browser, select all and copy.',
      });
      setState('idle');
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        size="sm"
        onClick={handleCopy}
        disabled={state === 'loading'}
        className="gap-1.5 h-8 text-xs font-semibold"
        style={{
          background: state === 'copied' ? '#16a34a' : '#0E0E0C',
          color: '#fff',
          border: 'none',
        }}
      >
        {state === 'loading' ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : state === 'copied' ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Clipboard className="w-3.5 h-3.5" />
        )}
        {state === 'loading'
          ? 'Preparing…'
          : state === 'copied'
            ? 'Copied!'
            : 'Copy for Outlook'}
      </Button>
      {showSteps && (
        <div
          className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-[#E8E5DC] bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
          ref={panelRef}
        >
          <div
            className="flex items-center justify-between px-4 py-3 border-b border-[#E8E5DC] rounded-t-xl"
            style={{ background: '#0E0E0C' }}
          >
            <div className="flex items-center gap-2">
              <Clipboard className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white">
                Paste into Outlook
              </span>
            </div>
            <button
              onClick={() => setShowSteps(false)}
              className="text-white/70 hover:text-white text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="p-4 space-y-3">
            {OUTLOOK_STEPS.map((step, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className="flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center mt-0.5"
                  style={{
                    background: i === 0 ? '#16a34a' : '#F4F1E8',
                    color: i === 0 ? '#fff' : '#0E0E0C',
                  }}
                >
                  {i === 0 ? <Check className="w-3 h-3" /> : i + 1}
                </span>
                <span className="text-xs text-[#444] leading-relaxed">
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Member Signature Row ────────────────────────────────────────────
function MemberRow({
  brand,
  member,
  defaultOpen = false,
}: {
  brand: Brand;
  member: Member;
  defaultOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const [platform, setPlatform] = useState('gmail');
  const [showCode, setShowCode] = useState(false);
  // The HTML-code panel shows the export HTML, which is built async (it fetches
  // hosted PNG icons). null = not built yet; we build it lazily on first expand.
  const [codeHtml, setCodeHtml] = useState<string | null>(null);

  const sigData = useMemo(
    () => buildSignatureData(brand, member),
    [brand, member],
  );
  // Ref to the preview iframe — used by CopyForGmailBtn to copy rendered content
  const previewRef = useRef<SignaturePreviewHandle>(null);
  // Parse pre-rendered icon URLs from DB for use in preview and export
  const preloadedIconUrlMap = useMemo<IconUrlMap | undefined>(() => {
    if (!member.renderedIconUrls) return undefined;
    try {
      return JSON.parse(member.renderedIconUrls) as IconUrlMap;
    } catch {
      return undefined;
    }
  }, [member.renderedIconUrls]);

  const selectedPlatform =
    PLATFORMS.find((p) => p.id === platform) ?? PLATFORMS[0];
  const utils = trpc.useUtils();

  /** Build export HTML using ONLY hosted PNG icon URLs (Gmail-safe, no SVG data URIs) */
  const buildExportHtml = (): Promise<string> =>
    renderExportHtml({
      utils,
      data: sigData,
      brandId: brand.brandId,
      signatureBrandId: brand.id,
      memberId: member.id,
      fallbackIconMap: preloadedIconUrlMap,
    });

  // Build the export HTML for the code panel the first time it is expanded.
  useEffect(() => {
    if (!showCode || codeHtml !== null) return;
    let cancelled = false;
    buildExportHtml().then((html) => {
      if (!cancelled) setCodeHtml(html);
    });
    return () => {
      cancelled = true;
    };
    // buildExportHtml is a stable closure over this row's static data; we only
    // want to (re)build when the panel is first opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCode]);

  const handleDownload = async () => {
    const finalHtml = await buildExportHtml();
    const blob = new Blob([finalHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${member.fullName.replace(/\s+/g, '-').toLowerCase()}-signature.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Initials for avatar fallback
  const initials = member.fullName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="bg-white rounded-2xl border border-[#E8E5DC] shadow-sm overflow-hidden">
      {/* Member header — clicking anywhere on the header toggles expand */}
      <div
        className="flex items-center gap-4 px-6 py-4 bg-[#FAFAF7] cursor-pointer hover:bg-[#F4F1E8] transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        {member.photoUrl ? (
          <img
            src={member.photoUrl}
            alt={member.fullName}
            className="w-11 h-11 rounded-full object-cover flex-shrink-0 border-2 border-[#E8E5DC]"
          />
        ) : (
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{
              backgroundColor: brand.primaryColor ?? '#0E0E0C',
              color: '#fff',
            }}
          >
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[#0E0E0C]">{member.fullName}</h3>
          <p className="text-sm text-[#666] truncate">{member.jobTitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {expanded && (
            <>
              <CopyForGmailBtn getText={buildExportHtml} />
              <CopyForOutlookBtn getText={buildExportHtml} />
              <CopyBtn getText={buildExportHtml} label="Copy HTML" />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 h-8 text-xs hidden sm:flex"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload();
                }}
              >
                <Download className="w-3.5 h-3.5" /> Download
              </Button>
            </>
          )}
          <button
            className="w-7 h-7 rounded-full flex items-center justify-center text-[#666] hover:bg-[#E8E5DC] transition-colors flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => !x);
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Stacked layout: preview on top, install instructions below */}
      {expanded && (
        <div className="divide-y divide-[#E8E5DC]">
          {/* Signature Preview — scale to fit container width */}
          <div className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#999] mb-3">
              Preview
            </p>
            <div className="bg-[#FAFAF7] rounded-xl border border-[#E8E5DC] p-4">
              <SignaturePreview
                data={sigData}
                brandId={brand.brandId}
                preloadedIconUrlMap={preloadedIconUrlMap}
                imperativeRef={previewRef}
              />
            </div>
          </div>

          {/* Install instructions + code */}
          <div className="p-6 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#999] mb-3">
                Install in
              </p>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPlatform(p.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      platform === p.id
                        ? 'bg-[#0E0E0C] text-white border-[#0E0E0C]'
                        : 'bg-white text-[#0E0E0C] border-[#E8E5DC] hover:border-[#0E0E0C]'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {selectedPlatform.steps.map((step, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#F4F1E8] text-[#0E0E0C] text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-[#444] leading-relaxed">{step}</span>
                </div>
              ))}
            </div>

            {/* Collapsible HTML code */}
            <div className="border border-[#E8E5DC] rounded-xl overflow-hidden">
              <button
                onClick={() => setShowCode(!showCode)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-[#FAFAF7] text-xs font-semibold text-[#0E0E0C] hover:bg-[#F4F1E8] transition-colors"
              >
                <span>HTML Code</span>
                {showCode ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {showCode && (
                <div className="relative">
                  <pre className="text-[11px] font-mono text-primary/90 bg-[#0E0E0C] p-4 overflow-x-auto max-h-64 whitespace-pre-wrap break-all leading-relaxed">
                    {/* PNG-safe export HTML, built lazily via buildExportHtml */}
                    {codeHtml ?? 'Loading HTML…'}
                  </pre>
                  <div className="absolute top-2 right-2">
                    <CopyBtn getText={buildExportHtml} label="Copy" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BrandSharePage() {
  // One component, two routes: /team/:slug (pretty, name-based) and the legacy
  // /share/:brandId (id-based). Exactly one param is present per matched route;
  // resolve via the matching public endpoint (the other query stays disabled).
  const params = useParams<{
    slug?: string;
    department?: string;
    brandId?: string;
  }>();
  const slug = params.slug ?? '';
  const department = params.department ?? '';
  const signatureBrandId = params.brandId ?? '';

  // Three routes, one component. Exactly one query is enabled per match:
  //   /team/:slug/:department  a specific department
  //   /team/:slug              the brand's current default department
  //   /share/:brandId          the original id link
  const byDepartment = trpc.signatures.share.getDepartmentBySlug.useQuery(
    { brandSlug: slug, departmentSlug: department },
    { enabled: !!slug && !!department, retry: false },
  );
  const bySlug = trpc.signatures.share.getBrandBySlug.useQuery(
    { slug },
    { enabled: !!slug && !department, retry: false },
  );
  const byId = trpc.signatures.share.getBrand.useQuery(
    { signatureBrandId },
    { enabled: !!signatureBrandId, retry: false },
  );
  const { data, isLoading, error } = department
    ? byDepartment
    : slug
      ? bySlug
      : byId;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-[#0E0E0C] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#666]">Loading signatures…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm px-6">
          <div className="w-12 h-12 rounded-2xl bg-[#0E0E0C] flex items-center justify-center mx-auto">
            <span className="text-primary font-black text-xl">N</span>
          </div>
          <h1 className="text-xl font-bold text-[#0E0E0C]">Brand not found</h1>
          <p className="text-sm text-[#666]">
            This share link may have expired or the brand doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  const { brand, members } = data;

  // Derive readable text colour for the brand accent — light accent gets dark text
  const accentBg = brand.primaryColor ?? brand.barColor ?? '#0E0E0C';
  const hexLum = (hex: string) => {
    try {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    } catch {
      return 0;
    }
  };
  const accentText = hexLum(accentBg) > 0.45 ? '#0E0E0C' : '#ffffff';

  return (
    <div className="min-h-screen bg-[#F4F1E8]">
      {/* Brand accent strip — 4px bar in the brand's primary colour */}
      <div
        style={{ backgroundColor: accentBg, height: '4px', width: '100%' }}
      />

      {/* Header — white, clean, brand-forward */}
      <header className="bg-white border-b border-[#E8E5DC]">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={brand.name}
                className="h-12 object-contain flex-shrink-0"
                style={{ maxWidth: 140 }}
              />
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg flex-shrink-0"
                style={{ backgroundColor: accentBg, color: accentText }}
              >
                {brand.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="font-bold text-xl leading-tight text-[#0E0E0C]">
                {brand.name}
              </h1>
              <p className="text-xs text-[#888] mt-0.5">
                {/* Secondary departments name themselves here; the brand's default
                    department stays the plain "Email Signatures" page it always was. */}
                {!brand.isDefault && brand.departmentName
                  ? brand.departmentName
                  : 'Email Signatures'}
                &nbsp;&middot;&nbsp; {members.length} team member
                {members.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: accentBg }}
            />
            <span className="text-xs text-[#999]">
              Powered by{' '}
              <span className="font-semibold text-[#0E0E0C]">SIGKITT</span>
            </span>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-[#0E0E0C] mb-1">
            Team Signatures
          </h2>
          <p className="text-sm text-[#666]">
            Select your name, choose your email client, and follow the install
            steps.
          </p>
        </div>

        {members.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E8E5DC] p-12 text-center">
            <p className="text-[#666]">
              No team members have been added to this brand yet.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {(members as Member[]).map((member, idx) => (
              <MemberRow
                key={member.id}
                brand={brand as Brand}
                member={member}
                defaultOpen={idx === 0}
              />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E8E5DC] mt-16 py-6">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-xs text-[#999]">
          <span>
            © {new Date().getFullYear()} {brand.name}
          </span>
          <span>
            Signatures by{' '}
            <span className="font-semibold text-[#0E0E0C]">SIGKITT</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
