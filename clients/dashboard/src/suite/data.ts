/* Prodesk Suite — mock data (ported from the design's app/data.js).
   Australian businesses, AUD. Everything app-facing is brand-scoped; the vendor
   and brand list sit above brands. Module exports replace the design's window.* globals. */

import { PRODESK_ORIGINS } from '@shared/lib/origins';

/**
 * Apps that live in their own standalone frontends rather than as in-suite
 * screens (hosts from @shared/lib/origins). Clicks and deep links to /app/<id>
 * open them in the dashboard's AppModal, an iframe over the page (SuiteApp.openApp,
 * overlays AppModal). Either way, when the target frontend is hosted on a
 * different domain the session is carried across via a one-time hand-off
 * token (see @shared/auth/use-cross-app).
 */
export const CROSS_APP_HOSTS: Record<string, string | undefined> = {
  'url-qr': PRODESK_ORIGINS.links, // Links & QR → Links/Adeyy frontend
  quotes: PRODESK_ORIGINS.payments, // Quick quotes → Payments/EziQuotes frontend
  reviews: PRODESK_ORIGINS.reviews, // Customer reviews → Reviews/Verdiict frontend
  signatures: PRODESK_ORIGINS.signatures, // Email signatures → Signatures/SIGKITT frontend
  logo: PRODESK_ORIGINS.logo, // Logo Studio → Logo frontend (brand-genesis engine)
};

export interface Brand {
  id: string;
  name: string;
  mono: string;
  shape: 'rich' | 'small' | 'new';
  peer?: string;
  type: string;
  colour: string;
  status: Record<string, string>;
  /** The brand's uploaded logo (brands.logoUrl), shown in place of the mono mark when set. */
  logo?: string;
  /** The brand's dedicated AI assistant thread (brands.chatbotThreadId). Null for
   *  legacy brands created before the AI thread feature — ensured on demand. */
  chatbotThreadId?: string | null;
  /** The brand's derived "shadow" agency (brands.derivedToAgencyId). Services the
   *  brand publishes are created under this agency. Null until the brand has one
   *  (auto-created on brand creation; backfilled for older brands). */
  derivedAgencyId?: string | null;
}

export interface SuiteApp {
  id: string;
  group: string;
  kind: 'source' | 'surface' | 'service';
  name: string;
  icon?: string;
  tool?: string;
  tag: string;
  tags?: string[];
  brand?: string;
  href?: string;
  build?: boolean;
  pulls?: string[];
  logo?: string;
  dot?: string;
  stage?: string;
  agencyOnly?: boolean;
  comingSoon?: boolean;
}

export interface Vendor {
  name: string;
  initials: string;
  email: string;
  plan: string;
  team: number;
  /** The user's profile photo (users.profileUrl), shown in place of initials when set. */
  profileUrl?: string;
}

export interface PersonalApp {
  id: string;
  name: string;
  icon: string;
  tag: string;
  meta?: string;
  live: boolean;
  brand?: string;
  href?: string;
}

export const VENDOR: Vendor = {
  name: 'Marcus Webb',
  initials: 'MW',
  email: 'marcus@webbgroup.com.au',
  plan: 'Studio plan',
  team: 4,
};

export const PERSONAL: {
  person: { name: string; initials: string };
  apps: PersonalApp[];
} = {
  person: { name: 'Marcus Webb', initials: 'MW' },
  apps: [
    {
      id: 'aggyl',
      name: 'Aggyl',
      icon: 'sparkle',
      tag: 'What to work on next, across every business',
      meta: '3 issued tasks',
      live: true,
      brand: 'Aggyl',
    },
    {
      id: 'p-inbox',
      name: 'Inbox',
      icon: 'email',
      tag: 'Tasks issued to you from every brand',
      meta: '3 new',
      live: true,
    },
    {
      id: 'p-pay',
      name: 'Pay',
      icon: 'billing',
      tag: "What you've earned across your work",
      meta: '$2,140 due',
      live: true,
    },
    {
      id: 'p-cal',
      name: 'Calendar',
      icon: 'calendar',
      tag: 'Your week, every commitment in one place',
      meta: 'Phase 2',
      live: false,
    },
    {
      id: 'p-wallet',
      name: 'Wallet',
      icon: 'billing',
      tag: 'Your money, across businesses',
      meta: 'Phase 2',
      live: false,
    },
    {
      id: 'p-cpd',
      name: 'Training',
      icon: 'advice',
      tag: 'CPD and training, tracked',
      meta: 'Phase 2',
      live: false,
    },
  ],
};

export const APPS: SuiteApp[] = [
  // ===== Your record (sources of truth) =====
  {
    id: 'strategy',
    group: 'Your record',
    kind: 'source',
    name: 'Growth strategy',
    icon: 'strategy',
    tool: 'strategy',
    tag: 'Your AI growth plan — generate, edit and run with it',
    tags: ['Manage'],
  },
  {
    id: 'brand-hub',
    group: 'Your record',
    kind: 'source',
    name: 'Brand kit',
    icon: 'brand',
    tool: 'brand',
    tag: 'Logo, colours, type and voice — used everywhere you appear',
    tags: ['Content'],
  },
  {
    id: 'product-hub',
    group: 'Your record',
    kind: 'source',
    name: 'Services',
    icon: 'product',
    tool: 'products',
    tag: 'Every service you sell, in one catalogue. Drops into quotes, proposals, print',
    tags: ['Sales', 'Manage'],
  },
  {
    id: 'people',
    group: 'Your record',
    kind: 'source',
    name: 'Team & people',
    icon: 'team',
    tool: 'people',
    tag: 'Everyone in the business — names, roles, details',
    tags: ['Manage'],
  },
  {
    id: 'info-hub',
    group: 'Your record',
    kind: 'source',
    name: 'Company info',
    icon: 'building',
    tool: 'company',
    tag: 'ABN, addresses, hours, policies — the facts everything pulls from',
    tags: ['Manage'],
  },
  {
    id: 'documents',
    group: 'Your record',
    kind: 'source',
    name: 'Docs & files',
    icon: 'document',
    tool: 'documents',
    tag: 'Signed contracts, T&Cs and SOWs — the canonical store',
    tags: ['Manage'],
    comingSoon: true,
  },
  {
    id: 'dam',
    group: 'Your record',
    kind: 'source',
    name: 'Files & assets',
    icon: 'dam',
    tool: 'files',
    tag: 'Every file, once. Reuse anywhere — or send to print',
    tags: ['Content', 'Manage'],
  },
  {
    id: 'password-hub',
    group: 'Your record',
    kind: 'source',
    name: 'Password vault',
    icon: 'password',
    tool: 'passwords',
    brand: 'Keymastr',
    tag: "A secure vault for the business's credentials",
    tags: ['Manage'],
    comingSoon: true,
  },

  // ===== Create & send (surfaces) =====
  {
    id: 'proposals',
    group: 'Create & send',
    kind: 'surface',
    name: 'Proposals',
    icon: 'proposals',
    tool: 'proposals',
    brand: 'Strategistic',
    tag: 'Send, sign and get paid',
    tags: ['Sales', 'Clients'],
    pulls: ['product-hub', 'people', 'brand-hub', 'documents'],
    comingSoon: true,
  },
  {
    id: 'quotes',
    group: 'Create & send',
    kind: 'surface',
    name: 'Quick quotes',
    icon: 'proposals',
    tool: 'links',
    brand: 'Eziquotes',
    tag: 'Fast, itemised quotes — priced straight from your catalogue',
    tags: ['Sales', 'Clients'],
    pulls: ['product-hub', 'brand-hub'],
  },
  {
    id: 'logo',
    group: 'Create & send',
    kind: 'surface',
    name: 'Logo Studio',
    icon: 'sparkle',
    tool: 'brand',
    tag: 'AI logo builder — one mark, then a whole identity your other tools inherit',
    tags: ['Content', 'Marketing'],
    pulls: ['brand-hub'],
  },
  {
    id: 'signatures',
    group: 'Create & send',
    kind: 'surface',
    name: 'Email signatures',
    icon: 'signature',
    tool: 'signatures',
    brand: 'Sigkitt',
    tag: 'Email signatures, built from People and Brand',
    tags: ['Content'],
    pulls: ['people', 'brand-hub'],
  },
  {
    id: 'printing',
    group: 'Create & send',
    kind: 'surface',
    name: 'Print Shop',
    icon: 'printer',
    tool: 'print',
    tag: 'Business cards, brochures and more — auto-filled from your record',
    tags: ['Marketing', 'Content'],
    pulls: ['people', 'brand-hub', 'dam'],
  },
  {
    id: 'url-qr',
    group: 'Create & send',
    kind: 'surface',
    name: 'Links & QR',
    icon: 'qr',
    tool: 'crm',
    brand: 'Adeyy',
    tag: 'Short links and QR codes in your brand colours — print once, change forever',
    tags: ['Marketing'],
    pulls: ['brand-hub'],
  },
  {
    id: 'ooh',
    group: 'Create & send',
    kind: 'surface',
    name: 'Media buying',
    icon: 'ooh',
    tool: 'ooh',
    brand: 'Adwyre',
    tag: 'Book ads yourself — OOH, TV, radio and print, all in one place',
    tags: ['Marketing', 'Advertise'],
    pulls: ['brand-hub', 'documents'],
  },
  {
    id: 'downsizer',
    group: 'Create & send',
    kind: 'surface',
    name: 'Resize & convert',
    icon: 'image',
    tool: 'resize',
    tag: 'Resize, upscale and convert files in seconds',
    tags: ['Content'],
    pulls: ['dam'],
    comingSoon: true,
  },

  // ===== Grow & connect (surfaces) =====
  {
    id: 'crm',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Sales CRM',
    icon: 'crm',
    tool: 'crm',
    tag: 'Contacts and pipeline',
    tags: ['Sales', 'Clients', 'Manage'],
    pulls: ['people'],
    comingSoon: true,
  },
  {
    id: 'reviews',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Customer reviews',
    icon: 'reviews',
    tool: 'reviews',
    brand: 'Verdiict',
    tag: 'Ask for the verdiict at checkout — collect and reply to reviews',
    tags: ['Clients', 'Marketing'],
    pulls: ['brand-hub'],
  },
  {
    id: 'raated',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Ratings score',
    icon: 'raated',
    tool: 'raated',
    brand: 'Raated',
    tag: 'Every rating, every channel — one score out of 100',
    tags: ['Clients', 'Marketing'],
    pulls: ['brand-hub'],
  },
  {
    id: 'meeting-booker',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Bookings',
    icon: 'calendar',
    tool: 'bookings',
    tag: 'Share availability and take bookings',
    tags: ['Clients', 'Sales'],
    pulls: ['people', 'brand-hub'],
  },
  {
    id: 'talent',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Labour hire',
    icon: 'talent',
    tool: 'fractional',
    tag: 'Engage a fractional marketer, designer or copywriter — ongoing',
    tags: ['Manage', 'Marketing'],
    pulls: [],
    comingSoon: true,
  },
  {
    id: 'advice',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Expert advice',
    icon: 'advice',
    tool: 'advice',
    tag: 'Guidance when you need it',
    tags: ['Manage'],
    pulls: [],
    comingSoon: true,
  },
  {
    id: 'aggyl-pm',
    group: 'Grow & connect',
    kind: 'surface',
    name: 'Project management',
    icon: 'tasks',
    tool: 'email',
    brand: 'Aggyl',
    tag: "Agile projects, roadmaps and tasks — issued straight to each person's Aggyl",
    tags: ['Manage'],
    pulls: ['people'],
  },

  // ===== Specialists =====
  {
    id: 'mentiis',
    group: 'Specialists',
    kind: 'service',
    name: 'Corporate advisory',
    brand: 'Mentiis',
    dot: '#5aa916',
    stage: 'Incubate · Facilitate',
    tag: 'Corporate advisory — strategy, capital raising, M&A and restructuring',
    tags: ['Manage'],
  },
  {
    id: 'zilophone',
    group: 'Specialists',
    kind: 'service',
    name: 'Phone systems',
    brand: 'Zilophone',
    dot: '#37c6d8',
    stage: 'Incubate',
    tag: 'Telecoms — 1300 numbers, IVR, cloud telephony and infrastructure',
    tags: ['Manage'],
  },
  {
    id: 'dmayn',
    group: 'Specialists',
    kind: 'service',
    name: 'Domain names',
    brand: 'Dmayn',
    dot: '#0e3a5f',
    stage: 'Incubate',
    tag: 'Register domains and buy premium curated names — a white-label registrar',
    tags: ['Manage'],
  },
  {
    id: 'sccrol',
    group: 'Specialists',
    kind: 'service',
    name: 'Web & apps',
    brand: 'Sccrol',
    agencyOnly: true,
    dot: '#2e3a3f',
    stage: 'Create',
    tag: 'Web, app and digital product builds — with an AI agent for editing',
    tags: ['Content'],
  },
  {
    id: 'fllrt',
    group: 'Specialists',
    kind: 'service',
    name: 'Public relations',
    brand: 'Fllrt',
    dot: '#f76b6b',
    stage: 'Accelerate',
    tag: 'Public relations — craft angles, develop a release, send it via PR Newswire',
    tags: ['Marketing'],
  },
  {
    id: 'whunda',
    group: 'Specialists',
    kind: 'service',
    name: 'Digital marketing',
    brand: 'Whunda',
    dot: '#f47b3c',
    stage: 'Accelerate',
    tag: 'Digital marketing — search, social, paid and organic growth',
    tags: ['Marketing', 'Advertise'],
    comingSoon: true,
  },
  {
    id: 'fylmr',
    group: 'Specialists',
    kind: 'service',
    name: 'Film & photo',
    brand: 'Fylmr',
    dot: '#141414',
    stage: 'Create',
    tag: 'Hire camera operators and photographers worldwide — film and photo',
    tags: ['Content'],
  },
  {
    id: 'fuyse',
    group: 'Specialists',
    kind: 'service',
    name: 'Software dev',
    brand: 'Fuyse',
    dot: '#3b5bdb',
    stage: 'Create',
    tag: 'Advanced software engineering and complex application builds',
    tags: ['Content'],
  },
  {
    id: 'cnxon',
    group: 'Specialists',
    kind: 'service',
    name: 'Automation',
    brand: 'Cnxon',
    dot: '#8fb0a3',
    stage: 'Create · Operate',
    tag: 'Business automation, SaaS management and workflow integration',
    tags: ['Manage'],
  },
  {
    id: 'sellx',
    group: 'Specialists',
    kind: 'service',
    name: 'Sales & BD',
    brand: 'Sellx',
    dot: '#e8252d',
    stage: 'Accelerate',
    tag: 'Sales and business development — outbound, direct and strategy',
    tags: ['Sales'],
  },
  {
    id: 'xppoz',
    group: 'Specialists',
    kind: 'service',
    name: 'Events',
    brand: 'Xppoz',
    dot: '#4a2f6b',
    stage: 'Motivate',
    tag: 'Functions and events — activations and experiential marketing',
    tags: ['Marketing'],
  },
  {
    id: 'entayn',
    group: 'Specialists',
    kind: 'service',
    name: 'Memberships',
    brand: 'Entayn',
    dot: '#7fa8e8',
    stage: 'Motivate',
    tag: 'Memberships, competitions, incentives, influencer and affiliate',
    tags: ['Marketing', 'Clients'],
  },
  {
    id: 'paakr',
    group: 'Specialists',
    kind: 'service',
    name: 'Logistics',
    brand: 'Paakr',
    dot: '#4a5560',
    stage: 'Operate',
    tag: '3PL and logistics — warehousing, fulfilment and supply chain',
    tags: ['Manage'],
  },
  {
    id: 'sqeze',
    group: 'Specialists',
    kind: 'service',
    name: 'Bookkeeping',
    brand: 'Sqeze',
    dot: '#e6c200',
    stage: 'Operate · Evaluate',
    tag: 'Bookkeeping, financial reporting and business health monitoring',
    tags: ['Manage'],
    comingSoon: true,
  },
  {
    id: 'servint',
    group: 'Specialists',
    kind: 'service',
    name: 'HR & recruiting',
    brand: 'Servint',
    dot: '#cf9ae0',
    stage: 'Operate',
    tag: 'HR and recruitment — workforce planning, people ops and templates',
    tags: ['Manage'],
    comingSoon: true,
  },
];

export const GROUPS = [
  'Your record',
  'Create & send',
  'Grow & connect',
  'Specialists',
];

export const TAGS = [
  'Marketing',
  'Social',
  'Advertise',
  'Sales',
  'Clients',
  'Content',
  'Manage',
];

export const ENTITLEMENTS: Record<string, string[]> = {
  full: APPS.map((a) => a.id),
  mixed: APPS.filter(
    (a) => !['promotion', 'social', 'advice', 'printing'].includes(a.id),
  ).map((a) => a.id),
};

export const BRANDS: Brand[] = [
  {
    id: 'coastline',
    name: 'Coastline Coffee Co.',
    mono: 'CC',
    shape: 'rich',
    peer: 'cafe',
    type: 'Roastery & cafe group',
    colour: '#1f6f54',
    status: {
      proposals: '3 awaiting payment',
      'meeting-booker': '2 today',
      reviews: '12 new',
      raated: 'Raated 94.2',
      crm: '48 contacts',
      'product-hub': '8 services',
      social: '4 scheduled',
      'password-hub': '18 entries',
      people: '8 people',
      signatures: '8 sets',
      documents: '6 docs',
      printing: '1 in production',
    },
  },
  {
    id: 'mornington',
    name: 'Mornington Joinery',
    mono: 'MJ',
    shape: 'small',
    peer: 'trade',
    type: 'Custom cabinetry',
    colour: '#7a4a22',
    status: {
      proposals: '1 draft',
      crm: '9 contacts',
      'product-hub': '4 services',
    },
  },
  {
    id: 'harbourvine',
    name: 'Harbour & Vine',
    mono: 'HV',
    shape: 'new',
    type: 'Wine bar (new)',
    colour: '#5b2a3e',
    status: {},
  },
  {
    id: 'baysidepilates',
    name: 'Bayside Pilates',
    mono: 'BP',
    shape: 'rich',
    peer: 'studio',
    type: 'Studio & classes',
    colour: '#2b5f7a',
    status: {
      'meeting-booker': '6 today',
      reviews: '4 new',
      raated: 'Raated 96.0',
      crm: '212 contacts',
      social: '9 scheduled',
      proposals: '2 awaiting payment',
    },
  },
  {
    id: 'otway',
    name: 'Otway Outfitters',
    mono: 'OO',
    shape: 'small',
    type: 'Outdoor retail',
    colour: '#3c5a2e',
    status: {
      'product-hub': '84 services',
      reviews: '1 new',
      crm: '31 contacts',
    },
  },
  {
    id: 'norse',
    name: 'Norse & Co Barbers',
    mono: 'NC',
    shape: 'rich',
    type: 'Barbershop group',
    colour: '#33424a',
    status: {
      'meeting-booker': '11 today',
      reviews: '8 new',
      raated: 'Raated 92.4',
      crm: '164 contacts',
      social: '2 scheduled',
    },
  },
  {
    id: 'yarra',
    name: 'Yarra Valley Cellars',
    mono: 'YV',
    shape: 'rich',
    type: 'Winery & cellar door',
    colour: '#5a1f2b',
    status: {
      'product-hub': '52 services',
      crm: '97 contacts',
      proposals: '1 awaiting payment',
      reviews: '21 new',
    },
  },
  {
    id: 'pinnacle',
    name: 'Pinnacle Plumbing',
    mono: 'PP',
    shape: 'small',
    peer: 'trade',
    type: 'Trades & maintenance',
    colour: '#2d4f6b',
    status: {
      crm: '58 contacts',
      proposals: '4 awaiting payment',
      'meeting-booker': '2 today',
    },
  },
  {
    id: 'driftwood',
    name: 'Driftwood Surf School',
    mono: 'DW',
    shape: 'new',
    type: 'Lessons & hire (new)',
    colour: '#1c7a8c',
    status: {},
  },
];

export const DEFAULT_BRAND_ID = 'coastline';

export const ASK_SUGGESTIONS: {
  q: string;
  answer: (b: Brand) => { text: string; appId: string; cta: string };
}[] = [
  {
    q: 'How do I bring in more customers?',
    answer: (b) => ({
      text: `Start with who already knows you. Email your ${b.status.crm || 'contacts'} a short update, then keep a standing offer running so there's always a reason to come back.`,
      appId: 'crm',
      cta: 'Start an email',
    }),
  },
  {
    q: 'What should I focus on this week?',
    answer: () => ({
      text: `Reply to anything waiting on you, send one email to your list, and line up your posts. Small, consistent moves beat big one-offs.`,
      appId: 'reviews',
      cta: 'Open Social',
    }),
  },
  {
    q: 'Where am I leaving money on the table?',
    answer: (b) => ({
      text: `${b.status.proposals ? `You have ${b.status.proposals} — chase them first. ` : ''}Then check who's bought from you but isn't on your email list, and bring them across.`,
      appId: 'proposals',
      cta: 'Open Proposals',
    }),
  },
];

export const APP_BLURBS: Record<string, string> = {
  strategy:
    'Your growth strategy, generated once by AI from everything in your record — your brand, products, people, numbers and how you compare to businesses like you. A clear plan with the moves that matter, in order.',
  'brand-hub':
    'The single source for your brand — logo, colours, type and voice. Set it once and every proposal, signature, post and print job pulls from it.',
  'product-hub':
    'Every service you sell, in one catalogue — names, types and prices. A price is changed once here and quotes, proposals, promotions and print all read it live.',
  quotes:
    'Fast, itemised quotes priced straight from your catalogue. For the quick number a client needs today.',
  'info-hub':
    "Your company's facts in one place — ABN, addresses, hours and policies. Pulled into everything you send.",
  documents:
    'The canonical store for signed contracts, agreements, T&Cs and SOWs. One place to find the latest signed version.',
  'password-hub':
    "A secure vault for the business's credentials. Reveal and copy when you need them, scoped to this brand only.",
  people:
    'Everyone in the business — names, positions and contact details, in one place. Signatures, proposals, bookings and business cards all read from here.',
  signatures:
    'Email signatures, built from People and Brand. Pick a person and a signature is ready in their details and your colours.',
  'url-qr':
    'Make short links and QR codes for anything, on-brand, with a history of everything you have generated.',
  ooh: 'Book advertising across every channel yourself — out-of-home, TV, radio and print. Pick what you want and book, no media buyer needed.',
  reviews:
    "Collect and reply to the brand's reviews, and request new ones, all in one feed.",
  raated:
    'Every rating you have, from every channel, rolled into a single Raated score out of 100.',
  proposals:
    'Send proposals the payer can sign and pay in one go, then track them through to paid. Priced from your Services catalogue.',
  'meeting-booker':
    "Share a booking link, manage availability, and see the brand's upcoming meetings at a glance.",
  crm: "Track the brand's contacts and pipeline: who they are, where they are, and when you last spoke.",
  downsizer:
    'Downsize, upscale and convert PDFs and images in seconds, with a history of everything you have processed.',
  printing:
    'Order business cards, brochures and more. Templates auto-fill from People, Brand and Files.',
  talent:
    'Engage fractional talent on an ongoing basis — a part-time marketer, designer, copywriter or strategist who works like an embedded team member.',
  advice:
    'Get tailored guidance on running the brand, and keep a record of every advice session.',
  'aggyl-pm':
    "Agile projects, roadmaps and tasks — issued straight to each person's Aggyl.",
};

/* ===== Wordmark tiles — each app's coloured "app icon" ===== */
export const TILE_BG: Record<string, string> = {
  strategy: '#0E0E0C',
  'brand-hub': '#d200fe',
  'product-hub': '#22b14c',
  people: '#18cee6',
  'info-hub': '#4b67d8',
  documents: '#c98a2b',
  dam: '#ccba14',
  'password-hub': '#336dfe',
  proposals: '#09d982',
  quotes: '#04d5b0',
  logo: '#ff5227',
  signatures: '#6e5afe',
  printing: '#ff0e62',
  'url-qr': '#12c5fe',
  ooh: '#ff069c',
  downsizer: '#e7ad01',
  crm: '#1aa3c9',
  reviews: '#fe9b03',
  raated: '#e8252d',
  'meeting-booker': '#9938fe',
  talent: '#13d1cd',
  advice: '#ff0cde',
  'aggyl-pm': '#9bbf00',
  aggyl: '#9bbf00',
};
export const TILE_WM: Record<string, string> = {
  strategy: 'Strategy',
  'brand-hub': 'Brand',
  'product-hub': 'Services',
  people: 'People',
  'info-hub': 'Company',
  documents: 'Locker',
  dam: 'Files',
  'password-hub': 'Keymastr',
  proposals: 'Strategistic',
  quotes: 'Eziquotes',
  logo: 'Logo',
  signatures: 'Sigkitt',
  printing: 'Print',
  'url-qr': 'Adeyy',
  ooh: 'Adwyre',
  downsizer: 'Resize',
  crm: 'CRM',
  reviews: 'Verdiict',
  raated: 'Raated',
  'meeting-booker': 'Bookings',
  talent: 'Labour',
  advice: 'Advice',
  'aggyl-pm': 'Aggyl',
  aggyl: 'Aggyl',
};

export function appTile(app?: Partial<SuiteApp> | null): {
  bg: string;
  wm: string;
  fg: string;
} {
  const bg =
    (app && app.dot) ||
    (app && app.id ? TILE_BG[app.id] : undefined) ||
    '#0E0E0C';
  const wm =
    (app && app.brand) ||
    (app && app.id ? TILE_WM[app.id] : undefined) ||
    ((app && app.name) || '').split(' ')[0];
  const h = bg.replace('#', '');
  const r = parseInt(h.substr(0, 2), 16),
    g = parseInt(h.substr(2, 2), 16),
    b = parseInt(h.substr(4, 2), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { bg, wm, fg: L > 0.62 ? '#0E0E0C' : '#FBFAF4' };
}
