/**
 * KEYMASTR skeleton data.
 *
 * Every screen in this frontend reads from here. There is no `passwords` backend
 * module yet — see DESIGN.md §6 for the schema and §9 for the build order. When
 * the real `trpc.passwords.*` router lands, the shapes below are what it should
 * return, so swapping the source is a one-file change per screen.
 *
 * The data is deliberately opinionated rather than lorem: it encodes the exact
 * situations the design is built to handle (a departed contractor holding sole
 * knowledge of a key, an agency over-provisioned on a client, a Meta Business
 * account that should be a DELEGATION and not a password), so the screens can be
 * judged on the real job.
 */

export type Health = 'strong' | 'weak' | 'stale' | 'breached';

export type ItemType =
  | 'login'
  | 'card'
  | 'note'
  | 'key'
  | 'licence'
  | 'recovery'
  | 'delegation';

export interface Brand {
  id: string;
  name: string;
  /** Owner | Editor | Viewer, or how the current user reaches it. */
  role: string;
  /** Set when the user reaches this brand through an agency, not directly. */
  via?: string;
  keys: number;
  people: number;
  sharedOut: number;
  /** Health split — the four-segment bar. Sums to `keys`. */
  split: { strong: number; weak: number; stale: number; breached: number };
  lastOpened: string;
  /** Deterministic seed for the brand's key silhouette (see KeyMark). */
  seed: number;
}

export interface Person {
  id: string;
  name: string;
  org: string;
  role: 'Owner' | 'Editor' | 'Viewer';
  /** Six-word key fingerprint — see DESIGN.md §5.10. */
  fingerprint: string;
  /** Set when this person has left and has not been closed out. */
  departed?: string;
  external?: boolean;
}

export interface Field {
  label: string;
  value: string;
  kind: 'text' | 'secret' | 'totp' | 'url' | 'note';
}

export interface Item {
  id: string;
  name: string;
  identity: string;
  brandId: string;
  type: ItemType;
  health: Health;
  /** Human relative time, e.g. "2h". Null when never opened. */
  lastUsed: string | null;
  tags: string[];
  url?: string;
  /** Age of the current password, in days. */
  age: number;
  /** People who can open it. */
  holders: string[];
  /** Live outbound shares. */
  shared: number;
  fields: Field[];
  /** Set on `delegation` items — a granted access, NOT a stored secret. */
  delegation?: { platform: string; account: string; level: string; grantedBy: string; granted: string };
}

export interface EventRow {
  id: string;
  at: string;
  who: string;
  action: string;
  item: string;
  brandId: string;
  from: string;
  tone?: 'alarm' | 'pigment';
}

export interface Send {
  id: string;
  to: string;
  items: string;
  brandId: string;
  /** 0→1 of life remaining; drives the drain ring. */
  remaining: number;
  expires: string;
  opens: string;
  receipt?: string;
}

export interface IntakeRow {
  label: string;
  why: string;
  status: 'supplied' | 'delegated' | 'outstanding';
  /** True where a password should NOT be requested — see DESIGN.md §5.6. */
  steer?: string;
}

export interface Intake {
  id: string;
  client: string;
  brandId: string;
  sent: string;
  rows: IntakeRow[];
}

export interface Finding {
  id: string;
  check: string;
  consequence: string;
  keys: string[];
  count: number;
  tone: 'alarm' | 'ink';
  fix: string;
}

/* ------------------------------------------------------------------ brands */

export const BRANDS: Brand[] = [
  {
    id: 'acme',
    name: 'Acme Coffee',
    role: 'Owner',
    keys: 24,
    people: 5,
    sharedOut: 2,
    split: { strong: 18, weak: 3, stale: 2, breached: 1 },
    lastOpened: '2h ago',
    seed: 3,
  },
  {
    id: 'bellweather',
    name: 'Bellweather Health',
    role: 'Editor',
    via: 'Noize Agency',
    keys: 41,
    people: 8,
    sharedOut: 1,
    split: { strong: 30, weak: 6, stale: 5, breached: 0 },
    lastOpened: 'yesterday',
    seed: 7,
  },
  {
    id: 'northwind',
    name: 'Northwind Studio',
    role: 'Editor',
    via: 'Noize Agency',
    keys: 19,
    people: 4,
    sharedOut: 3,
    split: { strong: 11, weak: 4, stale: 4, breached: 0 },
    lastOpened: '4d ago',
    seed: 11,
  },
  {
    id: 'harbourline',
    name: 'Harbourline Freight',
    role: 'Owner',
    keys: 33,
    people: 6,
    sharedOut: 0,
    split: { strong: 27, weak: 2, stale: 4, breached: 0 },
    lastOpened: '6h ago',
    seed: 5,
  },
  {
    id: 'gilder',
    name: 'Gilder & Co',
    role: 'Viewer',
    via: 'Noize Agency',
    keys: 17,
    people: 3,
    sharedOut: 1,
    split: { strong: 14, weak: 1, stale: 2, breached: 0 },
    lastOpened: '2w ago',
    seed: 13,
  },
  {
    id: 'palegrove',
    name: 'Pale Grove',
    role: 'Owner',
    keys: 13,
    people: 2,
    sharedOut: 0,
    split: { strong: 12, weak: 1, stale: 0, breached: 0 },
    lastOpened: '3d ago',
    seed: 17,
  },
];

export const brandName = (id: string) =>
  BRANDS.find((b) => b.id === id)?.name ?? id;

export const brandShort = (id: string) =>
  (BRANDS.find((b) => b.id === id)?.name ?? id).split(' ')[0].toUpperCase();

export const TOTAL_KEYS = BRANDS.reduce((n, b) => n + b.keys, 0);

/* ------------------------------------------------------------------ people */

export const PEOPLE: Person[] = [
  {
    id: 'sajat',
    name: 'Sajat Sivakumar',
    org: 'Noize Agency',
    role: 'Owner',
    fingerprint: 'amber fjord lantern rust quill nine',
  },
  {
    id: 'priya',
    name: 'Priya Raghunathan',
    org: 'Noize Agency',
    role: 'Editor',
    fingerprint: 'cedar mint harbour vellum six teal',
  },
  {
    id: 'marcus',
    name: 'Marcus Webb',
    org: 'Noize Agency',
    role: 'Editor',
    fingerprint: 'slate onyx pilot brine four ash',
    departed: '12 Aug',
  },
  {
    id: 'joanne',
    name: 'Joanne Ellis',
    org: 'Acme Coffee',
    role: 'Owner',
    fingerprint: 'linen copper drift maple two ivory',
    external: true,
  },
  {
    id: 'devan',
    name: 'Devan Roy',
    org: 'Noize Agency',
    role: 'Viewer',
    fingerprint: 'ochre wren tundra basalt seven fig',
  },
  {
    id: 'noor',
    name: 'Noor Haddad',
    org: 'Bellweather Health',
    role: 'Editor',
    fingerprint: 'sable plume cobalt reed one thorn',
    external: true,
  },
];

export const personName = (id: string) =>
  PEOPLE.find((p) => p.id === id)?.name ?? id;

/* ------------------------------------------------------------------- items */

export const ITEMS: Item[] = [
  {
    id: 'k1',
    name: 'Google Workspace — admin',
    identity: 'ops@acmecoffee.com',
    brandId: 'acme',
    type: 'login',
    health: 'strong',
    lastUsed: '2h',
    tags: ['critical', 'email'],
    url: 'admin.google.com',
    age: 41,
    holders: ['sajat', 'priya', 'joanne'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'ops@acmecoffee.com', kind: 'text' },
      { label: 'Password', value: 'Tr4ce-Hollow-Bramble-92', kind: 'secret' },
      { label: 'One-time code', value: '418 902', kind: 'totp' },
      { label: 'Website', value: 'admin.google.com', kind: 'url' },
      { label: 'Who to call', value: 'Joanne Ellis · +61 4xx xxx xxx', kind: 'text' },
    ],
  },
  {
    id: 'k2',
    name: 'Cloudflare — DNS',
    identity: 'dns@acmecoffee.com',
    brandId: 'acme',
    type: 'login',
    health: 'stale',
    lastUsed: '3w',
    tags: ['critical', 'infrastructure'],
    url: 'dash.cloudflare.com',
    age: 1104,
    holders: ['sajat', 'marcus'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'dns@acmecoffee.com', kind: 'text' },
      { label: 'Password', value: 'harbour-tide-1998', kind: 'secret' },
      { label: 'Website', value: 'dash.cloudflare.com', kind: 'url' },
    ],
  },
  {
    id: 'k3',
    name: 'Meta Business Manager',
    identity: 'Acme Coffee · ID 8841 0293',
    brandId: 'acme',
    type: 'delegation',
    health: 'strong',
    lastUsed: '1d',
    tags: ['advertising'],
    age: 0,
    holders: ['sajat', 'priya'],
    shared: 0,
    fields: [],
    delegation: {
      platform: 'Meta Business Manager',
      account: 'Acme Coffee · 8841 0293',
      level: 'Partner — Advertise + Analyse',
      grantedBy: 'Joanne Ellis',
      granted: '4 Mar 2026',
    },
  },
  {
    id: 'k4',
    name: 'Stripe — live keys',
    identity: 'acct_1Q8xTr',
    brandId: 'acme',
    type: 'key',
    health: 'strong',
    lastUsed: '5d',
    tags: ['critical', 'payments'],
    age: 88,
    holders: ['sajat'],
    shared: 0,
    fields: [
      { label: 'Publishable', value: 'pk_live_51Q8xTr...', kind: 'text' },
      { label: 'Secret', value: 'sk_live_51Q8xTrKq...', kind: 'secret' },
    ],
  },
  {
    id: 'k5',
    name: 'Mailchimp',
    identity: 'marketing@acmecoffee.com',
    brandId: 'acme',
    type: 'login',
    health: 'breached',
    lastUsed: null,
    tags: ['email'],
    url: 'login.mailchimp.com',
    age: 612,
    holders: ['sajat', 'priya', 'devan', 'joanne'],
    shared: 1,
    fields: [
      { label: 'Username', value: 'marketing@acmecoffee.com', kind: 'text' },
      { label: 'Password', value: 'coffee2023!', kind: 'secret' },
    ],
  },
  {
    id: 'k6',
    name: 'WordPress — admin',
    identity: 'admin',
    brandId: 'bellweather',
    type: 'login',
    health: 'weak',
    lastUsed: '6h',
    tags: ['website'],
    url: 'bellweather.health/wp-admin',
    age: 210,
    holders: ['sajat', 'priya', 'marcus', 'noor'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'admin', kind: 'text' },
      { label: 'Password', value: 'Bellweather2025', kind: 'secret' },
      { label: 'Website', value: 'bellweather.health/wp-admin', kind: 'url' },
    ],
  },
  {
    id: 'k7',
    name: 'AWS — root account',
    identity: 'aws@bellweather.health',
    brandId: 'bellweather',
    type: 'login',
    health: 'strong',
    lastUsed: '2d',
    tags: ['critical', 'infrastructure'],
    url: 'console.aws.amazon.com',
    age: 30,
    holders: ['sajat', 'marcus'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'aws@bellweather.health', kind: 'text' },
      { label: 'Password', value: 'Pellucid-Kestrel-Onyx-44', kind: 'secret' },
      { label: 'One-time code', value: '702 335', kind: 'totp' },
    ],
  },
  {
    id: 'k8',
    name: 'GoDaddy — registrar',
    identity: 'domains@bellweather.health',
    brandId: 'bellweather',
    type: 'login',
    health: 'stale',
    lastUsed: '5mo',
    tags: ['critical', 'infrastructure'],
    url: 'godaddy.com',
    age: 1340,
    holders: ['marcus'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'domains@bellweather.health', kind: 'text' },
      { label: 'Password', value: 'bellweather-dom-2022', kind: 'secret' },
      { label: 'Recovery codes', value: '10 codes · 4 unused', kind: 'note' },
    ],
  },
  {
    id: 'k9',
    name: 'Xero',
    identity: 'accounts@northwind.studio',
    brandId: 'northwind',
    type: 'login',
    health: 'strong',
    lastUsed: '1d',
    tags: ['finance'],
    url: 'login.xero.com',
    age: 62,
    holders: ['sajat', 'devan'],
    shared: 1,
    fields: [
      { label: 'Username', value: 'accounts@northwind.studio', kind: 'text' },
      { label: 'Password', value: 'Quarry-Lantern-Sift-71', kind: 'secret' },
    ],
  },
  {
    id: 'k10',
    name: 'Figma — organisation',
    identity: 'design@northwind.studio',
    brandId: 'northwind',
    type: 'login',
    health: 'weak',
    lastUsed: '4d',
    tags: ['design'],
    url: 'figma.com',
    age: 150,
    holders: ['sajat', 'priya', 'devan'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'design@northwind.studio', kind: 'text' },
      { label: 'Password', value: 'northwind123', kind: 'secret' },
    ],
  },
  {
    id: 'k11',
    name: 'Shopify — admin',
    identity: 'store@harbourline.com',
    brandId: 'harbourline',
    type: 'login',
    health: 'strong',
    lastUsed: '6h',
    tags: ['critical', 'commerce'],
    url: 'harbourline.myshopify.com',
    age: 22,
    holders: ['sajat', 'priya'],
    shared: 0,
    fields: [
      { label: 'Username', value: 'store@harbourline.com', kind: 'text' },
      { label: 'Password', value: 'Marlin-Cordage-Beacon-08', kind: 'secret' },
      { label: 'One-time code', value: '556 140', kind: 'totp' },
    ],
  },
  {
    id: 'k12',
    name: 'Adobe Creative Cloud',
    identity: 'studio@gilder.co',
    brandId: 'gilder',
    type: 'licence',
    health: 'strong',
    lastUsed: '2w',
    tags: ['licence'],
    age: 300,
    holders: ['sajat', 'devan'],
    shared: 0,
    fields: [
      { label: 'Seat count', value: '12', kind: 'text' },
      { label: 'Licence key', value: 'GLD-4471-XX22-PPQ8', kind: 'secret' },
      { label: 'Renews', value: '4 Nov 2026', kind: 'text' },
    ],
  },
  {
    id: 'k13',
    name: 'Company card — Amex',
    identity: '•••• 4102',
    brandId: 'palegrove',
    type: 'card',
    health: 'strong',
    lastUsed: '3d',
    tags: ['finance'],
    age: 12,
    holders: ['sajat'],
    shared: 0,
    fields: [
      { label: 'Number', value: '3782 8224 6310 005', kind: 'secret' },
      { label: 'Expires', value: '09 / 28', kind: 'text' },
      { label: 'Security code', value: '4102', kind: 'secret' },
    ],
  },
  {
    id: 'k14',
    name: 'Google Ads',
    identity: 'Northwind · 771-402-9915',
    brandId: 'northwind',
    type: 'delegation',
    health: 'strong',
    lastUsed: '2d',
    tags: ['advertising'],
    age: 0,
    holders: ['sajat', 'priya'],
    shared: 0,
    fields: [],
    delegation: {
      platform: 'Google Ads',
      account: '771-402-9915',
      level: 'Standard access',
      grantedBy: 'Ilse Brandt',
      granted: '19 Jun 2026',
    },
  },
];

export const itemsFor = (brandId: string) =>
  ITEMS.filter((i) => i.brandId === brandId);

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);

/* ------------------------------------------------------------------ events */

export const EVENTS: EventRow[] = [
  { id: 'e1', at: '14:41', who: 'priya', action: 'copied', item: 'Google Workspace — admin', brandId: 'acme', from: 'Melbourne AU' },
  { id: 'e2', at: '14:22', who: 'sajat', action: 'revoked share', item: 'Xero', brandId: 'northwind', from: 'Melbourne AU', tone: 'alarm' },
  { id: 'e3', at: '13:08', who: 'devan', action: 'revealed', item: 'Figma — organisation', brandId: 'northwind', from: 'Sydney AU', tone: 'pigment' },
  { id: 'e4', at: '11:55', who: 'sajat', action: 'sent', item: 'WordPress — admin', brandId: 'bellweather', from: 'Melbourne AU' },
  { id: 'e5', at: '09:30', who: 'joanne', action: 'supplied via intake', item: 'Mailchimp', brandId: 'acme', from: 'Geelong AU' },
  { id: 'e6', at: '08:02', who: 'priya', action: 'rotated', item: 'Shopify — admin', brandId: 'harbourline', from: 'Melbourne AU' },
  { id: 'e7', at: 'Yest 17:44', who: 'sajat', action: 'granted access', item: 'AWS — root account', brandId: 'bellweather', from: 'Melbourne AU' },
  { id: 'e8', at: 'Yest 16:10', who: 'noor', action: 'copied', item: 'WordPress — admin', brandId: 'bellweather', from: 'Perth AU' },
];

/** The one anomaly the Register surfaces above the ledger. */
export const ANOMALY = {
  who: 'Marcus Webb',
  what: 'revealed 11 keys in 4 minutes',
  at: '02:14, 11 Aug',
  from: 'a device seen for the first time · Ho Chi Minh City VN',
};

/* ------------------------------------------------------------------- sends */

export const SENDS: Send[] = [
  { id: 's1', to: 'jo@northwind.studio', items: 'Xero · 1 key', brandId: 'northwind', remaining: 0.62, expires: 'in 14h', opens: '0 of 1', receipt: undefined },
  { id: 's2', to: 'contractor@fold.design', items: 'Figma — organisation', brandId: 'northwind', remaining: 0.21, expires: 'in 2h', opens: '1 of 1', receipt: 'Opened 14:02 · Melbourne AU · Chrome' },
  { id: 's3', to: 'noor@bellweather.health', items: 'WordPress — admin · 2 keys', brandId: 'bellweather', remaining: 0.88, expires: 'in 6d', opens: '0 of 3' },
  { id: 's4', to: 'billing@gilder.co', items: 'Adobe Creative Cloud', brandId: 'gilder', remaining: 0.05, expires: 'in 24m', opens: '2 of 2', receipt: 'Opened 09:31 · Sydney AU · Safari' },
];

/* ------------------------------------------------------------------ intake */

export const INTAKES: Intake[] = [
  {
    id: 'in1',
    client: 'Northwind Studio',
    brandId: 'northwind',
    sent: '3 days ago',
    rows: [
      { label: 'WordPress admin', why: 'To ship the new site and keep plugins patched', status: 'supplied' },
      { label: 'DNS registrar', why: 'To point the domain at the new host on launch day', status: 'supplied' },
      { label: 'Google Analytics', why: 'To report on what the site is actually doing', status: 'supplied' },
      { label: 'Hosting control panel', why: 'To move the site without downtime', status: 'supplied' },
      { label: 'Email platform', why: 'To keep newsletters sending through the change', status: 'supplied' },
      { label: 'Stripe', why: 'To reconcile checkout after the migration', status: 'supplied' },
      {
        label: 'Meta Business Manager',
        why: 'To run and report on paid social',
        status: 'delegated',
        steer:
          'Don’t send a password — Meta flags cross-country logins as fraud and can restrict the ad account. Add us as a Partner instead.',
      },
      {
        label: 'Google Ads',
        why: 'To manage spend and conversions',
        status: 'outstanding',
        steer:
          'Don’t send a password. Grant our manager account access from Tools → Access and security.',
      },
      { label: 'Shopify admin', why: 'To wire the storefront to the new theme', status: 'outstanding' },
    ],
  },
];

/* --------------------------------------------------------------- watchtower */

export const HEALTH_SCORE = 82;

export const FINDINGS: Finding[] = [
  {
    id: 'f1',
    check: 'Reused across brands',
    consequence:
      'Three keys are reused between Acme and Bellweather. If one leaks, both do.',
    keys: ['Mailchimp', 'WordPress — admin', 'Figma — organisation'],
    count: 3,
    tone: 'alarm',
    fix: 'Rotate the duplicates',
  },
  {
    id: 'f2',
    check: 'Found in a breach',
    consequence:
      'Acme’s Mailchimp password appears in a known breach corpus. It has never been changed since.',
    keys: ['Mailchimp'],
    count: 1,
    tone: 'alarm',
    fix: 'Rotate now',
  },
  {
    id: 'f3',
    check: 'Sole holder has left',
    consequence:
      'Marcus Webb is the only person who can open Bellweather’s registrar. Rotating it without recovering it first locks you out of the domain.',
    keys: ['GoDaddy — registrar'],
    count: 1,
    tone: 'alarm',
    fix: 'Recover, then rotate',
  },
  {
    id: 'f4',
    check: 'Stale for its type',
    consequence:
      'Acme’s DNS password is 3 years old. A registrar or DNS key is the one that loses you the domain, so it is held to a tighter clock than a newsletter tool.',
    keys: ['Cloudflare — DNS', 'GoDaddy — registrar'],
    count: 2,
    tone: 'ink',
    fix: 'Queue rotation',
  },
  {
    id: 'f5',
    check: 'No second factor on a critical account',
    consequence:
      'Two keys that control money or infrastructure have no one-time code stored, so nobody on the team can get in if the phone that holds it is lost.',
    keys: ['Stripe — live keys', 'Cloudflare — DNS'],
    count: 2,
    tone: 'ink',
    fix: 'Add a one-time code',
  },
  {
    id: 'f6',
    check: 'Shared wider than it needs to be',
    consequence:
      'Four people can open Acme’s Mailchimp. One of them has opened it in the last year.',
    keys: ['Mailchimp'],
    count: 1,
    tone: 'ink',
    fix: 'Trim to what’s used',
  },
  {
    id: 'f7',
    check: 'Dormant',
    consequence:
      'Six keys have not been opened in twelve months. Deleting a key you do not need is a win, not a loss.',
    keys: ['6 keys across 3 brands'],
    count: 6,
    tone: 'ink',
    fix: 'Review for deletion',
  },
];

export const FINDINGS_RESOLVED = 41;

/* -------------------------------------------------------------- offboarding */

export const OFFBOARDING = {
  person: 'marcus',
  left: '12 Aug 2026',
  /** They hold these values. Rotate. */
  opened: [
    { name: 'GoDaddy — registrar', brandId: 'bellweather', why: 'opened 14× · last 2 Aug' },
    { name: 'AWS — root account', brandId: 'bellweather', why: 'opened 9× · last 9 Aug' },
    { name: 'Cloudflare — DNS', brandId: 'acme', why: 'opened 6× · last 28 Jul' },
    { name: 'WordPress — admin', brandId: 'bellweather', why: 'opened 22× · last 11 Aug' },
    { name: 'Bellweather CRM', brandId: 'bellweather', why: 'opened 3× · last 4 Aug' },
    { name: 'Sentry', brandId: 'bellweather', why: 'opened 2× · last 19 Jul' },
    { name: 'Twilio', brandId: 'acme', why: 'opened 5× · last 1 Aug' },
    { name: 'Postmark', brandId: 'acme', why: 'opened 1× · last 6 Jun' },
    { name: 'Linear', brandId: 'northwind', why: 'opened 31× · last 11 Aug' },
  ],
  /** Reachable but never opened. Revoke — do not rotate. */
  neverOpened: 22,
  /** Sole holder. Recover before rotating or you lock yourself out. */
  soleHolder: [
    { name: 'GoDaddy — registrar', brandId: 'bellweather' },
    { name: 'Bellweather CRM', brandId: 'bellweather' },
  ],
  /** How many of the rotation queue are done. */
  rotated: 4,
};

/* -------------------------------------------------------------- access map */

/** grants[personId] = item ids they can open. `used` drives the tie weight. */
export const GRANTS: { person: string; item: string; used: boolean }[] = [
  { person: 'sajat', item: 'k1', used: true },
  { person: 'sajat', item: 'k2', used: true },
  { person: 'sajat', item: 'k4', used: true },
  { person: 'sajat', item: 'k5', used: false },
  { person: 'priya', item: 'k1', used: true },
  { person: 'priya', item: 'k3', used: true },
  { person: 'priya', item: 'k5', used: false },
  { person: 'priya', item: 'k2', used: false },
  { person: 'priya', item: 'k4', used: false },
  { person: 'marcus', item: 'k2', used: true },
  { person: 'marcus', item: 'k4', used: false },
  { person: 'joanne', item: 'k1', used: true },
  { person: 'joanne', item: 'k5', used: false },
  { person: 'devan', item: 'k5', used: false },
  { person: 'devan', item: 'k3', used: false },
];

/** The Access map's headline sentence, per person. */
export const ACCESS_SUMMARY: Record<
  string,
  { can: number; of: number; opened: number; never: number; by: string; on: string }
> = {
  priya: { can: 14, of: 24, opened: 3, never: 11, by: 'Sajat', on: '4 Mar 2026' },
  sajat: { can: 24, of: 24, opened: 19, never: 5, by: 'themselves', on: '2 Jan 2026' },
  marcus: { can: 31, of: 41, opened: 9, never: 22, by: 'Sajat', on: '8 Nov 2025' },
  joanne: { can: 24, of: 24, opened: 11, never: 13, by: 'themselves', on: '2 Jan 2026' },
  devan: { can: 6, of: 24, opened: 0, never: 6, by: 'Priya', on: '22 Jun 2026' },
  noor: { can: 12, of: 41, opened: 7, never: 5, by: 'Sajat', on: '3 Apr 2026' },
};

/* ------------------------------------------------- the attention strip (home) */

export const ATTENTION: {
  id: string;
  text: string;
  action: string;
  href: string;
  tone: 'alarm' | 'ink';
}[] = [
  {
    id: 'a1',
    text: 'Marcus Webb left 12 Aug — 9 keys he opened are still live',
    action: 'Close him out',
    href: '/offboarding',
    tone: 'alarm',
  },
  {
    id: 'a2',
    text: 'Acme’s Mailchimp password appears in a known breach',
    action: 'Rotate',
    href: '/health',
    tone: 'alarm',
  },
  {
    id: 'a3',
    text: 'Priya has never opened 11 of her 14 Acme keys',
    action: 'Trim',
    href: '/access',
    tone: 'ink',
  },
  {
    id: 'a4',
    text: 'Northwind’s intake is 7 of 9 supplied',
    action: 'Chase',
    href: '/intake',
    tone: 'ink',
  },
];
