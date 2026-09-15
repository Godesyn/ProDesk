import { Field } from '../../pages/agency/form-bits';
import { isBillingCycleWeekly, type ServiceType } from '@server/lib/service-type';
import { SectionHeader, MoneyInput } from './section-header';

/**
 * Delivery-fee block (ports `ServiceDeliveryFeeSection`). Only rendered for
 * shipping types. Recurring types show upfront + recurring delivery fees;
 * everything else shows a single delivery fee. All optional.
 */
export function DeliveryFeeSection({
  type,
  upfrontDeliveryFee,
  recurringDeliveryFee,
  upfrontDeliveryFeeError,
  recurringDeliveryFeeError,
  onUpfront,
  onRecurring,
}: {
  type: ServiceType;
  upfrontDeliveryFee: string;
  recurringDeliveryFee: string;
  upfrontDeliveryFeeError?: string | null;
  recurringDeliveryFeeError?: string | null;
  onUpfront: (v: string) => void;
  onRecurring: (v: string) => void;
}) {
  const recurring = isBillingCycleWeekly(type);
  return (
    <div>
      <SectionHeader title="Delivery Settings" />
      {recurring ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Upfront Delivery Fee" error={upfrontDeliveryFeeError}>
            <MoneyInput value={upfrontDeliveryFee} onChange={onUpfront} />
          </Field>
          <Field label="Recurring Delivery Fee" error={recurringDeliveryFeeError}>
            <MoneyInput value={recurringDeliveryFee} onChange={onRecurring} suffix="weekly" />
          </Field>
        </div>
      ) : (
        <Field label="Delivery Fee" error={upfrontDeliveryFeeError}>
          <MoneyInput value={upfrontDeliveryFee} onChange={onUpfront} />
        </Field>
      )}
    </div>
  );
}
