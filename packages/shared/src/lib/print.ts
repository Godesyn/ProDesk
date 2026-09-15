/**
 * Dependency-free "export to PDF": open a clean popup containing only the
 * document HTML and trigger the browser's print dialog (Save as PDF). This is
 * the in-browser fallback the server's `*.pdf` endpoints reference when no
 * external PDF renderer is configured.
 */
import { formatPrice } from './utils';

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: Inter, Arial, sans-serif; color: #1a1a17; margin: 0; padding: 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #6b6b62; font-size: 13px; }
  .row { display: flex; justify-content: space-between; gap: 24px; }
  .parties { display: flex; gap: 48px; margin: 24px 0; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8a8a80; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
  th { text-align: left; border-bottom: 2px solid #e4e2d8; padding: 8px 4px; font-size: 12px; text-transform: uppercase; color: #6b6b62; }
  td { border-bottom: 1px solid #eee; padding: 8px 4px; }
  .right { text-align: right; }
  .total { display: flex; justify-content: flex-end; gap: 32px; margin-top: 16px; font-size: 18px; font-weight: 700; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .total-row.grand { border-top: 2px solid #e4e2d8; margin-top: 6px; padding-top: 10px; font-size: 18px; font-weight: 700; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 6px; background: #eef3ef; font-size: 12px; font-weight: 600; }
`;

export function printDocument(title: string, bodyHtml: string): void {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><title>${title}</title><meta charset="utf-8"><style>${STYLE}</style></head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print();},150)};</script></body></html>`,
  );
  w.document.close();
}

/**
 * Print-specific overrides injected into the proposal document before printing.
 * - `@page { size: ... portrait }` forces portrait orientation.
 * - `print-color-adjust: exact` keeps the email's background fills (orange header
 *   bar, card/badge/payment-plan backgrounds) — browsers strip these by default,
 *   which would make the PDF look nothing like the email.
 * - dropping the outer wrapper's 820px cap + page padding lets the fluid,
 *   width:100% layout fill the page width (scale-to-page-width), so nothing is
 *   clipped on the right edge in portrait.
 */
const PRINT_CSS = `
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    html, body {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body > table { width: 100% !important; }
    body > table > tbody > tr > td { padding: 0 !important; }
    table[style*="max-width"] { max-width: 100% !important; }
  }
`;

/**
 * Print a COMPLETE, standalone HTML document (its own <head>/<style>) as-is and
 * trigger Save-as-PDF. Used for the proposal "Download PDF" action, whose HTML is
 * the exact email the server sends (proposals.pdf → generateProposalEmailHtml),
 * so we must not re-wrap it in our own STYLE — we only append a print stylesheet
 * (PRINT_CSS) for portrait + page-width + color fidelity. We wait for
 * window.onload so the agency logo / images finish loading before the dialog.
 */
export function printHtmlDocument(html: string): void {
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) return;
  const style = `<style>${PRINT_CSS}</style>`;
  const trigger = `<script>window.onload=function(){setTimeout(function(){window.print();},250)};<\/script>`;
  const doc = (html.includes('</head>') ? html.replace('</head>', `${style}</head>`) : `${style}${html}`)
    .replace(/<\/body>/, `${trigger}</body>`);
  w.document.write(doc.includes(trigger) ? doc : `${doc}${trigger}`);
  w.document.close();
}

function esc(v: unknown): string {
  return String(v ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? formatPrice(n) : esc(v);
}

interface PartyLike {
  name?: string | null;
  companyName?: string | null;
  displayName?: string | null;
  email?: string | null;
  address?: string | null;
  abn?: string | null;
  phone?: string | null;
}
interface DocItem {
  name: string;
  qty?: number;
  totalPrice?: unknown;
  packageName?: string | null;
}
export interface InvoiceDoc {
  number: string;
  status?: string;
  issuedAt?: string | Date;
  billingBasis?: string;
  from?: PartyLike | null;
  to?: PartyLike | null;
  total?: unknown;
  /** AU tax-invoice split (90% subtotal + 10% GST = amount due). */
  subtotal?: unknown;
  gst?: unknown;
  amountDue?: unknown;
  items: DocItem[];
}

function partyBlock(label: string, p?: PartyLike | null): string {
  const name = p?.name ?? p?.companyName ?? p?.displayName ?? '—';
  const lines = [
    p?.email ? `<div class="muted">${esc(p.email)}</div>` : '',
    p?.address ? `<div class="muted">${esc(p.address)}</div>` : '',
    p?.abn ? `<div class="muted">ABN ${esc(p.abn)}</div>` : '',
    p?.phone ? `<div class="muted">${esc(p.phone)}</div>` : '',
  ].join('');
  return `<div><div class="label">${label}</div><div><strong>${esc(name)}</strong></div>${lines}</div>`;
}

/** Build + print a clean AU tax invoice from the server's invoice document. */
export function printInvoice(doc: InvoiceDoc): void {
  const rows = doc.items.length
    ? doc.items
        .map(
          (i) =>
            `<tr><td>${esc(i.name)}${i.packageName ? ` <span class="muted">(${esc(i.packageName)})</span>` : ''}</td><td class="right">${esc(i.qty ?? 1)}</td><td class="right">${money(i.totalPrice)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="muted">No line items.</td></tr>';
  const issued = doc.issuedAt
    ? new Date(doc.issuedAt).toLocaleDateString()
    : '';
  // GST-inclusive split, mirroring invoice_pdf_generator_service.dart: when the
  // server didn't supply the breakdown, derive it from the total (90% / 10%).
  const total = Number(doc.total) || 0;
  const subtotal = doc.subtotal != null ? Number(doc.subtotal) : total * 0.9;
  const gst = doc.gst != null ? Number(doc.gst) : total * 0.1;
  const amountDue = doc.amountDue != null ? Number(doc.amountDue) : total;
  const totals = `
    <div class="totals">
      <div class="total-row"><span class="muted">Subtotal</span><span>${money(subtotal)}</span></div>
      <div class="total-row"><span class="muted">GST (10%)</span><span>${money(gst)}</span></div>
      <div class="total-row grand"><span>Amount due</span><span>${money(amountDue)}</span></div>
    </div>`;
  const body = `
    <div class="row"><div><h1>Tax Invoice</h1><div class="muted">Prodesk</div></div>
    <div style="text-align:right"><div><strong>${esc(doc.number)}</strong></div><div class="muted">${issued}</div>${doc.billingBasis ? `<div class="muted">Billing Basis: ${esc(doc.billingBasis)}</div>` : ''}</div></div>
    <div class="parties">${partyBlock('From', doc.from)}${partyBlock('To', doc.to)}</div>
    <table><thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Total</th></tr></thead><tbody>${rows}</tbody></table>
    ${totals}`;
  printDocument(doc.number, body);
}
