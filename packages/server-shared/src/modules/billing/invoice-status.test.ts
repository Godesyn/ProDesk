import { describe, expect, it } from 'vitest';
import { payoutStatus } from '../../db/schema.js';
import { PAYOUT_TO_INVOICE_STATUS, deriveInvoiceStatus } from './invoice-parties.js';

/**
 * Invoice status is derived from the linked payout, never stored
 * (docs/invoices.md §7). The map is therefore the only place a payout state
 * becomes an invoice state, and its `?? 'unpaid'` fallback makes an omission
 * silent: a stopped payout read as "awaiting money" rather than "closed".
 * The completeness check is what stops that recurring.
 */
describe('deriveInvoiceStatus', () => {
  it('covers every payout status, so no new one falls through to unpaid', () => {
    const missing = payoutStatus.enumValues.filter((s) => !(s in PAYOUT_TO_INVOICE_STATUS));
    expect(missing).toEqual([]);
  });

  it('reads a stopped payout as stopped, not unpaid', () => {
    expect(deriveInvoiceStatus('stopped')).toBe('stopped');
  });

  it('still collapses the pre-settlement states to unpaid', () => {
    for (const s of ['upcoming', 'pending', 'failed']) {
      expect(deriveInvoiceStatus(s)).toBe('unpaid');
    }
  });

  it('treats a payout-less brand charge as paid', () => {
    expect(deriveInvoiceStatus(null)).toBe('paid');
  });
});
