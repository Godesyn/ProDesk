import { Field } from '../../pages/agency/form-bits';
import { Input } from '../ui/input';
import { isBillingCycleWeekly, type ServiceType } from '@server/lib/service-type';
import { type DeliverableFrequency, DELIVERABLE_FREQUENCY_DISPLAY_NAME } from '@server/lib/deliverable-frequency';
import { SectionHeader, MoneyInput } from './section-header';

/**
 * Pricing block (ports `ServicePricingSection`, boxed variant). Recurring types
 * show Upfront + Recurring fees and a minimum-term row; everything else shows a
 * single one-time price.
 */
export function PricingSection({
  type,
  selectedFrequency,
  price,
  upfrontFee,
  recurringFee,
  minimumTerm,
  priceError,
  upfrontFeeError,
  recurringFeeError,
  minimumTermError,
  onPrice,
  onUpfrontFee,
  onRecurringFee,
  onMinimumTerm,
}: {
  type: ServiceType;
  selectedFrequency?: DeliverableFrequency | '';
  price: string;
  upfrontFee: string;
  recurringFee: string;
  minimumTerm: string;
  priceError?: string | null;
  upfrontFeeError?: string | null;
  recurringFeeError?: string | null;
  minimumTermError?: string | null;
  onPrice: (v: string) => void;
  onUpfrontFee: (v: string) => void;
  onRecurringFee: (v: string) => void;
  onMinimumTerm: (v: string) => void;
}) {
  const recurring = isBillingCycleWeekly(type);
  const termUnit = selectedFrequency
    ? DELIVERABLE_FREQUENCY_DISPLAY_NAME[selectedFrequency as DeliverableFrequency].toLowerCase()
    : 'weeks';

  return (
    <div>
      <SectionHeader title="Pricing" />
      {recurring ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Upfront Fee" error={upfrontFeeError}>
              <MoneyInput value={upfrontFee} onChange={onUpfrontFee} />
            </Field>
            <Field label="Recurring Fee" error={recurringFeeError}>
              <MoneyInput value={recurringFee} onChange={onRecurringFee} suffix="weekly" />
            </Field>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-4">
              <span className="shrink-0 text-base text-ink-80">Minimum term ( {termUnit} )</span>
              <Input className="flex-1" type="number" min="0" value={minimumTerm} placeholder="0" onChange={(e) => onMinimumTerm(e.target.value)} />
            </div>
            {minimumTermError && <span className="text-xs text-danger">{minimumTermError}</span>}
          </div>
        </div>
      ) : (
        <Field label="One-time Price" error={priceError}>
          <MoneyInput value={price} onChange={onPrice} />
        </Field>
      )}
    </div>
  );
}
