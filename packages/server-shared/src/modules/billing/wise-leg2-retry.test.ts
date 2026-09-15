import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The leg-2 retry sweep must never turn a lost transfer into a DOUBLE PAYMENT.
 *
 * A `failed` payout whose `wiseFunding.status` is `funded` but which carries no
 * `wiseTransferId` is ambiguous: post-balance-gate it usually means leg 2 died
 * before creating a transfer (nothing sent), but the pre-gate code produced the
 * very same state AFTER creating a transfer it couldn't fund — and those transfers
 * were frequently funded and sent hours later, once leg-1's cash landed in our
 * Wise balance. In July 2026 that cost us four payouts (AUD 2,014) that read
 * `failed` while Wise had already paid the contractor; re-sending them would have
 * paid a second time. The sweep therefore skips those rows and reports them for
 * manual reconciliation, and only ever re-funds a transfer whose id we hold.
 */
const payViaWise = vi.fn().mockResolvedValue('99999');
const fundWiseTransfer = vi.fn().mockResolvedValue(undefined);

vi.mock('./payout-providers.js', () => ({
  payViaWise: (...a: unknown[]) => payViaWise(...a),
  fundWiseTransfer: (...a: unknown[]) => fundWiseTransfer(...a),
  WiseBalanceNotYetFundedError: class WiseBalanceNotYetFundedError extends Error {
    transferId?: string;
    constructor(transferId?: string) {
      super('balance not funded');
      this.transferId = transferId;
    }
  },
}));
vi.mock('../stripe/client.js', () => ({ stripe: {} }));
vi.mock('../stripe/env-tag.js', () => ({ withEnvTag: (v: unknown) => v }));
vi.mock('./wise-recipient.js', () => ({
  createWiseRecipient: vi.fn(),
  resolveTargetCurrency: vi.fn(),
}));
vi.mock('./payout-recipient.js', () => ({
  resolvePayoutRecipient: vi
    .fn()
    .mockResolvedValue({ payoutMethods: { wire: { recipientId: '1470255048' } } }),
}));
vi.mock('../../db/index.js', () => ({ db: {} }));

const { retryFundedWiseLeg2 } = await import('./wise.js');

/** Minimal drizzle stand-in: `select().from().where()` awaits to `rows`. */
function fakeDb(rows: unknown[]) {
  const updated: unknown[] = [];
  return {
    db: {
      select: () => ({ from: () => ({ where: async () => rows }) }),
      update: () => ({
        set: (v: unknown) => ({
          where: async () => {
            updated.push(v);
          },
        }),
      }),
    } as never,
    updated,
  };
}

const funded = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  amount: '430.00',
  currency: 'AUD',
  status: 'failed',
  wiseFunding: { status: 'funded', grossAmount: 430 },
  ...over,
});

beforeEach(() => {
  payViaWise.mockClear();
  fundWiseTransfer.mockClear();
});

describe('retryFundedWiseLeg2 — never double-pays a lost transfer', () => {
  it('SKIPS a `failed` payout with no wiseTransferId instead of sending again', async () => {
    const { db } = fakeDb([funded()]);
    const result = await retryFundedWiseLeg2(db);

    expect(payViaWise).not.toHaveBeenCalled();
    expect(fundWiseTransfer).not.toHaveBeenCalled();
    expect(result).toMatchObject({ considered: 1, sent: 0, needsReconcile: 1 });
  });

  it('re-funds a `failed` payout that DOES carry a wiseTransferId (idempotent)', async () => {
    const { db } = fakeDb([
      funded({ wiseFunding: { status: 'funded', grossAmount: 430, wiseTransferId: '2267335392' } }),
    ]);
    const result = await retryFundedWiseLeg2(db);

    // Re-funds the SAME transfer — never mints a second one.
    expect(fundWiseTransfer).toHaveBeenCalledWith('2267335392');
    expect(payViaWise).not.toHaveBeenCalled();
    expect(result).toMatchObject({ considered: 1, sent: 1, needsReconcile: 0 });
  });

  it('still first-sends a `processingByWire` payout with no transfer id', async () => {
    // That state is only reachable post-gate, where a missing id provably means
    // the gate skipped BEFORE creating a transfer — so nothing was sent.
    const { db } = fakeDb([funded({ status: 'processingByWire' })]);
    const result = await retryFundedWiseLeg2(db);

    expect(payViaWise).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ considered: 1, sent: 1, needsReconcile: 0 });
  });

  it('skips only the ambiguous rows in a mixed sweep', async () => {
    const { db } = fakeDb([
      funded({ id: 'lost' }),
      funded({
        id: 'refundable',
        wiseFunding: { status: 'funded', grossAmount: 430, wiseTransferId: '777' },
      }),
      funded({ id: 'fresh', status: 'processingByWire' }),
    ]);
    const result = await retryFundedWiseLeg2(db);

    expect(fundWiseTransfer).toHaveBeenCalledWith('777');
    expect(payViaWise).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ considered: 3, sent: 2, needsReconcile: 1 });
  });
});
