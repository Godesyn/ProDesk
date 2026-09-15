import { Field, Select } from '../../pages/agency/form-bits';
import { Input } from '../ui/input';
import { DELIVERABLE_FREQUENCIES, DELIVERABLE_FREQUENCY_DISPLAY_NAME, type DeliverableFrequency } from '@server/lib/deliverable-frequency';
import { BoxedSection } from './section-header';

export type TaskMode = 'upfront' | 'recurring';

/** State bag for a single task block. */
export interface TaskState {
  taskName: string;
  projectDuration: string;
  /** The numeric budget value as typed; meaning depends on `budgetIsPercentage`. */
  contractorBudget: string;
  budgetIsPercentage: boolean;
  estimatedDuration: string;
  /** Recurring only. */
  repeatsEvery: string;
}

export function emptyTaskState(): TaskState {
  return { taskName: '', projectDuration: '', contractorBudget: '', budgetIsPercentage: false, estimatedDuration: '', repeatsEvery: '' };
}

/**
 * Upfront- or recurring-task block (ports `ServiceTaskSection`, boxed variant).
 * Contractor budget has a `$`/`%` prefix toggle; typing a leading `%` or `$`
 * inline flips the mode (matching Flutter `_handleBudgetTextChanged`).
 */
export function TaskSection({
  mode,
  state,
  onChange,
  selectedFrequency,
  onFrequencyChange,
  dollarOnly = false,
  errors,
}: {
  mode: TaskMode;
  state: TaskState;
  onChange: (next: TaskState) => void;
  /** Recurring only. */
  selectedFrequency?: DeliverableFrequency | '';
  onFrequencyChange?: (v: DeliverableFrequency | '') => void;
  /** When true, the contractor budget is always in dollars: no `$`/`%` toggle. */
  dollarOnly?: boolean;
  /** Per-field validation errors (see service-form/validation `TaskErrors`). */
  errors?: {
    taskName?: string;
    projectDuration?: string;
    contractorBudget?: string;
    estimatedDuration?: string;
    repeatsEvery?: string;
    frequency?: string;
  };
}) {
  const e = errors ?? {};
  const recurring = mode === 'recurring';
  const title = recurring ? 'Recurring Project Task' : 'Upfront Project Task';
  const taskNameHint = recurring ? 'e.g. Maintenance' : 'e.g. Initial Setup';
  const durationSuffix = recurring ? 'work days' : 'days';
  const hoursSuffix = recurring ? 'work hours' : 'hours';

  const set = <K extends keyof TaskState>(k: K, v: TaskState[K]) => onChange({ ...state, [k]: v });

  // Typing a `%` or `$` anywhere in the field acts as a shortcut to flip the
  // unit dropdown rather than being entered as text; the symbol is stripped and
  // only the numeric value is kept. (`dollarOnly` locks the unit to dollars.)
  function onBudgetChange(raw: string) {
    const numeric = raw.replace(/[^0-9.]/g, '');
    if (dollarOnly) {
      onChange({ ...state, budgetIsPercentage: false, contractorBudget: numeric });
    } else if (raw.includes('%')) {
      onChange({ ...state, budgetIsPercentage: true, contractorBudget: numeric });
    } else if (raw.includes('$')) {
      onChange({ ...state, budgetIsPercentage: false, contractorBudget: numeric });
    } else {
      set('contractorBudget', numeric);
    }
  }

  return (
    <BoxedSection>
      <h3 className="mb-6 text-base font-semibold text-ink-100">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Task Name" error={e.taskName}>
          <Input value={state.taskName} placeholder={taskNameHint} onChange={(ev) => set('taskName', ev.target.value)} />
        </Field>
        <Field label="Project Duration (Client Facing)" error={e.projectDuration}>
          <div className="flex h-10 items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-[color:var(--color-accent-ring)]">
            <input type="number" min="0" className="h-full flex-1 bg-transparent outline-none placeholder:text-ink-40" placeholder="e.g. 3" value={state.projectDuration} onChange={(ev) => set('projectDuration', ev.target.value)} />
            <span className="ml-1 text-xs text-ink-40">{durationSuffix}</span>
          </div>
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Contractor Budget (Default)" error={e.contractorBudget}>
          <div className="flex h-10 items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card pr-3 text-sm focus-within:ring-2 focus-within:ring-[color:var(--color-accent-ring)]">
            {dollarOnly ? (
              <span className="pl-3 pr-1 text-sm font-semibold text-ink-80">$</span>
            ) : (
              <select
                className="h-full rounded-l-[var(--radius-sm)] bg-transparent pl-3 pr-1 text-sm font-semibold outline-none"
                value={state.budgetIsPercentage ? '%' : '$'}
                onChange={(ev) => set('budgetIsPercentage', ev.target.value === '%')}
              >
                <option value="$">$</option>
                <option value="%">%</option>
              </select>
            )}
            <input
              type="text"
              inputMode="decimal"
              className="h-full flex-1 bg-transparent px-2 outline-none placeholder:text-ink-40"
              placeholder={dollarOnly || !state.budgetIsPercentage ? 'e.g. 500' : 'e.g. 20'}
              value={state.contractorBudget}
              onChange={(ev) => onBudgetChange(ev.target.value)}
            />
          </div>
        </Field>
        <Field label="Default Time Allocation (Contractor / Staff)" error={e.estimatedDuration}>
          <div className="flex h-10 items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-[color:var(--color-accent-ring)]">
            <input type="number" min="0" step="0.01" className="h-full flex-1 bg-transparent outline-none placeholder:text-ink-40" placeholder="e.g. 10.5" value={state.estimatedDuration} onChange={(ev) => set('estimatedDuration', ev.target.value)} />
            <span className="ml-1 text-xs text-ink-40">{hoursSuffix}</span>
          </div>
        </Field>
      </div>
      {recurring && (
        <div className="mt-3 flex items-start gap-3">
          <Field label="Repeats every (Count)" error={e.repeatsEvery}>
            <Input type="number" min="1" placeholder="e.g. 3" value={state.repeatsEvery} onChange={(ev) => set('repeatsEvery', ev.target.value)} />
          </Field>
          <div className="flex-[2]">
            <Field label="Frequency" error={e.frequency}>
              <Select value={selectedFrequency ?? ''} onChange={(v) => onFrequencyChange?.(v as DeliverableFrequency | '')}>
                <option value="">Select…</option>
                {DELIVERABLE_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{DELIVERABLE_FREQUENCY_DISPLAY_NAME[f]}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      )}
    </BoxedSection>
  );
}
