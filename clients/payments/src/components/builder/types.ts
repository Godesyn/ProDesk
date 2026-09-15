/**
 * Shared types for the ProposalBuilder component tree.
 * All tRPC procedures, state, and mutations live in ProposalBuilder.tsx (orchestrator).
 * These types describe the shapes passed down to child components.
 */

export interface LineItem {
  id: string;
  type: "product" | "addon" | "custom" | "break";
  name: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  taxBehaviour: "inclusive" | "exclusive" | "exempt";
  taxRate?: number;
  optional?: boolean;
  isQuantityEditable?: boolean;
  breakLabel?: string;
  category?: string;
  categoryCode?: string;
}

export type PaymentModel = "one-off" | "subscription" | "payment-plan" | "dual_option";

export type CommercialIntent = "ongoing_service" | "fixed_engagement" | "hybrid";

// EngagementConfig is DEPRECATED — fields folded into PaymentConfig per ITEM-7.
// Kept only for legacy type compatibility during migration. Do not use in new code.
/** @deprecated use PaymentConfig fields directly */
export interface EngagementConfig {
  commercialIntent: CommercialIntent;
  allowPayerCancel: boolean;
  allowPayerPause: boolean;
  allowPayerPayoutFull: boolean;
  allowPayerSkip: boolean;
  /** @deprecated removed per ITEM-7 — always allowed at system level */
  allowPayerCardUpdate: boolean;
  commitmentPeriodMonths: string;
  maxSkipsPerYear: string;
  maxPauseDaysPerYear: string;
  maxDeferralsPerPlan: string;
}

export interface PaymentConfig {
  paymentModel: PaymentModel;

  // ── Subscription fields (ITEM-3) ─────────────────────────────────────────
  subCadence: string;                // weekly | fortnightly | monthly | quarterly | annually
  subTerm: string;                   // 3m | 6m | 12m | 18m | 24m | 36m | open-ended
  subAutoRenew: boolean;             // auto-renew at end of term (hidden for open-ended)
  subSetupFeeEnabled: boolean;       // show setup fee
  subSetupFeeLabel: string;          // custom label, falls back to "Setup fee"
  subSetupFeeCents: number;          // amount in cents (inc. GST)
  /** @deprecated use subSetupFeeEnabled/subSetupFeeLabel/subSetupFeeCents */
  subUpfrontType: string;
  /** @deprecated */
  subUpfrontCustom: string;
  /** @deprecated */
  subUpfrontCustomName: string;

  // ── Payment plan fields (ITEM-1) ─────────────────────────────────────────
  ppDepositPct: number;              // 0-100, 0 means no deposit
  ppDepositLabel: string;            // custom label, falls back to "Deposit"
  ppInstallments: string;            // number of installments after deposit
  ppInterval: string;                // weekly | fortnightly | monthly
  /** @deprecated use ppDepositPct */
  ppDeposit: string;

  // ── Dual option fields (ITEM-10) ─────────────────────────────────────────
  dualDiscountPct: number;           // 0-50, vendor-set upfront discount %
  dualDiscountLabel: string;         // custom label, falls back to "Upfront discount"

  // ── Payer permissions (ITEM-7 — folded from EngagementCard) ─────────────
  allowPayerCancel: boolean;         // subscription only
  allowPayerPause: boolean;          // subscription only
  allowPayerSkip: boolean;           // subscription only
  allowPayerPayoutFull: boolean;     // payment-plan + dual_option pay-plan side
  maxPauseDaysPerYear: string;
  maxSkipsPerYear: string;
  commitmentPeriodMonths: string;

  // ── Account-level (inherited, not editable per-proposal) ─────────────────
  currency: string;
  defaultTaxRate: number;
}

export interface SaveState {
  saving: boolean;
  saved: boolean;
}

export interface CatalogProduct {
  id: string;
  name: string;
  description?: string;
  priceCents?: number;
  basePriceCents?: number;
  category?: string;
  categoryCode?: string;
}
