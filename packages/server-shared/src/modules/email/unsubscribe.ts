import type { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { emailUnsubscribes } from '../../db/schema.js';
import { UNSUBSCRIBE_CHANNELS, type UnsubscribeChannel } from './mailer.js';

const CHANNELS = new Set<string>(UNSUBSCRIBE_CHANNELS);

/**
 * GET /unsubscribe?type=<channel>&email=<email> — opt an email out of a channel.
 * Ports functions/src/modules/email/email_functions.ts `unsubscribe` (the
 * link embedded in every branded email's footer via getUnsubscribeUrl).
 * Token-less by design (same as prod): the link is unguessable enough for an
 * unsubscribe action, and only ever *adds* a suppression.
 */
export async function handleUnsubscribe(req: Request, res: Response) {
  const type = String(req.query.type ?? '');
  const email = String(req.query.email ?? '')
    .toLowerCase()
    .trim();

  if (!email || !CHANNELS.has(type)) {
    res
      .status(400)
      .send(
        unsubPage(
          'Invalid unsubscribe link',
          'This link is missing or has an unknown channel.',
        ),
      );
    return;
  }
  const channel = type as UnsubscribeChannel;

  try {
    const existing = (
      await db
        .select()
        .from(emailUnsubscribes)
        .where(eq(emailUnsubscribes.email, email))
        .limit(1)
    )[0];
    const channels = new Set(existing?.channels ?? []);
    channels.add(channel);
    const next = [...channels];
    await db
      .insert(emailUnsubscribes)
      .values({ email, channels: next })
      .onConflictDoUpdate({
        target: emailUnsubscribes.email,
        set: { channels: next, updatedAt: new Date() },
      });
    res
      .status(200)
      .send(
        unsubPage(
          'Unsubscribed',
          `${email} will no longer receive “${channel.replace(/_/g, ' ')}” emails. You can re-enable this anytime in your Prodesk email preferences.`,
        ),
      );
  } catch (err) {
    console.error(
      '[unsubscribe] failed',
      email,
      channel,
      (err as Error).message,
    );
    res
      .status(500)
      .send(unsubPage('Something went wrong', 'Please try again later.'));
  }
}

/** Minimal branded confirmation page. */
function unsubPage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
<body style="margin:0;background:#F5F6FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 0;"><tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;border:1px solid #E5E7EB;overflow:hidden;">
      <tr><td style="background:#111111;padding:28px 40px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:24px;font-weight:700;">Prodesk</h1></td></tr>
      <tr><td style="padding:36px 40px;"><h2 style="margin:0 0 12px;font-size:20px;color:#111827;">${title}</h2><p style="margin:0;font-size:15px;color:#6B7280;line-height:1.6;">${body}</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}
