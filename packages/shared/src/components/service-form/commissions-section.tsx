import { Field } from '../../pages/agency/form-bits';
import { Input } from '../ui/input';
import { SectionHeader, BoxedSection } from './section-header';

/**
 * Three-up commission % fields (ports `ServiceCommissionsSection`, boxed
 * variant). Allocation / Briefing / Approval managers map to
 * production / briefing / internalApproval commissions.
 */
export function CommissionsSection({
  production,
  briefing,
  approval,
  productionError,
  briefingError,
  approvalError,
  onProduction,
  onBriefing,
  onApproval,
  baseline,
}: {
  production: string;
  briefing: string;
  approval: string;
  productionError?: string | null;
  briefingError?: string | null;
  approvalError?: string | null;
  onProduction: (v: string) => void;
  onBriefing: (v: string) => void;
  onApproval: (v: string) => void;
  /** Agency default commissions; when the entered values differ, a live note
   * is shown (ports `ServiceCommissionsSection._buildAgencyFooter`). */
  baseline?: { production: number; briefing: number; approval: number };
}) {
  // Live footer note (Flutter pink RGB 255,136,160): this service's commissions
  // diverge from the agency-wide defaults, so the change applies to it alone.
  const changed =
    baseline != null &&
    ((Number(production) || 0) !== baseline.production ||
      (Number(briefing) || 0) !== baseline.briefing ||
      (Number(approval) || 0) !== baseline.approval);

  return (
    <BoxedSection>
      <SectionHeader
        title="Service Commissions (%)"
        required
        subtitle="Use this section to allocate incentive commission to your team for managing different stages of the project"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Allocation Manager" error={productionError}>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0.0"
            value={production}
            onChange={(e) => onProduction(e.target.value)}
          />
        </Field>
        <Field label="Briefing Manager" error={briefingError}>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0.0"
            value={briefing}
            onChange={(e) => onBriefing(e.target.value)}
          />
        </Field>
        <Field label="Approval Manager" error={approvalError}>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder="0.0"
            value={approval}
            onChange={(e) => onApproval(e.target.value)}
          />
        </Field>
      </div>
      {changed && (
        <p className="mt-2 text-xs" style={{ color: 'rgb(255, 136, 160)' }}>
          NOTE: You are changing the commission for this service only.
        </p>
      )}
      {/* TODO (BY AI): Flutter also shows "NOTE: No staff is currently allocated
          as: <role>." when the agency has no allocation/briefing/approval designee.
          That needs the agency's designee ids (allocationDesigneeId, briefingDesigneeId,
          approvalDesigneeId) — extend agencies.commissionDefaults to return them and
          render the missing-designee note here. */}
    </BoxedSection>
  );
}
