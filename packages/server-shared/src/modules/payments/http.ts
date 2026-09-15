/**
 * Payments (EziQuotes) Express surface — everything the Manus export mounted on
 * its own Express app (server/_core/index.ts) besides the Stripe webhook (folded
 * into modules/stripe/webhook.ts) and the Manus auth/session endpoints (dropped;
 * Supabase owns auth). Mounted by servers/backend via `mountPaymentsRoutes(app)`.
 *
 * All routes live under /api/payments/*. OAuth redirect URIs are built on
 * env.SERVER_ORIGIN — the backend's own public origin (Railway domain in hosted
 * envs; in dev the prodesk client's /api proxy forwards here) — because hosted
 * frontends are static and can't proxy /api. After processing, callbacks bounce
 * the browser back to the ORIGIN captured in the OAuth `state` (the payments
 * client that initiated the flow).
 */
import express, { type Express, type Request } from 'express';
import busboy from 'busboy';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentClients, paymentSmsLogs } from '../../db/schema.js';
import { env } from '../../lib/env.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import {
  getPaymentAccount,
  getBrandLegalName,
  getClientById,
  getProposalBySlug,
  updatePaymentAccount,
} from './db.js';
import { generateProposalPdf } from './pdf.js';
import { handleInboundSms } from './sms.js';
import {
  exchangeXeroCode,
  getXeroAuthUrl,
  getXeroTenants,
  exchangeMyobCode,
  getMyobAuthUrl,
  getMyobCompanyFiles,
} from './accounting.js';
import {
  exchangePipedriveCode,
  getPipedriveAuthUrl,
  getPipedriveCurrentUser,
  getPipedrivePipelines,
  isPipedriveConfigured,
} from './pipedrive.js';

/** Storage bucket for uploaded payments assets (logos, hero images, …). */
const ASSET_BUCKET = 'brand-files';

function decodeState(state: string): { origin?: string; brandId?: string } {
  try {
    return JSON.parse(Buffer.from(state, 'base64').toString());
  } catch {
    try {
      return JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return {};
    }
  }
}

/** brandId from a connect-route query (the export used ?accountId=). */
function brandIdParam(req: Request): string {
  return String(req.query.brandId ?? req.query.accountId ?? '');
}

async function storagePut(key: string, buf: Buffer, contentType: string) {
  const { error } = await supabaseAdmin.storage
    .from(ASSET_BUCKET)
    .upload(key, buf, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabaseAdmin.storage.from(ASSET_BUCKET).getPublicUrl(key);
  return { key, url: data.publicUrl };
}

/** Shared line-item extraction for the PDF/receipt endpoints (ports the export 1:1). */
function extractLineItems(structure: unknown) {
  const lineItems: Array<{
    name: string;
    description?: string;
    qty?: number;
    unitPriceCents: number;
    totalCents: number;
  }> = [];
  const rawBlocks = Array.isArray(structure) ? (structure as any[]) : [];
  const obj = (structure ?? {}) as Record<string, unknown>;
  const rawItems =
    rawBlocks.length > 0
      ? rawBlocks
          .filter((b: any) => (b.type === 'pricing' || b.type === 'pricing_table') && (Array.isArray(b.items) || Array.isArray(b.data?.lineItems)))
          .flatMap((b: any) => b.items ?? b.data?.lineItems ?? [])
      : ((obj.lineItems ?? []) as Array<Record<string, unknown>>);
  for (const item of rawItems) {
    lineItems.push({
      name: String(item.name ?? ''),
      description: item.description ? String(item.description) : undefined,
      qty: typeof item.qty === 'number' ? item.qty : 1,
      unitPriceCents:
        typeof item.unitPriceCents === 'number'
          ? item.unitPriceCents
          : typeof item.priceCents === 'number'
            ? (item.priceCents as number)
            : 0,
      totalCents:
        typeof item.totalCents === 'number'
          ? item.totalCents
          : typeof item.priceCents === 'number'
            ? (item.priceCents as number)
            : 0,
    });
  }
  return lineItems;
}

async function proposalPdfPayload(slug: string, receiptMode: boolean) {
  const proposal = await getProposalBySlug(slug);
  if (!proposal) return null;
  const [client, account, legalName] = await Promise.all([
    proposal.clientId ? getClientById(proposal.clientId, proposal.brandId) : Promise.resolve(null),
    getPaymentAccount(proposal.brandId),
    getBrandLegalName(proposal.brandId),
  ]);
  const structure = proposal.structure ?? {};
  const sections = ((structure as Record<string, unknown>).sections ?? []) as Array<{
    type: string;
    title?: string;
    content?: string;
  }>;
  return generateProposalPdf({
    title: proposal.title ?? 'Proposal',
    clientName: client?.name ?? 'Client',
    businessName: legalName ?? account?.businessName ?? 'Business',
    abn: account?.abn ?? undefined,
    totalCents: proposal.totalCents ?? 0,
    subtotalCents: proposal.subtotalCents ?? proposal.totalCents ?? 0,
    taxCents: proposal.taxCents ?? 0,
    taxLabel: account?.taxLabel ?? 'GST',
    taxRate: account?.defaultTaxRate ? parseFloat(account.defaultTaxRate) : 10,
    taxBehaviour: account?.taxBehaviourDefault ?? 'inclusive',
    currency: proposal.currency ?? 'AUD',
    paymentModel: proposal.paymentModel ?? 'one_off',
    lineItems: extractLineItems(structure),
    ...(receiptMode
      ? { receiptMode: true, paidAt: proposal.paidAt ?? proposal.updatedAt ?? new Date() }
      : { sections }),
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    slug: proposal.slug ?? '',
  });
}

export function mountPaymentsRoutes(app: Express) {
  const json50 = express.json({ limit: '50mb' });
  const urlenc = express.urlencoded({ extended: false });

  // ── Proposal PDF / receipt downloads ──────────────────────────────────────
  app.get('/api/payments/proposals/:slug/pdf', async (req, res) => {
    try {
      const pdf = await proposalPdfPayload(req.params.slug, false);
      if (!pdf) return res.status(404).json({ error: 'Proposal not found' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="proposal-${req.params.slug}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    } catch (err) {
      console.error('[payments] PDF generation failed:', (err as Error).message);
      res.status(500).json({ error: 'PDF generation failed' });
    }
  });

  app.get('/api/payments/proposals/:slug/receipt', async (req, res) => {
    try {
      const pdf = await proposalPdfPayload(req.params.slug, true);
      if (!pdf) return res.status(404).json({ error: 'Proposal not found' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="receipt-${req.params.slug}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.send(pdf);
    } catch (err) {
      console.error('[payments] Receipt PDF failed:', (err as Error).message);
      res.status(500).json({ error: 'Receipt PDF generation failed' });
    }
  });

  // ── Asset upload (multipart or JSON base64) — logos, hero images ─────────
  app.post('/api/payments/assets/upload', json50, async (req, res) => {
    try {
      const ct = (req.headers['content-type'] ?? '').toLowerCase();
      if (ct.includes('multipart/form-data')) {
        const bb = busboy({ headers: req.headers, limits: { fileSize: 8 * 1024 * 1024 } });
        let fileBuffer: Buffer | null = null;
        let fileMime = 'application/octet-stream';
        let assetType = 'attachment';
        bb.on('field', (name: string, val: string) => {
          if (name === 'assetType') assetType = val;
        });
        bb.on('file', (_field, stream, info) => {
          fileMime = info.mimeType;
          const chunks: Buffer[] = [];
          stream.on('data', (d: Buffer) => chunks.push(d));
          stream.on('end', () => {
            fileBuffer = Buffer.concat(chunks);
          });
        });
        await new Promise<void>((resolve, reject) => {
          bb.on('finish', resolve);
          bb.on('error', reject);
          req.pipe(bb);
        });
        if (!fileBuffer) return res.status(400).json({ error: 'No file received' });
        const key = `payments/assets/${assetType}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await storagePut(key, fileBuffer, fileMime);
        res.json(result);
      } else {
        const { key, contentType, data } = req.body as {
          key?: string;
          contentType?: string;
          data?: string;
        };
        if (!key || !data) return res.status(400).json({ error: 'key and data required' });
        const buf = Buffer.from(data, 'base64');
        const safeKey = `payments/assets/${key.replace(/^\/+/, '')}`;
        const result = await storagePut(safeKey, buf, contentType ?? 'application/octet-stream');
        res.json(result);
      }
    } catch (err) {
      console.error('[payments] asset upload failed:', (err as Error).message);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Twilio SMS delivery-status callback ───────────────────────────────────
  app.post('/api/payments/sms/status', urlenc, async (req, res) => {
    try {
      const { MessageSid, MessageStatus } = req.body as {
        MessageSid?: string;
        MessageStatus?: string;
      };
      if (MessageSid && MessageStatus) {
        await db
          .update(paymentSmsLogs)
          .set({ status: MessageStatus })
          .where(eq(paymentSmsLogs.twilioSid, MessageSid))
          .catch(() => {});
      }
      res.sendStatus(204);
    } catch (e) {
      console.error('[payments] SMS status callback error:', e);
      res.sendStatus(500);
    }
  });

  // ── Twilio inbound SMS (STOP / START compliance) ──────────────────────────
  app.post('/api/payments/sms/inbound', urlenc, async (req, res) => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
    try {
      const { From, Body } = req.body as { From?: string; Body?: string };
      if (From && Body) {
        const twiml = await handleInboundSms(From, Body);
        res.set('Content-Type', 'text/xml').send(twiml);
      } else {
        res.set('Content-Type', 'text/xml').send(empty);
      }
    } catch (e) {
      console.error('[payments] inbound SMS error:', e);
      res.set('Content-Type', 'text/xml').send(empty);
    }
  });

  // ── Postmark bounce/delivery webhook ──────────────────────────────────────
  app.post('/api/payments/email/webhook', express.json(), async (req, res) => {
    try {
      const payload = req.body as {
        RecordType?: string;
        Email?: string;
        Type?: string;
        Description?: string;
      };
      if (payload.RecordType === 'Bounce' && payload.Type === 'HardBounce' && payload.Email) {
        // The export flagged clients.emailBounced (a drifted ad-hoc column);
        // the ported schema expresses the same outcome as doNotEmail.
        await db
          .update(paymentClients)
          .set({ doNotEmail: true })
          .where(eq(paymentClients.email, payload.Email))
          .catch(() => {});
      }
      res.json({ received: true });
    } catch (e) {
      console.error('[payments] Postmark webhook error:', e);
      res.sendStatus(500);
    }
  });

  // ── Xero OAuth ─────────────────────────────────────────────────────────────
  app.get('/api/payments/xero/connect', (req, res) => {
    try {
      const origin = String(req.query.origin ?? env.SERVER_ORIGIN);
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/xero/callback`;
      const state = Buffer.from(
        JSON.stringify({ origin, brandId: brandIdParam(req) }),
      ).toString('base64');
      res.redirect(getXeroAuthUrl(redirectUri, state));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/payments/xero/callback', async (req, res) => {
    const { code, state } = req.query as Record<string, string>;
    const { origin, brandId } = decodeState(state ?? '');
    try {
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/xero/callback`;
      const tokens = await exchangeXeroCode(code, redirectUri);
      const tenants = await getXeroTenants(tokens.access_token);
      if (brandId) {
        await updatePaymentAccount(brandId, {
          xeroAccessToken: tokens.access_token,
          xeroRefreshToken: tokens.refresh_token,
          xeroTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          xeroTenantId: tenants[0]?.tenantId ?? '',
          xeroConnectedAt: new Date(),
        });
      }
      res.redirect(`${origin ?? ''}/settings/integrations?xero=connected`);
    } catch (err) {
      console.error('[payments] Xero OAuth callback error:', (err as Error).message);
      res.redirect(`${origin ?? ''}/settings/integrations?xero=error`);
    }
  });

  // ── MYOB OAuth ─────────────────────────────────────────────────────────────
  app.get('/api/payments/myob/connect', (req, res) => {
    try {
      const origin = String(req.query.origin ?? env.SERVER_ORIGIN);
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/myob/callback`;
      const state = Buffer.from(
        JSON.stringify({ origin, brandId: brandIdParam(req) }),
      ).toString('base64');
      res.redirect(getMyobAuthUrl(redirectUri, state));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/payments/myob/callback', async (req, res) => {
    const { code, state } = req.query as Record<string, string>;
    const { origin, brandId } = decodeState(state ?? '');
    try {
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/myob/callback`;
      const tokens = await exchangeMyobCode(code, redirectUri);
      const files = await getMyobCompanyFiles(tokens.access_token);
      if (brandId) {
        await updatePaymentAccount(brandId, {
          myobAccessToken: tokens.access_token,
          myobRefreshToken: tokens.refresh_token,
          myobTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          myobCompanyFileId: files[0]?.Uri ?? '',
          myobConnectedAt: new Date(),
        });
      }
      res.redirect(`${origin ?? ''}/settings/integrations?myob=connected`);
    } catch (err) {
      console.error('[payments] MYOB OAuth callback error:', (err as Error).message);
      res.redirect(`${origin ?? ''}/settings/integrations?myob=error`);
    }
  });

  // ── Stripe Connect OAuth callback ─────────────────────────────────────────
  // The authorize URL is built by trpc payments.integrations.stripe.connectUrl
  // (state = base64url({ brandId, origin })).
  app.get('/api/payments/stripe/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    const { origin, brandId } = state ? decodeState(state) : {};
    try {
      if (oauthError) {
        console.error('[payments] Stripe Connect OAuth denied:', oauthError);
        return res.redirect(`${origin ?? ''}/settings/integrations?stripe=denied`);
      }
      if (!code || !state) {
        return res.redirect(`${origin ?? ''}/settings/integrations?stripe=error`);
      }
      if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
      const tokenRes = await fetch('https://connect.stripe.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_secret: env.STRIPE_SECRET_KEY,
        }).toString(),
      });
      const tokenData = (await tokenRes.json()) as {
        stripe_user_id?: string;
        error?: string;
      };
      if (!tokenRes.ok || tokenData.error || !tokenData.stripe_user_id) {
        console.error('[payments] Stripe Connect token exchange failed:', tokenData);
        return res.redirect(`${origin ?? ''}/settings/integrations?stripe=error`);
      }
      if (brandId) {
        await updatePaymentAccount(brandId, {
          stripeConnectAccountId: tokenData.stripe_user_id,
          stripeConnectStatus: 'active',
          stripeConnectOnboarded: true,
        });
      }
      res.redirect(`${origin ?? ''}/settings/integrations?stripe=connected`);
    } catch (err) {
      console.error('[payments] Stripe Connect callback error:', (err as Error).message);
      res.redirect(`${origin ?? ''}/settings/integrations?stripe=error`);
    }
  });

  // ── Pipedrive OAuth ────────────────────────────────────────────────────────
  app.get('/api/payments/pipedrive/connect', (req, res) => {
    try {
      if (!isPipedriveConfigured()) {
        return res.status(400).json({
          error:
            'Pipedrive OAuth not configured. Add PIPEDRIVE_CLIENT_ID and PIPEDRIVE_CLIENT_SECRET.',
        });
      }
      const origin = String(req.query.origin ?? env.SERVER_ORIGIN);
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/pipedrive/callback`;
      const state = Buffer.from(
        JSON.stringify({ origin, brandId: brandIdParam(req) }),
      ).toString('base64');
      res.redirect(getPipedriveAuthUrl(redirectUri, state));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/payments/pipedrive/callback', async (req, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;
    const { origin, brandId } = decodeState(state ?? '');
    try {
      if (oauthError) {
        console.error('[payments] Pipedrive OAuth denied:', oauthError);
        return res.redirect(`${origin ?? ''}/settings/integrations?pipedrive=denied`);
      }
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/pipedrive/callback`;
      const tokens = await exchangePipedriveCode(code, redirectUri);
      const pdUser = await getPipedriveCurrentUser(tokens.access_token, tokens.api_domain);
      let firstPipelineId: number | null = null;
      try {
        const pipelines = await getPipedrivePipelines(tokens.access_token, tokens.api_domain);
        firstPipelineId = pipelines[0]?.id ?? null;
      } catch {
        /* non-fatal */
      }
      if (brandId) {
        await updatePaymentAccount(brandId, {
          pipedriveAccessToken: tokens.access_token,
          pipedriveRefreshToken: tokens.refresh_token,
          pipedriveTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          pipedriveApiDomain: tokens.api_domain,
          pipedriveConnected: true,
          pipedriveConnectedAt: new Date(),
          ...(firstPipelineId ? { pipedrivePipelineId: firstPipelineId } : {}),
        });
      }
      console.log(`[payments] Pipedrive connected for ${pdUser.email}`);
      res.redirect(`${origin ?? ''}/settings/integrations?pipedrive=connected`);
    } catch (err) {
      console.error('[payments] Pipedrive OAuth callback error:', (err as Error).message);
      res.redirect(`${origin ?? ''}/settings/integrations?pipedrive=error`);
    }
  });

  app.get('/api/payments/pipedrive/disconnect', async (req, res) => {
    try {
      const brandId = brandIdParam(req);
      const origin = String(req.query.origin ?? env.SERVER_ORIGIN);
      if (!brandId) return res.status(400).json({ error: 'brandId required' });
      await updatePaymentAccount(brandId, {
        pipedriveAccessToken: null,
        pipedriveRefreshToken: null,
        pipedriveTokenExpiresAt: null,
        pipedriveApiDomain: null,
        pipedriveConnected: false,
        pipedriveConnectedAt: null,
      });
      res.redirect(`${origin}/settings/integrations?pipedrive=disconnected`);
    } catch (err) {
      console.error('[payments] Pipedrive disconnect error:', (err as Error).message);
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
