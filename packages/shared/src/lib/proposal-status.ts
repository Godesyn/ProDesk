// Shared proposal status wording. Agencies are the senders; brands are the
// recipients, so a "sent" proposal reads as "Received" on the brand side.
export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', viewed: 'Viewed', accepted: 'Accepted',
  rejected: 'Declined', expired: 'Expired', changeRequested: 'Changes Requested',
  internal: 'Internal',
};

export const BRAND_STATUS_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  sent: 'Received',
};

export const statusLabel = (status: string, isAgency: boolean): string =>
  (isAgency ? STATUS_LABEL : BRAND_STATUS_LABEL)[status] ?? status;
