/**
 * Prodesk's own platform/legal identity — a 1:1 port of the constants on the
 * Flutter `SubdomainDetector` (lib/src/core/utils/subdomain_detector.dart).
 *
 * Used wherever Prodesk itself is a party on a document. In particular it
 * populates the "from"/"to" block of a tax invoice when the stored party is
 * `{ isProdesk: true }` (the platform's own commission/affiliate legs), matching
 * `InvoiceService.invoiceItemToServiceUser` in the Flutter app.
 */
export const PRODESK_IDENTITY = {
  /** Display / legal name. */
  name: 'Prodesk',
  nameLower: 'prodesk',
  tagline: 'EVERYTHING CLICKS',
  /** Registered business address (AU). */
  address: '227/10 Albert Avenue, Broadbeach QLD 4218 AU',
  /** Australian Business Number. */
  abn: '38696024432',
  /** Australian Company Number. */
  acn: '696024432',
} as const;
