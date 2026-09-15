/** Shared marketplace client types (mirrors the server service/variant shapes). */

export interface ServiceVariant {
  id: string;
  options?: Record<string, string>;
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}

export interface ServiceOption {
  name: string;
  choices?: string[];
}

export interface ServiceAddon {
  id: string;
  name: string;
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}

export interface SelectedAddon {
  id: string;
  name: string;
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}

/** A service row as returned by marketplace.browse / serviceById. */
export interface MarketplaceService {
  id: string;
  agencyId: string;
  name: string;
  description: string | null;
  type: string | null;
  price: string | number | null;
  upfrontFee: string | number | null;
  recurringFee: string | number | null;
  upfrontDeliveryFee: string | number | null;
  recurringDeliveryFee: string | number | null;
  imageUrl: string | null;
  videoUrl: string | null;
  imageAspectRatio?: number | null;
  stage: string | null;
  subStage: string | null;
  disciplines: string[] | null;
  options?: unknown[] | null;
  variants?: unknown[] | null;
  addons?: unknown[] | null;
  deliverableFrequency?: string | null;
  /** Service integration flags (gate the detail-dialog CTAs, mirror Flutter). */
  allowBuyNow?: boolean;
  allowBookMeeting?: boolean;
  allowSalesProposal?: boolean;
  agencyName?: string | null;
  agencyLogo?: string | null;
  isReferredAgency?: boolean;
  isPlatformVerifiedAgency?: boolean;
}

/** A configured cart line, persisted client-side (no cart table in schema). */
export interface CartLine {
  /** Stable key for the configured line (service + variant + options + addons + package). */
  key: string;
  service: MarketplaceService;
  quantity: number;
  minQuantity: number;
  selectedVariantId?: string;
  selectedOptions: Record<string, string>;
  selectedAddons: SelectedAddon[];
  packageId?: string;
  packageName?: string;
}

export interface PaymentPlan {
  id?: string;
  name: string;
  upfrontPercentage: number;
  interestRate?: number;
  durationWeeks: number;
  isActive?: boolean;
}
