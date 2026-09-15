import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { payViaWise, WiseBalanceNotYetFundedError } from './payout-providers.js';

/**
 * The proactive balance gate on leg-2. Wise happily CREATES a transfer even when
 * our balance can't fund it — that transfer then strands in
 * `incoming_payment_waiting` (Wise's "paused" / "waiting for your money" state)
 * until leg-1 credits the balance, and every retry mints another orphan. These
 * lock in the gate: (a) a short balance defers with WiseBalanceNotYetFundedError
 * BEFORE any transfer is minted; (b) a sufficient balance creates + funds.
 */

const RECIPIENT = '1470255048';

type Call = { url: string; init?: { method?: string; body?: string } };

/** Mock the Wise API surface payViaWise touches; `balance` = our AUD balance. */
function mockWise(balance: number) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: Call['init']) => {
    const u = String(url);
    calls.push({ url: u, init });
    // Recipient's own (delivery) currency — a USD account, so no route fallback.
    if (u.includes(`/v1/accounts/${RECIPIENT}`))
      return new Response(JSON.stringify({ currency: 'USD' }), { status: 200 });
    if (u.includes('/quotes'))
      return new Response(
        JSON.stringify({
          id: 'quote_1',
          paymentOptions: [{ payIn: 'BALANCE', sourceAmount: 430 }],
        }),
        { status: 200 },
      );
    if (u.includes('/balances'))
      return new Response(
        JSON.stringify([{ currency: 'AUD', amount: { value: balance } }]),
        { status: 200 },
      );
    // The funding pay-in — path also contains "/transfers/", so check it first.
    if (u.includes('/payments'))
      return new Response(JSON.stringify({ status: 'COMPLETED' }), { status: 200 });
    if (u.includes('/v1/transfers'))
      return new Response(JSON.stringify({ id: 987654 }), { status: 200 });
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  return { calls };
}

const minted = (calls: Call[]) =>
  calls.some((c) => c.url.includes('/v1/transfers') && c.init?.method === 'POST');

beforeEach(() => {
  process.env.WISE_API_TOKEN = 'test-token';
  process.env.WISE_PROFILE_ID = '123';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WISE_API_TOKEN;
  delete process.env.WISE_PROFILE_ID;
});

describe('payViaWise — proactive balance gate', () => {
  it('defers (WiseBalanceNotYetFundedError) WITHOUT minting a transfer when the balance is short', async () => {
    const { calls } = mockWise(1); // 1 AUD available, 430 needed
    await expect(
      payViaWise({ amount: 430, currency: 'AUD', recipientId: RECIPIENT }),
    ).rejects.toBeInstanceOf(WiseBalanceNotYetFundedError);
    // The whole point: nothing was created, so nothing strands as "paused".
    expect(minted(calls)).toBe(false);
  });

  it('creates + funds the transfer once the balance covers the source total', async () => {
    const { calls } = mockWise(2015);
    const id = await payViaWise({
      amount: 430,
      currency: 'AUD',
      recipientId: RECIPIENT,
    });
    expect(id).toBe('987654');
    expect(minted(calls)).toBe(true);
    expect(calls.some((c) => c.url.includes('/payments'))).toBe(true);
  });
});
