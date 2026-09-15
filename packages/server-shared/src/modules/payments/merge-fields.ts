/**
 * Server-side merge field resolver for Payments (EziQuotes) proposals.
 * Ported verbatim from the Manus export's server/mergeFields.ts.
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

function formatCents(cents: number | null | undefined, currency?: string | null): string {
  if (cents == null) return '';
  const amount = cents / 100;
  const curr = currency ?? 'AUD';
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: curr, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toLocaleString('en-AU')}`;
  }
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d as string);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function firstWord(name: string | null | undefined): string {
  if (!name) return '';
  return name.trim().split(/\s+/)[0];
}

export function resolveMergeFields(text: string, ctx: MergeFieldContext): string {
  if (!text) return text;
  const currency = ctx.currency ?? 'AUD';
  return text
    // Canonical payer_* tokens
    .replace(/\{\{payer_name\}\}/gi, ctx.clientName ?? '')
    .replace(/\{\{payer_first_name\}\}/gi, firstWord(ctx.clientName))
    .replace(/\{\{payer_email\}\}/gi, ctx.clientEmail ?? '')
    .replace(/\{\{business_name\}\}/gi, ctx.businessName ?? '')
    .replace(/\{\{sender_name\}\}/gi, ctx.senderName ?? '')
    .replace(/\{\{sender_email\}\}/gi, ctx.senderEmail ?? '')
    .replace(/\{\{proposal_title\}\}/gi, ctx.proposalTitle ?? '')
    .replace(/\{\{proposal_number\}\}/gi, ctx.proposalNumber ?? '')
    .replace(/\{\{proposal_date\}\}/gi, formatDate(ctx.proposalDate))
    .replace(/\{\{expiry_date\}\}/gi, formatDate(ctx.expiryDate))
    .replace(/\{\{total\}\}/gi, ctx.totalCents != null ? formatCents(ctx.totalCents, currency) : '')
    .replace(/\{\{subtotal\}\}/gi, ctx.subtotalCents != null ? formatCents(ctx.subtotalCents, currency) : '')
    .replace(/\{\{tax\}\}/gi, ctx.taxCents != null ? formatCents(ctx.taxCents, currency) : '')
    .replace(/\{\{currency\}\}/gi, currency);
}

export function resolveStructureMergeFields(structure: unknown, ctx: MergeFieldContext): unknown {
  return JSON.parse(resolveMergeFields(JSON.stringify(structure), ctx));
}
