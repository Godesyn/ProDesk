/**
 * Brand Kit — Account-level brand system
 * Logo, primary/accent colours (with WCAG contrast guardrails),
 * Google Fonts selection, live phone preview.
 * Changes propagate to all proposals automatically.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ColorPicker as SharedColorPicker } from "@shared/components/ui/color-picker";
import { toast } from "sonner";
import { LazyImage } from "@shared/components/ui/lazy-image";

// ─── Google Fonts catalogue ───────────────────────────────────────────────────
const GOOGLE_FONTS: { name: string; category: "sans" | "serif" | "display" | "mono" }[] = [
  // Sans-serif
  { name: "Inter", category: "sans" },
  { name: "Inter Tight", category: "sans" },
  { name: "DM Sans", category: "sans" },
  { name: "Outfit", category: "sans" },
  { name: "Sora", category: "sans" },
  { name: "Plus Jakarta Sans", category: "sans" },
  { name: "Manrope", category: "sans" },
  { name: "Nunito Sans", category: "sans" },
  { name: "Work Sans", category: "sans" },
  { name: "Rubik", category: "sans" },
  { name: "Poppins", category: "sans" },
  { name: "Jost", category: "sans" },
  { name: "Raleway", category: "sans" },
  { name: "Montserrat", category: "sans" },
  { name: "Lato", category: "sans" },
  { name: "Source Sans 3", category: "sans" },
  // Serif
  { name: "Cormorant Garamond", category: "serif" },
  { name: "Playfair Display", category: "serif" },
  { name: "Lora", category: "serif" },
  { name: "Merriweather", category: "serif" },
  { name: "EB Garamond", category: "serif" },
  { name: "Libre Baskerville", category: "serif" },
  { name: "Crimson Pro", category: "serif" },
  { name: "Spectral", category: "serif" },
  // Display / expressive
  { name: "Bebas Neue", category: "display" },
  { name: "Oswald", category: "display" },
  { name: "Anton", category: "display" },
  { name: "Barlow Condensed", category: "display" },
  { name: "Space Grotesk", category: "display" },
  { name: "Clash Display", category: "display" },
  // Mono
  { name: "IBM Plex Mono", category: "mono" },
  { name: "JetBrains Mono", category: "mono" },
  { name: "Space Mono", category: "mono" },
  { name: "Fira Code", category: "mono" },
];

// ─── Colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function bestTextOnBg(bgHex: string): "#ffffff" | "#000000" {
  const onWhite = contrastRatio(bgHex, "#ffffff");
  const onBlack = contrastRatio(bgHex, "#000000");
  return onWhite >= onBlack ? "#ffffff" : "#000000";
}

function contrastLabel(ratio: number): { label: string; ok: boolean; color: string } {
  if (ratio >= 7) return { label: `${ratio.toFixed(1)}:1 · AAA`, ok: true, color: "#22c55e" };
  if (ratio >= 4.5) return { label: `${ratio.toFixed(1)}:1 · AA`, ok: true, color: "#84cc16" };
  if (ratio >= 3) return { label: `${ratio.toFixed(1)}:1 · AA Large`, ok: true, color: "#eab308" };
  return { label: `${ratio.toFixed(1)}:1 · Fail`, ok: false, color: "#ef4444" };
}

// ─── Curated preset swatches ─────────────────────────────────────────────────
const DARK_PRESETS = [
  "#0A0A0A", "#1A1A2E", "#0F3460", "#0F766E", "#065F46", "#1E3A5F",
  "#2D1B69", "#4A0E0E", "#1F2937", "#374151",
];
const LIGHT_PRESETS = [
  "#F4F1E8", "#FAFAF9", "#F8F8F4", "#F5F0E8", "#EFF6FF", "#F0FDF4",
  "#FFF7ED", "#FAFAFA", "#F9F5FF", "#F0F9FF",
];
const ACCENT_PRESETS = [
  "#D9F542", "#65F5C9", "#7AD7FF", "#FFB347", "#FF6B9D", "#A78BFA",
  "#34D399", "#FCD34D", "#F97316", "#60A5FA",
];

// ─── Load a Google Font into the document ────────────────────────────────────
function loadGoogleFont(fontName: string) {
  const id = `gfont-preview-${fontName.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,700&display=swap`;
  document.head.appendChild(link);
}

// ─── Colour Picker component ─────────────────────────────────────────────────
function ColourPicker({
  label, value, onChange, contrastAgainst, presets,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  contrastAgainst?: string;
  presets: string[];
}) {
  const contrast = contrastAgainst ? contrastRatio(value, contrastAgainst) : null;
  const info = contrast ? contrastLabel(contrast) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--ink-60)" }}>{label}</div>
      <div className="flex items-center gap-3">
        <SharedColorPicker value={value} onChange={onChange} presets={presets} ariaLabel={label} />
      </div>

      {/* Contrast badge */}
      {info && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: `${info.color}15`, border: `1px solid ${info.color}30` }}>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: info.color }} />
          <span className="text-[11px] font-semibold" style={{ color: info.color }}>{info.label}</span>
          {!info.ok && <span className="text-[11px]" style={{ color: "var(--ink-60)" }}>— try a darker or lighter shade</span>}
        </div>
      )}

      {/* Preset swatches */}
      <div className="flex flex-wrap gap-2 mt-1">
        {presets.map(c => (
          <button
            key={c}
            onClick={() => onChange(c)}
            className="w-7 h-7 rounded-lg transition-all hover:scale-110 active:scale-95"
            style={{
              background: c,
              border: c.toLowerCase() === value.toLowerCase() ? "2px solid var(--ink)" : "1px solid var(--border-2)",
              boxShadow: c.toLowerCase() === value.toLowerCase() ? "0 0 0 2px var(--paper), 0 0 0 4px var(--ink)" : "none",
            }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Font Picker component ────────────────────────────────────────────────────
function FontPicker({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "sans" | "serif" | "display" | "mono">("all");

  const filtered = GOOGLE_FONTS.filter(f =>
    (filter === "all" || f.category === filter) &&
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  // Load fonts for visible items
  useEffect(() => {
    filtered.forEach(f => loadGoogleFont(f.name));
  }, [filtered]);

  useEffect(() => {
    loadGoogleFont(value);
  }, [value]);

  return (
    <div className="relative">
      <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--ink-60)" }}>{label}</div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[14px] transition-all hover:opacity-80"
        style={{
          background: "var(--bg-inset)",
          border: `1px solid ${open ? "var(--ink)" : "var(--border-2)"}`,
          color: "var(--ink)",
          fontFamily: `'${value}', sans-serif`,
        }}
      >
        <span>{value}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms" }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 rounded-xl overflow-hidden"
          style={{ background: "var(--paper)", border: "1px solid var(--border-1)", boxShadow: "0 8px 32px rgba(0,0,0,0.16)" }}
        >
          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: "var(--border-2)" }}>
            <input
              type="text"
              placeholder="Search fonts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full text-[12px] px-3 py-2 rounded-lg"
              style={{ background: "var(--bg-inset)", border: "1px solid var(--border-2)", color: "var(--ink)", fontFamily: "inherit" }}
            />
          </div>
          {/* Category filter */}
          <div className="flex gap-1 p-2 border-b" style={{ borderColor: "var(--border-2)" }}>
            {(["all", "sans", "serif", "display", "mono"] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all"
                style={{
                  background: filter === cat ? "var(--ink)" : "transparent",
                  color: filter === cat ? "var(--paper)" : "var(--ink-60)",
                }}
              >
                {cat}
              </button>
            ))}
          </div>
          {/* Font list */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.map(f => (
              <button
                key={f.name}
                onClick={() => { onChange(f.name); setOpen(false); setSearch(""); }}
                className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-black/5"
                style={{ borderBottom: "1px solid var(--border-2)" }}
              >
                <span
                  className="text-[15px]"
                  style={{
                    fontFamily: `'${f.name}', sans-serif`,
                    color: "var(--ink)",
                    fontWeight: f.name === value ? 700 : 400,
                  }}
                >
                  {f.name}
                </span>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-40)" }}>{f.category}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-[12px]" style={{ color: "var(--ink-40)" }}>No fonts found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Phone Preview ────────────────────────────────────────────────────────────
function PhonePreview({
  primary, accent, headingFont, bodyFont, logoUrl, businessName,
}: {
  primary: string; accent: string;
  headingFont: string; bodyFont: string;
  logoUrl?: string; businessName?: string;
}) {
  const textOnPrimary = bestTextOnBg(primary);
  const textOnAccent = bestTextOnBg(accent);
  const isDark = bestTextOnBg(primary) === "#ffffff";

  const bodyText = isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
  const borderCol = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: 240,
        height: 480,
        background: primary,
        color: textOnPrimary,
        borderRadius: 32,
        padding: "20px 18px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.12)",
        fontFamily: `'${bodyFont}', sans-serif`,
        transition: "background 300ms ease, color 300ms ease",
      }}
    >
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: -60, right: -60, width: 200, height: 200,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accent}35, transparent 65%)`,
        }}
      />

      {/* Status bar dots */}
      <div className="flex justify-between items-center mb-4 relative">
        <div className="flex items-center gap-1.5">
          {logoUrl ? (
            <LazyImage src={logoUrl} alt="Logo" wrapperClassName="h-5 w-auto flex-shrink-0" className="object-contain" />
          ) : (
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-black"
              style={{ background: accent, color: textOnAccent }}
            >
              {(businessName ?? "PD").slice(0, 2).toUpperCase()}
            </div>
          )}
          <span
            className="text-[10px] font-semibold tracking-tight"
            style={{ fontFamily: `'${headingFont}', sans-serif`, color: textOnPrimary }}
          >
            {businessName ?? "EziQuotes"}
            <span style={{ color: accent }}> · payments</span>
          </span>
        </div>
        <div className="flex gap-0.5">
          {[3, 5, 7].map(h => (
            <div key={h} className="w-0.5 rounded-full" style={{ height: h, background: bodyText }} />
          ))}
        </div>
      </div>

      {/* Eyebrow */}
      <div
        className="text-[8px] tracking-[0.16em] uppercase mb-3 relative"
        style={{ color: bodyText, fontFamily: `'${bodyFont}', sans-serif` }}
      >
        PROPOSAL · A-0418
      </div>

      {/* Headline */}
      <h2
        className="relative leading-[0.9] mb-4"
        style={{
          fontFamily: `'${headingFont}', sans-serif`,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          color: textOnPrimary,
        }}
      >
        <span style={{ fontWeight: 300, opacity: 0.5 }}>your</span>
        <br />
        engagement
        <br />
        <span style={{ color: accent }}>with you.</span>
      </h2>

      {/* Meta row */}
      <div
        className="grid grid-cols-2 gap-2 py-3 mb-3 relative"
        style={{ borderTop: `1px solid ${borderCol}`, borderBottom: `1px solid ${borderCol}` }}
      >
        {[["Prepared by", businessName ?? "EziQuotes"], ["Valid until", "30 days"]].map(([k, v]) => (
          <div key={k}>
            <div className="text-[7px] tracking-[0.12em] uppercase mb-0.5" style={{ color: bodyText }}>{k}</div>
            <div className="text-[9px] font-semibold" style={{ color: textOnPrimary }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Pricing preview */}
      <div className="space-y-1.5 mb-4 relative">
        {[["Brand Strategy", "$4,200"], ["Website Design", "$3,800"]].map(([name, price]) => (
          <div key={name} className="flex justify-between items-center py-1.5 px-2 rounded-lg" style={{ background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}>
            <span className="text-[9px]" style={{ color: bodyText }}>{name}</span>
            <span className="text-[9px] font-semibold" style={{ color: textOnPrimary }}>{price}</span>
          </div>
        ))}
        <div className="flex justify-between items-center px-2 pt-1">
          <span className="text-[9px] font-semibold" style={{ color: textOnPrimary }}>Total</span>
          <span className="text-[11px] font-bold" style={{ color: accent }}>$8,000</span>
        </div>
      </div>

      {/* CTA button */}
      <button
        className="absolute bottom-5 left-4 right-4 py-3 rounded-2xl text-[11px] font-bold tracking-tight"
        style={{
          background: accent,
          color: textOnAccent,
          fontFamily: `'${headingFont}', sans-serif`,
          border: "none",
        }}
      >
        Accept &amp; pay $8,000
      </button>
    </div>
  );
}

// ─── Logo Upload ──────────────────────────────────────────────────────────────
function LogoUpload({
  label, currentUrl, onUpload, variant,
}: {
  label: string; currentUrl?: string | null;
  onUpload: (url: string) => void; variant: "light" | "dark";
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const trpc = useTRPC();
  const brandId = useBrandId();
  const getUploadUrl = useMutation(trpc.payments.accounts.getAssetUploadUrl.mutationOptions());
  const recordAsset = useMutation(trpc.payments.accounts.recordAssetUpload.mutationOptions());

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    if (file.size > 4 * 1024 * 1024) { toast.error("Logo must be under 4 MB"); return; }
    if (!brandId) { toast.error("No active brand"); return; }
    const assetType = variant === "light" ? "logo_light" : "logo_dark";
    setUploading(true);
    try {
      // Signed Supabase Storage upload (replaces the export's /api/assets/upload route)
      const target = await getUploadUrl.mutateAsync({
        brandId,
        filename: file.name,
        contentType: file.type,
        assetType,
      });
      const res = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      onUpload(target.publicUrl);
      // Mirror into the brand's Document Locker. The bytes went browser→storage,
      // so the server only learns the upload landed from this confirm call.
      // Never surfaced as an error — the logo itself is already saved.
      recordAsset.mutate({
        brandId, key: target.key, publicUrl: target.publicUrl,
        filename: file.name, assetType, size: file.size,
      });
    } catch { toast.error("Upload failed"); }
    finally { setUploading(false); }
  };

  const bg = variant === "light" ? "#F5F5F0" : "#0A0A0A";
  const border = variant === "light" ? "#E0DDD5" : "#2A2A2A";

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--ink-60)" }}>{label}</div>
      <div
        className="relative rounded-xl overflow-hidden flex items-center justify-center cursor-pointer group transition-all hover:opacity-90"
        style={{ background: bg, border: `1px dashed ${border}`, height: 80 }}
        onClick={() => inputRef.current?.click()}
      >
        {currentUrl ? (
          <>
            <LazyImage src={currentUrl} alt="Logo" wrapperClassName="max-h-12 max-w-[160px] flex-shrink-0" className="object-contain" />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: `${bg}CC` }}>
              <span className="text-[11px] font-semibold" style={{ color: variant === "light" ? "#0A0A0A" : "#fff" }}>Replace</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {uploading ? (
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: variant === "light" ? "#888" : "#666" }} />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ color: variant === "light" ? "#888" : "#666" }}>
                  <path d="M10 3v10M6 7l4-4 4 4M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[11px]" style={{ color: variant === "light" ? "#888" : "#666" }}>Upload {label.toLowerCase()}</span>
              </>
            )}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/svg+xml,image/jpeg,image/webp"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>
      <p className="text-[10.5px] mt-1.5" style={{ color: "var(--ink-40)" }}>PNG, SVG or WebP · max 4 MB</p>
    </div>
  );
}

// ─── Main BrandKit page ───────────────────────────────────────────────────────
export default function BrandKit() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const qc = useQueryClient();
  const { data: brandKit, isLoading } = useQuery({
    ...trpc.payments.accounts.getBrandKit.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: accountData } = useQuery({
    ...trpc.payments.accounts.me.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const updateMutation = useMutation(trpc.payments.accounts.updateBrandKit.mutationOptions());

  const [darkColor, setDarkColor] = useState("#0A0A0A");
  const [lightColor, setLightColor] = useState("#F4F1E8");
  const [accent, setAccent] = useState("#D9F542");
  const [headingFont, setHeadingFont] = useState("Inter");
  const [bodyFont, setBodyFont] = useState("Inter");
  const [logoLightUrl, setLogoLightUrl] = useState<string | undefined>();
  const [logoDarkUrl, setLogoDarkUrl] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const businessName = (accountData as any)?.businessName ?? "EziQuotes";

  // Load saved brand kit
  useEffect(() => {
    if (!brandKit) return;
    const bk = brandKit as any;
    // Support new role-based fields (darkColor/lightColor) and fall back to old primaryColor
    if (bk.darkColor) setDarkColor(bk.darkColor);
    else if (bk.primaryColor) setDarkColor(bk.primaryColor);
    if (bk.lightColor) setLightColor(bk.lightColor);
    if (bk.accentColor) setAccent(bk.accentColor);
    if (bk.headingFont) setHeadingFont(bk.headingFont);
    if (bk.bodyFont) setBodyFont(bk.bodyFont);
    if (bk.logoLightUrl) setLogoLightUrl(bk.logoLightUrl);
    if (bk.logoDarkUrl) setLogoDarkUrl(bk.logoDarkUrl);
  }, [brandKit]);

  // Load fonts
  useEffect(() => { loadGoogleFont(headingFont); }, [headingFont]);
  useEffect(() => { loadGoogleFont(bodyFont); }, [bodyFont]);

  const handleSave = useCallback(async () => {
    if (!brandId) { toast.error("No active brand"); return; }
    setSaving(true);
    try {
      await updateMutation.mutateAsync({
        brandId,
        primaryColor: darkColor,  // keep backward compat
        darkColor,
        lightColor,
        accentColor: accent,
        headingFont,
        bodyFont,
        logoLightUrl,
        logoDarkUrl,
      });
      await qc.invalidateQueries({ queryKey: trpc.payments.accounts.getBrandKit.queryKey() });
      setLastSaved(new Date());
      toast.success("Brand kit saved — changes propagate to all proposals");
    } catch { toast.error("Failed to save brand kit"); }
    finally { setSaving(false); }
  }, [brandId, darkColor, lightColor, accent, headingFont, bodyFont, logoLightUrl, logoDarkUrl, updateMutation, qc, trpc]);

  // Contrast checks
  const darkOnWhite = contrastRatio(darkColor, "#ffffff");
  const accentOnDark = contrastRatio(accent, darkColor);
  const accentOnLight = contrastRatio(accent, lightColor);
  const darkOnLight = contrastRatio(darkColor, lightColor);
  // Smart legibility: if accent is low-contrast on light bg, the system will auto-use darkColor for small text
  const accentLowOnLight = accentOnLight < 3.0;

  if (isLoading) {
    return (
      <div className="page">
        <div className="page-hd">
          <div className="ttl"><h1>Brand kit.</h1></div>
        </div>
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin" style={{ color: "var(--ink-40)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header */}
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">
            BRAND{lastSaved ? ` · SAVED ${lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""} · CHANGES PROPAGATE LIVE
          </span>
          <h1>Brand kit.</h1>
          <span className="sub">Set your logo, colours, and fonts. Changes apply to all proposals instantly.</span>
        </div>
        <div className="acts">
          <button
            className="btn ghost"
            onClick={() => {
              toast.info("Open any proposal to see your brand live");
            }}
          >
            View a proposal
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
        {/* ── Left column ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Logo */}
          <div className="pnl">
            <div className="pnl-hd"><h3>Logo</h3></div>
            <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <LogoUpload
                label="Logo (light background)"
                currentUrl={logoLightUrl}
                onUpload={setLogoLightUrl}
                variant="light"
              />
              <LogoUpload
                label="Logo (dark background)"
                currentUrl={logoDarkUrl}
                onUpload={setLogoDarkUrl}
                variant="dark"
              />
            </div>
            <div className="pnl-body" style={{ paddingTop: 0 }}>
              <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-60)" }}>
                Upload both versions so your logo always looks great — the dark version appears on dark-background proposal sections, and the light version on light sections.
              </p>
            </div>
          </div>

          {/* Colour */}
          <div className="pnl">
            <div className="pnl-hd">
              <h3>Colour system</h3>
              <span className="meta">WCAG CONTRAST CHECKED</span>
            </div>

            {/* Role explanation */}
            <div className="pnl-body" style={{ paddingBottom: 0 }}>
              <div className="grid grid-cols-3 gap-3 mb-1">
                {[
                  { role: "Dark", desc: "Deep section backgrounds — hero, video, closing", icon: "◼" },
                  { role: "Light", desc: "Pale section backgrounds — deliverables, pricing, FAQ", icon: "◻" },
                  { role: "Accent", desc: "Pop colour — stat bars, package selectors, CTAs", icon: "◈" },
                ].map(r => (
                  <div key={r.role} className="rounded-xl p-3" style={{ background: "var(--bg-inset)", border: "1px solid var(--border-2)" }}>
                    <div className="text-[13px] font-bold mb-0.5" style={{ color: "var(--ink)" }}>{r.icon} {r.role}</div>
                    <div className="text-[10.5px] leading-relaxed" style={{ color: "var(--ink-60)" }}>{r.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
              <ColourPicker
                label="◼ Dark (deep background)"
                value={darkColor}
                onChange={setDarkColor}
                contrastAgainst={lightColor}
                presets={DARK_PRESETS}
              />
              <ColourPicker
                label="◻ Light (pale background)"
                value={lightColor}
                onChange={setLightColor}
                contrastAgainst={darkColor}
                presets={LIGHT_PRESETS}
              />
              <ColourPicker
                label="◈ Accent (pop colour)"
                value={accent}
                onChange={setAccent}
                contrastAgainst={darkColor}
                presets={ACCENT_PRESETS}
              />
            </div>

            {/* Smart accent-on-light warning */}
            {accentLowOnLight && (
              <div className="pnl-body" style={{ paddingTop: 0 }}>
                <div className="flex items-start gap-3 rounded-xl p-3" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 mt-0.5">
                    <path d="M8 2L14.5 13.5H1.5L8 2Z" stroke="#FBBF24" strokeWidth="1.5" strokeLinejoin="round"/>
                    <line x1="8" y1="6" x2="8" y2="9.5" stroke="#FBBF24" strokeWidth="1.5" strokeLinecap="round"/>
                    <circle cx="8" cy="11.5" r="0.75" fill="#FBBF24"/>
                  </svg>
                  <div>
                    <div className="text-[12px] font-semibold mb-0.5" style={{ color: "#FBBF24" }}>Accent is low-contrast on your light background</div>
                    <p className="text-[11px] leading-relaxed" style={{ color: "#92610a" }}>
                      Your accent colour ({accent.toUpperCase()}) has a contrast ratio of {accentOnLight.toFixed(1)}:1 against your light background — below the 3.0 minimum for text legibility. The system will automatically use your dark colour for small text and borders on light sections, and reserve the accent for large display text and icons only.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Contrast matrix */}
            <div className="pnl-body" style={{ paddingTop: 0 }}>
              <div className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--ink-60)" }}>Contrast matrix</div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Dark on light", ratio: darkOnLight, bg: lightColor, fg: darkColor },
                  { label: "Accent on dark", ratio: accentOnDark, bg: darkColor, fg: accent },
                  { label: "Accent on light", ratio: accentOnLight, bg: lightColor, fg: accent },
                  { label: "Dark on white", ratio: darkOnWhite, bg: "#ffffff", fg: darkColor },
                ].map(({ label, ratio, bg, fg }) => {
                  const info = contrastLabel(ratio);
                  return (
                    <div key={label} className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-2)" }}>
                      <div className="h-10 flex items-center justify-center text-[12px] font-bold" style={{ background: bg, color: fg }}>
                        Aa
                      </div>
                      <div className="px-2.5 py-2">
                        <div className="text-[10px]" style={{ color: "var(--ink-60)" }}>{label}</div>
                        <div className="text-[11px] font-semibold mt-0.5" style={{ color: info.color }}>{info.label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Typography */}
          <div className="pnl">
            <div className="pnl-hd">
              <h3>Typography</h3>
              <span className="meta">GOOGLE FONTS</span>
            </div>
            <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <FontPicker label="Heading font" value={headingFont} onChange={setHeadingFont} />
              <FontPicker label="Body font" value={bodyFont} onChange={setBodyFont} />
            </div>

            {/* Font preview */}
            <div className="pnl-body" style={{ paddingTop: 0 }}>
              <div
                className="rounded-xl p-5"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-2)" }}
              >
                <div
                  className="text-[28px] leading-tight mb-2"
                  style={{ fontFamily: `'${headingFont}', sans-serif`, color: "var(--ink)", fontWeight: 700, letterSpacing: "-0.03em" }}
                >
                  Your proposal, beautifully presented.
                </div>
                <div
                  className="text-[14px] leading-relaxed"
                  style={{ fontFamily: `'${bodyFont}', sans-serif`, color: "var(--ink-60)" }}
                >
                  This is how your body copy will look across all proposals. Clear, professional, and on-brand.
                </div>
              </div>
            </div>
          </div>

          {/* Propagation notice */}
          <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "rgba(101,245,201,0.06)", border: "1px solid rgba(101,245,201,0.15)" }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "rgba(101,245,201,0.2)" }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2 4-4" stroke="#65F5C9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <div className="text-[12px] font-semibold mb-0.5" style={{ color: "#65F5C9" }}>Changes propagate live</div>
              <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-60)" }}>
                Your brand kit is applied to every proposal at render time. Updating your colours or fonts here will instantly update how all proposals look — no need to re-send.
              </p>
            </div>
          </div>
        </div>

        {/* ── Right column — Live preview ── */}
        <div className="sticky top-6">
          <div className="pnl">
            <div className="pnl-hd">
              <h3>Live preview</h3>
              <span className="meta">UPDATES INSTANTLY</span>
            </div>
            <div className="pnl-body flex flex-col items-center gap-4">
              <PhonePreview
                primary={darkColor}
                accent={accent}
                headingFont={headingFont}
                bodyFont={bodyFont}
                logoUrl={logoDarkUrl || logoLightUrl}
                businessName={businessName}
              />
              <div
                className="w-full rounded-xl px-3 py-2.5 text-[10px] font-mono space-y-1"
                style={{ background: "var(--bg-inset)", border: "1px solid var(--border-2)", color: "var(--ink-60)" }}
              >
                <div className="flex justify-between">
                  <span>◼ dark</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{darkColor.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span>◻ light</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{lightColor.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span>◈ accent</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{accent.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span>heading</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{headingFont}</span>
                </div>
                <div className="flex justify-between">
                  <span>body</span>
                  <span className="font-semibold" style={{ color: "var(--ink)" }}>{bodyFont}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
