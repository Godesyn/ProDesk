/**
 * Payments (EziQuotes) — Xero & MYOB OAuth integration helpers, ported from
 * the export's server/accounting.ts.
 *
 * OAuth credentials are stored per-brand in the `payment_accounts` table.
 * The OAuth flow is:
 *   1. Frontend redirects to the Xero/MYOB connect endpoint
 *   2. User authorises in Xero/MYOB
 *   3. Xero/MYOB redirects back to our callback
 *   4. We exchange the code for tokens and store them in the DB
 *
 * Auto-create invoice on proposal acceptance:
 *   - Called from the proposals router when status changes to "accepted"
 *   - Creates a draft invoice in Xero/MYOB with the proposal line items
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentAccounts } from '../../db/schema.js';
import { env } from '../../lib/env.js';

// ─── Xero ────────────────────────────────────────────────────────────────────

const XERO_CLIENT_ID = env.XERO_CLIENT_ID ?? '';
const XERO_CLIENT_SECRET = env.XERO_CLIENT_SECRET ?? '';
// Granular scopes (required for Web/PKCE apps from March 2026; broad scopes deprecated Sept 2027)
const XERO_SCOPES = [
  'accounting.invoices',
  'accounting.payments',
  'accounting.banktransactions',
  'accounting.manualjournals',
  'accounting.contacts',
  'accounting.contacts.read',
  'accounting.settings',
  'accounting.settings.read',
  'offline_access',
].join(' ');

export function getXeroAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: XERO_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });
  return `https://login.xero.com/identity/connect/authorize?${params}`;
}

export async function exchangeXeroCode(code: string, redirectUri: string) {
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: XERO_CLIENT_ID,
      client_secret: XERO_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Xero token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function refreshXeroToken(refreshToken: string) {
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: XERO_CLIENT_ID,
      client_secret: XERO_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Xero token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function getXeroTenants(accessToken: string) {
  const res = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Xero connections failed: ${await res.text()}`);
  return res.json() as Promise<Array<{ tenantId: string; tenantName: string }>>;
}

export async function createXeroInvoice(opts: {
  accessToken: string;
  tenantId: string;
  contactName: string;
  contactEmail: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; taxType?: string }>;
  currency: string;
  reference?: string;
}) {
  const body = {
    Type: 'ACCREC',
    Contact: { Name: opts.contactName, EmailAddress: opts.contactEmail },
    LineItems: opts.lineItems.map(li => ({
      Description: li.description,
      Quantity: li.quantity,
      UnitAmount: li.unitAmount,
      TaxType: li.taxType ?? 'OUTPUT',
    })),
    CurrencyCode: opts.currency,
    Reference: opts.reference,
    Status: 'DRAFT',
  };
  const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Xero-Tenant-Id': opts.tenantId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Invoices: [body] }),
  });
  if (!res.ok) throw new Error(`Xero create invoice failed: ${await res.text()}`);
  const data = await res.json() as any;
  return data.Invoices?.[0];
}

// ─── MYOB ────────────────────────────────────────────────────────────────────

const MYOB_CLIENT_ID = env.MYOB_CLIENT_ID ?? '';
const MYOB_CLIENT_SECRET = env.MYOB_CLIENT_SECRET ?? '';
const MYOB_SCOPES = 'CompanyFile';

export function getMyobAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: MYOB_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: MYOB_SCOPES,
    state,
  });
  return `https://secure.myob.com/oauth2/account/authorize?${params}`;
}

export async function exchangeMyobCode(code: string, redirectUri: string) {
  const res = await fetch('https://secure.myob.com/oauth2/v1/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MYOB_CLIENT_ID,
      client_secret: MYOB_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
      scope: MYOB_SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`MYOB token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function refreshMyobToken(refreshToken: string) {
  const res = await fetch('https://secure.myob.com/oauth2/v1/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MYOB_CLIENT_ID,
      client_secret: MYOB_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`MYOB token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

export async function getMyobCompanyFiles(accessToken: string) {
  const res = await fetch('https://api.myob.com/accountright/', {
    headers: { Authorization: `Bearer ${accessToken}`, 'x-myobapi-key': MYOB_CLIENT_ID },
  });
  if (!res.ok) throw new Error(`MYOB company files failed: ${await res.text()}`);
  return res.json() as Promise<Array<{ Id: string; Name: string; Uri: string }>>;
}

export async function createMyobInvoice(opts: {
  accessToken: string;
  companyFileUri: string;
  contactName: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  currency: string;
  reference?: string;
}) {
  const body = {
    Number: opts.reference ?? 'AUTO',
    Customer: { Name: opts.contactName },
    Lines: opts.lineItems.map(li => ({
      Type: 'Transaction',
      Description: li.description,
      Units: li.quantity,
      UnitPrice: li.unitPrice,
    })),
    IsTaxInclusive: true,
    Status: 'Open',
  };
  const res = await fetch(`${opts.companyFileUri}/Sale/Invoice/Service`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'x-myobapi-key': MYOB_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`MYOB create invoice failed: ${await res.text()}`);
  return res.json();
}

// ─── Auto-create invoice on proposal acceptance ───────────────────────────────

export async function syncProposalToAccounting(opts: {
  brandId: string;
  proposalId: string;
  clientName: string;
  clientEmail: string;
  lineItems: Array<{ name: string; qty: number; unitCents: number }>;
  currency: string;
  proposalNumber: string;
}) {
  const [account] = await db
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.brandId, opts.brandId))
    .limit(1);
  if (!account) return;

  const items = opts.lineItems.map(li => ({
    description: li.name,
    quantity: li.qty,
    unitAmount: li.unitCents / 100,
    unitPrice: li.unitCents / 100,
  }));

  // Xero sync
  if (account.xeroAccessToken && account.xeroTenantId) {
    try {
      let token = account.xeroAccessToken;
      // Refresh if expired
      if (account.xeroTokenExpiresAt && account.xeroTokenExpiresAt < new Date()) {
        const refreshed = await refreshXeroToken(account.xeroRefreshToken!);
        token = refreshed.access_token;
        await db.update(paymentAccounts).set({
          xeroAccessToken: refreshed.access_token,
          xeroRefreshToken: refreshed.refresh_token,
          xeroTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        }).where(eq(paymentAccounts.brandId, opts.brandId));
      }
      await createXeroInvoice({
        accessToken: token,
        tenantId: account.xeroTenantId,
        contactName: opts.clientName,
        contactEmail: opts.clientEmail,
        lineItems: items,
        currency: opts.currency,
        reference: opts.proposalNumber,
      });
      console.log(`[Accounting] Created Xero invoice for proposal ${opts.proposalId}`);
    } catch (err) {
      console.error(`[Accounting] Xero sync failed for proposal ${opts.proposalId}:`, err);
    }
  }

}
