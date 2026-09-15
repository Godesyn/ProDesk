/**
 * Shared signature types + template/typography catalogues.
 *
 * Extracted from the SIGKITT client so BOTH the Signatures frontend and the
 * dashboard Brand Kit render from the SAME source (the "In use → Signatures"
 * preview is byte-identical to the signature app). The client-only localStorage
 * / saved-workspace / brand-template helpers stay in
 * clients/signatures/src/lib/signatureTypes.ts and re-export from here.
 */

export interface SignatureData {
  // Personal Info
  fullName: string;
  jobTitle: string;
  department: string;
  company: string;

  // Contact
  email: string;
  phone: string;
  mobile: string;
  website: string;
  address: string;

  // Social Links
  linkedin: string;
  twitter: string;
  instagram: string;
  github: string;
  youtube: string;
  facebook: string;
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

  // Appearance
  template: TemplateId;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  fontSize: string;

  // Photo
  photoUrl: string;
  photoLinkUrl: string; // URL to open when headshot is clicked
  photoShape: 'circle' | 'square' | 'rounded';
  showPhoto: boolean;

  // Logo
  logoUrl: string;
  logoLinkUrl: string; // URL to open when company logo is clicked
  showLogo: boolean;
  logoWidth: number; // px, 40–240

  // Banner
  bannerUrl: string;
  bannerLinkUrl: string;
  showBanner: boolean;
  bannerWidth: number; // px, 200–600

  // Custom
  customCta: string;
  customCtaUrl: string;
  disclaimer: string;

  // Image Card template extras
  brandDisplayName: string; // Kept for backward compat; now stores bar logo data URL
  barLogoUrl: string; // PNG logo shown top-left in the Image Card colour bar
  barLogoLinkUrl: string; // URL to open when bar logo is clicked
  brandTagline: string; // Small text bottom-left of bar (e.g. "LOCAL MOVES DIFFERENT")
  barColor: string; // Colour bar background (e.g. orange)
  barTextColor: string; // Text/icon colour on the bar (e.g. dark navy)
  poweredByLogoUrl: string; // Secondary logo bottom-right
  poweredByLinkUrl: string; // URL to open when powered-by logo is clicked
  poweredByLabel: string; // Label above secondary logo (e.g. "POWERED BY")
  imageCardWidth: number; // Total card width in px (default 600)
  cardRadius: number; // Border-radius on the Branded Card container in px (0 = square)

  // Verdiict integration
  verdiictUrl: string; // URL for "Get a Review" CTA
  verdiictReviewsUrl: string; // URL for "See our reviews" link
}

export type TemplateId =
  | 'classic'
  | 'modern'
  | 'minimal'
  | 'bold'
  | 'corporate'
  | 'imagecard'
  | 'hub'
  | 'brandedcard';

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  previewColor: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Timeless horizontal layout with a left-aligned photo',
    previewColor: '#0E0E0C',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Clean vertical divider with bold name treatment',
    previewColor: '#333333',
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Text-only, ultra-clean with a subtle accent line',
    previewColor: '#555555',
  },
  {
    id: 'bold',
    name: 'Bold',
    description: 'Strong color block header with high contrast',
    previewColor: '#b6b6b6',
  },
  {
    id: 'corporate',
    name: 'Corporate',
    description: 'Professional two-column layout with logo prominence',
    previewColor: '#888888',
  },
  {
    id: 'imagecard',
    name: 'Image Card',
    description:
      'Photo overlapping a bold colour bar — brand-forward real estate style',
    previewColor: '#AAAAAA',
  },
  {
    id: 'hub',
    name: 'Hub',
    description:
      'Platform-forward layout with a labelled icon grid for all your social channels and review sites',
    previewColor: '#6366F1',
  },
  {
    id: 'brandedcard',
    name: 'Branded Card',
    description:
      'Full-bleed colour card — logo top-left, socials top-right, secondary logo bottom-left, website bottom-right',
    previewColor: '#0E0E0C',
  },
];

/**
 * Available signature fonts. Each `value` is an email-safe CSS font stack: the
 * brand-kit family first, then web-safe fallbacks so signatures still read well
 * in email clients that don't load the web font. The web-font families (Inter,
 * Fraunces, …) are the same ones the Brand Kit type editor offers, and they are
 * actually loaded (Google Fonts) in both the Signatures and dashboard shells so
 * the on-screen specimens/previews render in them — see each app's index.html /
 * index.css.
 */
export const FONT_OPTIONS = [
  // Web-safe classics
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
  { value: "'Courier New', monospace", label: 'Courier New' },
  // Brand Kit web fonts (loaded via Google Fonts in both shells)
  { value: "'Inter', Helvetica, Arial, sans-serif", label: 'Inter' },
  { value: "'Inter Tight', Helvetica, Arial, sans-serif", label: 'Inter Tight' },
  { value: "'Archivo', Helvetica, Arial, sans-serif", label: 'Archivo' },
  { value: "'Fraunces', Georgia, 'Times New Roman', serif", label: 'Fraunces' },
  { value: "'Space Grotesk', Helvetica, Arial, sans-serif", label: 'Space Grotesk' },
  { value: "'Work Sans', Helvetica, Arial, sans-serif", label: 'Work Sans' },
  { value: "'DM Sans', Helvetica, Arial, sans-serif", label: 'DM Sans' },
  { value: "'Source Serif 4', Georgia, serif", label: 'Source Serif 4' },
  { value: "'IBM Plex Sans', Helvetica, Arial, sans-serif", label: 'IBM Plex Sans' },
];

export const FONT_SIZE_OPTIONS = [
  { value: '12px', label: 'Small (12px)' },
  { value: '13px', label: 'Medium (13px)' },
  { value: '14px', label: 'Large (14px)' },
];

export const DEFAULT_SIGNATURE: SignatureData = {
  fullName: 'Alex Johnson',
  jobTitle: 'Senior Product Designer',
  department: 'Product & Design',
  company: 'Acme Corporation',
  email: 'alex@acmecorp.com',
  phone: '+1 (555) 234-5678',
  mobile: '',
  website: 'https://acmecorp.com',
  address: '123 Business Ave, San Francisco, CA 94105',
  linkedin: 'https://linkedin.com/in/alexjohnson',
  twitter: '',
  instagram: '',
  github: '',
  youtube: '',
  facebook: '',
  spotify: '',
  pinterest: '',
  tiktok: '',
  googleMaps: '',
  googleReviews: '',
  trustpilot: '',
  tripadvisor: '',
  uberEats: '',
  deliveroo: '',
  expedia: '',
  rss: '',
  amazon: '',
  websiteLink: '',
  template: 'imagecard',
  primaryColor: '#0E0E0C',
  secondaryColor: '#333333',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: '13px',
  photoUrl: '',
  photoLinkUrl: '',
  photoShape: 'circle',
  showPhoto: false,
  logoUrl: '',
  logoLinkUrl: '',
  showLogo: false,
  logoWidth: 120,
  bannerUrl: '',
  bannerLinkUrl: '',
  showBanner: false,
  bannerWidth: 400,
  customCta: '',
  customCtaUrl: '',
  disclaimer: '',

  // Image Card extras
  brandDisplayName: '',
  barLogoUrl: '',
  barLogoLinkUrl: '',
  brandTagline: 'MAKING IT HAPPEN',
  barColor: '#b6b6b6',
  barTextColor: '#0E0E0C',
  poweredByLogoUrl: '',
  poweredByLinkUrl: '',
  poweredByLabel: 'POWERED BY',
  imageCardWidth: 600,
  cardRadius: 0,

  // Verdiict
  verdiictUrl: '',
  verdiictReviewsUrl: '',
};
