/**
 * Brand/Team/Signatures Management System
 * Hierarchy: Brand → Team Members → Generated Signatures
 */

import type { SignatureData, TemplateId } from './signatureTypes';

// ─── Brand ────────────────────────────────────────────────────────────────────
export interface Brand {
  id: string;
  name: string;
  // Visual identity
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  // Image Card specific
  barColor: string;
  barTextColor: string;
  barLogoUrl?: string | null;
  barLogoLinkUrl?: string | null;   // URL to open when bar logo is clicked
  brandDisplayName: string;
  brandTagline: string;
  // Assets
  logoUrl: string;
  logoLinkUrl?: string | null;       // URL to open when company logo is clicked
  logoWidth: number;
  poweredByLogoUrl: string;
  poweredByLinkUrl?: string | null;  // URL to open when powered-by logo is clicked
  poweredByLabel: string;
  cardRadius?: number;               // Border-radius on Branded Card container (px, 0 = square)
  // Verdiict integration
  verdiictUrl: string;
  verdiictReviewsUrl: string;
  // Defaults applied to all members
  defaultTemplate: TemplateId;
  disclaimer: string;
  website: string;
  address: string;
  // Meta
  createdAt: string;
  updatedAt: string;
}

// ─── Team Member ──────────────────────────────────────────────────────────────
export interface TeamMember {
  id: string;
  brandId: string;
  // Personal
  fullName: string;
  jobTitle: string;
  department: string;
  email: string;
  phone: string;
  mobile: string;
  photoUrl: string;
  photoLinkUrl?: string | null;  // URL to open when headshot is clicked
  // Social
  linkedin: string;
  twitter: string;
  instagram: string;
  facebook: string;
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
  // Overrides (if different from brand defaults)
  templateOverride?: TemplateId;
  // Meta
  createdAt: string;
  updatedAt: string;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
const BRANDS_KEY = 'sig_brands_v1';
const MEMBERS_KEY = 'sig_members_v1';

export function loadBrands(): Brand[] {
  try {
    return JSON.parse(localStorage.getItem(BRANDS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveBrands(brands: Brand[]): void {
  // Brand logos are base64 data URLs; a QuotaExceededError here is uncaught and
  // blanks the app. Never throw — worst case this write is skipped.
  try {
    localStorage.setItem(BRANDS_KEY, JSON.stringify(brands));
  } catch { /* localStorage quota exceeded — skip persisting rather than crash */ }
}

export function loadMembers(): TeamMember[] {
  try {
    return JSON.parse(localStorage.getItem(MEMBERS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveMembers(members: TeamMember[]): void {
  // Member photos are base64 data URLs; guard against QuotaExceededError blanking
  // the app the same way as saveBrands.
  try {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
  } catch { /* localStorage quota exceeded — skip persisting rather than crash */ }
}

export function getMembersForBrand(brandId: string): TeamMember[] {
  return loadMembers().filter(m => m.brandId === brandId);
}

// ─── Merge brand + member into SignatureData ──────────────────────────────────
export function mergeToSignatureData(brand: Brand, member: TeamMember): SignatureData {
  return {
    // Template
    template: member.templateOverride || brand.defaultTemplate,
    // Personal
    fullName: member.fullName,
    jobTitle: member.jobTitle,
    department: member.department,
    company: brand.brandDisplayName || brand.name,
    email: member.email,
    phone: member.phone,
    mobile: member.mobile,
    website: brand.website,
    address: brand.address,
    // Photo
    photoUrl: member.photoUrl,
    photoLinkUrl: member.photoLinkUrl || '',
    showPhoto: !!member.photoUrl,
    photoShape: 'circle',
    // Logo
    logoUrl: brand.logoUrl,
    logoLinkUrl: brand.logoLinkUrl || '',
    logoWidth: brand.logoWidth,
    showLogo: !!brand.logoUrl,
    // Social
    linkedin: member.linkedin,
    twitter: member.twitter,
    instagram: member.instagram,
    facebook: member.facebook,
    youtube: member.youtube,
    github: member.github,
    spotify: member.spotify,
    pinterest: member.pinterest,
    tiktok: member.tiktok,
    googleMaps: member.googleMaps,
    googleReviews: member.googleReviews,
    trustpilot: member.trustpilot,
    tripadvisor: member.tripadvisor,
    uberEats: member.uberEats,
    deliveroo: member.deliveroo,
    expedia: member.expedia,
    rss: member.rss,
    amazon: member.amazon,
    websiteLink: member.websiteLink,
    // Style
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    fontFamily: brand.fontFamily,
    fontSize: '13px',
    // Banner
    bannerUrl: '',
    bannerLinkUrl: '',
    showBanner: false,
    bannerWidth: 400,
    // CTA
    customCta: '',
    customCtaUrl: '',
    disclaimer: brand.disclaimer,
    // Image Card
    brandDisplayName: brand.brandDisplayName,
    barLogoUrl: brand.barLogoUrl || '',
    barLogoLinkUrl: brand.barLogoLinkUrl || '',
    brandTagline: brand.brandTagline,
    barColor: brand.barColor,
    barTextColor: brand.barTextColor,
    poweredByLogoUrl: brand.poweredByLogoUrl,
    poweredByLinkUrl: brand.poweredByLinkUrl || '',
    poweredByLabel: brand.poweredByLabel,
    imageCardWidth: 600,
    cardRadius: brand.cardRadius ?? 0,
    verdiictUrl: brand.verdiictUrl || '',
    verdiictReviewsUrl: brand.verdiictReviewsUrl || '',
  };
}

// ─── Default brand template ───────────────────────────────────────────────────
export const DEFAULT_BRAND: Omit<Brand, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  primaryColor: '#4A7C59',
  secondaryColor: '#C17D3C',
  fontFamily: 'Arial, Helvetica, sans-serif',
  barColor: '#E85A00',
  barTextColor: '#1a1a2e',
  brandDisplayName: '',
  brandTagline: '',
  barLogoUrl: '',
  barLogoLinkUrl: '',
  logoUrl: '',
  logoLinkUrl: '',
  logoWidth: 120,
  poweredByLogoUrl: '',
  poweredByLinkUrl: '',
  poweredByLabel: 'POWERED BY',
  defaultTemplate: 'imagecard',
  disclaimer: '',
  website: '',
  address: '',
  verdiictUrl: '',
  verdiictReviewsUrl: '',
  cardRadius: 0,
};

export const DEFAULT_MEMBER: Omit<TeamMember, 'id' | 'brandId' | 'createdAt' | 'updatedAt'> = {
  fullName: '',
  jobTitle: '',
  department: '',
  email: '',
  phone: '',
  mobile: '',
  photoUrl: '',
  photoLinkUrl: '',
  linkedin: '',
  twitter: '',
  instagram: '',
  facebook: '',
  youtube: '',
  github: '',
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
};
