/**
 * Merge fields system for Prodesk proposals and templates.
 *
 * Standard fields:
 *   {{payer_name}}         — payer's full name
 *   {{payer_first_name}}   — payer's first name only
 *   {{payer_email}}        — payer's email address
 *   {{business_name}}      — sender's business name
 *   {{proposal_title}}     — proposal title
 *   {{total}}              — formatted total (e.g. $4,500)
 *   {{subtotal}}           — formatted subtotal
 *   {{tax}}                — formatted tax amount
 *   {{currency}}           — currency code (e.g. AUD)
 *   {{proposal_date}}      — date proposal was created (DD MMM YYYY)
 *   {{expiry_date}}        — proposal expiry date (DD MMM YYYY)
 *   {{proposal_number}}    — proposal reference number
 *   {{sender_name}}        — sender's full name
 *   {{sender_email}}       — sender's email address
 */

export interface MergeFieldContext {
  clientName?: string | null;
  clientEmail?: string | null;
  businessName?: string | null;
  proposalTitle?: string | null;
  totalCents?: number | null;
  subtotalCents?: number | null;
  taxCents?: number | null;
  currency?: string | null;
  proposalDate?: Date | string | null;
  expiryDate?: Date | string | null;
  proposalNumber?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
}

export const MERGE_FIELD_DEFINITIONS: Array<{
  key: string;
  label: string;
  description: string;
  category: 'payer' | 'proposal' | 'business';
}> = [
  {
    key: '{{payer_name}}',
    label: 'Payer Name',
    description: "Payer's full name",
    category: 'payer',
  },
  {
    key: '{{payer_first_name}}',
    label: 'Payer First Name',
    description: "Payer's first name only",
    category: 'payer',
  },
  {
    key: '{{payer_email}}',
    label: 'Payer Email',
    description: "Payer's email address",
    category: 'payer',
  },
  {
    key: '{{business_name}}',
    label: 'Business Name',
    description: 'Your business name',
    category: 'business',
  },
  {
    key: '{{sender_name}}',
    label: 'Sender Name',
    description: 'Your full name',
    category: 'business',
  },
  {
    key: '{{sender_email}}',
    label: 'Sender Email',
    description: 'Your email address',
    category: 'business',
  },
  {
    key: '{{proposal_title}}',
    label: 'Proposal Title',
    description: 'Title of this proposal',
    category: 'proposal',
  },
  {
    key: '{{proposal_number}}',
    label: 'Proposal Number',
    description: 'Proposal reference number',
    category: 'proposal',
  },
  {
    key: '{{proposal_date}}',
    label: 'Proposal Date',
    description: 'Date proposal was created',
    category: 'proposal',
  },
  {
    key: '{{expiry_date}}',
    label: 'Expiry Date',
    description: 'Proposal expiry date',
    category: 'proposal',
  },
  {
    key: '{{total}}',
    label: 'Total',
    description: 'Formatted total amount (e.g. $4,500)',
    category: 'proposal',
  },
  {
    key: '{{subtotal}}',
    label: 'Subtotal',
    description: 'Formatted subtotal amount',
    category: 'proposal',
  },
  {
    key: '{{tax}}',
    label: 'Tax',
    description: 'Formatted tax amount',
    category: 'proposal',
  },
  {
    key: '{{currency}}',
    label: 'Currency',
    description: 'Currency code (e.g. AUD)',
    category: 'proposal',
  },
];

function formatCents(
  cents: number | null | undefined,
  currency?: string | null,
): string {
  if (cents == null) return '';
  const amount = cents / 100;
  const curr = currency ?? 'AUD';
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: curr,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `$${amount.toLocaleString('en-AU')}`;
  }
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function firstWord(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().split(/\s+/)[0];
}

/**
 * Resolve all merge fields in a string using the provided context.
 * Unresolved fields are left as-is (so they're visible in preview mode).
 */
export function resolveMergeFields(
  text: string,
  ctx: MergeFieldContext,
): string {
  if (!text) return text;
  const currency = ctx.currency ?? 'AUD';
  return (
    text
      // Canonical payer_* tokens
      .replace(/\{\{payer_name\}\}/gi, ctx.clientName ?? '{{payer_name}}')
      .replace(
        /\{\{payer_first_name\}\}/gi,
        firstWord(ctx.clientName) || '{{payer_first_name}}',
      )
      .replace(/\{\{payer_email\}\}/gi, ctx.clientEmail ?? '{{payer_email}}')
      .replace(
        /\{\{business_name\}\}/gi,
        ctx.businessName ?? '{{business_name}}',
      )
      .replace(/\{\{sender_name\}\}/gi, ctx.senderName ?? '{{sender_name}}')
      .replace(/\{\{sender_email\}\}/gi, ctx.senderEmail ?? '{{sender_email}}')
      .replace(
        /\{\{proposal_title\}\}/gi,
        ctx.proposalTitle ?? '{{proposal_title}}',
      )
      .replace(
        /\{\{proposal_number\}\}/gi,
        ctx.proposalNumber ?? '{{proposal_number}}',
      )
      .replace(
        /\{\{proposal_date\}\}/gi,
        formatDate(ctx.proposalDate) || '{{proposal_date}}',
      )
      .replace(
        /\{\{expiry_date\}\}/gi,
        formatDate(ctx.expiryDate) || '{{expiry_date}}',
      )
      .replace(
        /\{\{total\}\}/gi,
        ctx.totalCents != null
          ? formatCents(ctx.totalCents, currency)
          : '{{total}}',
      )
      .replace(
        /\{\{subtotal\}\}/gi,
        ctx.subtotalCents != null
          ? formatCents(ctx.subtotalCents, currency)
          : '{{subtotal}}',
      )
      .replace(
        /\{\{tax\}\}/gi,
        ctx.taxCents != null ? formatCents(ctx.taxCents, currency) : '{{tax}}',
      )
      .replace(/\{\{currency\}\}/gi, currency)
  );
}

/**
 * Recursively resolve merge fields in all text content within a blocks structure.
 */
export function resolveBlocksMergeFields(
  blocks: unknown[],
  ctx: MergeFieldContext,
): unknown[] {
  return JSON.parse(resolveMergeFields(JSON.stringify(blocks), ctx));
}
