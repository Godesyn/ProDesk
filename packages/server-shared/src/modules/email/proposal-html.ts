import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { formatPrice } from '../../lib/num.js';
import {
  proposals,
  proposalItems,
  proposalPhases,
  agencies,
  brands,
  services,
  packages,
  globalSettings,
} from '../../db/schema.js';
import {
  computePayInFull,
  computePaymentPlan,
  type PaymentPlan,
  type PaymentPlanBreakdown,
  type BillingSubtotals,
} from '../billing/pricing.js';

/**
 * Shared email palette. Anchored on the Prodesk brand orange with a calm slate
 * neutral scale so phases, packages, badges, billing and the CTA all read as one
 * cohesive system instead of the old blue/purple/green/orange mix.
 */
const C = {
  brand: '#fe8b08',
  brandDark: '#d97706',
  brandSoft: '#fff6ea',
  brandBorder: '#fbdcb4',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  page: '#eef1f6',
  card: '#ffffff',
  inset: '#f8fafc',
  hairline: '#eef2f7',
  border: '#e3e8ef',
  // Accents reserved for semantic badges only.
  green: '#047857', greenSoft: '#ecfdf5', greenBorder: '#d1fae5',
  blue: '#1d4ed8', blueSoft: '#eff6ff', blueBorder: '#dbeafe',
  violet: '#7c3aed', violetSoft: '#faf5ff', violetBorder: '#f0e3fe',
};

/**
 * Rich proposal email — a port of
 * functions/src/modules/projects/proposal_template.ts `generateProposalEmailHtml`,
 * reading the Drizzle proposal tables instead of the Firestore ProposalModel.
 * Renders the same two-column layout (line items with phases/packages/badges +
 * billing summary with payment-plan breakdowns). Returns null if the proposal
 * is gone.
 */
export async function generateProposalEmailHtml(
  proposalId: string,
  opts?: { referralLink?: string },
): Promise<{ subject: string; html: string; brandEmail?: string | null; brandId: string | null } | null> {
  const p = (await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1))[0];
  if (!p) return null;

  const [items, phases] = await Promise.all([
    db.select().from(proposalItems).where(eq(proposalItems.proposalId, proposalId)).orderBy(proposalItems.sortOrder),
    db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, proposalId)).orderBy(proposalPhases.sortOrder),
  ]);

  const agency = p.agencyId ? (await db.select().from(agencies).where(eq(agencies.id, p.agencyId)).limit(1))[0] : null;
  const brand = p.brandId ? (await db.select().from(brands).where(eq(brands.id, p.brandId)).limit(1))[0] : null;

  // Resolve denormalized names (prod stored serviceName/packageName/agencyName on the item).
  const serviceIds = [...new Set(items.map((i) => i.serviceId).filter(Boolean))] as string[];
  const packageIds = [...new Set(items.map((i) => i.packageId).filter(Boolean))] as string[];
  const itemAgencyIds = [...new Set(items.map((i) => i.agencyId).filter(Boolean))] as string[];
  const [svcRows, pkgRows, agencyRows] = await Promise.all([
    serviceIds.length ? db.select({ id: services.id, name: services.name }).from(services).where(inArray(services.id, serviceIds)) : Promise.resolve([]),
    packageIds.length ? db.select({ id: packages.id, name: packages.name }).from(packages).where(inArray(packages.id, packageIds)) : Promise.resolve([]),
    itemAgencyIds.length ? db.select({ id: agencies.id, name: agencies.businessName }).from(agencies).where(inArray(agencies.id, itemAgencyIds)) : Promise.resolve([]),
  ]);
  const svcName = new Map(svcRows.map((r) => [r.id, r.name]));
  const pkgName = new Map(pkgRows.map((r) => [r.id, r.name]));
  const agencyName = new Map(agencyRows.map((r) => [r.id, r.name]));

  const gs = (await db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
  const paymentPlans = ((gs?.defaultPaymentPlans ?? []) as PaymentPlan[]).filter((pl) => pl && pl.name);

  // ── Subtotals (mirror proposals.ts computeSubtotals, excluding brand-excluded) ──
  const editable = items.filter((i) => !i.isExcludedByBrand);
  const num = (v: unknown) => Number(v ?? 0);
  const oneOffSubtotal = editable.reduce((s, i) => (i.type === 'heading' || i.isRecurring ? s : s + num(i.amount) * i.quantity), 0);
  const recurringUpfront = editable.reduce((s, i) => (i.type === 'heading' || !i.isRecurring ? s : s + num(i.upfrontFee) * i.quantity), 0);
  const recurringWeekly = editable.reduce((s, i) => (i.type === 'heading' || !i.isRecurring ? s : s + num(i.amount) * i.quantity), 0);

  const subtotals: BillingSubtotals = {
    oneOffSubtotal: Math.max(0, oneOffSubtotal),
    recurringUpfrontTotal: Math.max(0, recurringUpfront),
    recurringWeeklyTotal: Math.max(0, recurringWeekly),
  };
  const breakdowns: PaymentPlanBreakdown[] = [
    computePayInFull(subtotals),
    ...paymentPlans.map((pl) => computePaymentPlan(subtotals, pl)),
  ];

  const hasRecurring = recurringUpfront > 0 || recurringWeekly > 0;
  const itemCount = items.filter((i) => i.type !== 'heading').length;
  const brandName = (p.brandSnapshot?.name as string) ?? brand?.businessName ?? 'Client';
  const brandEmail = (p.brandSnapshot?.email as string) ?? brand?.email ?? null;
  const senderAgencyName = agency?.businessName ?? (p.agencySnapshot?.name as string) ?? 'Your Agency';

  // ── Items (grouped by phase, then by package) ──
  const effectivePhases =
    phases.length > 0
      ? phases.map((ph, idx) => ({ id: ph.id, name: ph.name, order: idx + 1, startDelayDays: ph.startDelayDays ?? 0 }))
      : [{ id: 'default', name: 'Phase 1', order: 1, startDelayDays: 0 }];
  const sortedItems = [...items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  let itemsHtml = '';
  for (let i = 0; i < effectivePhases.length; i++) {
    const phase = effectivePhases[i];
    const phaseItems = sortedItems.filter((it) => (phases.length > 0 ? it.phaseId === phase.id : true));
    if (phaseItems.length === 0 && phases.length > 0) continue;

    itemsHtml += `
      <tr><td style="padding-top: ${i > 0 ? '20px' : '0'}">
        ${
          phases.length > 0
            ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px;"><tr><td>
                <div style="display: inline-block; background-color: ${C.inset}; border: 1px solid ${C.hairline}; border-radius: 8px; padding: 6px 12px 6px 7px;">
                  <span style="display: inline-block; width: 20px; height: 20px; background-color: ${C.brand}; border-radius: 50%; text-align: center; vertical-align: middle; line-height: 20px; color: #fff; font-size: 11px; font-weight: bold;">${phase.order}</span>
                  <span style="font-size: 12px; font-weight: 700; color: ${C.ink}; margin-left: 9px; vertical-align: middle;">${escapeHtml(phase.name)}</span>
                  ${phase.startDelayDays > 0 ? `<span style="font-size: 11px; color: ${C.muted}; margin-left: 8px; vertical-align: middle;">&bull; Starts in ${phase.startDelayDays} days</span>` : ''}
                </div></td></tr></table>`
            : ''
        }`;

    let j = 0;
    while (j < phaseItems.length) {
      const current = phaseItems[j];
      if (current.packageId) {
        const packageId = current.packageId;
        const group = [current];
        j++;
        while (j < phaseItems.length && phaseItems[j].packageId === packageId) group.push(phaseItems[j++]);

        const packageCount = group.length;
        const packageTotal = group.reduce((s, it) => s + num(it.amount) * it.quantity, 0);
        const allExcluded = group.every((it) => it.isExcludedByBrand);
        const allRemoval = group.every((it) => it.removalProposedByBrand);
        const pktBorder = allExcluded ? C.border : allRemoval ? C.brandBorder : C.violetBorder;
        const pktBg = allExcluded ? C.inset : allRemoval ? C.brandSoft : C.card;
        const pktHeaderBg = allExcluded ? C.inset : C.violetSoft;
        const pkgLabel = (current.packageId && pkgName.get(current.packageId)) || 'Package';

        itemsHtml += `
          <div style="margin-bottom: 8px; border: 1px solid ${pktBorder}; border-radius: 12px; background-color: ${pktBg}; overflow: hidden; opacity: ${allExcluded ? '0.65' : '1.0'};">
            <div style="padding: 13px 15px;">
              <span style="font-size: 13px; font-weight: 700; color: ${allExcluded ? C.muted : '#6d28d9'}; text-decoration: ${allExcluded ? 'line-through' : 'none'};">${escapeHtml(pkgLabel)}</span>
              <div style="font-size: 11px; color: ${allExcluded ? C.faint : C.violet}; margin-top: 3px;">${packageCount} items &bull; Total ${formatCurrency(packageTotal)}</div>
            </div>
            <div style="background-color: ${pktHeaderBg}; border-top: 1px solid ${pktBorder}; padding: 12px;">`;
        group.forEach((it, idx) => {
          itemsHtml += buildItemHtml(it, true, idx === group.length - 1, { num, svcName, pkgName, agencyName });
        });
        itemsHtml += `</div></div>`;
      } else {
        itemsHtml += buildItemHtml(current, false, false, { num, svcName, pkgName, agencyName });
        j++;
      }
    }
    itemsHtml += `</td></tr>`;
  }

  const subject = `Proposal from ${senderAgencyName} - ${p.title ?? 'Proposal'}`;
  const agencyLogo = agency?.logoUrl || null;
  // Headline mirrors the in-app proposal header: full upfront (one-off + recurring
  // setup) as the big number, with a `+ $Y / wk` line for the recurring weekly cost
  // — so the PDF/email never shows a bare total that hides the subscription.
  const headlineUpfront = subtotals.oneOffSubtotal + subtotals.recurringUpfrontTotal;
  const headlineWeekly = subtotals.recurringWeeklyTotal;

  // Reusable section header (brand tick + uppercase label) for each card.
  const sectionHead = (label: string) =>
    `<tr><td style="padding: 22px 24px 4px;">
       <span style="display: inline-block; width: 8px; height: 8px; border-radius: 2px; background-color: ${C.brand}; vertical-align: middle;"></span>
       <span style="font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: ${C.ink}; margin-left: 9px; vertical-align: middle;">${label}</span>
     </td></tr>`;

  // Compact label/value row used inside the billing summary cards.
  const billRow = (label: string, value: string, opts?: { last?: boolean; strong?: boolean }) =>
    `<tr>
       <td style="padding: 0 14px ${opts?.last ? '11px' : '7px'}; font-size: 12px; color: ${C.muted};">${label}</td>
       <td style="padding: 0 14px ${opts?.last ? '11px' : '7px'}; font-size: ${opts?.strong ? '13px' : '12px'}; font-weight: ${opts?.strong ? '700' : '600'}; color: ${C.ink}; text-align: right;">${value}</td>
     </tr>`;

  const groupCard = (heading: string, rows: string, accent?: { bg: string; border: string; label: string }) =>
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${accent?.bg ?? C.card}; border: 1px solid ${accent?.border ?? C.hairline}; border-radius: 10px;">
       <tr><td colspan="2" style="padding: 11px 14px 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: ${accent?.label ?? C.faint};">${heading}</td></tr>
       ${rows}
     </table>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><title>Proposal</title>
<style>
  body{margin:0;padding:0;background-color:${C.page};-webkit-font-smoothing:antialiased;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;}
  table{border-collapse:collapse;}
  img{border:0;line-height:100%;outline:none;text-decoration:none;}
  @media only screen and (max-width:640px){
    .col-main,.col-side{display:block !important;width:100% !important;box-sizing:border-box;padding:0 !important;}
    .col-side{padding-top:18px !important;}
  }
</style></head>
<body style="margin:0;padding:0;background-color:${C.page};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${C.body};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page};"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:820px;width:100%;">

      <!-- ── Hero header ── -->
      <tr><td style="padding-bottom:18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.card};border:1px solid ${C.border};border-radius:18px;overflow:hidden;">
          <tr><td style="height:5px;background-color:${C.brand};font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:24px 30px 6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle">
                ${
                  agencyLogo
                    ? `<img src="${escapeHtml(agencyLogo)}" width="34" height="34" alt="" style="border-radius:9px;vertical-align:middle;border:1px solid ${C.border};"><span style="font-size:15px;font-weight:600;color:${C.ink};vertical-align:middle;margin-left:11px;">${escapeHtml(senderAgencyName)}</span>`
                    : `<span style="font-size:15px;font-weight:700;color:${C.ink};">${escapeHtml(senderAgencyName)}</span>`
                }
              </td>
              <td valign="middle" align="right">
                <span style="display:inline-block;padding:6px 13px;background-color:${statusColor(p.status)}14;border:1px solid ${statusColor(p.status)}33;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.4px;color:${statusColor(p.status)};">${statusLabel(p.status)}</span>
              </td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:16px 30px 4px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:${C.faint};text-transform:uppercase;">Proposal #${escapeHtml(p.invoiceNumber || p.id.substring(0, 8).toUpperCase())}</div>
            <div style="font-size:25px;font-weight:800;color:${C.ink};margin-top:7px;line-height:1.2;">${escapeHtml(p.title || 'Proposal')}</div>
            <div style="font-size:14px;color:${C.muted};margin-top:7px;">Prepared for <span style="color:${C.body};font-weight:600;">${escapeHtml(brandName)}</span>${brandEmail ? ` &middot; <span style="color:${C.faint};">${escapeHtml(brandEmail)}</span>` : ''}</div>
            ${p.description ? `<div style="font-size:13px;color:${C.muted};margin-top:12px;line-height:1.55;max-width:520px;">${escapeHtml(p.description)}</div>` : ''}
          </td></tr>
          <tr><td style="padding:20px 30px 26px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.inset};border:1px solid ${C.hairline};border-radius:12px;"><tr>
              <td width="34%" valign="top" style="padding:14px 16px;border-right:1px solid ${C.hairline};">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${C.faint};text-transform:uppercase;">Total</div>
                <div style="font-size:21px;font-weight:800;color:${C.brandDark};margin-top:4px;">${headlineUpfront > 0 || headlineWeekly === 0 ? formatCurrency(headlineUpfront) : `${formatCurrency(headlineWeekly)} / wk`}</div>
                ${headlineUpfront > 0 && headlineWeekly > 0 ? `<div style="font-size:11px;font-weight:700;color:${C.muted};margin-top:2px;">+ ${formatCurrency(headlineWeekly)} / wk</div>` : ''}
              </td>
              <td width="33%" valign="top" style="padding:14px 16px;border-right:1px solid ${C.hairline};">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${C.faint};text-transform:uppercase;">Date</div>
                <div style="font-size:14px;font-weight:600;color:${C.ink};margin-top:6px;">${formatDate(p.createdAt)}</div>
              </td>
              <td width="33%" valign="top" style="padding:14px 16px;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${C.faint};text-transform:uppercase;">Valid Until</div>
                <div style="font-size:14px;font-weight:600;color:${C.ink};margin-top:6px;">${formatDate(p.expiresAt)}</div>
              </td>
            </tr></table>
          </td></tr>
        </table>
      </td></tr>

      <!-- ── Body: two columns ── -->
      <tr><td>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td class="col-main" width="60%" valign="top" style="padding-right:9px;">

            <!-- Items -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;margin-bottom:18px;">
              ${sectionHead('Services &amp; Line Items')}
              <tr><td style="padding:10px 18px 18px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${itemsHtml}
                </table>
              </td></tr>
            </table>

            <!-- Terms -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;margin-bottom:18px;">
              ${sectionHead('Terms &amp; Conditions')}
              <tr><td style="padding:12px 24px 22px;font-size:13px;color:${C.muted};line-height:1.6;white-space:pre-line;">${escapeHtml(p.termsAndConditions || 'No specific terms provided.')}${p.clientNotes ? `<div style="margin-top:16px;font-weight:700;color:${C.ink};">Notes</div><div style="margin-top:6px;">${escapeHtml(p.clientNotes)}</div>` : ''}</td></tr>
            </table>

          </td>

          <!-- Billing sidebar -->
          <td class="col-side" width="40%" valign="top" style="padding-left:9px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.card};border:1px solid ${C.border};border-radius:16px;">
              ${sectionHead('Billing Summary')}

              <tr><td style="padding:12px 18px 0;">
                ${groupCard('Overview', billRow('Items', String(itemCount)) + billRow('Valid for', `${p.validityDays ?? 30} days`, { last: true }))}
              </td></tr>

              <tr><td style="padding:10px 18px 0;opacity:${subtotals.oneOffSubtotal === 0 ? '0.45' : '1'};">
                ${groupCard('One-off Items', billRow('Subtotal', formatCurrency(subtotals.oneOffSubtotal), { last: true, strong: true }))}
              </td></tr>

              ${
                hasRecurring
                  ? `<tr><td style="padding:10px 18px 0;">
                ${groupCard(
                  'Recurring',
                  (subtotals.recurringUpfrontTotal > 0 ? billRow('Setup (once)', formatCurrency(subtotals.recurringUpfrontTotal)) : '') +
                    (subtotals.recurringWeeklyTotal > 0 ? billRow('Weekly', formatCurrency(subtotals.recurringWeeklyTotal), { last: true, strong: true }) : ''),
                )}
              </td></tr>`
                  : ''
              }

              <tr><td style="padding:18px 18px 4px;">
                <div style="font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:${C.faint};margin-bottom:10px;">Payment Options</div>
                ${breakdowns
                  .map(
                    (bd, idx) => `
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${idx === 0 ? C.brandSoft : C.inset};border:1px solid ${idx === 0 ? C.brandBorder : C.hairline};border-radius:12px;margin-bottom:9px;">
                    <tr><td colspan="2" style="padding:11px 14px 7px;font-size:11px;font-weight:700;letter-spacing:0.2px;color:${idx === 0 ? C.brandDark : C.body};">${escapeHtml(bd.planLabel)}</td></tr>
                    <tr><td style="padding:0 14px 7px;font-size:11px;color:${C.muted};">Upfront</td><td style="padding:0 14px 7px;font-size:13px;font-weight:800;color:${C.brandDark};text-align:right;">${formatCurrency(bd.upfront)}</td></tr>
                    ${bd.weeklyDuring > 0 ? `<tr><td style="padding:0 14px 7px;font-size:11px;color:${C.muted};">${bd.durationWeeks ? `&times;${bd.durationWeeks} weeks` : 'Then weekly'}</td><td style="padding:0 14px 7px;font-size:12px;font-weight:700;color:${C.ink};text-align:right;">${formatCurrency(bd.weeklyDuring)}</td></tr>` : ''}
                    ${bd.weeklyAfter > 0 ? `<tr><td style="padding:0 14px 11px;font-size:11px;color:${C.muted};">Then weekly</td><td style="padding:0 14px 11px;font-size:12px;font-weight:700;color:${C.ink};text-align:right;">${formatCurrency(bd.weeklyAfter)}</td></tr>` : ''}
                  </table>`,
                  )
                  .join('')}
              </td></tr>

              <tr><td style="padding:14px 18px 24px;">
                ${
                  opts?.referralLink
                    ? `<a href="${opts.referralLink}" style="display:block;padding:15px 20px;background-color:${C.brand};color:#ffffff;text-decoration:none;border-radius:11px;font-size:15px;font-weight:700;text-align:center;box-shadow:0 2px 6px rgba(254,139,8,0.28);">View &amp; Accept Proposal &rarr;</a>
                       <div style="text-align:center;font-size:11px;color:${C.faint};margin-top:11px;">Secure link &bull; review before you accept</div>`
                    : `<div style="padding:14px;background-color:${C.inset};border:1px solid ${C.hairline};border-radius:11px;font-size:12px;color:${C.muted};text-align:center;line-height:1.5;">Log in to the app to review and accept this proposal.</div>`
                }
              </td></tr>
            </table>
          </td>
        </tr></table>
      </td></tr>

      <!-- ── Footer ── -->
      <tr><td style="padding:24px 8px 4px;text-align:center;">
        <div style="font-size:12px;color:${C.faint};">Sent by <span style="color:${C.muted};font-weight:600;">${escapeHtml(senderAgencyName)}</span></div>
        <div style="font-size:11px;color:${C.faint};margin-top:6px;">Powered by Prodesk</div>
      </td></tr>

    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html, brandEmail, brandId: p.brandId };
}

type ItemRow = typeof proposalItems.$inferSelect;
type NameCtx = {
  num: (v: unknown) => number;
  svcName: Map<string, string>;
  pkgName: Map<string, string>;
  agencyName: Map<string, string>;
};

function buildItemHtml(item: ItemRow, isNested: boolean, isLastInPackage: boolean, ctx: NameCtx): string {
  if (item.type === 'heading') {
    return `<div style="width: 100%; margin: 14px 0 8px; padding: 0 2px;"><span style="font-weight: 700; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: ${C.faint};">${escapeHtml(item.headingText || 'Section')}</span></div>`;
  }

  const isExcluded = item.isExcludedByBrand;
  const isRemoval = item.removalProposedByBrand;
  const borderColor = isExcluded ? C.border : isRemoval ? C.brandBorder : C.hairline;
  const bgColor = isExcluded ? C.inset : isRemoval ? C.brandSoft : C.card;
  const opacity = isExcluded ? '0.55' : '1.0';

  const displayName = (item.serviceId && ctx.svcName.get(item.serviceId)) || item.description || 'Service';
  const showDescription = !!(item.serviceId && ctx.svcName.get(item.serviceId) && item.description);
  const itemAgencyName = item.agencyId ? ctx.agencyName.get(item.agencyId) : null;
  const pkgName = item.packageId ? ctx.pkgName.get(item.packageId) : null;

  const badge = (text: string, bg: string, border: string, color: string) =>
    `<span style="display: inline-block; padding: 3px 8px; background-color: ${bg}; border: 1px solid ${border}; border-radius: 6px; font-size: 10px; color: ${color}; font-weight: 700; margin-right: 5px; margin-top: 7px;">${text}</span>`;

  let badges = '';
  if (item.isOptional) badges += badge('Optional', C.inset, C.border, C.muted);
  if (item.isRecurring) badges += badge('Recurring', C.greenSoft, C.greenBorder, C.green);
  if (isRemoval) badges += badge('Removal Proposed', C.brandSoft, C.brandBorder, C.brandDark);
  if (itemAgencyName) badges += badge(escapeHtml(itemAgencyName), C.blueSoft, C.blueBorder, C.blue);
  if (pkgName && !isNested) badges += badge(`Package: ${escapeHtml(pkgName)}`, C.violetSoft, C.violetBorder, C.violet);
  if (badges) badges = `<div style="line-height: 1;">${badges}</div>`;

  let optionsStr = '';
  if (item.selectedOptions && Object.keys(item.selectedOptions).length > 0) {
    optionsStr += Object.entries(item.selectedOptions)
      .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
      .join(', ');
  }
  if (Array.isArray(item.selectedAddons) && item.selectedAddons.length > 0) {
    if (optionsStr) optionsStr += '<br>';
    optionsStr += '+ ' + item.selectedAddons.map((a) => escapeHtml(String((a as { name?: unknown })?.name ?? ''))).join('<br>+ ');
  }

  const upfront = ctx.num(item.upfrontFee);
  const strike = isExcluded ? 'line-through' : 'none';
  return `
    <div style="margin-bottom: ${isLastInPackage ? '0' : '8px'}; padding: 13px 15px; background-color: ${bgColor}; border-radius: 11px; border: 1px solid ${borderColor}; opacity: ${opacity};">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="top">
          <div style="font-weight: 600; font-size: 14px; color: ${C.ink}; text-decoration: ${strike};">${escapeHtml(displayName)}</div>
          ${badges}
          ${showDescription ? `<div style="font-size: 12px; color: ${C.muted}; margin-top: 6px; line-height: 1.5;">${escapeHtml(item.description!)}</div>` : ''}
          ${optionsStr ? `<div style="margin-top: 9px; padding: 6px 10px; background-color: ${C.inset}; border: 1px solid ${C.hairline}; border-radius: 7px; font-size: 11px; color: ${C.body}; font-weight: 600; line-height: 1.5;">${optionsStr}</div>` : ''}
        </td>
        <td valign="top" align="right" width="104" style="padding-left: 10px;">
          <div style="font-weight: 700; font-size: 14px; color: ${C.ink}; text-decoration: ${strike};">${formatCurrency(ctx.num(item.amount))}${item.isRecurring ? ' / wk' : ''}</div>
          ${item.quantity > 1 ? `<div style="font-size: 11px; color: ${C.faint}; margin-top: 3px;">&times; ${item.quantity}</div>` : ''}
          ${item.isRecurring && upfront > 0 ? `<div style="font-size: 10px; color: ${C.faint}; margin-top: 3px;">+ ${formatCurrency(upfront)} setup</div>` : ''}
        </td>
      </tr></table>
    </div>`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'draft': return '#64748b';
    case 'sent': return '#2563eb';
    case 'viewed': return '#7c3aed';
    case 'accepted': return '#16a34a';
    case 'rejected': return '#dc2626';
    case 'expired': return '#d97706';
    case 'changeRequested': return '#d97706';
    default: return '#64748b';
  }
}

function statusLabel(status: string): string {
  if (status === 'changeRequested') return 'CHANGE REQUESTED';
  return status.toUpperCase();
}

function formatCurrency(amount: number): string {
  return formatPrice(amount);
}

function formatDate(date: unknown): string {
  if (!date) return 'N/A';
  const d = date instanceof Date ? date : new Date(date as string);
  return isNaN(d.getTime())
    ? 'N/A'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(
    /[&<>'"]/g,
    (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[tag] || tag,
  );
}
