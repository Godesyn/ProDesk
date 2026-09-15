import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWiseRecipient,
  resolveWiseAccountRequest,
  resolveTargetCurrency,
  WiseCurrencyError,
  type WiseConfig,
} from './wise-recipient.js';

/**
 * Wise's account-requirements for a USD target return BOTH a domestic ACH (`aba`)
 * type and an international `swift_code` type. Wise then rejects a `swift_code`
 * recipient whose bank is inside the US ("you can't send USD via Swift to
 * accounts inside the United States"). These tests lock in that we select the
 * domestic `aba` type for US/USD so that rejection can't recur.
 */

const USD_REQUIREMENTS = [
  {
    type: 'aba',
    fields: [
      { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
      { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
      { name: 'Routing number', group: [{ key: 'abartn', required: true }] },
      { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
      {
        name: 'Account type',
        group: [
          {
            key: 'accountType',
            required: true,
            valuesAllowed: [{ key: 'CHECKING' }, { key: 'SAVINGS' }],
          },
        ],
      },
      { name: 'Address line', group: [{ key: 'address.firstLine', required: true }] },
      { name: 'City', group: [{ key: 'address.city', required: true }] },
      {
        name: 'State',
        group: [
          {
            key: 'address.state',
            required: true,
            valuesAllowed: [
              { key: 'NY', name: 'New York' },
              { key: 'CA', name: 'California' },
            ],
          },
        ],
      },
      { name: 'Post code', group: [{ key: 'address.postCode', required: true }] },
      { name: 'Country', group: [{ key: 'address.country', required: true }] },
    ],
  },
  {
    type: 'swift_code',
    fields: [
      { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
      { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
      { name: 'SWIFT / BIC', group: [{ key: 'swiftCode', required: true }] },
      { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
    ],
  },
];

const AUD_REQUIREMENTS = [
  {
    type: 'australian',
    fields: [
      { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
      { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
      { name: 'BSB code', group: [{ key: 'bsbCode', required: true }] },
      { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
    ],
  },
  {
    type: 'swift_code',
    fields: [
      { name: 'SWIFT / BIC', group: [{ key: 'swiftCode', required: true }] },
      { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
      { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
    ],
  },
];

const CFG: WiseConfig = {
  baseUrl: 'https://api.sandbox.transferwise.tech',
  token: 'test-token',
  profileId: '123',
  sourceCurrency: 'AUD',
};

/** Mock global fetch: GET account-requirements → reqs, POST /v1/accounts → captured. */
function mockWise(requirements: unknown[]) {
  const posted: any[] = [];
  const fetchMock = vi.fn(async (url: string, init?: any) => {
    if (String(url).includes('/v1/account-requirements')) {
      return new Response(JSON.stringify(requirements), { status: 200 });
    }
    if (String(url).includes('/v1/accounts')) {
      posted.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 999 }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { posted };
}

afterEach(() => vi.unstubAllGlobals());

describe('createWiseRecipient — US/USD domestic', () => {
  it('selects the domestic aba type even when a SWIFT/BIC is also supplied', async () => {
    const { posted } = mockWise(USD_REQUIREMENTS);

    const res = await createWiseRecipient(CFG, {
      accountHolderName: 'Jane Doe',
      country: 'US',
      accountNumber: '12345678',
      routingNumber: '021000021',
      swiftCode: 'CHASUS33', // present, but must NOT win for a US-domestic account
      accountType: 'CHECKING',
      address: {
        firstLine: '1 Main St',
        city: 'New York',
        state: 'NY',
        postCode: '10001',
        country: 'US',
      },
    });

    expect(res.currency).toBe('USD');
    expect(res.type).toBe('aba');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('aba');
    expect(posted[0].details.abartn).toBe('021000021');
    expect(posted[0].details.swiftCode).toBeUndefined();
    expect(posted[0].details.address.state).toBe('NY');
  });

  it('resolves a full state name to the 2-letter code Wise expects', async () => {
    const { posted } = mockWise(USD_REQUIREMENTS);

    await createWiseRecipient(CFG, {
      accountHolderName: 'Jane Doe',
      country: 'US',
      accountNumber: '12345678',
      routingNumber: '021000021',
      accountType: 'CHECKING',
      address: {
        firstLine: '1 Main St',
        city: 'Los Angeles',
        state: 'California', // full name — must become "CA"
        postCode: '90001',
        country: 'US',
      },
    });

    expect(posted[0].details.address.state).toBe('CA');
  });

  it('reveals and fills a state hidden behind refreshRequirementsOnChange (the two-step flow)', async () => {
    // Mirrors real Wise: the GET requirements omit `address.state` entirely and
    // flag `address.country` with refreshRequirementsOnChange. State (with its
    // valuesAllowed) only appears once we POST `address.country: "US"` back.
    const ABA_FIELDS_NO_STATE = [
      { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
      { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
      { name: 'Routing number', group: [{ key: 'abartn', required: true }] },
      { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
      {
        name: 'Account type',
        group: [
          { key: 'accountType', required: true, valuesAllowed: [{ key: 'CHECKING' }] },
        ],
      },
      { name: 'Address line', group: [{ key: 'address.firstLine', required: true }] },
      { name: 'City', group: [{ key: 'address.city', required: true }] },
      { name: 'Post code', group: [{ key: 'address.postCode', required: true }] },
      {
        name: 'Country',
        group: [{ key: 'address.country', required: true, refreshRequirementsOnChange: true }],
      },
    ];
    const getReqs = [{ type: 'aba', fields: ABA_FIELDS_NO_STATE }];
    const refreshedReqs = [
      {
        type: 'aba',
        fields: [
          ...ABA_FIELDS_NO_STATE,
          {
            name: 'State',
            group: [
              {
                key: 'address.state',
                required: true,
                valuesAllowed: [
                  { key: 'NY', name: 'New York' },
                  { key: 'CA', name: 'California' },
                ],
              },
            ],
          },
        ],
      },
    ];

    const posted: any[] = [];
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).includes('/v1/account-requirements')) {
        const isRefresh = init?.method === 'POST';
        return new Response(JSON.stringify(isRefresh ? refreshedReqs : getReqs), {
          status: 200,
        });
      }
      if (String(url).includes('/v1/accounts')) {
        posted.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 999 }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await createWiseRecipient(CFG, {
      accountHolderName: 'Jane Doe',
      country: 'US',
      accountNumber: '12345678',
      routingNumber: '021000021',
      accountType: 'CHECKING',
      address: {
        firstLine: '1 Main St',
        city: 'New York',
        state: 'NY',
        postCode: '10001',
        country: 'US',
      },
    });

    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('aba');
    // The state survived the refresh round and made it into the POSTed account.
    expect(posted[0].details.address.state).toBe('NY');
  });

  it('errors clearly when the domestic routing number is missing instead of falling back to SWIFT', async () => {
    mockWise(USD_REQUIREMENTS);

    await expect(
      createWiseRecipient(CFG, {
        accountHolderName: 'Jane Doe',
        country: 'US',
        accountNumber: '12345678',
        swiftCode: 'CHASUS33',
        accountType: 'CHECKING',
        address: {
          firstLine: '1 Main St',
          city: 'New York',
          state: 'NY',
          postCode: '10001',
          country: 'US',
        },
      }),
    ).rejects.toThrow(/Missing bank details/i);
  });
});

describe('createWiseRecipient — AU/AUD domestic', () => {
  it('maps the BSB to Wise\'s `bsbCode` key (not `bsb`) for the australian type', async () => {
    const { posted } = mockWise(AUD_REQUIREMENTS);

    const res = await createWiseRecipient(CFG, {
      accountHolderName: 'Jane Doe',
      country: 'AU',
      accountNumber: '123456789',
      routingNumber: '062-000', // BSB, with formatting
    });

    expect(res.type).toBe('australian');
    expect(posted[0].type).toBe('australian');
    expect(posted[0].details.bsbCode).toBe('062000');
  });
});

describe('selectRecipientType — non-bank rails are never chosen', () => {
  // Wise offers non-bank "alternative payout" rails (email/Interac, UPI/mobile
  // wallets) alongside the real bank types. They ask for very few fields, so a
  // naive fewest-missing pick can land on them over the genuine bank rail and
  // silently mis-route a typed account number as an email/VPA. For a *wire*
  // feature they must be excluded — an incomplete bank input should fail loud.
  const JPY_REQS = [
    {
      type: 'japanese',
      fields: [
        { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
        { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
        { name: 'Bank code', group: [{ key: 'bankCode', required: true }] },
        { name: 'Branch code', group: [{ key: 'branchCode', required: true }] },
        { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
      ],
    },
    {
      type: 'email',
      fields: [
        { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
        { name: 'Email', group: [{ key: 'email', required: true }] },
      ],
    },
  ];

  it('picks the bank rail (japanese) and reports its missing fields rather than falling back to email', async () => {
    mockWise(JPY_REQS);
    const r = await resolveWiseAccountRequest(CFG, {
      accountHolderName: 'Taro Yamada',
      country: 'JP',
      accountNumber: '12345678',
      swiftCode: 'BOTKJPJT',
      currency: 'JPY',
    });
    expect(r.type).toBe('japanese'); // NOT 'email'
    expect(r.missing.length).toBeGreaterThan(0); // branch/bank code we can't supply
  });

  it('createWiseRecipient surfaces a clear missing-fields error instead of creating an email recipient', async () => {
    mockWise(JPY_REQS);
    await expect(
      createWiseRecipient(CFG, {
        accountHolderName: 'Taro Yamada',
        country: 'JP',
        accountNumber: '12345678',
        currency: 'JPY',
      }),
    ).rejects.toThrow(/Missing bank details/i);
  });
});

describe('createWiseRecipient — IN/INR maps IFSC and prefers the bank rail', () => {
  const INR_REQS = [
    {
      type: 'indian',
      fields: [
        { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
        { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
        { name: 'IFSC', group: [{ key: 'ifscCode', required: true }] },
        { name: 'Account number', group: [{ key: 'accountNumber', required: true }] },
      ],
    },
    {
      type: 'indian_upi',
      fields: [
        { name: 'Legal type', group: [{ key: 'legalType', required: true }] },
        { name: 'Name', group: [{ key: 'accountHolderName', required: true }] },
        { name: 'UPI / account', group: [{ key: 'accountNumber', required: true }] },
      ],
    },
  ];

  it('routes the IFSC into ifscCode and selects `indian` over `indian_upi`', async () => {
    const { posted } = mockWise(INR_REQS);
    const res = await createWiseRecipient(CFG, {
      accountHolderName: 'Jane Doe',
      country: 'IN',
      accountNumber: '123456789012',
      routingNumber: 'HDFC0000123',
      currency: 'INR',
    });
    expect(res.type).toBe('indian'); // NOT 'indian_upi'
    expect(posted[0].details.ifscCode).toBe('HDFC0000123');
  });
});

describe('resolveTargetCurrency', () => {
  it('honours an explicit non-AUD currency', () => {
    expect(resolveTargetCurrency({ accountHolderName: 'x', currency: 'EUR' })).toBe('EUR');
  });
  it('derives USD from a US bank country', () => {
    expect(resolveTargetCurrency({ accountHolderName: 'x', country: 'US' })).toBe('USD');
  });
  it('derives the currency from an IBAN country prefix', () => {
    expect(
      resolveTargetCurrency({ accountHolderName: 'x', accountNumber: 'DE89370400440532013000' }),
    ).toBe('EUR');
  });
  it('throws WiseCurrencyError when no signal resolves the currency', () => {
    expect(() =>
      resolveTargetCurrency({ accountHolderName: 'x', country: 'ZZ', accountNumber: '12345678' }),
    ).toThrow(WiseCurrencyError);
  });
});
