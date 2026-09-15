/**
 * Payments (EziQuotes) — Pipedrive OAuth 2.0 helpers, ported 1:1 from the
 * export's server/pipedrive.ts. These are pure API helpers — persisting the
 * (refreshed) tokens onto payment_accounts is the caller's job (integrations
 * router), same as the source.
 *
 * Pipedrive uses a standard OAuth 2.0 Authorization Code flow.
 * Docs: https://pipedrive.readme.io/docs/marketplace-oauth-authorization
 *
 * Required env vars:
 *   PIPEDRIVE_CLIENT_ID     — App client ID from Pipedrive Marketplace
 *   PIPEDRIVE_CLIENT_SECRET — App client secret from Pipedrive Marketplace
 */

import { env } from '../../lib/env.js';

const PIPEDRIVE_CLIENT_ID = env.PIPEDRIVE_CLIENT_ID ?? '';
const PIPEDRIVE_CLIENT_SECRET = env.PIPEDRIVE_CLIENT_SECRET ?? '';
const PIPEDRIVE_AUTH_URL = 'https://oauth.pipedrive.com/oauth/authorize';
const PIPEDRIVE_TOKEN_URL = 'https://oauth.pipedrive.com/oauth/token';

export interface PipedriveTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  api_domain: string;
  scope: string;
}

export interface PipedriveUser {
  id: number;
  name: string;
  email: string;
  company_id: number;
  company_name: string;
  company_domain: string;
}

export interface PipedriveDeal {
  id: number;
  title: string;
  status: string;
  value: number;
  currency: string;
  person_id?: { value: number; name: string };
  org_id?: { value: number; name: string };
  stage_id: number;
  pipeline_id: number;
  add_time: string;
  update_time: string;
}

export interface PipedrivePerson {
  id: number;
  name: string;
  email: Array<{ value: string; primary: boolean }>;
  phone: Array<{ value: string; primary: boolean }>;
  org_id?: { value: number; name: string };
}

// ─── Auth URL ─────────────────────────────────────────────────────────────────
export function getPipedriveAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: PIPEDRIVE_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });
  return `${PIPEDRIVE_AUTH_URL}?${params.toString()}`;
}

// ─── Token Exchange ───────────────────────────────────────────────────────────
export async function exchangePipedriveCode(
  code: string,
  redirectUri: string
): Promise<PipedriveTokens> {
  const credentials = Buffer.from(`${PIPEDRIVE_CLIENT_ID}:${PIPEDRIVE_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(PIPEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pipedrive token exchange failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<PipedriveTokens>;
}

// ─── Token Refresh ────────────────────────────────────────────────────────────
export async function refreshPipedriveToken(refreshToken: string): Promise<PipedriveTokens> {
  const credentials = Buffer.from(`${PIPEDRIVE_CLIENT_ID}:${PIPEDRIVE_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(PIPEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pipedrive token refresh failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<PipedriveTokens>;
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function pipedriveGet<T>(
  accessToken: string,
  apiDomain: string,
  path: string
): Promise<T> {
  const base = apiDomain.startsWith('http') ? apiDomain : `https://${apiDomain}`;
  const res = await fetch(`${base}/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pipedrive GET ${path} failed: ${res.status} ${body}`);
  }
  const json = await res.json() as { success: boolean; data: T };
  return json.data;
}

async function pipedrivePost<T>(
  accessToken: string,
  apiDomain: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const base = apiDomain.startsWith('http') ? apiDomain : `https://${apiDomain}`;
  const res = await fetch(`${base}/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pipedrive POST ${path} failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { success: boolean; data: T };
  return json.data;
}

async function pipedrivePut<T>(
  accessToken: string,
  apiDomain: string,
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const base = apiDomain.startsWith('http') ? apiDomain : `https://${apiDomain}`;
  const res = await fetch(`${base}/v1${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pipedrive PUT ${path} failed: ${res.status} ${text}`);
  }
  const json = await res.json() as { success: boolean; data: T };
  return json.data;
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function getPipedriveCurrentUser(
  accessToken: string,
  apiDomain: string
): Promise<PipedriveUser> {
  return pipedriveGet<PipedriveUser>(accessToken, apiDomain, '/users/me');
}

export async function getPipedriveDeals(
  accessToken: string,
  apiDomain: string,
  limit = 100
): Promise<PipedriveDeal[]> {
  return pipedriveGet<PipedriveDeal[]>(accessToken, apiDomain, `/deals?limit=${limit}&status=open`);
}

export async function getPipedriveDeal(
  accessToken: string,
  apiDomain: string,
  dealId: number
): Promise<PipedriveDeal> {
  return pipedriveGet<PipedriveDeal>(accessToken, apiDomain, `/deals/${dealId}`);
}

export async function createPipedriveDeal(
  accessToken: string,
  apiDomain: string,
  deal: {
    title: string;
    value?: number;
    currency?: string;
    person_id?: number;
    org_id?: number;
    stage_id?: number;
    status?: string;
  }
): Promise<PipedriveDeal> {
  return pipedrivePost<PipedriveDeal>(accessToken, apiDomain, '/deals', deal);
}

export async function updatePipedriveDeal(
  accessToken: string,
  apiDomain: string,
  dealId: number,
  updates: Partial<{
    title: string;
    value: number;
    status: string;
    stage_id: number;
  }>
): Promise<PipedriveDeal> {
  return pipedrivePut<PipedriveDeal>(accessToken, apiDomain, `/deals/${dealId}`, updates);
}

export async function getPipedrivePersons(
  accessToken: string,
  apiDomain: string,
  limit = 100
): Promise<PipedrivePerson[]> {
  return pipedriveGet<PipedrivePerson[]>(accessToken, apiDomain, `/persons?limit=${limit}`);
}

export async function createPipedrivePerson(
  accessToken: string,
  apiDomain: string,
  person: {
    name: string;
    email?: string;
    phone?: string;
    org_id?: number;
  }
): Promise<PipedrivePerson> {
  const body: Record<string, unknown> = { name: person.name };
  if (person.email) body.email = [{ value: person.email, primary: true }];
  if (person.phone) body.phone = [{ value: person.phone, primary: true }];
  if (person.org_id) body.org_id = person.org_id;
  return pipedrivePost<PipedrivePerson>(accessToken, apiDomain, '/persons', body);
}

export async function getPipedriveStages(
  accessToken: string,
  apiDomain: string
): Promise<Array<{ id: number; name: string; pipeline_id: number; pipeline_name: string }>> {
  return pipedriveGet(accessToken, apiDomain, '/stages');
}

export async function getPipedrivePipelines(
  accessToken: string,
  apiDomain: string
): Promise<Array<{ id: number; name: string }>> {
  return pipedriveGet(accessToken, apiDomain, '/pipelines');
}

// ─── Config check ─────────────────────────────────────────────────────────────
export function isPipedriveConfigured(): boolean {
  return !!(PIPEDRIVE_CLIENT_ID && PIPEDRIVE_CLIENT_SECRET);
}
