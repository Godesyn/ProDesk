import type { Express, Request, Response, NextFunction } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { env } from '../../lib/env.js';
import { users, services } from '../../db/schema.js';

/**
 * Public partner REST API (ports third_party_integrations: get_user / update_user
 * / public_service). The user routes are authenticated with a shared `X-API-Key`
 * header matched against PARTNER_API_KEY (disabled — 404 — when the key isn't
 * configured). The agency service catalog (`GET /agencies/:id/services`) is
 * public: it's the same data agencies embed into external sites.
 */
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (!env.PARTNER_API_KEY) return res.status(404).json({ error: 'Partner API not enabled' });
  const key = req.header('x-api-key');
  if (key !== env.PARTNER_API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

export function mountPartnerApi(app: Express) {
  // GET /api/v1/users/:id — public user profile (get_user).
  app.get('/api/v1/users/:id', requireApiKey, async (req, res) => {
    try {
      const u = (await db.select().from(users).where(eq(users.id, req.params.id)).limit(1))[0];
      if (!u) return res.status(404).json({ error: 'User not found' });
      res.json({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, profileUrl: u.profileUrl });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // PATCH /api/v1/users/:id — update a user's editable profile fields (update_user).
  app.patch('/api/v1/users/:id', requireApiKey, async (req, res) => {
    try {
      const body = (req.body ?? {}) as { firstName?: string; lastName?: string; profileUrl?: string };
      const set: Record<string, unknown> = {};
      if (typeof body.firstName === 'string') set.firstName = body.firstName;
      if (typeof body.lastName === 'string') set.lastName = body.lastName;
      if (typeof body.profileUrl === 'string') set.profileUrl = body.profileUrl;
      if (Object.keys(set).length === 0) return res.status(400).json({ error: 'No editable fields supplied' });
      const [u] = await db.update(users).set(set).where(eq(users.id, req.params.id)).returning();
      if (!u) return res.status(404).json({ error: 'User not found' });
      res.json({ id: u.id, firstName: u.firstName, lastName: u.lastName, profileUrl: u.profileUrl });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // GET /api/v1/agencies/:agencyId/services — an agency's live catalog (public_service).
  // Public (no API key): the live catalog is the same data agencies embed into
  // external sites via the integration prompt.
  app.get('/api/v1/agencies/:agencyId/services', async (req, res) => {
    try {
      const rows = await db
        .select()
        .from(services)
        .where(and(eq(services.agencyId, req.params.agencyId), eq(services.isActive, true), isNull(services.deletedAt)));
      res.json({ count: rows.length, services: rows });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
