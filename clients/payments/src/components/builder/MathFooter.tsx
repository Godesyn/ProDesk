/**
 * MathFooter — sticky bottom bar.
 *
 * Three-zone CSS Grid layout (ITEM-4):
 *   [LEFT] Payment model selector + cadence/instalment controls
 *   [CENTRE] Cadence-led total (largest text on the bar)
 *   [RIGHT] Issue count + Send button
 *
 * No expand toggle, no absolute positioning, no collapsed/expanded state.
 */
import { Icon, fmtCurrency } from "./atoms";
import type { PaymentConfig } from "./types";

const CADENCE_OPTIONS = [
  { value: "weekly",      label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly",     label: "Monthly" },
  { value: "quarterly",   label: "Quarterly" },
  { value: "annually",    label: "Annually" },
];

interface MathFooterProps {
  subtotalCents: number;
  currency: string;
  paymentConfig: PaymentConfig;
  onPaymentConfigChange: (patch: Partial<PaymentConfig>) => void;
  issueCount: number;
  onSend: () => void;
  isSendDisabled?: boolean;
}

/** Returns the cadence-led display total — the amount the payer sees per billing period. */
function cadenceTotal(subtotalCents: number, cfg: PaymentConfig): number {
  const taxRate = (cfg.defaultTaxRate ?? 10) / 100;
  const gst = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + gst;

  if (cfg.paymentModel === "payment-plan") {
    const n = Math.max(1, parseInt(cfg.ppInstallments) || 3);
    return Math.round(totalCents / n);
  }
  return totalCents;
}

function cadenceTotalLabel(cfg: PaymentConfig): string {
  if (cfg.paymentModel === "subscription") {
    const cadence = cfg.subCadence || "monthly";
    return `Total \u00b7 ${cadence.charAt(0).toUpperCase() + cadence.slice(1)}`;
  }
  if (cfg.paymentModel === "payment-plan") {
    const n = Math.max(1, parseInt(cfg.ppInstallments) || 3);
    return `Per instalment \u00b7 ${n} total`;
  }
  if (cfg.paymentModel === "dual_option") {
    const disc = cfg.dualDiscountPct ?? 0;
    return disc > 0 ? `Upfront (${disc}% off) or pay plan` : "Upfront or pay plan";
  }
  return "Total (inc. GST)";
}

export function MathFooter({
  subtotalCents, currency, paymentConfig, onPaymentConfigChange, issueCount, onSend, isSendDisabled,
}: MathFooterProps) {
  const displayTotal = cadenceTotal(subtotalCents, paymentConfig);
  const totalLabel = cadenceTotalLabel(paymentConfig);
  const pm = paymentConfig.paymentModel;

  return (
    <div className="math-foot">
      <div className="math-bar">

        {/* ── ZONE LEFT: payment model + cadence controls ── */}
        <div className="mb-zone mb-zone-left">
          <span className="mb-eyebrow">Payment model</span>
          <div className="mb-model-selects">
            <div className="mb-select-wrap">
              <select
                className="mb-select"
                value={pm}
                aria-label="Payment model"
                onChange={e => onPaymentConfigChange({ paymentModel: e.target.value as PaymentConfig["paymentModel"] })}
              >
                <option value="one-off">One-off</option>
                <option value="subscription">Subscription</option>
                <option value="payment-plan">Payment plan</option>
                <option value="dual_option">Dual option</option>
              </select>
            </div>

            {pm === "subscription" && (
              <div className="mb-select-wrap">
                <select
                  className="mb-select"
                  value={paymentConfig.subCadence || "monthly"}
                  aria-label="Billing cadence"
                  onChange={e => onPaymentConfigChange({ subCadence: e.target.value })}
                >
                  {CADENCE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}

            {pm === "payment-plan" && (
              <>
                <div className="mb-select-wrap">
                  <input
                    type="number"
                    className="mb-select"
                    value={paymentConfig.ppInstallments || "3"}
                    onChange={e => onPaymentConfigChange({ ppInstallments: e.target.value })}
                    min={2} max={60} step={1}
                    style={{ width: 52, textAlign: "center" }}
                    aria-label="Number of instalments"
                    title="Number of instalments"
                  />
                  <span className="mb-select-suffix">×</span>
                </div>
                <div className="mb-select-wrap">
                  <select
                    className="mb-select"
                    value={paymentConfig.ppInterval || "monthly"}
                    aria-label="Instalment interval"
                    onChange={e => onPaymentConfigChange({ ppInterval: e.target.value })}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="fortnightly">Fortnightly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── ZONE CENTRE: cadence-led total (largest element) ── */}
        <div className="mb-zone mb-zone-centre">
          <span className="mb-eyebrow">{totalLabel}</span>
          <span className="mb-total-value">{fmtCurrency(displayTotal, currency)}</span>
        </div>

        {/* ── ZONE RIGHT: issues + send ── */}
        <div className="mb-zone mb-zone-right">
          {issueCount > 0 && (
            <span className="mb-issues">
              <Icon name="x" size={10} />
              {issueCount} issue{issueCount !== 1 ? "s" : ""}
            </span>
          )}
          <button
            type="button"
            className="btn primary"
            onClick={onSend}
            disabled={isSendDisabled}
            aria-label="Send proposal"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="send" size={13} />
            Send proposal
          </button>
        </div>

      </div>
    </div>
  );
}
