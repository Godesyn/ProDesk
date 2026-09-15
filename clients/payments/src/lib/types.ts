// ============================================================
// EziQuotes — Shared Frontend Types
// ============================================================

export type ProposalStatus =
  | "draft" | "sent" | "viewed" | "engaged" | "accepted"
  | "paid" | "active" | "past_due" | "cancelled" | "completed"
  | "expired" | "withdrawn";

export type PaymentModel = "one_off" | "subscription" | "payment_plan";

export type LineItemType = "product" | "addon" | "custom" | "break";

export interface LineItem {
  id: string;
  type: LineItemType;
  name: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  taxBehaviour: "inclusive" | "exclusive" | "exempt";
  taxRate?: number; // per-line override, e.g. 10 for 10%
  productId?: number;
  addonId?: number;
  sortOrder: number;
  breakLabel?: string;
}

export interface ProposalSection {
  id: string;
  label: string;
  sortOrder: number;
}

export interface ProposalStructure {
  lineItems: LineItem[];
  sections: ProposalSection[];
  introCopy?: string;
  nextStepsCopy?: string;
  showTerms?: boolean;
  termsUrl?: string;
  heroImageUrl?: string;
  videoUrl?: string;
}

export interface AISuggestion {
  id: string;
  type: "content" | "pricing" | "structure" | "conversion";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
}

// Format cents to currency string
export function formatCents(cents: number, currency = "AUD"): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// Format date
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// Format relative time
export function formatRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

// Initials from name
export function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

// Status label
export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft", sent: "Sent", viewed: "Viewed", engaged: "Engaged",
  accepted: "Accepted", paid: "Paid", active: "Active", past_due: "Past Due",
  cancelled: "Cancelled", completed: "Completed", expired: "Expired",
  withdrawn: "Withdrawn", pending: "Pending", approved: "Approved",
  declined: "Declined", suspended: "Suspended", under_review: "Under Review",
  approved_with_conditions: "Conditional",
};

// Proposal theme options
export const PROPOSAL_THEMES = [
  { value: "agency", label: "Agency", description: "Bold serif headings, editorial layout" },
  { value: "digital", label: "Digital", description: "Dark background, tech-forward mono accents" },
  { value: "luxury", label: "Luxury", description: "Refined whitespace, elegant typography" },
] as const;

// Industry options
export const INDUSTRIES = [
  "Solar & Renewable Energy", "Landscaping & Horticulture", "Plumbing",
  "Electrical", "Building & Construction", "Painting & Decorating",
  "Web Design & Development", "Digital Marketing", "Photography & Videography",
  "Consulting", "Events & Hospitality", "Cleaning Services",
  "HVAC & Refrigeration", "Flooring", "Other",
];

// Team size options
export const TEAM_SIZES = ["Just me", "2–5", "6–15", "16–50", "50+"];

// Monthly volume options
export const MONTHLY_VOLUMES = [
  "Under $10k", "$10k–$50k", "$50k–$100k", "$100k–$500k", "$500k+"
];
