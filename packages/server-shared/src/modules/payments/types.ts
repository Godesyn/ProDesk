/**
 * Payments (EziQuotes) — shared domain types, single entry point.
 *
 * The export's shared/types.ts merely re-exported its drizzle row types (those
 * now live on ../../db/schema.ts as `PaymentX` / `InsertPaymentX` exports) plus Manus
 * auth/session types (dropped — platform Supabase auth replaces them). The
 * genuine domain shapes live with their logic and are re-exported here so
 * routers/jobs have one import site.
 */

export type {
  PaymentModel,
  BillingCycle,
  LineItem,
  PaymentConfig,
  PaymentSummary,
  InstallmentSummary,
  SubscriptionSummary,
  DualOptionSummary,
  ProposalForDisplay,
} from './payment-model-calc.js';

export type { MergeFieldContext } from './merge-fields.js';

export type { Tier, FeeResolution, ChargeResolution, TierInfo, PlanTierRow } from './fee-calc.js';
