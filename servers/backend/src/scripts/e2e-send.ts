import './env-setup.js';
import {
  addEmailAccountsToCampaign,
  addLeadsToCampaign,
  createCampaign,
  getCampaign,
  listCampaigns,
  setCampaignSchedule,
  setCampaignSequences,
  setCampaignStatus,
} from '@prodesk/server-shared/modules/outreach/smartlead';

/**
 * End-to-end SEND test.
 *
 * Its own campaign, containing only addresses the operator owns. Scraped
 * businesses live in a different campaign that is never started — a test is not
 * a reason to cold-email a real dental practice.
 */

/**
 * Addresses to send to. Env-driven and empty by default, deliberately: a test
 * script with real inboxes baked into it is a script that eventually emails
 * someone who didn't ask for it.
 *
 *   E2E_RECIPIENTS="you@example.com,Name,Company; other@example.com,Name,Co"
 */
const RECIPIENTS = (process.env.E2E_RECIPIENTS ?? '')
  .split(';')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [email, firstName, company] = entry.split(',').map((s) => s.trim());
    return { email, firstName: firstName || 'there', company: company || 'your business' };
  });

if (RECIPIENTS.length === 0) {
  console.error('Set E2E_RECIPIENTS="email,First,Company; email2,First,Company" first.');
  process.exit(1);
}

const NAME = 'E2E send test';
const MAILBOX_ID = Number(process.env.E2E_MAILBOX_ID ?? 22225114); // team@useprodesk.com

const log = (...a: unknown[]) => console.log('·', ...a);

const existing = (await listCampaigns()).find((c) => (c.name ?? '').trim() === NAME);
const campaign = existing ?? (await createCampaign(NAME));
log(existing ? `reusing campaign ${campaign.id}` : `created campaign ${campaign.id}`);

// A window wide enough that the test sends now rather than at 9am tomorrow.
await setCampaignSchedule(campaign.id, {
  timezone: 'Australia/Sydney',
  days_of_the_week: [0, 1, 2, 3, 4, 5, 6],
  start_hour: '00:00',
  end_hour: '23:59',
  // 3 is Smartlead's floor — 1 and 2 are rejected outright.
  min_time_btw_emails: 3,
  max_new_leads_per_day: 20,
});
log('schedule saved (24/7, so it sends immediately)');

await addEmailAccountsToCampaign(campaign.id, [MAILBOX_ID]);
log(`mailbox ${MAILBOX_ID} attached`);

// The real template, with the real merge tags, so this proves rendering too.
await setCampaignSequences(campaign.id, [
  {
    id: null,
    seq_number: 1,
    subject: 'Quick question about {{company_name}}',
    email_body:
      `Hi {{first_name}},<br><br>` +
      `I had a look at {{company_name}} — {{hook}}.<br><br>` +
      `We help local businesses turn happy customers into Google reviews without chasing them manually. ` +
      `Given {{detail}}, it seemed worth a note.<br><br>` +
      `Worth a quick chat?<br><br>Sajat`,
    seq_delay_details: { delay_in_days: 0 },
  },
]);
log('sequence saved');

await addLeadsToCampaign(
  campaign.id,
  RECIPIENTS.map((r) => ({
    email: r.email,
    first_name: r.firstName,
    company_name: r.company,
    custom_fields: {
      hook: "you're on 11 Google reviews at 4.2 stars — the typical business in your area is on 84",
      detail: 'the work you do',
      reviews: '11',
      rating: '4.2',
    },
  })),
);
log(`${RECIPIENTS.length} leads added: ${RECIPIENTS.map((r) => r.email).join(', ')}`);

await setCampaignStatus(campaign.id, 'ACTIVE');
const after = await getCampaign(campaign.id);
log(`campaign status: ${after.status}`);
log('done — Smartlead will send on its own scheduler within a few minutes.');

process.exit(0);
