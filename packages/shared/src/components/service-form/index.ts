/**
 * Reusable service-form building blocks — a 1:1 port of the Flutter
 * `lib/src/shared/components/service_form/*` widgets plus the add_service
 * subflows. Consumed by the New/Edit Service dialog and (later) the Custom-Item
 * and New-Project dialogs.
 */
export { SectionHeader, InputLabel, BoxedSection, MoneyInput } from './section-header';
export { PricingSection } from './pricing-section';
export { DeliveryFeeSection } from './delivery-fee-section';
export { CommissionsSection } from './commissions-section';
export { TaskSection, emptyTaskState, type TaskMode, type TaskState } from './task-section';
export { ValuePropositionChips } from './value-proposition-chips';
export { ClassificationSelect } from './classification-select';
export { CustomFieldBuilder } from './custom-field-builder';
export { VariantsEditor } from './variants-editor';
export { AddonsEditor } from './addons-editor';
export { MediaAssetsSection } from './media-assets-section';
export { SettingsIntegrationsSection } from './settings-integrations-section';
export { StaffConfigDialog } from './staff-config-dialog';
export { DigitalFileAssetSection } from './digital-file-asset-section';
export * from './types';
export {
  hasErrors,
  maxBudgetPercentage,
  validatePricing,
  validateDeliveryFee,
  validateCommissions,
  commissionCapError,
  serviceBudgetValidator,
  projectBudgetValidator,
  validateTask,
  type PricingErrors,
  type DeliveryErrors,
  type CommissionErrors,
  type TaskErrors,
} from './validation';
