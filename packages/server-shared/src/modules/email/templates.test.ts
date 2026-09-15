import { describe, it, expect } from 'vitest';
import { templates } from './templates.js';

// Ports the intent of functions/test/test_emails — assert each template renders
// a subject + branded HTML body (and a working CTA where expected). Templates now
// render through the shared common-template shell (prod parity).
describe('email templates', () => {
  it('staffInvite includes org name + accept CTA', () => {
    const { subject, html } = templates.staffInvite({ orgName: 'Acme', name: 'Sam' });
    expect(subject).toContain('Acme');
    expect(html).toContain('Acme');
    expect(html).toContain('Staff Invitation');
    expect(html).toContain('Accept Invitation');
  });

  it('connectionRequest names the agency', () => {
    const { html } = templates.connectionRequest({ agencyName: 'Studio' });
    expect(html).toContain('Studio');
    expect(html).toContain('Review request');
  });

  it('taskAssigned references the task title + view CTA', () => {
    const { subject, html } = templates.taskAssigned({ taskTitle: 'Ship copy', assignerName: 'Sam', email: 'a@b.com' });
    expect(subject).toContain('Ship copy');
    expect(html).toContain('Sam');
    expect(html).toContain('View Task');
  });

  it('contractorInvite names the agency + accept CTA', () => {
    const { subject, html } = templates.contractorInvite({ agencyName: 'Studio' });
    expect(subject).toContain('Studio');
    expect(html).toContain('Contractor Invitation');
    expect(html).toContain('Accept Invitation');
  });

  it('softDeleteConfirm branches between refund and cancellation', () => {
    const refund = templates.softDeleteConfirm({ projectTitle: 'Logo', refundAmount: 50, confirmUrl: 'https://x' });
    expect(refund.subject).toContain('Refund Proposed');
    expect(refund.html).toContain('$50');
    const cancel = templates.softDeleteConfirm({ projectTitle: 'Logo', confirmUrl: 'https://x' });
    expect(cancel.subject).toContain('Cancellation Request');
    expect(cancel.html).toContain('no refunds will be issued');
  });

  it('feature subscription templates name the product + carry a subject', () => {
    const started = templates.featureSubscriptionStarted({ productName: 'Growth Strategy' });
    expect(started.subject).toContain('Growth Strategy');
    expect(started.html).toContain('Growth Strategy');

    const cancelled = templates.featureSubscriptionCancelled({ productName: 'Growth Strategy', endsOn: '14 Jul 2026' });
    expect(cancelled.subject).toContain('Cancelled');
    expect(cancelled.html).toContain('14 Jul 2026');

    const resumed = templates.featureSubscriptionResumed({ productName: 'Growth Strategy' });
    expect(resumed.subject).toContain('Resumed');
    expect(resumed.html).toContain('Growth Strategy');
  });

  it('resume subscription templates name the service for brand + agency', () => {
    expect(templates.resumeSubscriptionBrand({ brandName: 'Acme', serviceName: 'SEO' }).html).toContain('SEO');
    expect(templates.resumeSubscriptionAgency({ brandName: 'Acme', serviceName: 'SEO', agencyName: 'Studio' }).subject).toContain('SEO');
  });

  it('generic renders the CTA only when provided', () => {
    expect(templates.generic({ subject: 'Hi', body: 'Body' }).html).not.toContain('>Go<');
    expect(templates.generic({ subject: 'Hi', body: 'Body', ctaLabel: 'Go', ctaUrl: 'https://x' }).html).toContain('Go');
  });
});
