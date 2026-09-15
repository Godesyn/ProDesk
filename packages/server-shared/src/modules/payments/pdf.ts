/**
 * Payments (EziQuotes) — proposal PDF generator using PDFKit (pure Node.js,
 * no Chromium). Ported 1:1 from the export's server/pdf.ts; works in any Node
 * environment without system dependencies.
 */
import PDFDocument from 'pdfkit';

// --- Types --------------------------------------------------------------------

export interface ProposalPdfData {
  title: string;
  clientName: string;
  businessName: string;
  abn?: string;
  totalCents: number;
  subtotalCents?: number;
  taxCents?: number;
  taxLabel?: string;
  taxRate?: number;
  taxBehaviour?: string;
  currency: string;
  paymentModel: string;
  lineItems: Array<{
    name: string;
    description?: string;
    qty?: number;
    unitPriceCents: number;
    totalCents: number;
  }>;
  sections?: Array<{ type: string; title?: string; content?: string }>;
  createdAt: Date;
  expiresAt?: Date | null;
  slug: string;
  // Signature
  signatureDataUrl?: string | null;
  signerName?: string | null;
  signerEmail?: string | null;
  signedAt?: Date | null;
  signatureIp?: string | null;
  /**
   * When true, renders a compact single-page receipt:
   * - Labelled "RECEIPT" instead of "PROPOSAL"
   * - All non-pricing sections (text, gallery, etc.) are stripped
   * - Signature block is omitted
   * - Paid date shown instead of expiry
   */
  receiptMode?: boolean;
  paidAt?: Date | null;
}

// --- Helpers ------------------------------------------------------------------

function fmtCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency || 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const PAYMENT_MODEL_LABELS: Record<string, string> = {
  one_off: 'One-off Payment',
  'one-off': 'One-off Payment',
  subscription: 'Subscription',
  payment_plan: 'Payment Plan',
  'payment-plan': 'Payment Plan',
  deposit_then_balance: 'Deposit + Balance',
};

// --- PDF Generator ------------------------------------------------------------

export function generateProposalPdf(data: ProposalPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 60, bottom: 60, left: 60, right: 60 },
      info: {
        Title: data.title,
        Author: data.businessName,
        Subject: `Proposal for ${data.clientName}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const marginL = 60;
    const marginR = 60;
    const contentW = pageW - marginL - marginR;
    const isReceipt = !!data.receiptMode;

    // -- Colour palette ------------------------------------------------------
    const INK = '#1a1a1a';
    const INK_MID = '#555555';
    const INK_LIGHT = '#888888';
    const ACCENT = '#1a1a1a';
    const BG_LIGHT = '#f8f8f8';
    const BORDER = '#e5e5e5';

    // -- Header --------------------------------------------------------------
    doc
      .rect(marginL, 60, contentW, 1)
      .fill(ACCENT);

    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(data.businessName, marginL, 72, { width: contentW / 2 });

    if (data.abn) {
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(INK_LIGHT)
        .text(`ABN ${data.abn}`, marginL, 96, { width: contentW / 2 });
    }

    // Right-aligned header info
    const headerRightX = marginL + contentW / 2;
    const headerRightW = contentW / 2;
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor(INK_LIGHT)
      .text(isReceipt ? 'RECEIPT' : 'PROPOSAL', headerRightX, 72, { width: headerRightW, align: 'right' });

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(INK_MID)
      .text(`${isReceipt ? 'Issued to' : 'Prepared for'}: ${data.clientName}`, headerRightX, 84, { width: headerRightW, align: 'right' })
      .text(`Date: ${fmtDate(data.createdAt)}`, headerRightX, 96, { width: headerRightW, align: 'right' });

    if (isReceipt && data.paidAt) {
      doc
        .text(`Paid: ${fmtDate(data.paidAt)}`, headerRightX, 108, { width: headerRightW, align: 'right' });
    } else if (!isReceipt && data.expiresAt) {
      doc
        .text(`Valid until: ${fmtDate(data.expiresAt)}`, headerRightX, 108, { width: headerRightW, align: 'right' });
    }

    doc.moveDown(3);

    // -- Meta boxes ----------------------------------------------------------
    const boxY = doc.y;
    const boxW = (contentW - 12) / 2;

    // Box 1: Proposal/Receipt title
    doc
      .rect(marginL, boxY, boxW, 52)
      .fillAndStroke(BG_LIGHT, BORDER);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor(INK_LIGHT)
      .text(isReceipt ? 'RECEIPT' : 'PROPOSAL', marginL + 12, boxY + 10, { width: boxW - 24 });
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(data.title, marginL + 12, boxY + 22, { width: boxW - 24, ellipsis: true });

    // Box 2: Payment
    const box2X = marginL + boxW + 12;
    doc
      .rect(box2X, boxY, boxW, 52)
      .fillAndStroke(BG_LIGHT, BORDER);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor(INK_LIGHT)
      .text('PAYMENT', box2X + 12, boxY + 10, { width: boxW - 24 });
    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(
        `${PAYMENT_MODEL_LABELS[data.paymentModel] ?? 'Payment'} · ${fmtCurrency(data.totalCents, data.currency)}`,
        box2X + 12,
        boxY + 22,
        { width: boxW - 24, ellipsis: true }
      );

    doc.y = boxY + 52 + 24;

    // -- Text sections --------------------------------------------------------
    // In receipt mode, skip all non-pricing sections to keep the PDF to one page.
    const textSections = isReceipt ? [] : (data.sections ?? []).filter(
      (s) => s.type === 'text' && s.content && s.content.trim()
    );

    for (const section of textSections) {
      if (section.title) {
        doc
          .fontSize(11)
          .font('Helvetica-Bold')
          .fillColor(INK)
          .text(section.title, marginL, doc.y, { width: contentW });
        doc
          .moveTo(marginL, doc.y + 2)
          .lineTo(marginL + contentW, doc.y + 2)
          .stroke(BORDER);
        doc.moveDown(0.5);
      }
      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(INK_MID)
        .text(section.content ?? '', marginL, doc.y, {
          width: contentW,
          lineGap: 3,
        });
      doc.moveDown(1.5);
    }

    // -- Pricing table header -------------------------------------------------
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text('Pricing Breakdown', marginL, doc.y, { width: contentW });
    doc
      .moveTo(marginL, doc.y + 2)
      .lineTo(marginL + contentW, doc.y + 2)
      .stroke(BORDER);
    doc.moveDown(0.8);

    // Table column widths
    const col = {
      item: contentW * 0.5,
      qty: contentW * 0.1,
      unit: contentW * 0.2,
      total: contentW * 0.2,
    };
    const colX = {
      item: marginL,
      qty: marginL + col.item,
      unit: marginL + col.item + col.qty,
      total: marginL + col.item + col.qty + col.unit,
    };

    // Table header row
    const thY = doc.y;
    doc
      .rect(marginL, thY, contentW, 20)
      .fill(INK);
    doc
      .fontSize(8)
      .font('Helvetica-Bold')
      .fillColor('#ffffff');
    doc.text('ITEM', colX.item + 6, thY + 6, { width: col.item - 12 });
    doc.text('QTY', colX.qty, thY + 6, { width: col.qty, align: 'right' });
    doc.text('UNIT PRICE', colX.unit, thY + 6, { width: col.unit, align: 'right' });
    doc.text('TOTAL', colX.total, thY + 6, { width: col.total - 6, align: 'right' });

    doc.y = thY + 20;

    // Table rows
    for (let i = 0; i < data.lineItems.length; i++) {
      const li = data.lineItems[i];
      const rowBg = i % 2 === 0 ? '#ffffff' : BG_LIGHT;
      const rowH = li.description ? 36 : 24;
      const rowY = doc.y;

      doc.rect(marginL, rowY, contentW, rowH).fill(rowBg);
      doc
        .moveTo(marginL, rowY + rowH)
        .lineTo(marginL + contentW, rowY + rowH)
        .stroke(BORDER);

      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text(li.name, colX.item + 6, rowY + 7, { width: col.item - 12, ellipsis: true });

      if (li.description) {
        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor(INK_LIGHT)
          .text(li.description, colX.item + 6, rowY + 19, { width: col.item - 12, ellipsis: true });
      }

      doc
        .fontSize(10)
        .font('Helvetica')
        .fillColor(INK_MID)
        .text(String(li.qty ?? 1), colX.qty, rowY + 7, { width: col.qty, align: 'right' })
        .text(fmtCurrency(li.unitPriceCents, data.currency), colX.unit, rowY + 7, { width: col.unit, align: 'right' });

      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text(fmtCurrency(li.totalCents, data.currency), colX.total, rowY + 7, { width: col.total - 6, align: 'right' });

      doc.y = rowY + rowH;
    }

    // Tax breakdown rows (if applicable)
    const hasTax = data.taxBehaviour !== 'exempt' && data.taxCents && data.taxCents > 0;
    if (hasTax) {
      const subtotalY = doc.y;
      doc
        .rect(marginL, subtotalY, contentW, 22)
        .fill('#F5F5F0');
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(INK_LIGHT)
        .text('SUBTOTAL', colX.item + 6, subtotalY + 6, { width: col.item + col.qty + col.unit - 12 })
        .text(fmtCurrency(data.subtotalCents ?? data.totalCents, data.currency), colX.total, subtotalY + 6, { width: col.total - 6, align: 'right' });
      doc.y = subtotalY + 22;

      const taxY = doc.y;
      doc
        .rect(marginL, taxY, contentW, 22)
        .fill('#F5F5F0');
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(INK_LIGHT)
        .text(`${data.taxLabel ?? 'GST'} ${data.taxRate ?? 10}% (${data.taxBehaviour === 'inclusive' ? 'incl.' : 'excl.'})`, colX.item + 6, taxY + 6, { width: col.item + col.qty + col.unit - 12 })
        .text(fmtCurrency(data.taxCents!, data.currency), colX.total, taxY + 6, { width: col.total - 6, align: 'right' });
      doc.y = taxY + 22;
    }

    // Total row
    const totalY = doc.y;
    doc
      .rect(marginL, totalY, contentW, 28)
      .fill(INK);
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#ffffff')
      .text('TOTAL', colX.item + 6, totalY + 8, { width: col.item + col.qty + col.unit - 12 })
      .text(fmtCurrency(data.totalCents, data.currency), colX.total, totalY + 8, {
        width: col.total - 6,
        align: 'right',
      });

    doc.y = totalY + 28 + 40;

    // -- Signature block -------------------------------------------------------
    // Receipts don't include the signature block — it's already captured on the proposal.
    if (!isReceipt && data.signatureDataUrl && data.signerName) {
      if (doc.y + 180 > doc.page.height - 80) doc.addPage();
      const sigSectionY = doc.y;
      doc
        .moveTo(marginL, sigSectionY)
        .lineTo(marginL + contentW, sigSectionY)
        .stroke(BORDER);
      doc.moveDown(1);
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text('Accepted & Signed', marginL, doc.y, { width: contentW });
      doc.moveDown(0.6);
      try {
        const base64 = data.signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64, 'base64');
        doc.image(imgBuf, marginL, doc.y, { width: 200, height: 60, fit: [200, 60] });
        doc.y = doc.y + 68;
      } catch {
        const lineY = doc.y + 30;
        doc.moveTo(marginL, lineY).lineTo(marginL + 200, lineY).stroke(INK_MID);
        doc.y = lineY + 8;
      }
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(INK)
        .text(data.signerName, marginL, doc.y, { width: contentW / 2 });
      if (data.signerEmail) {
        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor(INK_LIGHT)
          .text(data.signerEmail, marginL, doc.y + 14, { width: contentW / 2 });
        doc.y = doc.y + 14;
      }
      if (data.signedAt) {
        doc
          .fontSize(8)
          .font('Helvetica')
          .fillColor(INK_LIGHT)
          .text(
            `Signed ${fmtDate(data.signedAt)}${data.signatureIp ? ` · IP ${data.signatureIp}` : ''}`,
            marginL + contentW / 2,
            sigSectionY + 20,
            { width: contentW / 2, align: 'right' }
          );
      }
      doc.moveDown(2);
    }

    // -- Footer ---------------------------------------------------------------
    const footerY = doc.page.height - 50;
    doc
      .moveTo(marginL, footerY)
      .lineTo(marginL + contentW, footerY)
      .stroke(BORDER);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor(INK_LIGHT)
      .text('Generated by EziQuotes · ezyquotes.com', marginL, footerY + 8, {
        width: contentW / 2,
      })
      .text(`${isReceipt ? 'Receipt' : 'Ref'}: ${data.slug}`, marginL + contentW / 2, footerY + 8, {
        width: contentW / 2,
        align: 'right',
      });

    doc.end();
  });
}
