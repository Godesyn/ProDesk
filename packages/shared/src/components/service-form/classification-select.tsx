import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';
import { InputLabel, SectionHeader } from './section-header';

/**
 * Sub-stage classification dropdown (ports `_buildClassificationSection`).
 * Stages are rendered as disabled bold optgroups; selecting a substage sets the
 * sub-stage and infers the parent stage. Required.
 *
 * The taxonomy is the admin-editable Infin8 list from globalSettings (the single
 * source of truth), fetched live — not a hardcoded constant.
 */
export function ClassificationSelect({
  subStage,
  onChange,
  error,
}: {
  subStage: string;
  onChange: (subStage: string, stage: string) => void;
  error?: string | null;
}) {
  const trpc = useTRPC();
  const stages = useQuery(trpc.agencies.infin8Stages.queryOptions()).data ?? [];

  return (
    <div>
      <SectionHeader title="Classification" />
      <InputLabel label="Sub Stage" required />
      <select
        className="h-10 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm"
        value={subStage}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange('', '');
          const stage = stages.find((s) => s.substages.includes(v))?.stage ?? '';
          onChange(v, stage);
        }}
      >
        <option value="">Select Sub Stage</option>
        {stages.map((stage) => (
          <optgroup key={stage.stage} label={stage.stage}>
            {stage.substages.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </div>
  );
}
