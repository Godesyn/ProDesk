/**
 * ServiceType — 1:1 port of Flutter `lib/src/shared/models/service_type.dart`.
 *
 * Dependency-free on purpose: imported as a VALUE by both the server and the
 * client (the client resolves it via the `@server/*` path alias). Do not add
 * server-only imports here.
 *
 * The 7 canonical values match the Flutter enum exactly. Note `meeting` is NOT
 * a service type — "book a meeting" is the `allowBookMeeting` flag on a normal
 * service. The legacy web enum (oneOff/recurring/digital/meeting) is migrated
 * to these values by migration 0007.
 */
export const SERVICE_TYPES = [
  'subscription',
  'oneOffService',
  'recurringService',
  'oneOffProductShips',
  'recurringProductShips',
  'digitalProduct',
  'section',
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Display names — verbatim from Flutter `ServiceType.displayName`. */
export const SERVICE_TYPE_DISPLAY_NAME: Record<ServiceType, string> = {
  subscription: 'Subscription',
  oneOffService: 'One off Service',
  recurringService: 'Recurring Service',
  oneOffProductShips: 'One off Product (Ships)',
  recurringProductShips: 'Recurring Product (Ships)',
  digitalProduct: 'Digital Product',
  section: 'Section',
};

/** Billed on a weekly cycle (Flutter `isBillingCycleWeekly`). */
export function isBillingCycleWeekly(t: ServiceType | null | undefined): boolean {
  return t === 'subscription' || t === 'recurringProductShips' || t === 'recurringService';
}

/** Project re-cycles a deliverable (Flutter `hasDeliverableCycle`). Subscriptions bill weekly but do NOT cycle a deliverable. */
export function hasDeliverableCycle(t: ServiceType | null | undefined): boolean {
  return t === 'recurringProductShips' || t === 'recurringService';
}

/** Physical product that ships → exposes delivery-fee fields (Flutter `hasShipping`). */
export function hasShipping(t: ServiceType | null | undefined): boolean {
  return t === 'oneOffProductShips' || t === 'recurringProductShips';
}

/** Single up-front payment (Flutter `isSinglePayment`). */
export function isSinglePayment(t: ServiceType | null | undefined): boolean {
  return t === 'oneOffProductShips' || t === 'oneOffService' || t === 'digitalProduct';
}

/** Digital download (Flutter `isDigital`). */
export function isDigital(t: ServiceType | null | undefined): boolean {
  return t === 'digitalProduct';
}

/** Types selectable in the Add-Service dialog — all except `section` (Flutter `_types`). */
export const ADD_SERVICE_TYPES: ServiceType[] = SERVICE_TYPES.filter((t) => t !== 'section');

/**
 * Types selectable in the New-Project / purchase + custom-item dialogs — all
 * except `section` and `digitalProduct` (Flutter `_types` in those dialogs).
 */
export const PURCHASE_SERVICE_TYPES: ServiceType[] = SERVICE_TYPES.filter(
  (t) => t !== 'section' && t !== 'digitalProduct',
);
