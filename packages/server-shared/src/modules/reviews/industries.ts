/**
 * Default industry presets for the Reviews tool. DB-backed (reviewIndustries /
 * reviewTagPresets, super-admin managed) with this seed as the fallback when the
 * tables are empty. Ported from the Manus export's shared/industries.ts.
 */

export type ReviewIndustrySeed = {
  slug: string;
  label: string;
  description: string;
  defaultTags: string[];
};

export const REVIEW_INDUSTRIES: ReviewIndustrySeed[] = [
  {
    slug: 'agency',
    label: 'Marketing / Creative Agency',
    description: 'Design, advertising, digital, PR, or creative services',
    defaultTags: [
      'Nailed the brief',
      'Creative was on point',
      'Communication was easy',
      'Moved fast',
      'Understood our business',
      'Made the hard stuff simple',
      'Hit every deadline',
      'Went above and beyond',
      'Professional from start to finish',
      'Fair on pricing',
    ],
  },
  {
    slug: 'real-estate',
    label: 'Real Estate',
    description: 'Residential or commercial sales, property management, rentals',
    defaultTags: [
      'Sold quickly',
      'Got us a great price',
      'Kept us informed throughout',
      'Honest and transparent',
      'Knew the market inside out',
      'Made the process stress-free',
      'Responsive and available',
      'Professional from start to finish',
      'Went above and beyond',
      'Highly attentive to detail',
    ],
  },
  {
    slug: 'retail',
    label: 'Retail',
    description: 'Physical or online store selling products',
    defaultTags: [
      'Great product quality',
      'Fast shipping',
      'Easy to deal with',
      'Exactly as described',
      'Excellent customer service',
      'Hassle-free returns',
      'Great value for money',
      'Beautifully packaged',
      'Will definitely buy again',
      'Went above and beyond',
    ],
  },
  {
    slug: 'hospitality',
    label: 'Hospitality',
    description: 'Restaurant, café, bar, hotel, accommodation, or events',
    defaultTags: [
      'Amazing food / drinks',
      'Exceptional service',
      'Great atmosphere',
      'Staff were friendly and attentive',
      'Perfect for the occasion',
      'Great value',
      'Will definitely be back',
      'Clean and well-presented',
      'Went above and beyond',
      'Made us feel welcome',
    ],
  },
  {
    slug: 'trades',
    label: 'Trades & Home Services',
    description: 'Builder, plumber, electrician, landscaper, cleaner, etc.',
    defaultTags: [
      'Showed up on time',
      'Clean and tidy workmanship',
      'Finished on budget',
      'Communicated clearly',
      'Honest and reliable',
      'Went above and beyond',
      'Highly skilled',
      'Respectful of our home',
      'Would use again',
      'Sorted the problem fast',
    ],
  },
  {
    slug: 'health',
    label: 'Health & Wellness',
    description: 'Clinic, gym, physio, dentist, allied health, beauty, or wellness',
    defaultTags: [
      'Caring and attentive',
      'Explained everything clearly',
      'Made me feel comfortable',
      'Noticeable results',
      'Professional and knowledgeable',
      'Easy to book',
      'Clean and welcoming space',
      'Went above and beyond',
      'Highly skilled practitioner',
      'Genuinely listened',
    ],
  },
  {
    slug: 'legal',
    label: 'Legal & Professional Services',
    description: 'Law firm, accountant, financial advisor, consultant',
    defaultTags: [
      'Explained everything clearly',
      'Responsive and available',
      'Got the outcome we needed',
      'Honest and transparent',
      'Made a stressful process easy',
      'Thorough and detail-oriented',
      'Professional from start to finish',
      'Fair fees',
      'Went above and beyond',
      'Trusted advisor',
    ],
  },
  {
    slug: 'automotive',
    label: 'Automotive',
    description: 'Car dealer, mechanic, detailer, or auto services',
    defaultTags: [
      'Honest and upfront',
      'Fixed it right the first time',
      'Fast turnaround',
      'Fair pricing',
      'Kept me informed throughout',
      'Clean and professional workshop',
      'Went above and beyond',
      'Knowledgeable team',
      'Easy to deal with',
      'Would recommend to anyone',
    ],
  },
  {
    slug: 'other',
    label: 'Other',
    description: 'Something else — you can customise your tags after setup',
    defaultTags: [
      'Great service',
      'Professional and reliable',
      'Communication was easy',
      'Went above and beyond',
      'Great value',
      'Would recommend',
      'Fast and efficient',
      'Knowledgeable team',
      'Made the process easy',
      'Will use again',
    ],
  },
];

export function getReviewIndustryBySlug(slug: string): ReviewIndustrySeed | undefined {
  return REVIEW_INDUSTRIES.find((i) => i.slug === slug);
}

export function getDefaultTagsForIndustry(slug: string): string[] {
  return (
    getReviewIndustryBySlug(slug)?.defaultTags ??
    REVIEW_INDUSTRIES.find((i) => i.slug === 'other')!.defaultTags
  );
}

/** URL-safe slug from a free-text name (locations + directory profiles). */
export function slugifyName(name: string, max = 80): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, max);
}
