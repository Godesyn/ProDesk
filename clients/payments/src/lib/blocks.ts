// ============================================================
// Prodesk Modular Proposal Block System
// ============================================================

const uuidv4 = () => crypto.randomUUID();

export type BlockType =
  | 'hero'
  | 'value_panels'
  | 'text_block'
  | 'pricing_table'
  | 'team_cards'
  | 'roadmap'
  | 'image_banner'
  | 'divider'
  | 'accept_pay'
  // New block types
  | 'video'
  | 'testimonial'
  | 'case_study'
  | 'faq'
  | 'comparison'
  | 'guarantee'
  | 'countdown'
  | 'stat_bar'
  | 'logo_strip'
  | 'process_steps'
  | 'spacer'
  | 'embed'
  | 'gallery'
  | 'package_selector'
  | 'signature'
  | 'custom_html'
  | 'recommendations'
  | 'table_of_contents';

export interface BlockStyles {
  bg?: string;
  accent?: string;
  text?: string;
  textMuted?: string;
  scheme?: 'dark' | 'light';
  paddingTop?: number;
  paddingBottom?: number;
  bgImageUrl?: string;
  bgImageOpacity?: number;
  borderRadius?: number;
  fontHeading?: string;
  fontBody?: string;
  width?: 'full' | 'contained' | 'narrow';
  columns?: 1 | 2 | 3;
  animation?: 'none' | 'fade' | 'slide-up' | 'slide-left' | 'zoom';
  animationDelay?: number;
  /**
   * blockRole — the intended colour role for this block in the brand system.
   * 'dark'   → uses brandKit.darkColor as bg (deep, authoritative sections)
   * 'light'  → uses brandKit.lightColor as bg (open, readable sections)
   * 'accent' → uses brandKit.accentColor as bg (punchy CTA / stat sections)
   * When Apply Brand Kit is triggered, this role is used to map the correct colour.
   * If not set, the block's current bg luminance is used to infer the role.
   */
  blockRole?: 'dark' | 'light' | 'accent';
}

// ---- Hero ----
export interface HeroData {
  eyebrow: string;
  headlineTop: string;
  headlineBottom: string;
  strap: string;
  metaItems: Array<{ label: string; value: string }>;
  videoUrl?: string;
  bgImageUrl?: string;
}

// ---- Value Panels (3-col) ----
export interface ValuePanelItem {
  num: string;
  title: string;
  body: string;
  corner?: string;
}
export interface ValuePanelsData {
  eyebrow: string;
  headline: string;
  lede: string;
  panels: ValuePanelItem[];
}

// ---- Text Block ----
export interface TextBlockData {
  eyebrow: string;
  eyebrowNum?: string;
  headline: string;
  lede: string;
}

// ---- Pricing Table ----
export interface PricingLineItem {
  id: string;
  name: string;
  description?: string;
  qty: number;
  unitCents: number;
  taxBehaviour: 'inclusive' | 'exclusive' | 'exempt';
  taxRate?: number;
  optional?: boolean;
  selected?: boolean;
  isQuantityEditable?: boolean;
}
export interface PricingTableData {
  eyebrow: string;
  headline: string;
  lede: string;
  lineItems: PricingLineItem[];
  currency: string;
  paymentModel: 'one_off' | 'subscription' | 'payment_plan';
  paymentConfig?: Record<string, unknown>;
  subtotalCents: number;
  taxCents: number;
  taxLabel: string;
  taxRate?: number;
  totalCents: number;
  depositPercent?: number;
  installments?: number;
  billingInterval?: string;
}

// ---- Team Cards ----
export interface TeamMember {
  id: string;
  initials: string;
  name: string;
  role: string;
  bio: string;
  avatarUrl?: string;
}
export interface TeamCardsData {
  eyebrow: string;
  headline: string;
  lede: string;
  members: TeamMember[];
}

// ---- Roadmap ----
export interface RoadmapStep {
  id: string;
  stamp: string;
  title: string;
  body: string;
}
export interface RoadmapData {
  eyebrow: string;
  headline: string;
  lede: string;
  steps: RoadmapStep[];
}

// ---- Image Banner ----
export interface ImageBannerData {
  imageUrl: string;
  alt?: string;
  caption?: string;
  aspectRatio?: '16/9' | '4/3' | '21/9' | '1/1';
}

// ---- Divider ----
export interface DividerData {
  style: 'line' | 'space' | 'gradient';
  height?: number;
}

// ---- Accept & Pay ----
export interface AcceptPayData {
  headline: string;
  lede: string;
  termsText: string;
  termsUrl?: string;
  ctaLabel: string;
  postPayHeadline: string;
  postPayStrap: string;
  postPaySteps: Array<{ stamp: string; title: string; body: string }>;
  requireSignature?: boolean;
  customQuestions?: Array<{ id: string; label: string; required: boolean }>;
  calendlyUrl?: string;
}

// ---- Video ----
export interface VideoData {
  url: string; // YouTube, Vimeo, Loom, or direct mp4
  caption?: string;
  autoplay?: boolean;
  aspectRatio?: '16/9' | '4/3' | '1/1';
  eyebrow?: string;
  headline?: string;
  lede?: string;
}

// ---- Testimonial ----
export interface TestimonialItem {
  id: string;
  quote: string;
  name: string;
  title: string;
  company: string;
  avatarInitials?: string;
  avatarUrl?: string;
  rating?: number; // 1-5
}
export interface TestimonialData {
  eyebrow: string;
  headline?: string;
  items: TestimonialItem[];
  layout: 'single' | 'grid' | 'carousel';
}

// ---- Case Study ----
export interface CaseStudyStat {
  value: string;
  label: string;
}
export interface CaseStudyData {
  eyebrow: string;
  clientName: string;
  headline: string;
  body: string;
  stats: CaseStudyStat[];
  logoText?: string;
  imageUrl?: string;
}

// ---- FAQ ----
export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}
export interface FaqData {
  eyebrow: string;
  headline: string;
  lede?: string;
  items: FaqItem[];
}

// ---- Comparison Table ----
export interface ComparisonRow {
  id: string;
  feature: string;
  without: string;
  with: string;
}
export interface ComparisonData {
  eyebrow: string;
  headline: string;
  withoutLabel: string;
  withLabel: string;
  rows: ComparisonRow[];
}

// ---- Guarantee ----
export interface GuaranteeData {
  eyebrow: string;
  headline: string;
  body: string;
  badgeText: string;
  icon?: 'shield' | 'star' | 'check' | 'heart';
}

// ---- Countdown ----
export interface CountdownData {
  eyebrow: string;
  headline: string;
  lede: string;
  expiresAt?: string; // ISO date string, or use proposal valid_until
  useProposalExpiry: boolean;
  ctaLabel: string;
  ctaAction?: 'scroll_to_accept' | 'external_url';
  ctaUrl?: string;
}

// ---- Stat Bar ----
export interface StatItem {
  id: string;
  value: string;
  label: string;
  prefix?: string;
  suffix?: string;
}
export interface StatBarData {
  eyebrow?: string;
  stats: StatItem[];
}

// ---- Logo Strip ----
export interface LogoItem {
  id: string;
  name: string;
  logoUrl?: string;
  logoText?: string; // fallback if no image
}
export interface LogoStripData {
  eyebrow?: string;
  headline?: string;
  logos: LogoItem[];
}

// ---- Process Steps ----
export interface ProcessStep {
  id: string;
  number: string;
  title: string;
  body: string;
  icon?: string;
}
export interface ProcessStepsData {
  eyebrow: string;
  headline: string;
  lede?: string;
  steps: ProcessStep[];
  layout: 'horizontal' | 'vertical' | 'grid';
}

// ---- Spacer ----
export interface SpacerData {
  height: number; // px
}

// ---- Embed ----
export interface EmbedData {
  url: string;
  height?: number; // px
  caption?: string;
  provider?: 'calendly' | 'typeform' | 'google_maps' | 'figma' | 'other';
}

// ---- Gallery ----
export interface GalleryImage {
  id: string;
  url: string;
  alt?: string;
  caption?: string;
}
export interface GalleryData {
  eyebrow?: string;
  headline?: string;
  images: GalleryImage[];
  columns: 2 | 3 | 4;
  lightbox: boolean;
}

// ---- Package Selector ----
export interface PackageTier {
  id: string;
  name: string;
  tagline: string;
  priceCents: number;
  currency: string;
  period?: string;
  features: string[];
  highlighted?: boolean;
  ctaLabel?: string;
}
export interface PackageSelectorData {
  eyebrow: string;
  headline: string;
  lede?: string;
  tiers: PackageTier[];
  selectedTierId?: string;
}

// ---- Signature ----
export interface SignatureData {
  headline: string;
  lede: string;
  signerName?: string;
  signerTitle?: string;
  signedAt?: string;
  signatureData?: string; // base64 canvas data
  signatureType?: 'draw' | 'type';
  typedName?: string;
}

// ---- Custom HTML ----
export interface CustomHtmlData {
  html: string;
  caption?: string;
}

// ---- Table of Contents ----
export interface TableOfContentsData {
  title: string;
  items: Array<{ label: string; anchor: string }>;
}

// ---- Recommendations ----
export interface RecommendationsData {
  eyebrow: string;
  headline: string;
  lede?: string;
  items: string[]; // dot-point strings
}

// ---- Union ----
export type BlockData =
  | HeroData
  | ValuePanelsData
  | TextBlockData
  | PricingTableData
  | TeamCardsData
  | RoadmapData
  | ImageBannerData
  | DividerData
  | AcceptPayData
  | VideoData
  | TestimonialData
  | CaseStudyData
  | FaqData
  | ComparisonData
  | GuaranteeData
  | CountdownData
  | StatBarData
  | LogoStripData
  | ProcessStepsData
  | SpacerData
  | EmbedData
  | GalleryData
  | PackageSelectorData
  | SignatureData
  | CustomHtmlData
  | RecommendationsData
  | TableOfContentsData;

export interface Block {
  id: string;
  type: BlockType;
  data: BlockData;
  styles: BlockStyles;
  locked?: boolean;
  hidden?: boolean;
  condition?: {
    field: 'total' | 'client_tag' | 'payment_model';
    operator: 'gt' | 'lt' | 'eq';
    value: string | number;
  };
}

// ============================================================
// Default block factories
// ============================================================
export function createBlock(
  type: BlockType,
  overrides?: Partial<Block>,
): Block {
  const defaults = DEFAULT_BLOCK_DATA[type];
  return {
    id: uuidv4(),
    type,
    data: { ...(defaults?.data ?? {}) } as BlockData,
    styles: { ...(defaults?.styles ?? {}) },
    ...overrides,
  };
}

export const DEFAULT_BLOCK_DATA: Record<
  BlockType,
  { data: BlockData; styles: BlockStyles }
> = {
  hero: {
    data: {
      eyebrow: 'Your engagement',
      headlineTop: 'your',
      headlineBottom: 'engagement.',
      strap:
        "We've built this specifically for you based on our initial conversations.",
      metaItems: [
        { label: 'Prepared by', value: 'Your Business' },
        { label: 'Client', value: 'Client Name' },
        { label: 'Proposal', value: 'New Proposal' },
        { label: 'Valid until', value: '30 days' },
      ],
    } as HeroData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  value_panels: {
    data: {
      eyebrow: 'Why us',
      headline: 'A partner, not a service ticket.',
      lede: 'We sit inside your business. We know the names of your team. We tell you when something is off before you do.',
      panels: [
        {
          num: '01',
          title: 'On retainer, on the team.',
          body: 'Two people every week, hands in your accounts.',
          corner: 'ALWAYS ON',
        },
        {
          num: '02',
          title: 'A price you can plan around.',
          body: 'Monthly fee covers everything in scope. No surprises.',
          corner: 'FIXED PRICE',
        },
        {
          num: '03',
          title: 'Local, on local time.',
          body: 'Sydney office. Available same day. No offshore handoffs.',
          corner: 'SYDNEY-BASED',
        },
      ],
    } as ValuePanelsData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  text_block: {
    data: {
      eyebrow: 'Section',
      eyebrowNum: '01',
      headline: 'Your headline here.',
      lede: 'Add your supporting copy here. This section is great for introducing a concept, explaining your approach, or setting context for what follows.',
    } as TextBlockData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  pricing_table: {
    data: {
      eyebrow: 'Your engagement',
      headline: 'New proposal',
      lede: "Here's what's included.",
      lineItems: [],
      currency: 'AUD',
      paymentModel: 'one_off',
      subtotalCents: 0,
      taxCents: 0,
      taxLabel: 'GST',
      totalCents: 0,
    } as PricingTableData,
    styles: {
      bg: '#04100E',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  team_cards: {
    data: {
      eyebrow: 'Your team',
      headline: 'Two names, one inbox.',
      lede: 'Your dedicated contacts throughout the engagement.',
      members: [
        {
          id: uuidv4(),
          initials: 'SA',
          name: 'Team Member',
          role: 'Lead',
          bio: 'Add a short bio here.',
        },
        {
          id: uuidv4(),
          initials: 'PN',
          name: 'Team Member',
          role: 'Support',
          bio: 'Add a short bio here.',
        },
      ],
    } as TeamCardsData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  roadmap: {
    data: {
      eyebrow: 'What happens next',
      headline: 'Onboarded in ten business days.',
      lede: "Here's what the first month looks like.",
      steps: [
        {
          id: uuidv4(),
          stamp: 'DAY 1',
          title: 'Accept & pay',
          body: 'You confirm the engagement and we get started.',
        },
        {
          id: uuidv4(),
          stamp: 'DAY 2–3',
          title: 'Onboarding',
          body: 'We get access to everything we need.',
        },
        {
          id: uuidv4(),
          stamp: 'DAY 5–7',
          title: 'First deliverable',
          body: 'You receive the first output.',
        },
        {
          id: uuidv4(),
          stamp: 'DAY 10+',
          title: 'Live',
          body: 'Ongoing rhythm established.',
        },
      ],
    } as RoadmapData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  image_banner: {
    data: {
      imageUrl: '',
      alt: 'Banner image',
      caption: '',
      aspectRatio: '16/9',
    } as ImageBannerData,
    styles: { bg: '#000000', scheme: 'dark' },
  },
  divider: {
    data: { style: 'space', height: 80 } as DividerData,
    styles: { bg: '#000000', scheme: 'dark' },
  },
  accept_pay: {
    data: {
      headline: 'Confirm the engagement.',
      lede: "Ready to get started? Accept below and we'll be in touch within 24 hours.",
      termsText:
        'Payment is due on acceptance. By accepting you agree to our terms of service.',
      ctaLabel: 'Accept & pay',
      postPayHeadline: "You're in.",
      postPayStrap: "We'll be in touch within 24 hours to kick things off.",
      postPaySteps: [
        {
          stamp: 'STEP 1',
          title: 'Confirmation email',
          body: 'Check your inbox for a receipt and next steps.',
        },
        {
          stamp: 'STEP 2',
          title: 'Onboarding call',
          body: "We'll schedule a kickoff call within 48 hours.",
        },
        {
          stamp: 'STEP 3',
          title: 'Access shared',
          body: "You'll receive access to our shared workspace.",
        },
      ],
      requireSignature: false,
      customQuestions: [],
    } as AcceptPayData,
    styles: {
      bg: '#04100E',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  video: {
    data: {
      url: '',
      caption: '',
      aspectRatio: '16/9',
      eyebrow: '',
      headline: '',
      lede: '',
    } as VideoData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  testimonial: {
    data: {
      eyebrow: 'What clients say',
      headline: "Don't take our word for it.",
      layout: 'grid',
      items: [
        {
          id: uuidv4(),
          quote:
            'Working with this team transformed our business. The results speak for themselves.',
          name: 'Jane Smith',
          title: 'CEO',
          company: 'Acme Corp',
          avatarInitials: 'JS',
          rating: 5,
        },
        {
          id: uuidv4(),
          quote:
            'Professional, responsive, and delivered exactly what they promised. Highly recommend.',
          name: 'Mark Johnson',
          title: 'Founder',
          company: 'TechStart',
          avatarInitials: 'MJ',
          rating: 5,
        },
        {
          id: uuidv4(),
          quote:
            "The best investment we've made this year. ROI was clear within the first month.",
          name: 'Sarah Lee',
          title: 'COO',
          company: 'GrowthCo',
          avatarInitials: 'SL',
          rating: 5,
        },
      ],
    } as TestimonialData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  case_study: {
    data: {
      eyebrow: 'Case study',
      clientName: 'Client Name',
      headline: 'How we delivered results.',
      body: 'Add a brief description of the challenge, approach, and outcome here.',
      stats: [
        { value: '340%', label: 'Revenue increase' },
        { value: '6mo', label: 'Time to result' },
        { value: '$2.4M', label: 'Value generated' },
      ],
      logoText: 'CLIENT',
    } as CaseStudyData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  faq: {
    data: {
      eyebrow: 'Questions',
      headline: 'Everything you need to know.',
      items: [
        {
          id: uuidv4(),
          question: 'How long does onboarding take?',
          answer:
            "We typically onboard new clients within 10 business days. You'll have access to everything you need from day one.",
        },
        {
          id: uuidv4(),
          question: "What's included in the monthly fee?",
          answer:
            'Everything in scope is covered. There are no surprise invoices. If scope changes, we discuss it first.',
        },
        {
          id: uuidv4(),
          question: 'Can I cancel at any time?',
          answer:
            'Yes. We work on a rolling monthly basis with 30 days notice. No lock-in contracts.',
        },
        {
          id: uuidv4(),
          question: 'Who will I be working with?',
          answer:
            "You'll have two dedicated team members. You'll know their names and they'll know yours.",
        },
      ],
    } as FaqData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  comparison: {
    data: {
      eyebrow: 'Why choose us',
      headline: 'The difference is clear.',
      withoutLabel: 'Without us',
      withLabel: 'With us',
      rows: [
        {
          id: uuidv4(),
          feature: 'Response time',
          without: '24–48 hours',
          with: 'Same day',
        },
        {
          id: uuidv4(),
          feature: 'Dedicated contact',
          without: 'Rotating team',
          with: 'Named person',
        },
        {
          id: uuidv4(),
          feature: 'Pricing',
          without: 'Variable, surprise invoices',
          with: 'Fixed monthly fee',
        },
        {
          id: uuidv4(),
          feature: 'Reporting',
          without: 'Quarterly',
          with: 'Monthly + on-demand',
        },
        {
          id: uuidv4(),
          feature: 'Onboarding',
          without: '6–8 weeks',
          with: '10 business days',
        },
      ],
    } as ComparisonData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  guarantee: {
    data: {
      eyebrow: 'Our promise',
      headline: '30-day satisfaction guarantee.',
      body: "If you're not completely satisfied with our work in the first 30 days, we'll refund your first month. No questions asked.",
      badgeText: 'GUARANTEED',
      icon: 'shield',
    } as GuaranteeData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  countdown: {
    data: {
      eyebrow: 'Offer expires',
      headline: 'This proposal is time-limited.',
      lede: 'Accept before the deadline to lock in this pricing.',
      useProposalExpiry: true,
      ctaLabel: 'Accept now →',
      ctaAction: 'scroll_to_accept',
    } as CountdownData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  stat_bar: {
    data: {
      eyebrow: 'By the numbers',
      stats: [
        {
          id: uuidv4(),
          value: '12',
          label: 'Years in business',
          suffix: 'yrs',
        },
        { id: uuidv4(), value: '400', label: 'Clients served', suffix: '+' },
        { id: uuidv4(), value: '98', label: 'Retention rate', suffix: '%' },
        { id: uuidv4(), value: '4.9', label: 'Average rating', suffix: '/5' },
      ],
    } as StatBarData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  logo_strip: {
    data: {
      eyebrow: 'Trusted by',
      headline: '',
      logos: [
        { id: uuidv4(), name: 'Acme Corp', logoText: 'ACME' },
        { id: uuidv4(), name: 'TechStart', logoText: 'TECHSTART' },
        { id: uuidv4(), name: 'GrowthCo', logoText: 'GROWTHCO' },
        { id: uuidv4(), name: 'BuildCo', logoText: 'BUILDCO' },
        { id: uuidv4(), name: 'DataFirm', logoText: 'DATAFIRM' },
      ],
    } as LogoStripData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  process_steps: {
    data: {
      eyebrow: 'How it works',
      headline: 'Simple, transparent process.',
      steps: [
        {
          id: uuidv4(),
          number: '01',
          title: 'Discovery',
          body: 'We learn about your business, goals, and current challenges.',
          icon: 'search',
        },
        {
          id: uuidv4(),
          number: '02',
          title: 'Strategy',
          body: 'We build a tailored plan based on your specific situation.',
          icon: 'map',
        },
        {
          id: uuidv4(),
          number: '03',
          title: 'Execution',
          body: 'We deliver on the plan with weekly check-ins and reporting.',
          icon: 'zap',
        },
        {
          id: uuidv4(),
          number: '04',
          title: 'Review',
          body: "Monthly reviews ensure we're always aligned with your goals.",
          icon: 'refresh-cw',
        },
      ],
      layout: 'horizontal',
    } as ProcessStepsData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  spacer: {
    data: { height: 80 } as SpacerData,
    styles: { bg: '#000000', scheme: 'dark' },
  },
  embed: {
    data: {
      url: '',
      height: 600,
      caption: '',
      provider: 'other',
    } as EmbedData,
    styles: { bg: '#000000', scheme: 'dark' },
  },
  gallery: {
    data: {
      eyebrow: '',
      headline: '',
      images: [],
      columns: 3,
      lightbox: true,
    } as GalleryData,
    styles: { bg: '#000000', scheme: 'dark' },
  },
  package_selector: {
    data: {
      eyebrow: 'Choose your plan',
      headline: 'Pick the right fit.',
      lede: 'All plans include onboarding and dedicated support.',
      tiers: [
        {
          id: uuidv4(),
          name: 'Starter',
          tagline: 'For small teams getting started',
          priceCents: 150000,
          currency: 'AUD',
          period: '/ month',
          features: [
            'Up to 5 users',
            'Core features',
            'Email support',
            'Monthly reporting',
          ],
          highlighted: false,
          ctaLabel: 'Choose Starter',
        },
        {
          id: uuidv4(),
          name: 'Growth',
          tagline: 'For teams ready to scale',
          priceCents: 350000,
          currency: 'AUD',
          period: '/ month',
          features: [
            'Up to 20 users',
            'All features',
            'Priority support',
            'Weekly reporting',
            'Dedicated contact',
          ],
          highlighted: true,
          ctaLabel: 'Choose Growth',
        },
        {
          id: uuidv4(),
          name: 'Enterprise',
          tagline: 'For large organisations',
          priceCents: 750000,
          currency: 'AUD',
          period: '/ month',
          features: [
            'Unlimited users',
            'Custom integrations',
            '24/7 support',
            'Daily reporting',
            'Named team',
          ],
          highlighted: false,
          ctaLabel: 'Choose Enterprise',
        },
      ],
    } as PackageSelectorData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  signature: {
    data: {
      headline: 'Sign to confirm.',
      lede: 'By signing below you confirm your agreement to the terms outlined in this proposal.',
      signatureType: 'draw',
    } as SignatureData,
    styles: {
      bg: '#04100E',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  custom_html: {
    data: {
      html: '<!-- Add your custom HTML here -->',
      caption: '',
    } as CustomHtmlData,
    styles: { bg: '#000000', scheme: 'dark' },
  },
  recommendations: {
    data: {
      eyebrow: 'A few things we noted',
      headline: 'Based on our conversations.',
      lede: 'Here are some observations from our discovery call that shaped this proposal.',
      items: [
        'Add your first observation here.',
        'Add another insight from the discovery call.',
      ],
    } as RecommendationsData,
    styles: {
      bg: '#000000',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
  table_of_contents: {
    data: {
      title: 'In this proposal',
      items: [],
    } as TableOfContentsData,
    styles: {
      bg: '#040D0B',
      accent: '#65F5C9',
      text: '#ffffff',
      scheme: 'dark',
    },
  },
};

// ============================================================
// Default template structure
// ============================================================
// Prodesk native colour palette (INK / PAPER / VOLT system)
// Each preset carries a blockRole so Apply Brand Kit maps correctly:
//   dark   → brandKit.darkColor  (deep, authoritative sections)
//   light  → brandKit.lightColor (open, readable sections)
//   accent → brandKit.accentColor (punchy CTA / stat sections)
const PRODESK_STYLES = {
  dark: {
    bg: '#0A0A0A',
    accent: '#D9F542',
    text: '#F4F1E8',
    textMuted: 'rgba(244,241,232,0.55)',
    border: 'rgba(217,245,66,0.15)',
    fontHeading: 'Inter Tight',
    fontBody: 'Inter Tight',
    scheme: 'dark' as const,
    blockRole: 'dark' as const,
  },
  light: {
    bg: '#F4F1E8',
    accent: '#D9F542',
    text: '#0A0A0A',
    textMuted: 'rgba(10,10,10,0.55)',
    border: 'rgba(10,10,10,0.1)',
    fontHeading: 'Inter Tight',
    fontBody: 'Inter Tight',
    scheme: 'light' as const,
    blockRole: 'light' as const,
  },
  accent: {
    bg: '#D9F542',
    accent: '#0A0A0A',
    text: '#0A0A0A',
    textMuted: 'rgba(10,10,10,0.65)',
    border: 'rgba(10,10,10,0.15)',
    fontHeading: 'Inter Tight',
    fontBody: 'Inter Tight',
    scheme: 'light' as const,
    blockRole: 'accent' as const,
  },
};

// Block types that should use the light background by default
const ALT_BLOCKS: BlockType[] = [
  'value_panels',
  'team_cards',
  'faq',
  'logo_strip',
  'process_steps',
];

export function createDefaultBlocks(opts?: {
  businessName?: string;
  proposalTitle?: string;
  clientName?: string;
  currency?: string;
}): Block[] {
  const hero = createBlock('hero');
  (hero.data as HeroData).metaItems = [
    { label: 'Prepared by', value: opts?.businessName ?? 'Your Business' },
    { label: 'Client', value: opts?.clientName ?? 'Client Name' },
    { label: 'Proposal', value: opts?.proposalTitle ?? 'New Proposal' },
    { label: 'Valid until', value: '30 days' },
  ];
  (hero.data as HeroData).headlineBottom = opts?.proposalTitle ?? 'engagement.';
  hero.styles = { ...hero.styles, ...PRODESK_STYLES.dark };

  const pricing = createBlock('pricing_table');
  (pricing.data as PricingTableData).currency = opts?.currency ?? 'AUD';
  pricing.styles = { ...pricing.styles, ...PRODESK_STYLES.dark };

  const blocks: Block[] = [
    hero,
    createBlock('value_panels'),
    pricing,
    createBlock('team_cards'),
    createBlock('roadmap'),
    createBlock('accept_pay'),
  ];

  // Apply Prodesk INK/PAPER colour rhythm to all blocks — with blockRole tags
  return blocks.map((b) => ({
    ...b,
    styles: {
      ...b.styles,
      ...(ALT_BLOCKS.includes(b.type)
        ? PRODESK_STYLES.light
        : PRODESK_STYLES.dark),
    },
  }));
  // Note: stat_bar and package_selector blocks should use PRODESK_STYLES.accent
  // when added manually — the block toolbar role toggle handles this.
}

// ============================================================
// Block metadata for the picker UI
// ============================================================
export const BLOCK_CATALOG: Array<{
  type: BlockType;
  label: string;
  description: string;
  icon: string;
  category: string;
  system?: boolean;
}> = [
  // Layout & Structure
  {
    type: 'hero',
    label: 'Hero',
    description: 'Full-bleed opening section with headline and meta row',
    icon: 'layout-template',
    category: 'Layout',
  },
  {
    type: 'text_block',
    label: 'Text Block',
    description: 'Eyebrow + large headline + lede paragraph',
    icon: 'type',
    category: 'Layout',
  },
  {
    type: 'value_panels',
    label: 'Value Panels',
    description: "3-column panel grid — great for 'why us' sections",
    icon: 'columns-3',
    category: 'Layout',
  },
  {
    type: 'stat_bar',
    label: 'Stat Bar',
    description: '3–4 big numbers with labels',
    icon: 'bar-chart-2',
    category: 'Layout',
  },
  {
    type: 'divider',
    label: 'Divider',
    description: 'Line or gradient section separator',
    icon: 'minus',
    category: 'Layout',
  },
  {
    type: 'spacer',
    label: 'Spacer',
    description: 'Controlled whitespace between sections',
    icon: 'move-vertical',
    category: 'Layout',
  },

  // Media
  {
    type: 'video',
    label: 'Video',
    description: 'Embed a Loom, YouTube, or Vimeo video',
    icon: 'play-circle',
    category: 'Media',
  },
  {
    type: 'image_banner',
    label: 'Image',
    description: 'Full-width image with optional caption',
    icon: 'image',
    category: 'Media',
  },
  {
    type: 'gallery',
    label: 'Gallery',
    description: '2–4 column image grid with lightbox',
    icon: 'grid-2x2',
    category: 'Media',
  },
  {
    type: 'embed',
    label: 'Embed',
    description: 'Calendly, Typeform, Google Maps, Figma — any iframe',
    icon: 'code-2',
    category: 'Media',
  },
  {
    type: 'custom_html',
    label: 'Custom HTML',
    description: 'Power-user escape hatch for anything else',
    icon: 'code',
    category: 'Media',
  },

  // Social Proof
  {
    type: 'testimonial',
    label: 'Testimonials',
    description: 'Client quotes with name, title, company',
    icon: 'message-square-quote',
    category: 'Social Proof',
  },
  {
    type: 'case_study',
    label: 'Case Study',
    description: 'Client logo + headline + 3 result stats',
    icon: 'trophy',
    category: 'Social Proof',
  },
  {
    type: 'logo_strip',
    label: 'Logo Strip',
    description: 'Row of past client logos',
    icon: 'building-2',
    category: 'Social Proof',
  },
  {
    type: 'guarantee',
    label: 'Guarantee',
    description: 'Bold promise with icon — removes risk',
    icon: 'shield-check',
    category: 'Social Proof',
  },

  // Pricing & Conversion
  {
    type: 'pricing_table',
    label: 'Pricing Table',
    description: 'Line items with totals and payment summary',
    icon: 'dollar-sign',
    category: 'Pricing',
  },
  {
    type: 'package_selector',
    label: 'Package Selector',
    description: 'Good / Better / Best tier cards — client selects',
    icon: 'layers',
    category: 'Pricing',
  },
  {
    type: 'comparison',
    label: 'Comparison Table',
    description: 'Without us / With us feature comparison',
    icon: 'table-2',
    category: 'Pricing',
  },
  {
    type: 'countdown',
    label: 'Countdown Timer',
    description: 'Live expiry countdown — creates urgency',
    icon: 'timer',
    category: 'Pricing',
  },

  // Process & Team
  {
    type: 'team_cards',
    label: 'Team Cards',
    description: '2-column team member cards with bio',
    icon: 'users',
    category: 'Team',
  },
  {
    type: 'roadmap',
    label: 'Roadmap',
    description: '4-column timeline / onboarding steps',
    icon: 'milestone',
    category: 'Team',
  },
  {
    type: 'process_steps',
    label: 'Process Steps',
    description: 'Numbered steps with icons — reduces anxiety',
    icon: 'list-ordered',
    category: 'Team',
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'Collapsible Q&A — kills objections',
    icon: 'help-circle',
    category: 'Team',
  },

  {
    type: 'table_of_contents',
    label: 'Table of Contents',
    description: 'Auto-generated anchor links from your proposal sections',
    icon: 'list',
    category: 'Layout',
  },
  // Personalisation
  {
    type: 'recommendations',
    label: 'Recommendations',
    description: 'Personalised dot-point insights from your discovery call',
    icon: 'lightbulb',
    category: 'Personalisation',
  },
  // Closing
  {
    type: 'signature',
    label: 'E-Signature',
    description: 'Client draws or types signature — legally binding',
    icon: 'pen-line',
    category: 'Closing',
  },
  {
    type: 'accept_pay',
    label: 'Accept & Pay',
    description: 'Payment section — always placed last',
    icon: 'credit-card',
    category: 'Closing',
    system: true,
  },
];

// ============================================================
// Theme system
// ============================================================
export interface ThemeConfig {
  id: string;
  label: string;
  description: string;
  colors: {
    bg: string; // primary background (dark sections)
    bgAlt: string; // alternate background (light sections)
    accent: string; // brand accent colour
    text: string; // primary text on dark bg
    textAlt: string; // primary text on light bg
    textMuted: string; // muted text on dark bg
    border: string; // border / divider colour
  };
  fonts: {
    heading: string; // Google Font name for headings
    body: string; // Google Font name for body
  };
  swatches: string[]; // 3 swatches shown in the picker
}

export const THEME_CONFIGS: Record<string, ThemeConfig> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    description: 'Dark, bold, tech-forward',
    colors: {
      bg: '#040D0B',
      bgAlt: '#0A1A16',
      accent: '#65F5C9',
      text: '#FFFFFF',
      textAlt: '#0A1A16',
      textMuted: 'rgba(255,255,255,0.55)',
      border: 'rgba(255,255,255,0.08)',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
    swatches: ['#040D0B', '#65F5C9', '#0A1A16'],
  },
  agency: {
    id: 'agency',
    label: 'Agency',
    description: 'Editorial serif, high contrast',
    colors: {
      bg: '#0A0A0A',
      bgAlt: '#F5F0E8',
      accent: '#C6F135',
      text: '#FFFFFF',
      textAlt: '#0A0A0A',
      textMuted: 'rgba(255,255,255,0.5)',
      border: 'rgba(255,255,255,0.1)',
    },
    fonts: { heading: 'Playfair Display', body: 'DM Sans' },
    swatches: ['#0A0A0A', '#C6F135', '#0A0A0A'],
  },
  luxury: {
    id: 'luxury',
    label: 'Luxury',
    description: 'Refined, warm, elegant',
    colors: {
      bg: '#1A1410',
      bgAlt: '#F9F5EF',
      accent: '#C9A96E',
      text: '#F5EFE6',
      textAlt: '#1A1410',
      textMuted: 'rgba(245,239,230,0.55)',
      border: 'rgba(201,169,110,0.2)',
    },
    fonts: { heading: 'Cormorant Garamond', body: 'Jost' },
    swatches: ['#1A1410', '#C9A96E', '#1A1410'],
  },
  solar: {
    id: 'solar',
    label: 'Solar',
    description: 'Energetic orange, clean sans',
    colors: {
      bg: '#0F0A00',
      bgAlt: '#FFF8F0',
      accent: '#FF6B35',
      text: '#FFFFFF',
      textAlt: '#0F0A00',
      textMuted: 'rgba(255,255,255,0.55)',
      border: 'rgba(255,107,53,0.2)',
    },
    fonts: { heading: 'Outfit', body: 'Outfit' },
    swatches: ['#0F0A00', '#FF6B35', '#0F0A00'],
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    description: 'Deep blue, calm, professional',
    colors: {
      bg: '#050D1A',
      bgAlt: '#EEF4FB',
      accent: '#5BA4E5',
      text: '#FFFFFF',
      textAlt: '#050D1A',
      textMuted: 'rgba(255,255,255,0.55)',
      border: 'rgba(91,164,229,0.2)',
    },
    fonts: { heading: 'Sora', body: 'Sora' },
    swatches: ['#050D1A', '#5BA4E5', '#050D1A'],
  },
  brand: {
    id: 'brand',
    label: 'Brand',
    description: 'Uses your Brand Kit colours and fonts',
    colors: {
      bg: '#0E0E0C',
      bgAlt: '#1A1A17',
      accent: '#D9F542',
      text: '#F4F1E8',
      textAlt: '#0E0E0C',
      textMuted: 'rgba(244,241,232,0.55)',
      border: 'rgba(217,245,66,0.15)',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
    swatches: ['#0E0E0C', '#D9F542', '#1A1A17'],
  },
};

/**
 * Apply a theme to all blocks in a template.
 * Sets bg, accent, text, fontHeading, fontBody on every block's styles.
 * Alternates between bg and bgAlt for visual rhythm.
 */
export function applyThemeToBlocks(blocks: Block[], themeId: string): Block[] {
  const theme = THEME_CONFIGS[themeId];
  if (!theme) return blocks;
  const { colors, fonts } = theme;
  // Blocks that should use the alternate (light) background
  const lightBlocks: BlockType[] = [
    'value_panels',
    'team_cards',
    'faq',
    'logo_strip',
    'process_steps',
  ];
  return blocks.map((block) => {
    const useLightBg = lightBlocks.includes(block.type);
    const bg = useLightBg ? colors.bgAlt : colors.bg;
    const text = useLightBg ? colors.textAlt : colors.text;
    const textMuted = useLightBg ? `${colors.textAlt}99` : colors.textMuted;
    return {
      ...block,
      styles: {
        ...block.styles,
        bg,
        accent: colors.accent,
        text,
        textMuted,
        fontHeading: fonts.heading,
        fontBody: fonts.body,
        border: colors.border,
        scheme: useLightBg ? 'light' : 'dark',
      },
    };
  });
}

/**
 * Load Google Fonts for a theme into the document head.
 */
export function loadThemeFonts(themeId: string) {
  const theme = THEME_CONFIGS[themeId];
  if (!theme) return;
  const fonts = Array.from(new Set([theme.fonts.heading, theme.fonts.body]));
  fonts.forEach((font) => {
    const id = `gfont-${font.replace(/\s+/g, '-').toLowerCase()}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@300;400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
  });
}

// ─── Brand Kit types ──────────────────────────────────────────────────────────
export interface BrandKit {
  primaryColor?: string | null;
  accentColor?: string | null;
  accentColor2?: string | null; // 3rd / tertiary accent colour
  backgroundColor?: string | null;
  textColor?: string | null;
  /** Explicit dark role colour (e.g. INK #0A0A0A) — used for 'dark' blockRole sections */
  darkColor?: string | null;
  /** Explicit light role colour (e.g. PAPER #F4F1E8) — used for 'light' blockRole sections */
  lightColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
  logoLightUrl?: string | null;
  logoDarkUrl?: string | null;
  heroImageUrl?: string | null;
  defaultIntroCopy?: string | null;
  defaultNextStepsCopy?: string | null;
  defaultTermsUrl?: string | null;
}

/**
 * Compute the WCAG contrast ratio between two hex colours.
 * Returns a value between 1 (no contrast) and 21 (maximum contrast).
 */
function contrastRatio(hex1: string, hex2: string): number {
  function lum(hex: string): number {
    const c = hex.replace('#', '');
    if (c.length < 6) return 0;
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    const toLinear = (v: number) =>
      v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }
  const l1 = lum(hex1),
    l2 = lum(hex2);
  const lighter = Math.max(l1, l2),
    darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Resolve the best foreground accent colour for a given background.
 * If the accent colour has insufficient contrast on the bg (< 3.0),
 * fall back to the dark role colour which is guaranteed to be legible.
 * This handles cases like VOLT #D9F542 on PAPER #F4F1E8 — nearly invisible.
 */
function resolveAccentOnBg(
  accent: string,
  bg: string,
  darkFallback: string,
): string {
  return contrastRatio(accent, bg) >= 3.0 ? accent : darkFallback;
}

/**
 * Apply a brand kit to all blocks in a proposal.
 *
 * Role-based colour mapping:
 *   blockRole 'dark'   → brandKit.darkColor   (deep, authoritative bg)
 *   blockRole 'light'  → brandKit.lightColor  (open, readable bg)
 *   blockRole 'accent' → brandKit.accentColor (punchy CTA / stat bg)
 *
 * If a block has no explicit blockRole, the role is inferred from the
 * current bg luminance so existing templates still work correctly.
 *
 * Fonts are updated across all blocks regardless of role.
 *
 * Smart accent legibility: on light backgrounds, if the accent colour
 * has a contrast ratio < 3.0 against the bg, the dark colour is used
 * for small text/borders instead — preserving legibility without losing
 * the brand accent at large display sizes.
 */
export function applyBrandKitToBlocks(
  blocks: Block[],
  brandKit: BrandKit,
): Block[] {
  const fallback = THEME_CONFIGS['midnight'];

  // Resolve the three role colours — prefer explicit dark/light fields,
  // fall back to primaryColor / backgroundColor for backwards compatibility.
  const darkBg =
    brandKit.darkColor ?? brandKit.primaryColor ?? fallback.colors.bg;
  const lightBg =
    brandKit.lightColor ?? brandKit.backgroundColor ?? fallback.colors.bgAlt;
  const accentBg = brandKit.accentColor ?? fallback.colors.accent;
  const headingFont = brandKit.headingFont ?? fallback.fonts.heading;
  const bodyFont = brandKit.bodyFont ?? fallback.fonts.body;

  // Derived text colours for each role background
  const darkText = isLightColor(darkBg) ? '#0A0A0A' : '#FFFFFF';
  const lightText = isLightColor(lightBg) ? '#0A0A0A' : '#FFFFFF';
  // Accent bg text: the accent is often a vivid colour — derive text from its luminance
  const accentText = isLightColor(accentBg) ? '#0A0A0A' : '#FFFFFF';

  // Border colours derived from each bg
  const darkBorder = isLightColor(darkBg)
    ? 'rgba(0,0,0,0.1)'
    : 'rgba(255,255,255,0.1)';
  const lightBorder = isLightColor(lightBg)
    ? 'rgba(0,0,0,0.1)'
    : 'rgba(255,255,255,0.1)';
  const accentBorder = isLightColor(accentBg)
    ? 'rgba(0,0,0,0.15)'
    : 'rgba(255,255,255,0.2)';

  // On light backgrounds the accent may not have enough contrast at small sizes.
  // Resolve a safe small-text accent that is always legible.
  const accentOnLight = resolveAccentOnBg(accentBg, lightBg, darkBg);
  const accentOnDark = resolveAccentOnBg(accentBg, darkBg, lightBg);
  const accentOnAccent = resolveAccentOnBg(darkBg, accentBg, lightBg);

  return blocks.map((block) => {
    // Determine the block's colour role:
    // 1. Use explicit blockRole if set (most reliable — set by editor toggle or seed script)
    // 2. Infer from current bg luminance for backwards compatibility
    let role: 'dark' | 'light' | 'accent' = block.styles?.blockRole ?? 'dark';
    if (!block.styles?.blockRole) {
      const currentBg = block.styles?.bg ?? darkBg;
      // Detect accent blocks by checking if the current bg is close to the accent colour
      const isAccentBlock = contrastRatio(currentBg, accentBg) < 1.5;
      if (isAccentBlock) {
        role = 'accent';
      } else {
        role = isLightColor(currentBg) ? 'light' : 'dark';
      }
    }

    let blockBg: string,
      blockText: string,
      blockBorder: string,
      blockAccent: string,
      blockTextMuted: string;
    if (role === 'light') {
      blockBg = lightBg;
      blockText = lightText;
      blockBorder = lightBorder;
      // On light bg: use the smart accent (falls back to dark if contrast is too low)
      blockAccent = accentOnLight;
      blockTextMuted = isLightColor(lightBg)
        ? 'rgba(0,0,0,0.55)'
        : 'rgba(255,255,255,0.55)';
    } else if (role === 'accent') {
      blockBg = accentBg;
      blockText = accentText;
      blockBorder = accentBorder;
      blockAccent = accentOnAccent;
      blockTextMuted = isLightColor(accentBg)
        ? 'rgba(0,0,0,0.55)'
        : 'rgba(255,255,255,0.55)';
    } else {
      // dark (default)
      blockBg = darkBg;
      blockText = darkText;
      blockBorder = darkBorder;
      blockAccent = accentOnDark;
      blockTextMuted = isLightColor(darkBg)
        ? 'rgba(0,0,0,0.55)'
        : 'rgba(255,255,255,0.55)';
    }

    return {
      ...block,
      styles: {
        ...block.styles,
        bg: blockBg,
        accent: blockAccent,
        text: blockText,
        textMuted: blockTextMuted,
        fontHeading: headingFont,
        fontBody: bodyFont,
        border: blockBorder,
        scheme: isLightColor(blockBg) ? 'light' : 'dark',
        blockRole: role,
      },
    };
  });
}

/** Load Google Fonts for a brand kit into the document head. */
export function loadBrandKitFonts(brandKit: BrandKit) {
  const fonts = Array.from(
    new Set(
      [brandKit.headingFont, brandKit.bodyFont].filter(Boolean) as string[],
    ),
  );
  fonts.forEach((font) => {
    const id = `gfont-${font.replace(/\s+/g, '-').toLowerCase()}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font)}:wght@300;400;500;600;700;800&display=swap`;
    document.head.appendChild(link);
  });
}

/** Simple luminance check — returns true if the colour is light (>50% perceived brightness). */
function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '');
  if (c.length < 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Perceived luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5;
}

export function lighten(hex: string, amount: number): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const r = Math.min(
    255,
    Math.round(parseInt(c.slice(0, 2), 16) + 255 * amount),
  );
  const g = Math.min(
    255,
    Math.round(parseInt(c.slice(2, 4), 16) + 255 * amount),
  );
  const b = Math.min(
    255,
    Math.round(parseInt(c.slice(4, 6), 16) + 255 * amount),
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function darken(hex: string, amount: number): string {
  const c = hex.replace('#', '');
  if (c.length < 6) return hex;
  const r = Math.max(0, Math.round(parseInt(c.slice(0, 2), 16) - 255 * amount));
  const g = Math.max(0, Math.round(parseInt(c.slice(2, 4), 16) - 255 * amount));
  const b = Math.max(0, Math.round(parseInt(c.slice(4, 6), 16) - 255 * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
